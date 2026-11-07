"""
grading/visual_grader.py — Multimodal LLM Visual Red-Pen Grading Engine [BETA].

Evaluates student handwritten solutions directly on the image against teacher solutions,
and uses high-resolution 2x supersampled red-pen overlay rendering to produce human-like teacher grading:
  - Checkmarks (✓) for correct steps
  - Crosses (✗) and strikethroughs on errors
  - Circled errors around specific incorrect symbols and signs
  - Direct handwritten symbol corrections (clean mathematical Unicode, no raw backslash LaTeX)
  - Circled final score bubble at the top-right margin in red pen
  - Strict 1-to-1 teacher rubric reconciliation, deterministic SymPy contradiction/equivalence verification,
    and rich Iraqi Arabic pedagogical feedback.

Model: VISUAL_MODEL via llm/router.py (default gpt-5, effort "medium"), with optional
VISUAL_FALLBACK_MODEL / MODEL_FALLBACK failover. Scores are reconciled against the
question's rubric in Python; the model's own totals are never trusted as-is.
"""

import io
import os
import re
import base64
import uuid
import logging
from typing import List, Dict, Any, Optional, Union, Tuple
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

from grading.red_pen_renderer import (
    render_red_pen_overlay_bytes,
    render_red_pen_overlay,
    has_arabic,
    format_math_for_overlay,
)
from feedback.ai_feedback import match_arabic_misconception_cache
from math_engine.verifier import verify_equivalence
from llm.router import complete_vision_json, model_for

logger = logging.getLogger(__name__)

UPLOADS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "uploads")

# Long-edge cap applied once before both the model call and the red-pen render, so the
# model's 0-1000 boxes and the rendered marks refer to the same pixels.
VISUAL_MAX_EDGE = 2048

ANNOTATION_TYPES = ("checkmark", "cross", "circle_error", "strikethrough", "correction", "comment")
STEP_STATUSES = ("correct", "incorrect", "partially_correct", "propagated_error", "not_attempted")

_UNATTEMPTED_MARKERS = frozenset({
    "", "none", "n/a", "na", "null", "not attempted", "not_attempted",
    "unattempted", "omitted", "blank", "missing", "no work", "nothing", "-", "—",
    "لا يوجد", "متروك", "متروكة", "لم يحل", "لم يتم الحل", "فارغ", "غير محلول",
})


class VisualAnnotation(BaseModel):
    box: List[int] = Field(default_factory=lambda: [0, 0, 0, 0], description="[ymin, xmin, ymax, xmax] normalized 0-1000")
    type: str = Field(default="checkmark", description="checkmark, cross, circle_error, strikethrough, correction, comment")
    content: str = Field(default="", description="Text to write or badge in red ink (e.g. '+17', '+2', '-1 sign')")
    target_text: str = Field(default="", description="What the student wrote")
    corrected_text: str = Field(default="", description="What the teacher expected / correct symbol")
    points_delta: float = Field(default=0.0, description="Points awarded (+pts) or deducted (-pts)")
    description: str = Field(default="", description="Pedagogical explanation of this mark")


class VisualStepResult(BaseModel):
    step_number: int = 1
    section: str = "step_1"
    student_work: str = ""
    expected: str = ""
    status: str = "correct"  # correct, incorrect, partially_correct, propagated_error, not_attempted
    points_awarded: float = 0.0
    points_possible: float = 1.0
    reason: str = ""


class VisualGradingResult(BaseModel):
    score: float = 0.0
    max_score: float = 10.0
    percentage: float = 0.0
    verdict: str = "correct"  # correct, partially_correct, incorrect
    summary: str = ""
    feedback: str = ""
    overall_badge: str = ""
    teacher_note: str = ""
    annotations: List[VisualAnnotation] = Field(default_factory=list)
    steps: List[VisualStepResult] = Field(default_factory=list)
    model_used: str = "gpt-5"
    is_beta: bool = True
    graded_image_path: Optional[str] = None
    original_image_path: Optional[str] = None
    graded_image_base64: Optional[str] = None
    # Set when the model's own total disagreed with its step points or exceeded the rubric
    consistency_warning: str = ""


class _VisualOutput(BaseModel):
    """Schema handed to the model (structured outputs on Claude; prompt schema on GPT)."""
    score: float = 0.0
    max_score: float = 0.0
    verdict: str = "partially_correct"
    summary: str = ""
    overall_badge: str = ""
    teacher_note: str = ""
    annotations: List[VisualAnnotation] = Field(default_factory=list)
    steps: List[VisualStepResult] = Field(default_factory=list)


