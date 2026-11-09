import os
import uuid
import asyncio
import logging
from typing import List, Dict, Any, Optional, Tuple
from grading.grader import calculate_grade, GradingResult, StepResult
from grading.rubric import Rubric, RubricObjective
from grading.strictness import GradingConfig
from review.detector import detect_review_needed, ReviewTask
from feedback.ai_feedback import generate_feedback, feedback_enabled
from grading.scores import round_score, percentage as score_percentage
from ocr.vision import extract_regions_from_image, MathRegion
from llm.router import complete_text, any_credentials

logger = logging.getLogger(__name__)
REPO_ROOT = os.path.dirname(os.path.abspath(__file__))


def ocr_summary(confidences: Optional[List[float]]) -> Tuple[Optional[float], str]:
    """Average OCR confidence (0-1) and its label: high, moderate, low, or unknown."""
    values = [float(c) for c in (confidences or []) if isinstance(c, (int, float))]
    if not values:
        return None, "unknown"
    avg = sum(values) / len(values)
    return round_score(avg), ("high" if avg >= 0.85 else "moderate" if avg >= 0.6 else "low")


def ocr_label_score(label_or_score) -> Optional[float]:
    """Accepts a stored label ("high"/"moderate"/"low") or number and returns a 0-1 score."""
    if isinstance(label_or_score, (int, float)):
        return float(label_or_score)
    return {"high": 1.0, "moderate": 0.7, "medium": 0.7, "low": 0.3}.get(str(label_or_score or "").lower())

