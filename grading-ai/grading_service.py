import os
import uuid
import asyncio
from typing import List, Dict, Any, Optional
from grading.grader import calculate_grade, GradingResult, StepResult
from grading.rubric import Rubric, RubricObjective
from grading.strictness import GradingConfig
from review.detector import detect_review_needed, ReviewTask
from feedback.ai_feedback import generate_feedback
from ocr.vision import extract_regions_from_image, MathRegion
from llm.router import complete_text, any_credentials

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
    allow_equivalence: bool = True,
    generate_ai_feedback: bool = False
) -> Dict[str, Any]:
    """
    Grades student steps for a specific question against teacher question steps and rubric.
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
    config = GradingConfig(strictness=strictness)
    # An empty list routes to the grader's deterministic "not_attempted" fast path
    stu_parsed = [{"raw_text": line.strip()} for line in student_steps_text if line.strip()]

    try:
        grading_result: GradingResult = await calculate_grade(ref_parsed, stu_parsed, rubric, config)
        review_task = detect_review_needed(grading_result)
        
        feedback_text = None
        if generate_ai_feedback:
            try:
                feedback_text = await generate_feedback(grading_result, user_requested=True)
            except Exception:
                feedback_text = None

        # Build clean serialized step details for easy rendering and manual review
        steps_data = []
        for step in grading_result.steps:
            steps_data.append({
                "section": step.section,
                "status": step.status,
                "points_awarded": float(step.points_awarded),
                "points_possible": float(step.points_possible),
                "reason": step.reason or "No deduction reason recorded.",
                "expected": step.expected or "",
                "student": step.student or ("; ".join(step.student_lines) if step.student_lines else ""),
                "student_lines": step.student_lines or [],
                "error_type": step.error.type if step.error else None,
                "error_desc": step.error.description if step.error else None
            })

        return {
            "success": True,
            "score": round(float(grading_result.score), 1),
            "max_score": round(float(grading_result.max_score), 1),
            "percentage": round((grading_result.score / max(grading_result.max_score, 0.001)) * 100, 1),
            "confidence": round(float(getattr(grading_result, "confidence", 1.0)), 2),
            "confidence_score": round(float(getattr(grading_result, "confidence", 1.0)), 2),
            "requires_review": review_task.requires_review,
            "review_reason": review_task.reason if review_task.requires_review else "",
            "review_priority": review_task.priority if review_task.requires_review else "none",
            "steps": steps_data,
            "feedback": feedback_text
        }
    except Exception as e:
        max_p = float(teacher_question.get("max_points", 10.0))
        return {
            "success": False,
            "score": 0.0,
            "max_score": max_p,
            "percentage": 0.0,
            "requires_review": True,
            "review_reason": f"Grading error: {str(e)}",
            "review_priority": "high",
            "steps": [
                {
                    "section": "step_1",
                    "status": "uncertain",
                    "points_awarded": 0.0,
                    "points_possible": max_p,
                    "reason": f"Grading failure: {str(e)}",
                    "expected": "See teacher solution",
                    "student": "",
                    "student_lines": []
                }
            ],
            "feedback": None
        }


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
    question_result["score"] = round(total_awarded, 1)
    question_result["max_score"] = round(max_p, 1)
    question_result["percentage"] = round((total_awarded / max(max_p, 0.001)) * 100, 1)


def recalculate_submission_overall(submission: Dict[str, Any]) -> None:
    """Recalculates total exam score, percentage, and review flag across all questions."""
    questions = submission.get("questions", {})
    tot_score = sum(float(q.get("score", 0.0)) for q in questions.values())
    tot_max = sum(float(q.get("max_score", 0.0)) for q in questions.values())
    submission["total_score"] = round(tot_score, 1)
    submission["max_total_score"] = round(tot_max, 1)
    submission["percentage"] = round((tot_score / max(tot_max, 0.001)) * 100, 1)
    submission["requires_review"] = any(bool(q.get("requires_review")) for q in questions.values())


async def generate_question_ai_feedback(steps_data: List[Dict[str, Any]], language: Optional[str] = None) -> str:
    """
    Generates concise AI feedback for a graded question.
    Supports Arabic ('ar') and English ('en') based on the language parameter
    or FEEDBACK_LANGUAGE environment setting.
    """
    lang = (language or os.getenv("FEEDBACK_LANGUAGE", "ar")).lower().strip()
    if lang not in ("ar", "en"):
        lang = "ar"

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

        if status == "correct" and (pts_possible == 0.0 or pts_awarded >= pts_possible):
            correct_steps.append(f"{sec}: تم الحصول على '{stu}' بشكل صحيح.")
        else:
            lost = max(0.0, pts_possible - pts_awarded)
            mistakes.append(f"{sec} ({status}): المتوقع '{exp}'، والمدون '{stu}'. مقدار الخصم: {lost:g} درجة. التعليل: {reason}")

    if not mistakes and (total_possible == 0.0 or total_earned >= total_possible):
        return "عفية عليك وأحسنت بطل! إجابة ممتازة وجميع خطوات الحل صحيحة ومكتملة رياضياً، عاشت إيدك." if lang == "ar" else "All steps in this question are mathematically correct! Excellent work."

    if not mistakes and total_earned < total_possible:
        mistakes.append(f"خصم بالدرجات: تم خصم {total_possible - total_earned:g} درجة من المجموع الكلي للسؤال.")

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
        result = await complete_text("feedback", prompt, max_tokens=1500)
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
    language: str = "ar"
) -> Dict[str, Any]:
    """
    [BETA FEATURE]
    Grades student handwritten solution directly on the image with reference to the teacher solution,
    and generates a human-like red pen overlay with checkmarks, circled mistakes, and symbol corrections.
    Model: `model`, else VISUAL_MODEL (default gpt-5) via llm/router.py.
    """
    from grading.visual_grader import grade_paper_visually, VisualGradingResult

    # If teacher image not provided, check if stored in question or canonical Exam 1 folder
    if not teacher_image_bytes:
        t_path = teacher_question.get("teacher_image_path")
        if not t_path and (
            str(teacher_question.get("id", "")).startswith("q_exam1_")
            or teacher_question.get("teacher_solution_text")
        ):
            q_num = teacher_question.get("number", 1)
            candidate = os.path.join("Exams", "Exam 1", "Teacher Solutions", f"Question {q_num}.png")
            if os.path.exists(candidate):
                t_path = candidate
        if t_path and os.path.exists(t_path):
            try:
                with open(t_path, "rb") as ft:
                    teacher_image_bytes = ft.read()
            except Exception:
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
        language=language
    )

    # Convert steps to standard dicts compatible with PDF & gradebook
    default_reason = "تم التقييم عبر الفحص البصري المباشر." if (language or "ar").lower().strip() == "ar" else "Evaluated via direct visual inspection."
    steps_data = []
    for s in visual_res.steps:
        steps_data.append({
            "section": s.section,
            "status": s.status,
            "points_awarded": float(s.points_awarded),
            "points_possible": float(s.points_possible),
            "reason": s.reason or default_reason,
            "expected": s.expected or "",
            "student": s.student_work or "",
            "student_lines": [s.student_work] if s.student_work else []
        })

    feedback_text = getattr(visual_res, "feedback", "") or (
        f"{visual_res.teacher_note}\n\n{visual_res.summary}" if visual_res.teacher_note else visual_res.summary
    )

    return {
        "success": True,
        "score": visual_res.score,
        "max_score": visual_res.max_score,
        "percentage": visual_res.percentage,
        "verdict": visual_res.verdict,
        "confidence": 0.95,
        # Full marks with a consistent score skip review; anything else, or a score the
        # server had to reconcile, goes to the teacher.
        "requires_review": bool(visual_res.consistency_warning) or visual_res.score < visual_res.max_score,
        "review_reason": " | ".join(r for r in (
            f"Visual Grading: {visual_res.verdict} ({visual_res.overall_badge})",
            f"Score reconciled: {visual_res.consistency_warning}" if visual_res.consistency_warning else "",
        ) if r),
        "review_priority": "low" if visual_res.score >= visual_res.max_score * 0.7 else "medium",
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


