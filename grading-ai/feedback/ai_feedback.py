import os
import re
import asyncio
import collections.abc
from typing import Iterable, List, Optional
from llm.router import complete_text, any_credentials
from grading.grader import GradingResult

def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def feedback_enabled() -> bool:
    """ENABLE_FEEDBACK=false turns feedback off everywhere (no model calls at all)."""
    return _env_flag("ENABLE_FEEDBACK", True)


def feedback_by_default() -> bool:
    """
    REQUEST_FEEDBACK=false means feedback is generated only when a request explicitly asks
    for it; true (the default) also generates it during grading.
    """
    return feedback_enabled() and _env_flag("REQUEST_FEEDBACK", True)


class FeedbackStr(str, collections.abc.Coroutine):
    def send(self, val):
        raise StopIteration(self)

    def throw(self, typ, val=None, tb=None):
        raise typ(val)

    def close(self):
        pass

    def __await__(self):
        yield from ()
        return self

MISCONCEPTION_TEMPLATES_AR = [
    {
        "id": "extraneous_root",
        "keywords": ["يهمل", "discard", "x^2 = -1", "x^2 = -9", "x^2 + 1", "x^2 + 9", "notin r", "notin r"],
        "advice": (
            "توجيه تربوي: عاشت إيدك على خطوات التحليل الرياضي، بس دير بالك عيني دائماً على شرط الأعداد الحقيقية (x ∈ ℝ) "
            "من تطلع قيم x و y؛ فالمعادلات اللي بيها مجموع مربعين مثل (x² + 1 = 0) أو (x² + 9 = 0) "
            "ما تمتلك حلول حقيقية ولازم تكتب يمها [يهمل] حتى تستبعد الحل غير الحقيقي قبل لا تكمل إيجاد قيم y وما تضيع عليك الدرجة."
        )
    },
    {
        "id": "sign_error",
        "keywords": ["-8 - 6i", "-8-6i", "sign error", "arithmetic", "إشارة", "i^2"],
        "advice": (
            "توجيه تربوي: عفية عليك صياغتك للمسألة حلوة ومرتبة. بس ركزلي كلش زين على إشارات ضرب الحدود التخيلية وتطبيق "
            "قاعدة (i² = -1) من توزع وتبسط؛ لأن غلطة إشارة وحدة بالبداية تخربط عليك باقي معادلات الحل."
        )
    },
    {
        "id": "quadratic_formula",
        "keywords": ["دستور", "quadratic", "discriminant", "مميز", "b^2-4ac", "b^2 - 4ac"],
        "advice": (
            "توجيه تربوي: بطل بترتيب المعادلة بالصورة القياسية. بس تذكر دائماً تطبق قانون الدستور بدقة: "
            "x = (-b ± √(b² - 4ac)) / (2a) وانتبه كلش زين لإشارة الحد (-b) ومضاعف المقام (2a)."
        )
    },
    {
        "id": "stopping_early",
        "keywords": ["not stated", "stopped", "لم يذكر", "لم يستكمل", "state final", "final root"],
        "advice": (
            "توجيه تربوي: عاشت إيدك خطواتك صحيحة ومضبوطة بإنك طلعت قيم المتغير الأول، بس دير بالك عيني لازم تكمل الحل للآخر "
            "وتحسب قيم المتغير المقابل، وبعدها تكتب الجذور النهائية بصيغة العدد المركب c = ±(x + yi) حتى تاخذ الدرجة الكاملة."
        )
    },
    {
        "id": "pure_imaginary_radical",
        "keywords": ["sqrt{-17}", "sqrt(-17)", "√-17", "تخيلي"],
        "advice": (
            "توجيه تربوي: دير بالك عيني، تذكر دائماً أن الجذر التربيعي للعدد السالب يطلع منه وحدة تخيلية i "
            "(يعني √( -a ) = ±√a i). ولا تنسى تكتب إشارتي الموجب والسالب للجذرين."
        )
    }
]

def _keyword_in(keyword: str, text: str) -> bool:
    """Whole-token match for Latin keywords ("2a" must not match "12a"); substring for Arabic."""
    kw = keyword.lower()
    if re.search(r"[a-z0-9]", kw):
        return re.search(rf"(?<![a-z0-9]){re.escape(kw)}(?![a-z0-9])", text) is not None
    return kw in text