async def extract_student_steps_from_pages(
    pages_bytes_list: List[bytes],
    ocr_strategy: str = "on_low_confidence",
    detail: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Extracts math steps across one or more pages in parallel for a single question.
    Preserves sequential page order and associates each step with its source page.
    """
    async def _extract_single_page(page_idx: int, img_bytes: bytes) -> List[Dict[str, Any]]:
        page_num = page_idx + 1
        page_tag = f"Page {page_num}"
        try:
            regions: List[MathRegion] = await extract_regions_from_image(
                img_bytes,
                media_type="image/jpeg",
                ensemble_mode=ocr_strategy,
                detail=detail
            )
            page_steps = []
            for r in regions:
                content = (r.content or "").strip()
                if content:
                    page_steps.append({
                        "id": str(uuid.uuid4()),
                        "page_number": page_num,
                        "page_tag": page_tag,
                        "text": content,
                        "confidence": getattr(r, "ocr_confidence", "high"),
                        "annotations": getattr(r, "annotations", []),
                        "bbox": getattr(r, "bbox", [])
                    })
            return page_steps
        except Exception as e:
            return [{
                "id": str(uuid.uuid4()),
                "page_number": page_num,
                "page_tag": page_tag,
                "text": "",
                "ocr_error": str(e),
                "confidence": "low",
                "annotations": []
            }]

    if not pages_bytes_list:
        return []
    page_results = await asyncio.gather(*[
        _extract_single_page(page_idx, img_bytes)
        for page_idx, img_bytes in enumerate(pages_bytes_list)
    ])
    all_steps = []
    for p_steps in page_results:
        all_steps.extend(p_steps)
    return all_steps


async def grade_single_question(
    teacher_question: Dict[str, Any],
    student_steps_text: List[str],
    strictness: str = "standard",
    generate_ai_feedback: bool = False,
    *,
    feedback_language: Optional[str] = None,
    ocr_confidences: Optional[List[float]] = None,
    submitted_pages: int = 0,
    has_discarded_work: bool = False,
    images: Optional[list] = None,
) -> Dict[str, Any]:
    """
    Grades student steps for one question against the teacher's rubric.

    Returns success=False when grading itself failed (model outage, bad response). Callers
    must not store that as a grade: a failure is not a zero. `images` ((bytes, media_type,
    caption) tuples) lets the LLM grader read the student's photos as well as the text.
    """
    teacher_steps = teacher_question.get("steps", [])
    objectives = []
    ref_parsed = []

    for i, step in enumerate(teacher_steps):
        s_text = step.get("text", "").strip()
        ref_parsed.append({"raw_text": s_text})
        obj_desc = step.get("objective", f"Step {i+1}")
        pts = float(step.get("points", 1.0))
        objectives.append(RubricObjective(id=f"step_{i+1}", objective=obj_desc, points=pts))

    if not objectives:
        max_p = float(teacher_question.get("max_points", 10.0))
        objectives.append(RubricObjective(id="step_1", objective="Complete Solution", points=max_p))

    rubric = Rubric(objectives=objectives)
    config = GradingConfig(strictness=strictness if strictness in ("strict", "standard", "lenient") else "standard")
    # An empty list routes to the grader's deterministic "not_attempted" fast path
    stu_parsed = [{"raw_text": line.strip()} for line in student_steps_text if line and line.strip()]
    avg_ocr, ocr_label = ocr_summary(ocr_confidences)

    try:
        grading_result: GradingResult = await calculate_grade(ref_parsed, stu_parsed, rubric, config, images=images)
    except Exception as e:
        logger.exception("Grading failed")
        return {
            "success": False,
            "error": str(e),
            "score": 0.0,
            "max_score": round_score(sum(o.points for o in objectives)),
            "percentage": 0.0,
            "requires_review": True,
            "review_reason": f"Grading failed and nothing was scored: {e}",
            "review_priority": "high",
            "steps": [],
            "feedback": None,
            "ocr_confidence": ocr_label,
            "ocr_confidence_score": avg_ocr,
        }

    review_task = detect_review_needed(
        grading_result, avg_ocr_confidence=avg_ocr, has_discarded_work=has_discarded_work
    )
    requires_review = review_task.requires_review
    review_reason = review_task.reason if requires_review else ""
    review_priority = review_task.priority if requires_review else "none"
    if submitted_pages and not stu_parsed and not images:
        # A photo that yields no readable work is an OCR problem until a teacher says otherwise
        requires_review, review_priority = True, "high"
        review_reason = " | ".join(r for r in (
            f"No work could be read from the {submitted_pages} submitted page(s); check the image before releasing this grade.",
            review_reason,
        ) if r)

    feedback_text = None
    if generate_ai_feedback and feedback_enabled():
        try:
            feedback_text = await generate_feedback(
                grading_result, language=_feedback_language(feedback_language), user_requested=True
            )
        except Exception:
            feedback_text = None

    # Build clean serialized step details for easy rendering and manual review
    steps_data = []
    for step in grading_result.steps:
        steps_data.append({
            "section": step.section,
            "status": step.status,
            "points_awarded": round_score(step.points_awarded),
            "points_possible": round_score(step.points_possible),
            "reason": step.reason or "No deduction reason recorded.",
            "expected": step.expected or "",
            "student": step.student or ("; ".join(step.student_lines) if step.student_lines else ""),
            "student_lines": step.student_lines or [],
            "error_type": step.error.type if step.error else None,
            "error_desc": step.error.description if step.error else None
        })

    score = round_score(grading_result.score)
    max_score = round_score(grading_result.max_score)
    return {
        "success": True,
        "score": score,
        "max_score": max_score,
        "percentage": score_percentage(score, max_score),
        "confidence": round_score(getattr(grading_result, "confidence", 1.0)),
        "confidence_score": round_score(getattr(grading_result, "confidence", 1.0)),
        "requires_review": requires_review,
        "review_reason": review_reason,
        "review_priority": review_priority,
        "steps": steps_data,
        "feedback": feedback_text,
        "ocr_confidence": ocr_label,
        "ocr_confidence_score": avg_ocr,
    }


def _feedback_language(language: Optional[str]) -> str:
    lang = (language or os.getenv("FEEDBACK_LANGUAGE", "ar")).lower().strip()
    return lang if lang in ("ar", "en") else "ar"


def render_graded_overlays(question_result: Dict[str, Any], title: str = "") -> List[bytes]:
    """
    PNG overlays of the grading drawn on the student's own page(s). Uses the page
    images and OCR regions stored on the question result under "pages"
    ([{"image_path", "regions"}]); returns [] for typed (image-less) answers.
    """
    from grading.overlay import render_question_overlays
    pages = []
    for page in question_result.get("pages") or []:
        path = page.get("image_path")
        if path and os.path.exists(path):
            with open(path, "rb") as f:
                pages.append({"image_bytes": f.read(), "regions": page.get("regions", [])})
    if not pages:
        return []
    return render_question_overlays(
        pages,
        question_result.get("steps", []),
        score=question_result.get("score"),
        max_score=question_result.get("max_score"),
        title=title,
        requires_review=bool(question_result.get("requires_review")),
    )


def recalculate_question_total(question_result: Dict[str, Any]) -> None:
    """Recalculates a question's score after manual teacher adjustments."""
    steps = question_result.get("steps", [])
    total_awarded = sum(float(s.get("points_awarded", 0.0)) for s in steps)
    max_p = float(question_result.get("max_score", sum(float(s.get("points_possible", 0.0)) for s in steps) or 10.0))
    question_result["score"] = round_score(total_awarded)
    question_result["max_score"] = round_score(max_p)
    question_result["percentage"] = score_percentage(total_awarded, max_p)


def recalculate_submission_overall(submission: Dict[str, Any]) -> None:
    """Recalculates total exam score, percentage, review flag and OCR summary across all questions."""
    questions = submission.get("questions", {})
    tot_score = sum(float(q.get("score", 0.0) or 0.0) for q in questions.values())
    tot_max = sum(float(q.get("max_score", 0.0) or 0.0) for q in questions.values())
    submission["total_score"] = round_score(tot_score)
    submission["max_total_score"] = round_score(tot_max)
    submission["percentage"] = score_percentage(tot_score, tot_max)
    submission["requires_review"] = any(bool(q.get("requires_review")) for q in questions.values())
    confidences = [c for c in (ocr_label_score(q.get("ocr_confidence_score", q.get("ocr_confidence")))
                               for q in questions.values()) if c is not None]
    submission["ocr_confidence"] = min(confidences) if confidences else None
    grading_conf = [float(q["confidence"]) for q in questions.values() if isinstance(q.get("confidence"), (int, float))]
    submission["confidence_score"] = round_score(sum(grading_conf) / len(grading_conf)) if grading_conf else None


async def generate_question_ai_feedback(steps_data: List[Dict[str, Any]], language: Optional[str] = None) -> str:
    """
    Generates concise AI feedback for a graded question.
    Supports Arabic ('ar') and English ('en') based on the language parameter
    or FEEDBACK_LANGUAGE environment setting.
    """
    if not feedback_enabled():
        return None
    lang = _feedback_language(language)

    mistakes = []
    correct_steps = []
    total_earned = 0.0
    total_possible = 0.0
    for s in steps_data:
        sec = s.get("section", "Step")
        exp = s.get("expected", "")
        stu = s.get("student", "")
        status = s.get("status", "")
        reason = s.get("reason", "")
        pts_awarded = float(s.get("points_awarded", s.get("earned", 0.0)))
        pts_possible = float(s.get("points_possible", s.get("points", 0.0)))
        total_earned += pts_awarded
        total_possible += pts_possible

        # Build the step notes in the prompt's own language
        if status == "correct" and (pts_possible == 0.0 or pts_awarded >= pts_possible):
            correct_steps.append(
                f"{sec}: تم الحصول على '{stu}' بشكل صحيح." if lang == "ar"
                else f"{sec}: correctly wrote '{stu}'."
            )
        else:
            lost = max(0.0, pts_possible - pts_awarded)
            mistakes.append(
                f"{sec} ({status}): المتوقع '{exp}'، والمدون '{stu}'. مقدار الخصم: {lost:g} درجة. التعليل: {reason}"
                if lang == "ar"
                else f"{sec} ({status}): expected '{exp}', student wrote '{stu}'. Points lost: {lost:g}. Reason: {reason}"
            )

    if not mistakes and (total_possible == 0.0 or total_earned >= total_possible):
        return "عفية عليك وأحسنت بطل! إجابة ممتازة وجميع خطوات الحل صحيحة ومكتملة رياضياً، عاشت إيدك." if lang == "ar" else "All steps in this question are mathematically correct! Excellent work."

    if not mistakes and total_earned < total_possible:
        lost_total = total_possible - total_earned
        mistakes.append(
            f"خصم بالدرجات: تم خصم {lost_total:g} درجة من المجموع الكلي للسؤال." if lang == "ar"
            else f"Points deducted: {lost_total:g} from the question total."
        )

    if lang == "ar":
        prompt = f"""أنت مصحح رياضيات متخصص يقدم تعليقاً واضحاً وموجزاً لطالب في سؤال امتحاني.
درجة الطالب المستحقة في هذا السؤال: {int(round(total_earned))} من أصل {int(round(total_possible))} درجة.

عمل الطالب:
الخطوات الصحيحة:
{chr(10).join(correct_steps) if correct_steps else "لا يوجد"}

الأخطاء / مواضع الخصم والسهو:
{chr(10).join(mistakes)}

تنبيه مهم: دائماً استخدم لغة واضحة ومباشرة في "تعليق المصحح". بدلاً من شرح كيفية وقوع الخطأ أو إعطاء طريقة الحل بالتفصيل، حدد للطالب بدقة متناهية أين موقع الخطأ أو السهو في خطواته بالتحديد، ودعه يفكر ويستنتج ويكتشف الحل بنفسه:
1. أثنِ بإيجاز على ما قام به الطالب بشكل صحيح.
2. حدد بدقة موضع الخلل أو أين توقف/أخطأ في خطواته الرياضية دون حرق الحل، ليدركه الطالب بنفسه.
اجعل التعليق مركزاً وموجزاً وواضحاً دائماً."""
    else:
        prompt = f"""You are a precise mathematics grader giving concise feedback to a student for a single exam question.
Student score: {int(round(total_earned))} / {int(round(total_possible))}.

Student's work:
Correct steps:
{chr(10).join(correct_steps) if correct_steps else "None"}

Errors / Lost points:
{chr(10).join(mistakes)}

Write a clear, concise grader comment:
Always use clear writing: instead of explaining how the student went wrong or prescribing the full solution, state exactly WHERE they went wrong and let them figure it out.
Keep it concise, mathematical, and clear."""

    if not any_credentials():
        if lang == "ar":
            return f"عاشت إيدك، حلك جيد وحصلت على {total_earned:g} من {total_possible:g} درجة، بس دير بالك من السهو بالخطوات اللي راحت عليك بيها درجات. راجع الحل النموذجي على كيفك حتى تضمن الدرجة الكاملة."
        return f"Student earned {total_earned:g}/{total_possible:g}. Review step deductions against expected solution."

    try:
        # Routed by FEEDBACK_MODEL; headroom covers reasoning/thinking tokens
        result = await complete_text("feedback", prompt)
        return result.text
    except Exception:
        if lang == "ar":
            return f"عاشت إيدك، حلك جيد وحصلت على {total_earned:g} من {total_possible:g} درجة، بس دير بالك من السهو بالخطوات اللي راحت عليك بيها درجات. راجع الحل النموذجي على كيفك حتى تضمن الدرجة الكاملة."
        return f"Student earned {total_earned:g}/{total_possible:g}. Review step deductions against expected solution."


async def grade_question_visually(
    teacher_question: Dict[str, Any],
    student_image_bytes: bytes,
    teacher_image_bytes: Optional[bytes] = None,
    model: Optional[str] = None,
    detail: str = "auto",
    language: str = "ar",
    strictness: str = "standard",
    save_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    [BETA FEATURE]
    Grades student handwritten solution directly on the image with reference to the teacher solution,
    and generates a human-like red pen overlay with checkmarks, circled mistakes, and symbol corrections.
    Model: `model`, else VISUAL_MODEL (Claude Haiku 5.5) via llm/router.py.
    Images are written to disk only when save_dir is given.
    """
    from grading.visual_grader import grade_paper_visually, VisualGradingResult

    # The answer key comes only from this question's own teacher_image_path. Guessing a
    # file by question number handed other exams Exam 1's key.
    if not teacher_image_bytes:
        t_path = teacher_question.get("teacher_image_path") or ""
        q_id = str(teacher_question.get("id", ""))
        if not t_path and q_id.startswith("q_exam1_"):
            # Only the bundled sample exam's questions (ids q_exam1_N) use its key images
            t_path = os.path.join("Exams", "Exam 1", "Teacher Solutions", f"Question {teacher_question.get('number', 1)}.png")
        if t_path and not os.path.isabs(t_path):
            t_path = os.path.join(REPO_ROOT, t_path)
        if t_path and os.path.isfile(t_path):
            try:
                with open(t_path, "rb") as ft:
                    teacher_image_bytes = ft.read()
            except OSError:
                pass

    teacher_steps = teacher_question.get("steps", [])
    max_pts = float(teacher_question.get("max_points", 10.0))
    q_statement = teacher_question.get("statement") or teacher_question.get("arabic_title", "")
    t_sol_text = teacher_question.get("teacher_solution_text", "")

    visual_res: VisualGradingResult = await grade_paper_visually(
        student_image_bytes=student_image_bytes,
        teacher_solution=teacher_steps,
        max_points=max_pts,
        teacher_image_bytes=teacher_image_bytes,
        question_statement=q_statement,
        teacher_solution_text=t_sol_text,
        model=model,
        detail=detail,
        language=language,
        strictness=strictness,
        save_dir=save_dir,
    )

    # Convert steps to standard dicts compatible with PDF & gradebook
    default_reason = "تم التقييم عبر الفحص البصري المباشر." if (language or "ar").lower().strip() == "ar" else "Evaluated via direct visual inspection."
    steps_data = []
    for s in visual_res.steps:
        steps_data.append({
            "section": s.section,
            "status": s.status,
            "points_awarded": round_score(s.points_awarded),
            "points_possible": round_score(s.points_possible),
            "reason": s.reason or default_reason,
            "expected": s.expected or "",
            "student": s.student_work or "",
            "student_lines": [s.student_work] if s.student_work else []
        })

    feedback_text = getattr(visual_res, "feedback", "") or (
        f"{visual_res.teacher_note}\\n\\n{visual_res.summary}" if visual_res.teacher_note else visual_res.summary
    )

    # Same review rules as the standard pipeline, plus any score the server had to reconcile.
    # The model reports no confidence, so none is invented.
    review = detect_review_needed(GradingResult(
        score=visual_res.score, max_score=visual_res.max_score, confidence=1.0,
        steps=[StepResult(section=s.section, status=s.status, points_awarded=s.points_awarded,
                          points_possible=s.points_possible, reason=s.reason or "") for s in visual_res.steps],
    ))
    reasons = [r for r in (
        f"Score reconciled: {visual_res.consistency_warning}" if visual_res.consistency_warning else "",
        review.reason if review.requires_review else "",
    ) if r]
    requires_review = bool(visual_res.consistency_warning) or review.requires_review

    return {
        "success": True,
        "score": round_score(visual_res.score),
        "max_score": round_score(visual_res.max_score),
        "percentage": score_percentage(visual_res.score, visual_res.max_score),
        "verdict": visual_res.verdict,
        "confidence": None,
        "requires_review": requires_review,
        "review_reason": " | ".join(reasons),
        "review_priority": ("high" if visual_res.consistency_warning else review.priority) if requires_review else "none",
        "summary": visual_res.summary,
        "teacher_note": visual_res.teacher_note,
        "overall_badge": visual_res.overall_badge,
        "feedback": feedback_text,
        "steps": steps_data,
        "annotations": [a.model_dump() for a in visual_res.annotations],
        "graded_image_path": visual_res.graded_image_path,
        "original_image_path": visual_res.original_image_path,
        "graded_image_base64": visual_res.graded_image_base64,
        "model": visual_res.model_used,
        "is_visual_grading": True,
        "is_beta": True,
    }