VISUAL_GRADING_SYSTEM_PROMPT = r"""You are a strict, fair, and mathematically rigorous mathematics professor and senior exam grader holding a RED PEN.
You grade handwritten student solutions directly on the student's paper image by comparing every line against the teacher's official reference solution and rubric steps.

CRITICAL GRADING RULES (ZERO TOLERANCE FOR FALSE GRADES):
1. LITERAL VISUAL INSPECTION & GLOBAL NON-SEQUENTIAL COMPARISON:
   - Inspect ONLY what is physically written on the student's paper image from top to bottom AND across ALL columns (students frequently draw a vertical line down the middle of the page and continue their solution in a second column on the right or left — you MUST read both columns completely!).
   - Compare each equation, sign, exponent, coefficient, and final value against the Teacher's Official Solution / Rubric (and the Teacher's Reference Solution Image when attached).
   - Two expressions or equations that are algebraically equivalent MUST be classified as "correct" (e.g. `2xy = 4 => y = 2/x` vs `x = 2/y`, factored vs expanded, `x = ±2` vs `x = 2, -2`).
   - Recognize Arabic mathematical procedural annotations written by students:
     * "يهمل" or "يهمل ∉ R" written beside or under a non-real root (e.g., `x^2 + 1 = 0 يهمل` or `x^2 = -9 يهمل`) satisfies the rubric requirement to discard the extraneous root — award FULL CREDIT ("correct") for that step!
     * "بالتربيع" = squaring both sides; "بجذر الطرفين" = taking square roots; "نعوض 2 في 1" = substitution.

2. IMPLICIT SETUP & COMBINED STEPS vs. UNFINISHED SOLUTIONS:
   - You MUST evaluate EVERY rubric step listed in the Teacher's Official Solution / Rubric (`step_1` through `step_N`) and include an entry for EVERY rubric step in `steps`.
   - **Implicit Setup / Combined Steps (DO NOT penalize combined introductory lines)**:
     * Students frequently combine an introductory setup milestone (`step_1`, e.g. `sqrt(3+4i) = x + yi` or `c^2 = -17`) with its immediate operation (`step_2`, e.g. `(x+yi)^2 = 3+4i => x^2 - y^2 + 2xyi = 3 + 4i` or `sqrt(c^2) = sqrt(-17)`) on a single line.
     * When a written equation embodies both the setup milestone and the operational milestone, copy that written equation into `student_work` for BOTH steps and classify BOTH as `status: "correct"`.
   - **Unfinished / Incomplete Solutions (NEVER award points for unwritten calculations)**:
     * If a student stopped midway through the problem (for example, derived the quartic equation `x^4 - 3x^2 - 4 = 0` at `step_5`, and NEVER wrote the factoring or final roots for `step_6`..`step_9`), you MUST set `status: "not_attempted"`, `student_work: ""`, and `points_awarded: 0` for EVERY unwritten remaining step!
     * NEVER copy or hallucinate the teacher's expected equations into `student_work` if those calculations are not visibly written by the student on the student's page!
     * NEVER inflate `points_possible` or `points_awarded` on earlier steps to make up for unattempted steps.

3. WRONG STEPS, SIGN ERRORS & PROPAGATED ERRORS:
   - Carefully verify every sign (`+` vs `-`), number, variable power, and imaginary unit `i`.
   - If the student wrote a wrong equation, wrong sign (e.g., `-8 - 6i` instead of `-8 + 6i`, or `c^2 = 17` instead of `c^2 = -17`), wrong factoring (e.g., `(x^2 + 9)(x^2 - 1) = 0` instead of `(x^2 - 9)(x^2 + 1) = 0`), or invalid algebraic step, classify that step as `status: "incorrect"` with `points_awarded: 0`, and place a `"circle_error"` or `"cross"` red-pen annotation on the mistake (NEVER place a `"checkmark"` on an incorrect step).
   - **Propagated Error Tracking (CRITICAL — do not double-penalize)**:
     * If a subsequent step does not match the teacher's numerical answer ONLY because it logically and correctly follows from the student's own earlier error (for example, solving their own wrong equation `(x^2 + 9)(x^2 - 1) = 0` to get `x^2 = -9 (يهمل), x = ±1` and substituting `x = ±1` to find `y = ±3`), classify those subsequent steps as `status: "propagated_error"` (NOT `"incorrect"` or `"not_attempted"`) and record what the student wrote in `student_work`.

4. GENERATE AUTHENTIC RED-PEN MARKS WITH PRECISE BOUNDING BOXES:
   Provide bounding boxes [ymin, xmin, ymax, xmax] normalized on a 0-1000 coordinate scale of the STUDENT'S paper image:
   - "checkmark": ONLY for genuinely correct steps written on the page. Set `content` to the points awarded only (e.g. "+2", "+4"), without a leading checkmark symbol.
   - "circle_error": hand-drawn circle/oval around an EXACT faulty symbol, sign, or number. Set `content` to clean mathematical notation (e.g. "+17", "±√17 i", "-2"), NOT raw backslash LaTeX.
   - "cross": for invalid or incorrect mathematical steps. Set `content` to the point deduction (e.g. "-2").
   - "strikethrough": for expressions that are erroneous and should be struck out. Set `content` to the clean corrected expression.
   - "correction": handwrite the corrected symbol or equation above or next to the mistake using clean math symbols (e.g. "c = ±√17 i", "b = 2").
   - "comment": short teacher note in the margin (e.g. "إشارة سالبة خاطئة", "خطوة ناقصة", "خطوة سليمة").

5. SCORING & ARABIC PEDAGOGICAL FEEDBACK:
   - Grade each rubric step strictly: `points_awarded = points_possible` when `status == "correct"`; `points_awarded = 0.5 * points_possible` when `status` is `"propagated_error"` or `"partially_correct"`; `points_awarded = 0` when `status` is `"incorrect"` or `"not_attempted"`.
   - "score" is the exact sum of `points_awarded` across all rubric steps.
   - When Feedback Language is Arabic ('ar'):
     * "teacher_note" MUST be a short remark in authentic Iraqi Arabic teacher dialect reflecting the true grade (e.g. "عاشت إيدك يا بطل!" for full marks, "حلك للبداية صحيح بس ما مكمل خطوات الجذور" for unfinished work, "انتبه للإشارات السالبة والتعويض" for errors).
     * "summary" MUST be a clear, constructive 2-3 sentence pedagogical explanation in Arabic detailing what the student solved correctly, which exact steps had mistakes or were left unfinished, and how to fix them.
     * Every step's "reason" and every annotation's "description" MUST be written in clear Arabic.

OUTPUT FORMAT: Strict, compact JSON adhering to this schema:
{
  "score": float,
  "max_score": float,
  "verdict": "correct" | "partially_correct" | "incorrect",
  "summary": "2-3 sentence pedagogical summary (in Arabic when language is 'ar')",
  "overall_badge": "12/20",
  "teacher_note": "Short teacher remark (in Arabic when language is 'ar')",
  "annotations": [
    {
      "box": [ymin, xmin, ymax, xmax],
      "type": "checkmark" | "circle_error" | "cross" | "strikethrough" | "correction" | "comment",
      "content": "clean text/math to write in red ink",
      "target_text": "what student wrote",
      "corrected_text": "correct symbol/expression",
      "points_delta": float,
      "description": "brief explanation"
    }
  ],
  "steps": [
    {
      "step_number": 1,
      "section": "step_1",
      "student_work": "exact equations student visibly wrote for this step (or empty string if not attempted)",
      "expected": "expected equations from teacher rubric",
      "status": "correct" | "partially_correct" | "propagated_error" | "incorrect" | "not_attempted",
      "points_awarded": float,
      "points_possible": float,
      "reason": "deduction or awarding reason"
    }
  ]
}
"""


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _normalize_image(image_bytes: bytes) -> Tuple[bytes, str]:
    """
    Applies the EXIF orientation and caps the long edge, returning PNG/JPEG bytes and
    their MIME type. Phone photos often store rotation in EXIF only; without this the
    model and the renderer can see the page rotated differently and every mark lands
    in the wrong place.
    """
    try:
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(image_bytes))
        img = ImageOps.exif_transpose(img)
        if max(img.size) > VISUAL_MAX_EDGE:
            img.thumbnail((VISUAL_MAX_EDGE, VISUAL_MAX_EDGE), Image.LANCZOS)
        buf = io.BytesIO()
        if img.mode in ("RGBA", "LA", "P"):
            img.save(buf, format="PNG", optimize=True)
            return buf.getvalue(), "image/png"
        img.convert("RGB").save(buf, format="JPEG", quality=92)
        return buf.getvalue(), "image/jpeg"
    except Exception as e:
        logger.warning(f"Image normalization failed ({e}); using original bytes.")
        return image_bytes, "image/jpeg"


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _clean_box(box: Any) -> Optional[List[int]]:
    """[ymin, xmin, ymax, xmax] in 0-1000, corners ordered; None when unusable."""
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return None
    try:
        y0, x0, y1, x1 = (max(0, min(1000, int(round(float(v))))) for v in box)
    except (TypeError, ValueError):
        return None
    y0, y1 = sorted((y0, y1))
    x0, x1 = sorted((x0, x1))
    if y1 == y0 and x1 == x0:
        return None
    return [y0, x0, y1, x1]