def match_arabic_misconception_cache(evidence: Iterable[str]) -> Optional[str]:
    """
    RAG / Misconception Cache (Solution 6):
    Matches recurring Iraqi curriculum math mistakes against pre-approved,
    pedagogically certified Arabic guidance cards in Iraqi educational dialect.
    Delivers 0.00s latency and $0.00 token cost for standard errors.

    Pass what the STUDENT wrote and why it lost marks. The expected answer must not be
    included, or every question whose model answer contains "x^2 + 1" gets the same card.
    """
    combined_text = " ".join(str(e) for e in evidence if e).lower()
    for item in MISCONCEPTION_TEMPLATES_AR:
        for kw in item["keywords"]:
            if _keyword_in(kw, combined_text):
                return item["advice"]
    return None


async def _async_generate_feedback(grading_result: GradingResult, language: str = "ar", user_requested: bool = True) -> FeedbackStr:
    """
    Internal asynchronous feedback generator.
    constructive feedback based on the grading result in Iraqi Arabic (default) or English.
    Includes fallback safeguards to prevent 400 invalid_request_error token exhaustions.
    
    Feedback is optional and only generates when user_requested is True (or requested via user action).
    """
    if not feedback_enabled():
        return FeedbackStr("")
    if not user_requested:
        return "لم يُطلب التوجيه التربوي (اختياري بحسب رغبة المستخدم)." if language == "ar" else "Pedagogical feedback was not requested by user (optional mode)."

    cached_advice = None  # Only the Arabic path has a template cache
    if language == "ar":
        mistakes = []
        student_evidence = []
        for step in grading_result.steps:
            status = step.status
            pts_awarded = float(step.points_awarded)
            pts_possible = float(step.points_possible)
            if status != "correct":
                student_evidence.extend([step.student, step.reason])
            if status == "incorrect":
                mistakes.append(
                    f"- الخطوة '{step.section}': النتيجة المتوقعة هي '{step.expected}'، بينما كتب الطالب '{step.student}'. "
                    f"الخطأ: خطأ رياضي/حسابي. التعليل: {step.reason}"
                )
            elif status == "propagated_error":
                mistakes.append(
                    f"- الخطوة '{step.section}': كتب الطالب '{step.student}'. هذه الخطوة تمثل متابعة صحيحة لخطأ حسابي سابق، "
                    f"لكنها لا تطابق القيمة النموذجية '{step.expected}'."
                )
            elif status == "not_attempted":
                mistakes.append(
                    f"- الخطوة '{step.section}': لم يستكمل الطالب هذه الخطوة أو تركها دون حل. المطلوب كان: '{step.expected}'."
                )
            elif status == "partially_correct":
                mistakes.append(
                    f"- الخطوة '{step.section}': إجابة صحيحة جزئياً ولكنها غير مكتملة. المتوقع: '{step.expected}'، والمدون: '{step.student}'. "
                    f"التعليل: {step.reason}"
                )
            elif status == "uncertain":
                mistakes.append(
                    f"- الخطوة '{step.section}': غير مؤكدة. المتوقع: '{step.expected}'، والمدون: '{step.student}'."
                )
            elif pts_awarded < pts_possible:
                lost = round(pts_possible - pts_awarded, 2)
                mistakes.append(
                    f"- الخطوة '{step.section}': حصل خصم جزئي مقدار ({lost} درجة من أصل {pts_possible}). "
                    f"الملاحظة: {step.reason or 'سهو أو عدم اكتمال الصياغة'}. المتوقع: '{step.expected}'، والمدون: '{step.student}'."
                )

        if not mistakes and float(grading_result.score) < float(grading_result.max_score):
            lost_tot = round(float(grading_result.max_score) - float(grading_result.score), 2)
            mistakes.append(
                f"- هناك خصم بمقدار {lost_tot} درجة من المجموع الكلي (حصل على {grading_result.score} من {grading_result.max_score})."
            )
                
        if not mistakes and float(grading_result.score) >= float(grading_result.max_score):
            return "عفية عليك وأحسنت بطل! حلك ممتاز وكل خطوات الحل صحيحة ومضبوطة 100% رياضياً، عاشت إيدك."

        # ── Step 1: Check Pre-Certified Arabic Misconception Cache (0 Tokens, 0ms) ──
        cached_advice = match_arabic_misconception_cache(student_evidence)
        if cached_advice and len(mistakes) <= 2:
            return cached_advice
            
        prompt = f"""أنت مصحح رياضيات متخصص يقوم بتدقيق إجابة طالب لمرحلة السادس الإعدادي.
قام طالب بحل مسألة وحصل على نتيجة ({int(round(float(grading_result.score)))} من أصل {int(round(float(grading_result.max_score)))} درجة).
تم تدقيق خطوات حله وتحديد الملاحظات التالية:

{chr(10).join(mistakes)}

المطلوب:
اكتب في "تعليق المصحح" ملاحظة واضحة ومباشرة وموجزة (فقرة واحدة من سطرين فقط):
1. استخدم دائماً لغة واضحة ومباشرة: بدلاً من شرح كيفية وقوع الخطأ أو تفصيل طريقة الحل الرياضي، وضح للطالب بدقة متناهية أين موقع الخطأ أو السهو أو التوقف في خطواته بالتحديد (موضع الخلل).
2. دع الطالب يفكر ويستنتج ويكتشف طريقة الحل والتبسيط بنفسه."""
    else:
        mistakes = []
        for step in grading_result.steps:
            if step.status == "incorrect":
                mistakes.append(f"Section {step.section}: Expected '{step.expected}', but student wrote '{step.student}'. Mathematically incorrect.")
            elif step.status == "propagated_error":
                mistakes.append(f"Section {step.section}: Student wrote '{step.student}' which logically follows their previous mistake, but does not match expected '{step.expected}'.")
            elif step.status == "uncertain":
                mistakes.append(f"Section {step.section}: Could not verify this step. Expected '{step.expected}', student wrote '{step.student}'. Reason: {step.reason}")
            elif step.status == "not_attempted":
                mistakes.append(f"Section {step.section}: Student did not attempt this step. Expected '{step.expected}'.")
            elif step.status == "partially_correct":
                mistakes.append(f"Section {step.section}: Partially correct. Expected '{step.expected}', student wrote '{step.student}'. {step.reason}")
                
        if not mistakes:
            return "Great job! All steps are mathematically correct."
            
        prompt = f"""You are a helpful, encouraging math teacher.
A student just completed a math problem and their solution was graded by an automated system.
The automated system found the following mistakes:

{chr(10).join(mistakes)}

Write a short, encouraging explanation of their mistakes so they understand what went wrong.
Do NOT determine the final grade or points. Just explain the mathematical mistake simply.
Keep it brief and student-friendly.
"""

    if not any_credentials():
        if cached_advice:
            return FeedbackStr(cached_advice)
        if language != "ar":
            return FeedbackStr("Good attempt. Please review the flagged steps in the grading table above and check them against the rules.")
        return FeedbackStr("عاشت إيدك على محاولة الحل. راجع الملاحظات والخطوات المشار إلها بالتصحيح فوك حتى تضبط القواعد وما يتكرر الخطأ.")

    try:
        # Routed by FEEDBACK_MODEL (GPT or Claude) with FEEDBACK_FALLBACK_MODEL failover
        result = await complete_text("feedback", prompt)
        return FeedbackStr(result.text)
    except Exception as e:
        # Fallback to cached pedagogical advice if API fails or exhausts tokens
        if language == "ar":
            if cached_advice:
                return FeedbackStr(cached_advice)
            return FeedbackStr(
                "توجيه تربوي: عاشت إيدك، بس راجع الخطوات اللي أشرنالك عليها بالحل النموذجي فوك "
                "(خصوصاً الخطوات اللي صار بيها خصم درجات)، ودقق بالعمليات الحسابية حتى تطابق الحل المعتمد."
            )
        return FeedbackStr("Please review the steps noted in your grading report and verify the calculations against standard rules.")


def generate_feedback(grading_result: GradingResult, language: str = "ar", user_requested: bool = True):
    """
    Calls OpenAI API or cached pedagogical templates to generate student-friendly,
    constructive feedback based on the grading result in Arabic (default) or English.
    Supports both synchronous callers and asynchronous (await / asyncio.run) callers.
    """
    # Fast non-LLM paths:
    if not feedback_enabled():
        return FeedbackStr("")
    if not user_requested:
        msg = "لم يُطلب التوجيه التربوي (اختياري بحسب رغبة المستخدم)." if language == "ar" else "Pedagogical feedback was not requested by user (optional mode)."
        return FeedbackStr(msg)

    has_mistakes = (
        any(s.status in ("incorrect", "propagated_error", "not_attempted", "partially_correct", "uncertain") for s in grading_result.steps)
        or any(float(s.points_awarded) < float(s.points_possible) for s in grading_result.steps)
        or (float(grading_result.score) < float(grading_result.max_score))
    )
    if not has_mistakes and float(grading_result.score) >= float(grading_result.max_score):
        msg = "عفية عليك وأحسنت بطل! حلك ممتاز وكل خطوات الحل صحيحة ومضبوطة 100% رياضياً، عاشت إيدك." if language == "ar" else "Great job! All steps are mathematically correct."
        return FeedbackStr(msg)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        return _async_generate_feedback(grading_result, language=language, user_requested=user_requested)
    else:
        return asyncio.run(_async_generate_feedback(grading_result, language=language, user_requested=user_requested))