def _format_reference(
    teacher_solution: Union[str, bytes, List[Dict[str, Any]]],
    teacher_solution_text: str = "",
) -> str:
    parts: List[str] = []
    if teacher_solution_text and teacher_solution_text.strip():
        parts.append(f"Complete Reference Solution Derivation:\n{teacher_solution_text.strip()}")
    if isinstance(teacher_solution, str) and teacher_solution.strip():
        parts.append(teacher_solution.strip())
    elif isinstance(teacher_solution, list):
        step_strs = []
        for idx, s in enumerate(teacher_solution):
            if not isinstance(s, dict):
                continue
            s_txt = s.get("text") or ""
            s_obj = s.get("objective") or ""
            pts = s.get("points", 1.0)
            if s_txt and s_obj and s_txt != s_obj:
                step_strs.append(
                    f"Step {idx+1} (section='step_{idx+1}', points_possible={pts} pts):\n"
                    f"  - Expected Math: {s_txt}\n"
                    f"  - Rubric Objective: {s_obj}"
                )
            else:
                step_strs.append(f"Step {idx+1} (section='step_{idx+1}', points_possible={pts} pts): {s_txt or s_obj}")
        if step_strs:
            parts.append("Authoritative Rubric Breakdown (MUST output 1 step per item in exact order):\n" + "\n".join(step_strs))
    return "\n\n".join(parts)


def _normalize_for_sympy(expr: str) -> str:
    """Normalizes Unicode math symbols and strips non-mathematical commentary before SymPy parsing."""
    if not expr:
        return ""
    s = expr
    # Strip trailing "(or ...)" alternatives at the end of rubric strings (may contain nested parens like "(or +-(1 + 3i))")
    s = re.sub(r"\(\s*or\s+.*\)\s*$", "", s, flags=re.IGNORECASE)
    # Strip parenthetical equation labels and commentary: (Equation 1), (1), (discard ...), (يهمل ...)
    s = re.sub(
        r"\((?:Equation|Eq\.?|discard|since|because|or\b|معادلة|يهمل)[^()]*\)",
        "",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(r"\(\s*[1234]\s*\)", "", s)
    # Strip bracketed or inline Arabic procedural commentary and set membership notes
    s = re.sub(r"\[[^\]]*(?:يهمل|نعوض|بالتربيع|بجذر)[^\]]*\]", "", s)
    s = re.sub(r"(?:يهمل|بجذر الطرفين|بالتربيع|نعوض[^\n,;]*)", "", s)
    s = re.sub(r"(?:\\notin|\\in|∉|∈)\s*(?:\\mathbb\{R\}|R|ℝ)", "", s)
    # Convert Unicode superscripts and math operators to standard ASCII/LaTeX equivalents
    s = (
        s.replace("²", "^2")
        .replace("³", "^3")
        .replace("⁴", "^4")
        .replace("−", "-")
        .replace("–", "-")
        .replace("×", "*")
        .replace("÷", "/")
        .replace("±", "\\pm ")
        .replace("∓", "\\mp ")
        .replace("+-", "\\pm ")
        .replace("-+", "\\mp ")
        .replace("→", "=>")
        .replace("⇒", "=>")
        .replace("⟹", "=>")
    )
    s = re.sub(r"√\s*\(([^()]+)\)", r"\\sqrt{\1}", s)
    s = re.sub(r"√\s*(\d+\s*[+\-]\s*\d*i)", r"\\sqrt{\1}", s)
    s = re.sub(r"√\s*(-?[a-zA-Z0-9]+)", r"\\sqrt{\1}", s)
    # Transliterate isolated Arabic variable letters occasionally output by vision models
    s = re.sub(r"(?:^|(?<=[\s,;]))ي(?=\s*=)", "y", s)
    s = re.sub(r"(?:^|(?<=[\s,;]))س(?=\s*=)", "x", s)
    # Split space-separated equations on the same line: e.g. "x=3 y=1" -> "x=3, y=1", "2xy=6 y=3/x" -> "2xy=6, y=3/x"
    s = re.sub(r"(=[^=,;>\n]+?)\s+([a-zA-Z]\s*=)", r"\1, \2", s)
    # Normalize uppercase single-letter variables (C -> c, X -> x, Y -> y) for case-insensitive parity
    s = re.sub(r"\b([A-Z])\b", lambda m: m.group(1).lower(), s)
    return s.strip()


def _split_clauses(expr: str) -> List[str]:
    """Splits a compound step into atomic math clauses for symbolic comparison."""
    cleaned = _normalize_for_sympy(expr)
    if not cleaned:
        return []
    raw_parts = re.split(r"(?:=>|\\Rightarrow|\\implies|\\rightarrow|\\to|;|,|\n|\bor\b|أو)", cleaned)
    out: List[str] = []
    for p in raw_parts:
        p_str = p.strip()
        if not p_str or not any(ch.isalnum() for ch in p_str):
            continue
        # If a clause is a multi-step chained equality "LHS = mid1 = RHS", include "LHS = ep" for each step
        if p_str.count("=") >= 2 and not any(op in p_str for op in ("!=", "<=", ">=")):
            eq_parts = [ep.strip() for ep in p_str.split("=") if ep.strip()]
            if len(eq_parts) >= 3:
                for ep in eq_parts[1:]:
                    out.append(f"{eq_parts[0]} = {ep}")
                continue
        out.append(p_str)
    return out


def _lhs_key(clause: str) -> Optional[str]:
    """Returns normalized LHS variable/expression if `clause` is an equation `LHS = RHS`."""
    if "=" not in clause or any(op in clause for op in ("!=", "\\neq", "≠", "<=", ">=")):
        return None
    parts = clause.split("=")
    if len(parts) < 2:
        return None
    lhs = re.sub(r"\s+", "", parts[0]).lower()
    return lhs if lhs else None


def _verify_visual_step_symbolically(
    expected_text: str,
    student_work: str,
    current_status: str,
    language: str = "ar",
) -> Tuple[str, Optional[str]]:
    """
    Applies deterministic SymPy verification to catch both:
    1. Equivalent student equations that were unfairly penalized -> upgrades to 'correct'.
    2. Mathematically contradictory student equations that were falsely marked 'correct' -> downgrades to 'incorrect'.
    Returns (verified_status, override_reason_or_None).
    """
    norm_exp = _normalize_for_sympy(expected_text)
    norm_stu = _normalize_for_sympy(student_work)
    if not norm_exp or not norm_stu:
        return current_status, None

    # 1. Whole-string equivalence check on normalized expressions
    whole_verdict = None
    try:
        whole_verdict = verify_equivalence(norm_exp, norm_stu)
        if whole_verdict.equivalent is True and whole_verdict.status == "certain":
            if current_status != "correct":
                reason = "خطوة صحيحة ومكافئة رياضياً للحل النموذجي." if language == "ar" else "Matches expected answer via mathematical equivalence."
                return "correct", reason
            return "correct", None
    except Exception:
        whole_verdict = None

    exp_clauses = _split_clauses(norm_exp)
    if norm_stu.startswith("=") and exp_clauses and "=" in exp_clauses[0]:
        norm_stu = exp_clauses[0].split("=")[0].strip() + " " + norm_stu
    stu_clauses = _split_clauses(norm_stu)
    if not exp_clauses or not stu_clauses:
        return current_status, None

    # Target-variable presence check for substitution steps like "x = 1/sqrt(2) => y = 1/sqrt(2)":
    # If the final expected clause solves for a single variable `target_var` (e.g. `y`) that differs from
    # an earlier premise variable (e.g. `x`), and `target_var` does NOT appear anywhere in `norm_stu`,
    # then the student only wrote the premise (`x = ...`) and never computed `target_var`!
    if len(exp_clauses) >= 2:
        final_lk = _lhs_key(exp_clauses[-1])
        first_lk = _lhs_key(exp_clauses[0])
        if (
            final_lk
            and first_lk
            and final_lk != first_lk
            and re.fullmatch(r"[a-z]", final_lk)
            and not re.search(rf"\b{re.escape(final_lk)}\b", norm_stu.lower())
        ):
            reason = (
                f"لم يقم الطالب بحساب قيمة ({final_lk}) في هذه الخطوة."
                if language == "ar"
                else f"Student did not compute ({final_lk}) in this step."
            )
            return "not_attempted", reason

    # Check pairwise clause equivalences
    any_clause_equiv = False
    final_exp_matched = False
    for e_idx, ec in enumerate(exp_clauses):
        for sc in stu_clauses:
            try:
                v = verify_equivalence(ec, sc)
                if v.equivalent is True and v.status == "certain":
                    any_clause_equiv = True
                    if e_idx == len(exp_clauses) - 1:
                        final_exp_matched = True
            except Exception:
                pass

    # If the final target clause of the expected step (or the sole expected clause) is matched
    # and all expected clauses with that same LHS are matched, upgrade to 'correct'.
    exp_by_lhs: Dict[str, List[str]] = {}
    for ec in exp_clauses:
        lk = _lhs_key(ec)
        if lk:
            exp_by_lhs.setdefault(lk, []).append(ec)

    if final_exp_matched:
        final_lk = _lhs_key(exp_clauses[-1])
        same_lhs_clauses = exp_by_lhs.get(final_lk, [exp_clauses[-1]]) if final_lk else [exp_clauses[-1]]
        all_same_lhs_matched = True
        for req_ec in same_lhs_clauses:
            if not any(
                verify_equivalence(req_ec, sc).equivalent is True
                for sc in stu_clauses
            ):
                all_same_lhs_matched = False
                break
        if all_same_lhs_matched:
            if current_status != "correct":
                reason = "خطوة صحيحة ومكافئة رياضياً للحل النموذجي." if language == "ar" else "Matches expected answer via mathematical equivalence."
                return "correct", reason
            return "correct", None

    # Never downgrade 'correct' if any student clause is deterministically equivalent to an expected clause
    if any_clause_equiv:
        return current_status, None

    # 2. Check if any student clause directly contradicts an expected clause with the SAME LHS (e.g. c^2 = 17 vs c^2 = -17, or (-1+7i)(1+i) = -8-6i vs -8+6i)
    for sc in stu_clauses:
        lk = _lhs_key(sc)
        if lk and lk in exp_by_lhs and "sqrt" not in lk:
            matching_exp_clauses = exp_by_lhs[lk]
            if any("\\pm" in c or "+-" in c for c in matching_exp_clauses + [sc]):
                continue
            any_equiv = False
            all_certain_false = True
            for ec in matching_exp_clauses:
                try:
                    v = verify_equivalence(ec, sc)
                    if v.equivalent is True:
                        any_equiv = True
                        break
                    if not (v.equivalent is False and v.status == "certain" and v.method != "variable_mismatch"):
                        all_certain_false = False
                except Exception:
                    all_certain_false = False
            if not any_equiv and all_certain_false:
                if current_status == "correct":
                    reason = (
                        f"خطأ رياضي: كتب الطالب ({sc}) بينما القيمة الصحيحة هي ({matching_exp_clauses[-1]})."
                        if language == "ar"
                        else f"Mathematical error: student wrote ({sc}) instead of ({matching_exp_clauses[-1]})."
                    )
                    return "incorrect", reason

    # 3. Single-clause direct contradiction check (when both expected and student are single expressions/equations without sqrt/pm ambiguity)
    if (
        len(exp_clauses) == 1
        and len(stu_clauses) == 1
        and current_status == "correct"
        and "sqrt" not in exp_clauses[0].lower()
        and "sqrt" not in stu_clauses[0].lower()
        and "\\pm" not in exp_clauses[0]
        and "\\pm" not in stu_clauses[0]
    ):
        try:
            single_v = verify_equivalence(exp_clauses[0], stu_clauses[0])
            if (
                single_v.equivalent is False
                and single_v.status == "certain"
                and single_v.method != "variable_mismatch"
            ):
                reason = (
                    f"خطأ في المعادلة أو الحساب: ({student_work}) لا تكافئ ({expected_text})."
                    if language == "ar"
                    else f"Equation ({student_work}) is not mathematically equivalent to ({expected_text})."
                )
                return "incorrect", reason
        except Exception:
            pass

    return current_status, None


def _parse_annotations(raw: Any) -> List[VisualAnnotation]:
    annotations = []
    for a in raw if isinstance(raw, list) else []:
        if not isinstance(a, dict):
            continue
        box = _clean_box(a.get("box"))
        if box is None:
            continue
        a_type = str(a.get("type", "checkmark")).lower().strip()
        annotations.append(VisualAnnotation(
            box=box,
            type=a_type if a_type in ANNOTATION_TYPES else "comment",
            content=str(a.get("content") or ""),
            target_text=str(a.get("target_text") or ""),
            corrected_text=str(a.get("corrected_text") or ""),
            points_delta=_to_float(a.get("points_delta")),
            description=str(a.get("description") or ""),
        ))
    return annotations


def _parse_steps(
    raw: Any,
    teacher_solution: Optional[Union[str, bytes, List[Dict[str, Any]]]] = None,
    language: str = "ar",
) -> List[VisualStepResult]:
    """
    Parses model steps and, when `teacher_solution` is a list of rubric step dicts,
    enforces strict 1-to-1 rubric alignment, authoritative rubric `points_possible`,
    zero points for unfinished (`not_attempted`) or `incorrect` steps, and SymPy verification.
    """
    raw_list = [s for s in (raw if isinstance(raw, list) else []) if isinstance(s, dict)]

    # Path A: Free-form string/bytes reference (no structured rubric step list)
    if not isinstance(teacher_solution, list) or not teacher_solution:
        steps = []
        for idx, s in enumerate(raw_list):
            possible = max(0.0, _to_float(s.get("points_possible"), 1.0))
            awarded = min(max(0.0, _to_float(s.get("points_awarded"))), possible)
            status = str(s.get("status", "partially_correct")).lower().strip()
            stu_work = str(s.get("student_work") or "").strip()
            if status == "not_attempted" or stu_work.lower() in _UNATTEMPTED_MARKERS and status not in ("correct", "incorrect", "partially_correct", "propagated_error"):
                status = "not_attempted"
                awarded = 0.0
            steps.append(VisualStepResult(
                step_number=_to_int(s.get("step_number"), idx + 1),
                section=str(s.get("section") or f"step_{idx+1}"),
                student_work=stu_work,
                expected=str(s.get("expected") or ""),
                status=status if status in STEP_STATUSES else "partially_correct",
                points_awarded=awarded,
                points_possible=possible,
                reason=str(s.get("reason") or ""),
            ))
        return steps

    # Path B: Authoritative Teacher Rubric List (`isinstance(teacher_solution, list)`)
    if not raw_list:
        return []

    def _clean_id(val: Any) -> str:
        return re.sub(r"[^a-z0-9]", "", str(val or "").lower())

    def _step_num(val: Any) -> Optional[int]:
        m = re.search(r"\d+", str(val or ""))
        return int(m.group()) if m else None

    used_indices = set()
    reconciled: List[VisualStepResult] = []

    for obj_idx, t_step in enumerate(teacher_solution):
        if not isinstance(t_step, dict):
            continue
        target_num = obj_idx + 1
        target_sec = f"step_{target_num}"
        target_clean = _clean_id(target_sec)
        pts_possible = max(0.0, _to_float(t_step.get("points"), 1.0))
        expected_text = str(t_step.get("text") or t_step.get("objective") or "").strip()

        matched_raw: Optional[Dict[str, Any]] = None
        matched_idx: Optional[int] = None

        # 1. Exact section ID match
        for r_idx, s in enumerate(raw_list):
            if r_idx in used_indices:
                continue
            if _clean_id(s.get("section")) == target_clean:
                matched_raw = s
                matched_idx = r_idx
                break

        # 2. Step number match
        if matched_raw is None:
            for r_idx, s in enumerate(raw_list):
                if r_idx in used_indices:
                    continue
                s_num = _to_int(s.get("step_number"), 0) or _step_num(s.get("section"))
                if s_num == target_num:
                    matched_raw = s
                    matched_idx = r_idx
                    break

        # 3. Positional fallback
        if matched_raw is None and obj_idx < len(raw_list) and obj_idx not in used_indices:
            matched_raw = raw_list[obj_idx]
            matched_idx = obj_idx

        if matched_raw is None:
            # Unanswered / omitted step from unfinished student solution -> 0 points
            reconciled.append(VisualStepResult(
                step_number=target_num,
                section=target_sec,
                student_work="",
                expected=expected_text,
                status="not_attempted",
                points_awarded=0.0,
                points_possible=pts_possible,
                reason="لم يقم الطالب بحل هذه الخطوة (متروكة)." if language == "ar" else "Student left this step unanswered.",
            ))
            continue

        used_indices.add(matched_idx)
        stu_work = str(matched_raw.get("student_work") or "").strip()
        raw_status = str(matched_raw.get("status", "partially_correct")).lower().strip()
        if raw_status not in STEP_STATUSES:
            raw_status = "partially_correct"
        raw_reason = str(matched_raw.get("reason") or "").strip()
        raw_awarded = _to_float(matched_raw.get("points_awarded"), 0.0)

        # Enforce not_attempted when student_work is empty or a placeholder marker
        if not stu_work or stu_work.lower() in _UNATTEMPTED_MARKERS or raw_status == "not_attempted":
            reconciled.append(VisualStepResult(
                step_number=target_num,
                section=target_sec,
                student_work="",
                expected=expected_text,
                status="not_attempted",
                points_awarded=0.0,
                points_possible=pts_possible,
                reason=raw_reason or ("لم يقم الطالب بحل هذه الخطوة (متروكة)." if language == "ar" else "Student left this step unanswered."),
            ))
            continue

        # Run deterministic SymPy verification against expected rubric equation
        verified_status, sym_reason = _verify_visual_step_symbolically(
            expected_text=expected_text,
            student_work=stu_work,
            current_status=raw_status,
            language=language,
        )
        if sym_reason:
            raw_reason = sym_reason

        # Compute authoritative points_awarded from verified_status and rubric pts_possible
        if verified_status == "correct":
            awarded = pts_possible
        elif verified_status in ("incorrect", "not_attempted"):
            awarded = 0.0
        elif verified_status == "partially_correct":
            if 0.0 < raw_awarded < pts_possible:
                awarded = round(raw_awarded, 2)
            else:
                awarded = round(pts_possible * 0.5, 2)
        elif verified_status == "propagated_error":
            awarded = round(pts_possible * 0.5, 2)
        else:
            awarded = 0.0

        reconciled.append(VisualStepResult(
            step_number=target_num,
            section=target_sec,
            student_work=stu_work,
            expected=expected_text,
            status=verified_status,
            points_awarded=awarded,
            points_possible=pts_possible,
            reason=raw_reason or ("تم التقييم عبر الفحص البصري المباشر." if language == "ar" else "Evaluated via visual inspection."),
        ))

    # Guard: If the final step (e.g. step_9 stating final complex roots) was marked attempted,
    # but BOTH preceding substitution steps (step_7 and step_8 finding y) are 'not_attempted',
    # then the student stopped at finding x (step_6) and never computed y or the final root.
    if (
        len(reconciled) >= 4
        and reconciled[-1].status != "not_attempted"
        and reconciled[-2].status == "not_attempted"
        and reconciled[-3].status == "not_attempted"
    ):
        reconciled[-1].status = "not_attempted"
        reconciled[-1].student_work = ""
        reconciled[-1].points_awarded = 0.0
        reconciled[-1].reason = (
            "لم يكمل الطالب إيجاد قيم المتغير الثاني والجذور النهائية."
            if language == "ar"
            else "Student stopped before computing the second variable and final roots."
        )

    # Post-pass 1: Recover combined introductory/intermediate steps ONLY when subsequent steps were attempted
    for idx, step in enumerate(reconciled):
        if step.status != "not_attempted":
            continue
        later_attempted = any(s.status != "not_attempted" and bool(s.student_work) for s in reconciled[idx + 1 :])
        if not later_attempted:
            # Never recover steps at the end of an unfinished solution!
            continue
        # Check if an adjacent step's student_work contains a clause equivalent to this step's expected math
        recovered = False
        for adj_idx in (idx - 1, idx + 1):
            if 0 <= adj_idx < len(reconciled) and reconciled[adj_idx].student_work:
                v_stat, _ = _verify_visual_step_symbolically(
                    expected_text=step.expected,
                    student_work=reconciled[adj_idx].student_work,
                    current_status="incorrect",
                    language=language,
                )
                if v_stat == "correct":
                    step.student_work = reconciled[adj_idx].student_work
                    step.status = "correct"
                    step.points_awarded = step.points_possible
                    step.reason = (
                        "خطوة مدمجة صحيحة ضمن سطر الحل المجاور."
                        if language == "ar"
                        else "Combined step verified from adjacent student line."
                    )
                    recovered = True
                    break
        # Implicit preamble/squaring rule (step_1 / step_2 ONLY) when student combined setup and squaring on one line
        if not recovered and idx in (0, 1) and idx + 1 < len(reconciled):
            next_step = reconciled[idx + 1]
            prev_step = reconciled[idx - 1] if idx > 0 else None
            if next_step.status == "correct" and (prev_step is None or prev_step.status == "correct"):
                donor = next_step if next_step.student_work else prev_step
                if donor and donor.student_work:
                    step.student_work = donor.student_work
                    step.status = "correct"
                    step.points_awarded = step.points_possible
                    step.reason = (
                        "خطوة تمهيدية/تربيعية مضمنة بشكل صحيح في المعادلة اللاحقة."
                        if language == "ar"
                        else "Implicit setup/squaring step embodied in subsequent correct equation."
                    )

    # Post-pass 1b: If step_1 (idx == 0) was marked 'incorrect' ONLY because the student jumped directly
    # to the step_2 radical/squared operation on line 1 (e.g. writing sqrt(-17) = sqrt(17)*sqrt(-1) instead of c^2 = -17),
    # and step_2 is 'correct', credit step_1 via the Implicit Setup Rule.
    if (
        len(reconciled) >= 2
        and reconciled[0].status == "incorrect"
        and reconciled[1].status == "correct"
        and reconciled[0].student_work
        and ("sqrt" in _normalize_for_sympy(reconciled[0].student_work).lower() or "^2" in _normalize_for_sympy(reconciled[0].student_work))
    ):
        # Verify that step_1's student_work does NOT directly contradict step_1's expected LHS (like c^2 = 17)
        s0_lhs = _lhs_key(_normalize_for_sympy(reconciled[0].student_work))
        e0_lhs = _lhs_key(_normalize_for_sympy(reconciled[0].expected))
        if s0_lhs != e0_lhs:
            reconciled[0].status = "correct"
            reconciled[0].points_awarded = reconciled[0].points_possible
            reconciled[0].reason = (
                "خطوة تمهيدية مضمنة بشكل صحيح في خطوة الجذر/التربيع اللاحقة."
                if language == "ar"
                else "Implicit setup step embodied in subsequent operation."
            )

    # Post-pass 2: Deterministic SymPy propagated-error recovery (parity with grading/grader.py)
    try:
        from math_engine.sympy_parser import safe_parse, extract_equation_sides
        from sympy import solve, simplify
        for idx, step in enumerate(reconciled):
            if idx == 0 or step.status != "incorrect" or not step.student_work:
                continue
            reclassified = False
            stu_clauses = _split_clauses(step.student_work)
            for prior_idx in range(0, idx):
                prior_step = reconciled[prior_idx]
                if prior_step.status not in ("incorrect", "propagated_error") or not prior_step.student_work:
                    continue
                for p_clause in _split_clauses(prior_step.student_work):
                    p_sides = extract_equation_sides(p_clause)
                    if len(p_sides) < 2:
                        continue
                    p_lhs, p_rhs = safe_parse(p_sides[0]), safe_parse(p_sides[-1])
                    if p_lhs is None or p_rhs is None:
                        continue
                    p_eq = p_lhs - p_rhs
                    # Build variable assignment map from current step clauses (e.g. {x: 1, y: -3})
                    stu_assignments = {}
                    for s_clause in stu_clauses:
                        s_sides = extract_equation_sides(s_clause)
                        if len(s_sides) < 2:
                            continue
                        s_lhs, s_rhs = safe_parse(s_sides[0]), safe_parse(s_sides[-1])
                        if s_lhs is None or s_rhs is None:
                            continue
                        if hasattr(s_lhs, "free_symbols") and len(s_lhs.free_symbols) == 1 and str(s_lhs) == str(list(s_lhs.free_symbols)[0]):
                            var = list(s_lhs.free_symbols)[0]
                            stu_assignments[var] = s_rhs
                        if hasattr(s_lhs, "free_symbols") and len(s_lhs.free_symbols) == 1:
                            var = list(s_lhs.free_symbols)[0]
                            try:
                                sols = solve(p_eq, var)
                                if any(simplify(sol - s_rhs) == 0 for sol in sols):
                                    step.status = "propagated_error"
                                    step.points_awarded = round(step.points_possible * 0.5, 2)
                                    step.reason = (
                                        f"خطأ مترتب: النتيجة ({s_clause}) تتبع منطقياً من معادلة الطالب السابقة."
                                        if language == "ar"
                                        else f"Propagated error: ({s_clause}) follows from student's earlier equation."
                                    )
                                    reclassified = True
                                    break
                            except Exception:
                                pass
                    # Check if multi-variable assignments (e.g. x=1, y=-3) satisfy prior step's equation (e.g. y = -3/x)
                    if not reclassified and len(stu_assignments) >= 2 and hasattr(p_eq, "free_symbols") and p_eq.free_symbols.issubset(set(stu_assignments.keys())):
                        try:
                            if simplify(p_eq.subs(stu_assignments)) == 0:
                                step.status = "propagated_error"
                                step.points_awarded = round(step.points_possible * 0.5, 2)
                                step.reason = (
                                    "خطأ مترتب: التعويض يتبع منطقياً من معادلة الطالب السابقة."
                                    if language == "ar"
                                    else "Propagated error: substitution follows from student's earlier equation."
                                )
                                reclassified = True
                        except Exception:
                            pass
                    if reclassified:
                        break
                if reclassified:
                    break
    except Exception:
        pass

    return reconciled


def _sanitize_annotations_against_steps(
    annotations: List[VisualAnnotation],
    steps: List[VisualStepResult],
) -> List[VisualAnnotation]:
    """
    Ensures red-pen visual annotations never contradict the verified rubric step statuses:
    - Converts any 'checkmark' placed on an 'incorrect' step into a 'cross' (-pts).
    - Removes any hallucinated 'checkmark' whose target_text is empty when steps are unattempted.
    """
    if not annotations or not steps:
        return annotations

    incorrect_works = {
        re.sub(r"\s+", "", s.student_work.lower()): s
        for s in steps
        if s.status == "incorrect" and s.student_work.strip()
    }

    sanitized: List[VisualAnnotation] = []
    for ann in annotations:
        t_norm = re.sub(r"\s+", "", (ann.target_text or "").lower())
        if ann.type == "checkmark" and ann.points_delta < 0:
            ann.type = "cross"
        elif ann.type == "checkmark" and t_norm and t_norm in incorrect_works:
            bad_step = incorrect_works[t_norm]
            ann.type = "cross"
            ann.points_delta = -bad_step.points_possible
            ann.content = f"-{bad_step.points_possible:g}"
        sanitized.append(ann)
    return sanitized


def _reconcile_score(model_score: float, steps: List[VisualStepResult], max_points: float) -> Tuple[float, str]:
    """
    Final score = clamped step sum (or the clamped model total when there are no steps),
    never above the question's maximum. Returns (score, warning).
    """
    warnings = []
    if steps:
        step_sum = sum(s.points_awarded for s in steps)
        if abs(step_sum - model_score) > 0.05:
            warnings.append(f"model total {model_score:g} != step sum {step_sum:g}")
        score = step_sum
    else:
        score = model_score
    if score > max_points:
        warnings.append(f"score {score:g} exceeded max {max_points:g}")
    score = min(max(0.0, score), max_points)
    return score, "; ".join(warnings)


def _verdict(score: float, max_points: float) -> str:
    if max_points > 0 and score >= max_points - 1e-9:
        return "correct"
    return "incorrect" if score <= 0 else "partially_correct"


def _build_visual_pedagogical_feedback(
    score: float,
    max_points: float,
    steps: List[VisualStepResult],
    annotations: List[VisualAnnotation],
    raw_summary: str,
    raw_teacher_note: str,
    language: str = "ar",
) -> Tuple[str, str]:
    """
    Guarantees a rich, constructive teacher note and full pedagogical feedback string.
    When `language == 'ar'`, ensures authentic Iraqi Arabic teacher feedback even if
    the vision model returned English or terse text, enriched with RAG misconception hints.
    Returns (teacher_note, full_feedback).
    """
    pct = (score / max(max_points, 0.001)) * 100.0
    unattempted_steps = [s for s in steps if s.status == "not_attempted"]
    error_steps = [s for s in steps if s.status in ("incorrect", "partially_correct")]
    correct_steps = [s for s in steps if s.status == "correct"]

    if language != "ar":
        note = raw_teacher_note or ("Excellent work!" if pct >= 85 else ("Good effort, review mistakes." if pct >= 50 else "Review reference solution."))
        fb = f"{note}\n\n{raw_summary}".strip() if raw_summary else f"{note} Earned {score:g}/{max_points:g}."
        return note, fb

    # Ensure teacher_note is in Arabic and accurately reflects unfinished/incorrect work
    if raw_teacher_note and has_arabic(raw_teacher_note) and not (pct < 80 and "ممتاز" in raw_teacher_note):
        teacher_note = raw_teacher_note.strip()
    else:
        if pct >= 95:
            teacher_note = "عاشت إيدك يا بطل! حل نموذجي ومرتب"
        elif unattempted_steps and correct_steps and not error_steps:
            teacher_note = "عاشت إيدك على الخطوات الأولى، بس الحل غير مكتمل للنهاية"
        elif pct >= 75:
            teacher_note = "أحسنت! حلك جيد، انتبه فقط للملاحظات المؤشرة"
        elif pct >= 40:
            teacher_note = "محاولة جيدة، راجع الخطوات الناقصة والأخطاء المؤشرة"
        elif pct > 0:
            teacher_note = "بداية مقبولة، لكن تحتاج مراجعة وإكمال خطوات الحل"
        else:
            teacher_note = "راجع الحل النموذجي وخطواته بالتفصيل"

    # Check Arabic RAG misconception cache for any faulty or unattempted step
    rag_hints: List[str] = []
    for s in error_steps + unattempted_steps:
        hint = match_arabic_misconception_cache([s.expected, s.student_work, s.reason])
        if hint and hint not in rag_hints:
            rag_hints.append(hint)

    arabic_parts: List[str] = [f"✍️ {teacher_note} (الدرجة المستحقة: {score:g} من {max_points:g})."]

    if raw_summary and has_arabic(raw_summary):
        arabic_parts.append(raw_summary.strip())
    else:
        if pct >= 99.0:
            arabic_parts.append("حلك كامل وصحيح في جميع الخطوات الرياضية، استمر على هذا المستوى الممتاز!")
        else:
            if correct_steps:
                arabic_parts.append(f"• أحسنت في إنجاز {len(correct_steps)} خطوة من سلم التصحيح بشكل صحيح.")
            for s in error_steps[:3]:
                exp_clean = format_math_for_overlay(s.expected)
                stu_clean = format_math_for_overlay(s.student_work)
                if has_arabic(s.reason):
                    arabic_parts.append(f"• في الخطوة ({s.step_number}): {s.reason} (الدرجة: {s.points_awarded:g}/{s.points_possible:g})")
                elif stu_clean and exp_clean:
                    arabic_parts.append(
                        f"• في الخطوة ({s.step_number}): كتبت ({stu_clean}) بينما الصحيح في الحل النموذجي هو ({exp_clean})."
                    )
                elif exp_clean:
                    arabic_parts.append(f"• في الخطوة ({s.step_number}): راجع العلاقة المطلوبة ({exp_clean}).")
            if unattempted_steps:
                missing_nums = "، ".join(str(s.step_number) for s in unattempted_steps)
                missing_pts = sum(s.points_possible for s in unattempted_steps)
                arabic_parts.append(
                    f"• خطوات غير مكتملة: توقف الحل قبل إتمام الخطوات ({missing_nums}) من سلم التصحيح (قيمتها {missing_pts:g} درجة)."
                )
        if raw_summary and not has_arabic(raw_summary):
            arabic_parts.append(raw_summary.strip())

    if rag_hints:
        arabic_parts.append("💡 توجيه تربوي: " + " ".join(rag_hints[:2]))

    return teacher_note, "\n\n".join(p for p in arabic_parts if p)


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def grade_paper_visually(
    student_image_bytes: bytes,
    teacher_solution: Union[str, bytes, List[Dict[str, Any]]],
    max_points: float = 10.0,
    teacher_image_bytes: Optional[bytes] = None,
    question_statement: str = "",
    teacher_solution_text: str = "",
    model: Optional[str] = None,
    detail: str = "auto",
    language: str = "ar"
) -> VisualGradingResult:
    """
    Directly grades a student paper image using a multimodal vision model against both
    the teacher's rubric steps and the teacher's reference solution image/text, and generates
    an authentic red-pen overlaid graded paper image.

    Parameters:
      - student_image_bytes: Raw bytes of student paper image.
      - teacher_solution: Either teacher solution text, or list of rubric steps, or image bytes.
      - max_points: Maximum score possible for this question (authoritative).
      - teacher_image_bytes: Optional image bytes of teacher's handwritten/printed solution.
      - question_statement: Text of the problem / question.
      - teacher_solution_text: Optional full derivation text of the teacher's solution.
      - model: Override for VISUAL_MODEL (default gpt-5). Failover per llm/router.py.
      - detail: Vision resolution mode ('auto' or 'low').
      - language: Language for teacher notes ('ar' for Arabic, 'en' for English).

    Raises llm.router.LLMUnavailableError when no model could grade the paper; a failed
    call never turns into a 0-point grade.
    """
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    max_points = max(0.0, _to_float(max_points, 10.0))
    lang = (language or "ar").lower().strip()

    # One normalized copy is sent to the model AND drawn on
    student_bytes, student_mime = _normalize_image(student_image_bytes)

    if isinstance(teacher_solution, bytes) and not teacher_image_bytes:
        teacher_image_bytes = teacher_solution
    ref_text = _format_reference(teacher_solution, teacher_solution_text=teacher_solution_text)

    user_prompt = "Grade the attached student solution image strictly against the teacher's official reference solution and rubric steps.\n"
    if question_statement:
        user_prompt += f"\nExam Question Statement:\n{question_statement}\n"
    if ref_text:
        user_prompt += f"\nTeacher's Official Solution / Rubric:\n{ref_text}\n"
    if isinstance(teacher_solution, list) and teacher_solution:
        user_prompt += (
            f"\nMANDATORY RUBRIC ALIGNMENT: There are {len(teacher_solution)} rubric steps "
            f"({[f'step_{i+1}' for i in range(len(teacher_solution))]}). "
            f"You MUST output exactly {len(teacher_solution)} items in `steps` with their exact `points_possible`. "
            "Any rubric step not visibly written on the student's paper MUST have `status: 'not_attempted'`, "
            "`student_work: ''`, and `points_awarded: 0`.\n"
        )
    user_prompt += f"\nMaximum Points: {max_points:g}\n"
    if lang == "ar":
        user_prompt += (
            "Feedback Language: Arabic (العربية — لهجة عراقية تدريسية واضحة ومشجعة).\n"
            "IMPORTANT: Write 'summary', 'teacher_note', every step 'reason', and 'comment' annotations in Arabic.\n"
        )
    else:
        user_prompt += "Feedback Language: English\n"
    user_prompt += ("Perform direct visual grading, determine all correct/incorrect/unattempted steps, locate bounding boxes "
                    "on the student's paper, and specify red-pen overlay marks. Respond with the JSON object only.")

    images = []
    if teacher_image_bytes:
        t_bytes, t_mime = _normalize_image(teacher_image_bytes)
        images.append((
            t_bytes,
            t_mime,
            "IMAGE 1 — TEACHER'S OFFICIAL REFERENCE SOLUTION (REFERENCE ONLY — DO NOT GRADE AND NEVER COPY EQUATIONS FROM THIS IMAGE INTO 'student_work'):",
        ))
    images.append((
        student_bytes,
        student_mime,
        "IMAGE 2 — STUDENT'S HANDWRITTEN PAPER TO GRADE (transcribe ONLY what is handwritten on this image into 'student_work'; if the student stopped writing before the final steps of Image 1, mark the missing steps 'not_attempted' with student_work=''):",
    ))

    parsed_data = await complete_vision_json(
        "visual",
        user_prompt,
        images=images,
        schema=_VisualOutput,
        system=VISUAL_GRADING_SYSTEM_PROMPT,
        detail=detail,
        model=model,
    )

    summary = str(parsed_data.get("summary") or "")
    annotations_list = _parse_annotations(parsed_data.get("annotations"))
    steps_list = _parse_steps(parsed_data.get("steps"), teacher_solution=teacher_solution, language=lang)
    annotations_list = _sanitize_annotations_against_steps(annotations_list, steps_list)

    model_score = _to_float(parsed_data.get("score"))
    score, warning = _reconcile_score(model_score, steps_list, max_points)
    if warning:
        logger.warning(f"Visual grading score reconciled: {warning}")

    # If steps list empty, create at least 1 step from the reconciled score
    if not steps_list:
        steps_list.append(VisualStepResult(
            step_number=1,
            section="step_1",
            student_work="Complete derivation",
            expected="Correct solution",
            status=_verdict(score, max_points),
            points_awarded=score,
            points_possible=max_points,
            reason=summary or ("تم التقييم عبر الفحص البصري المباشر." if lang == "ar" else "Graded via visual inspection.")
        ))

    overall_badge = f"{score:g}/{max_points:g}"
    raw_teacher_note = str(parsed_data.get("teacher_note") or "")
    teacher_note, full_feedback = _build_visual_pedagogical_feedback(
        score=score,
        max_points=max_points,
        steps=steps_list,
        annotations=annotations_list,
        raw_summary=summary,
        raw_teacher_note=raw_teacher_note,
        language=lang,
    )
    if not summary:
        summary = full_feedback

    # Generate the human-like red pen overlay on the same normalized image the model saw
    rendered_bytes = render_red_pen_overlay_bytes(
        image_input=student_bytes,
        annotations=[a.model_dump() for a in annotations_list],
        overall_score_badge=overall_badge,
        teacher_note=teacher_note
    )

    run_id = uuid.uuid4().hex[:10]
    graded_path = os.path.join(UPLOADS_DIR, f"graded_visual_{run_id}.png")
    original_ext = ".png" if student_mime == "image/png" else ".jpg"
    original_path = os.path.join(UPLOADS_DIR, f"original_stu_{run_id}{original_ext}")
    with open(graded_path, "wb") as f_out:
        f_out.write(rendered_bytes)
    with open(original_path, "wb") as f_orig:
        f_orig.write(student_bytes)

    return VisualGradingResult(
        score=round(score, 2),
        max_score=round(max_points, 2),
        percentage=round((score / max(max_points, 0.001)) * 100, 1),
        verdict=_verdict(score, max_points),
        summary=summary,
        feedback=full_feedback,
        overall_badge=overall_badge,
        teacher_note=teacher_note,
        annotations=annotations_list,
        steps=steps_list,
        model_used=model or model_for("visual"),
        is_beta=True,
        graded_image_path=graded_path,
        original_image_path=original_path,
        graded_image_base64=base64.b64encode(rendered_bytes).decode("utf-8"),
        consistency_warning=warning,
    )
