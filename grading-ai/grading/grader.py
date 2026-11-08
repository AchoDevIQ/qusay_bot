import os
import re
import json
import asyncio
import collections.abc
import time
from typing import List, Optional
from pydantic import BaseModel, Field
from dotenv import load_dotenv
load_dotenv()

from grading.rubric import Rubric
from grading.strictness import GradingConfig
from llm.router import complete_structured, complete_vision_json, any_credentials, LLMUnavailableError

# QMath: added to the prompt only when the student's photos are passed in
PHOTO_RULES = """

## The Student's Photos
The photos of the student's handwritten answer are attached. The "Student's Solution" text above is a machine reading of them and can be wrong.
Whenever the text and the photo differ, or the text is empty, the PHOTO is what the student wrote. Read signs, fractions, powers, +- and which x goes with which y from the photo yourself.
Apply these fixed rules the same way every time:
- A pair (x, y) whose signs do not satisfy the equations (for example 2xy = -3 needs opposite signs) is incorrect.
- Writing x = +-a and y = +-b without the right pairing, then listing a wrongly paired root, is incorrect for those milestones.
- A correct final answer does not make an earlier wrong step correct.
- If the photo cannot be read for a milestone, classify it as "uncertain".
"""

class ErrorDetail(BaseModel):
    type: str = Field(description="The type of error: math_error, arithmetic_error, parse_error, propagated_error, uncertain_verification")
    location: str = Field(description="Where the error occurred, e.g., 'section' or 'mid_section'")
    description: str = Field(description="A brief description of the error")

class StepResult(BaseModel):
    section: str = Field(description="The ID of the rubric step being graded, e.g., 'step_1'")
    status: str = Field(description="The result of the step: correct, incorrect, partially_correct, propagated_error, uncertain, not_attempted")
    points_awarded: float
    points_possible: float
    reason: str = Field(description="A brief explanation of why the points were awarded or deducted.")
    expected: str = Field(default="", description="The expected mathematical string from the teacher's rubric.")
    student: str = Field(default="", description="The matching mathematical string the student wrote. Leave empty if not attempted.")
    error: Optional[ErrorDetail] = None
    student_lines: List[str] = Field(default_factory=list, description="The raw lines of the student's work for this section.")
    lines_detected: int = Field(default=0, description="The number of student lines associated with this step.")

class GradingResult(BaseModel, collections.abc.Coroutine):
    score: float
    max_score: float
    confidence: float = Field(description="Overall confidence in the grading accuracy (0.0 to 1.0)")
    steps: List[StepResult]

    def send(self, val):
        raise StopIteration(self)

    def throw(self, typ, val=None, tb=None):
        raise typ(val)

    def close(self):
        pass

    def __await__(self):
        yield from ()
        return self


from math_engine.verifier import verify_equivalence

def _split_math_clauses(text: str) -> List[str]:
    """Splits a math text into logical/equation clauses (implications, arrows, semicolons, commas between equations, newlines)."""
    if not text:
        return []
    parts = re.split(r'\s*(?:\\(?:implies|Longrightarrow|rightarrow|to)|=>)\s*|[;\n]+', text)
    clauses = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if ',' in p:
            sub = [s.strip() for s in p.split(',') if s.strip()]
            if len(sub) > 1 and any('=' in s for s in sub):
                clauses.extend(sub)
                continue
        clauses.append(p)
    return clauses


def _attempt_deterministic_grading(
    reference: List[dict],
    student: List[dict],
    rubric: Rubric
) -> Optional[GradingResult]:
    """
    Attempts to deterministically grade the student's submission using SymPy symbolic equivalence.
    Returns GradingResult with confidence=1.0 if all rubric milestones can be mathematically verified,
    or None if LLM semantic/partial-credit analysis is required.
    
    Parses through all solution possibilities, alternative variable isolations,
    and multi-line intermediate derivations.
    """
    if not reference or not student or not rubric.objectives:
        return None

    # Check 1-to-1 correspondence between reference steps and rubric objectives
    ref_steps = [r.get("raw_text", "").strip() for r in reference if r.get("raw_text", "").strip()]
    stu_steps = [s.get("raw_text", "").strip() for s in student if s.get("raw_text", "").strip()]
    
    if not ref_steps or not stu_steps:
        return None

    try:
        matched_results: List[StepResult] = []
        used_student_indices = set()

        for idx, obj in enumerate(rubric.objectives):
            exp_candidates = []
            if idx < len(ref_steps):
                exp_candidates.append(ref_steps[idx])
            # Also check objective text for embedded equations
            if "=" in obj.objective:
                exp_candidates.append(obj.objective)

            found_match = False
            for exp in exp_candidates:
                for s_idx, s_text in enumerate(stu_steps):
                    if s_idx in used_student_indices:
                        continue
                    try:
                        # 1. Direct equivalence check
                        verdict = verify_equivalence(exp, s_text)
                        if verdict.equivalent is True and verdict.status == "certain":
                            s_clauses = _split_math_clauses(s_text) or [s_text]
                            matched_results.append(StepResult(
                                section=obj.id,
                                status="correct",
                                points_awarded=obj.points,
                                points_possible=obj.points,
                                reason="Deterministically verified via SymPy algebraic equivalence.",
                                expected=exp,
                                student=s_text,
                                student_lines=s_clauses
                            ))
                            used_student_indices.add(s_idx)
                            found_match = True
                            break

                        # 2. Multi-line / compound clause equivalence check (only when either has >1 clause)
                        exp_clauses = _split_math_clauses(exp)
                        s_clauses = _split_math_clauses(s_text)
                        if exp_clauses and s_clauses and (len(exp_clauses) > 1 or len(s_clauses) > 1):
                            # Check if target derived clause matches
                            v_target = verify_equivalence(exp_clauses[-1], s_clauses[-1])
                            if v_target.equivalent is True and v_target.status == "certain":
                                matched_results.append(StepResult(
                                    section=obj.id,
                                    status="correct",
                                    points_awarded=obj.points,
                                    points_possible=obj.points,
                                    reason="Deterministically verified via SymPy algebraic equivalence on derived clause.",
                                    expected=exp,
                                    student=s_text,
                                    student_lines=s_clauses
                                ))
                                used_student_indices.add(s_idx)
                                found_match = True
                                break

                            # Check if any student clause matches any expected clause
                            for sc in s_clauses:
                                for ec in exp_clauses:
                                    v_sub = verify_equivalence(ec, sc)
                                    if v_sub.equivalent is True and v_sub.status == "certain":
                                        matched_results.append(StepResult(
                                            section=obj.id,
                                            status="correct",
                                            points_awarded=obj.points,
                                            points_possible=obj.points,
                                            reason="Deterministically verified via SymPy algebraic equivalence.",
                                            expected=exp,
                                            student=s_text,
                                            student_lines=s_clauses
                                        ))
                                        used_student_indices.add(s_idx)
                                        found_match = True
                                        break
                                if found_match:
                                    break
                    except Exception:
                        pass
                if found_match:
                    break

            if not found_match:
                # Cannot verify all steps deterministically - fall back towards LLM
                return None

        # If all objectives found deterministic matches:
        total_score = sum(s.points_awarded for s in matched_results)
        max_score = sum(s.points_possible for s in matched_results)
        return GradingResult(
            score=round(total_score, 2),
            max_score=round(max_score, 2),
            confidence=1.0,
            steps=matched_results
        )
    except Exception:
        # On any LaTeX, SymPy, or parsing error: unconditionally fall back to LLM
        return None



def _recover_propagated_errors(result: GradingResult, student: List[dict]) -> None:
    """
    Deterministic Propagated Error Recovery Pass.
    
    When using gpt-4o-mini (a smaller model), it sometimes misclassifies propagated
    errors as 'incorrect' or 'not_attempted' when the student's isolated value differs
    from the teacher's expected answer.
    
    This pass checks: if a step is marked 'incorrect' or 'not_attempted' and there
    exists an earlier step marked 'incorrect', does the student's answer (or an unassigned
    student line) logically follow from their own earlier wrong answer via SymPy solving?
    
    Example: Student wrote 5x = -11 (incorrect), then x = -11/5 (follows correctly).
    The LLM may omit x = -11/5 or mark it 'not_attempted' / 'incorrect'.
    This pass reclaims the step as 'propagated_error' with appropriate partial credit.
    
    This function mutates the result in-place.
    """
    if len(result.steps) < 2:
        return

    from math_engine.normalizer import extract_equation_sides
    from sympy import solve, Symbol, simplify
    from math_engine.verifier import safe_parse

    # Extract all clean student lines
    stu_lines = [s.get("raw_text", "").strip() for s in (student or []) if s.get("raw_text", "").strip()]
    used_student_lines = {s.student.strip() for s in result.steps if s.student and s.student.strip()}
    unused_lines = [l for l in stu_lines if l not in used_student_lines]

    for idx in range(1, len(result.steps)):
        step = result.steps[idx]
        if step.status == "correct":
            continue

        for prior_idx in range(0, idx):
            prior_step = result.steps[prior_idx]
            if prior_step.status not in ("incorrect", "propagated_error") or not prior_step.student:
                continue

            prior_student_expr = prior_step.student
            prior_sides = extract_equation_sides(prior_student_expr)
            if len(prior_sides) < 2:
                continue

            prior_lhs = safe_parse(prior_sides[0])
            prior_rhs = safe_parse(prior_sides[1])
            if prior_lhs is None or prior_rhs is None:
                continue

            prior_eq = prior_lhs - prior_rhs

            # Candidate student expressions: either currently bound to step, or unused student lines
            candidates = []
            if step.student:
                candidates.append((step.student, False))
            for ul in unused_lines:
                candidates.append((ul, True))

            reclassified = False
            for cand_expr, from_unused in candidates:
                cand_sides = extract_equation_sides(cand_expr)
                if len(cand_sides) < 2:
                    continue

                cand_lhs = safe_parse(cand_sides[0])
                cand_rhs = safe_parse(cand_sides[1])
                if cand_lhs is None or cand_rhs is None:
                    continue

                if hasattr(cand_lhs, 'free_symbols') and len(cand_lhs.free_symbols) == 1:
                    var = list(cand_lhs.free_symbols)[0]
                    try:
                        solutions = solve(prior_eq, var)
                        for sol in solutions:
                            if simplify(sol - cand_rhs) == 0:
                                step.student = cand_expr
                                step.status = "propagated_error"
                                step.reason = (
                                    f"Reclassified: student's answer '{step.student}' correctly follows "
                                    f"from their own prior error '{prior_step.student}' "
                                    f"(deterministic SymPy verification)."
                                )
                                if from_unused and cand_expr in unused_lines:
                                    unused_lines.remove(cand_expr)
                                reclassified = True
                                break
                    except Exception:
                        pass
                if reclassified:
                    break

            if reclassified:
                break


async def _async_calculate_grade(
    reference: List[dict], 
    student: List[dict], 
    rubric: Rubric, 
    config: GradingConfig = GradingConfig(),
    _skip_deterministic: bool = False,
    images: Optional[list] = None,
) -> GradingResult:
    """
    Internal asynchronous grader:
    1. Deterministic SymPy Symbolic Verifier (unless already run by caller).
    2. If any step is ambiguous or contains mistakes, falls back to LLM with low reasoning effort.
    """
    max_total = sum(obj.points for obj in rubric.objectives)
    
    has_student_work = any(bool(s.get("raw_text", "").strip()) for s in student) if student else False
    if not has_student_work and not images:
        # Fast path for empty student solutions
        steps = []
        for i, obj in enumerate(rubric.objectives):
            exp_text = reference[i].get("raw_text", "") if (reference and i < len(reference)) else obj.objective
            steps.append(StepResult(
                section=obj.id,
                status="not_attempted",
                points_awarded=0.0,
                points_possible=float(obj.points),
                reason="Student did not provide any work.",
                expected=exp_text,
                student="",
                student_lines=[]
            ))
        return GradingResult(score=0.0, max_score=max_total, confidence=1.0, steps=steps)

    # ── Tier 1: Deterministic SymPy Pre-Pass (offloaded to thread pool so event loop stays responsive) ──
    if not _skip_deterministic:
        deterministic_result = await asyncio.to_thread(_attempt_deterministic_grading, reference, student, rubric)
        if deterministic_result is not None:
            return deterministic_result

    # ── Tier 2: LLM Fallback with Reasoning Control ───────────────────────
    # Routed by GRADING_MODEL (GPT or Claude) with GRADING_FALLBACK_MODEL failover
    if not any_credentials():
        raise ValueError("OPENAI_API_KEY or ANTHROPIC_API_KEY is required for the LLM grader.")

    # Reconstruct the text blocks for the LLM
    ref_text = "\n".join([line["raw_text"] for line in reference])
    stu_text = "\n".join([line["raw_text"] for line in student])
    rubric_text = "\n".join([f"- {obj.id}: {obj.objective} ({obj.points} pts)" for obj in rubric.objectives])

    prompt = f"""You are an expert, highly accurate AI math grader.
Your task is to grade a student's handwritten solution against a teacher's reference solution and rubric.

## Teacher's Solution
{ref_text}

## Rubric Breakdown
{rubric_text}
Total Points: {max_total}

## Student's Solution
{stu_text}

## Grading Instructions
1. **GLOBAL NON-SEQUENTIAL COMPARISON**: Students frequently solve problems in different orders, write work in columns, rearrange systems, or place side calculations in margins. Compare each step of the student with the ENTIRE sequence of steps of the teacher to make the comparison completely fair.
2. **MATHEMATICAL EQUIVALENCE & ALTERNATIVE METHODS ARE PARAMOUNT**: Two expressions or equations that are algebraically equivalent MUST be classified as "correct", even if written in different forms, notations, or alternative solution paths. Examples of equivalent forms that MUST receive full credit:
   - Factored vs Expanded: `(x-2)(x-3) = 0` and `x^2 - 5x + 6 = 0`
   - Distributed vs Factored: `2(x+3)` and `2x + 6`
   - Combined vs Separate: `x = 2, 3` and `x = 2` + `x = 3`
   - Equivalent System Formulations: `2xy = 4` and `y = 2/x` or `x = 2/y` or `xy = 2` (isolating either variable is completely correct)
   - Rearranged Equations: `x^2 - y^2 = 3` and `y^2 = x^2 - 3` or `x^2 = y^2 + 3`
   - Radicals and Roots: `x = \\pm 2` and `x = 2, x = -2`. Also `\\pm(2+i)` and `2+i, -2-i`
   - Unsimplified vs Simplified: `\\sqrt{{4}}` and `2`, `\\frac{{4}}{{2}}` and `2`
   - Alternative Solution Paths: Students may solve quadratics by factoring, quadratic formula, or completing the square; or solve complex roots using algebraic Cartesian forms or polar forms. Any sound mathematical method must be parsed and awarded full credit.
   A student who writes an algebraically equivalent statement or valid alternative derivation has demonstrated mastery and MUST be awarded full credit.
3. **IMPLICIT SETUP & EMBEDDED PREAMBLE RULE (DO NOT MARK AS NOT_ATTEMPTED)**:
   - Rubric setup milestones often describe introductory definitions or variable declarations (e.g., "Set c^2 = -17", "Set sqrt(8+6i) = x + yi", "Set sqrt(0+i) = x + yi", or declaring variables).
   - In standard mathematical practice, students frequently omit writing the trivial introductory definition as a standalone line and jump directly to its applied/squared form (e.g., writing `\\sqrt{{c^2}} = \\sqrt{{-17}}`, `x^2 - y^2 + 2xyi = 8 + 6i`, or directly solving `\\sqrt{{-17}} = \\sqrt{{17}}\\sqrt{{-1}}`).
   - If the student's written work clearly assumes, embodies, or directly operates on this setup, they MUST be awarded FULL CREDIT ("correct") for that setup milestone.
   - **STRICT BOUNDARY: PREAMBLE VS. CALCULATION MILESTONES**:
     * This flexibility applies STRICTLY to introductory definitions, variable setups, and question restatements.
     * It does NOT apply to calculation/evaluation milestones! If a rubric milestone requires computing a specific numerical value or variable (e.g. "For x = 1/sqrt(2), find y = 1/sqrt(2)", "For x = 2, compute y = 1", or "State final square roots"), the student MUST physically compute or state that value on paper.
     * NEVER award points for unperformed calculations by claiming "implicit substitution". If a student found x but stopped writing without calculating or stating y, classify those y-calculation milestones as "not_attempted" (or "incorrect").
4. **COMPOUND EQUATIONS, MULTI-LINE DERIVATIONS & ALL SOLUTION POSSIBILITIES**:
   - Students frequently write mathematical solutions across multiple lines or chained with arrows/commas/semicolons (e.g., intermediate derivations, expanding `(x+yi)^2`, simplifying real and imaginary parts, factoring, and solving).
   - The grading system MUST parse through ALL solution possibilities, intermediate steps, and alternative derivation paths (e.g., isolating x vs isolating y; factoring vs quadratic formula; substituting equation 2 into 1 vs 1 into 2).
   - If a student wrote intermediate steps across multiple lines, evaluate all their lines and solution possibilities. If any valid path or sub-step reaches the required mathematical outcome or demonstrates the required rubric milestone, award FULL CREDIT ("correct").
   - Do NOT penalize the student for writing a derivation in 2 or 3 stacked lines instead of a single cramped line.
   - An equation that embodies both an implicit setup and its immediate operation (e.g., `\\sqrt{{c^2}} = \\sqrt{{-17}}` embodying both `c^2 = -17` and taking square roots, or `x^2 - y^2 + 2xyi = 8 + 6i` embodying both `\\sqrt{{8+6i}} = x+yi` and squaring) can satisfy both the setup milestone and the operational milestone. Do NOT penalize the student or mark the setup as unattempted when combining a definition with its immediate operational consequence.
5. If a student's step matches a teacher's milestone (exactly OR via valid mathematical equivalence/deduction/implicit setup), classify it as "correct".
6. If a student's step is mathematically incorrect, contains a genuine calculation/arithmetic error, or states a wrong equation/value, classify it as "incorrect". Do NOT classify an arithmetic error or wrong equation as "partially_correct" — it MUST be classified as "incorrect". Reserve "partially_correct" strictly for compound milestones where only a subset of required elements was provided (e.g., found only 1 out of 2 required roots) or when substantial partial progress is demonstrated without reaching an incorrect equation.
7. **PROPAGATED ERROR TRACKING (CRITICAL)**: If a student's step does not match the teacher's expected answer, BUT it logically and mathematically follows from the student's own previous incorrect line (for example, if the student wrote an initial arithmetic slip `2x = 5` instead of `2x = 4`, that step is "incorrect", but their subsequent line `x = 2.5` correctly solves from `2x = 5`, so classify that subsequent milestone as "propagated_error", NOT "incorrect" or "not_attempted"). Do not double-penalize the student for carrying forward an earlier slip. Always record their written derived line in 'student'.
8. Classify as "not_attempted" ONLY if the student completely omitted or provided NO work whatsoever for that milestone. If a student wrote an attempt or calculation (even if incorrect or based on a previous error), classify it as "incorrect" or "propagated_error" and record their equation in 'student' — NEVER mark it as "not_attempted".
9. IGNORE VARIABLE CASE & LOCAL NOTATION:
   - Do not penalize students for using uppercase instead of lowercase variables (e.g., `4P = 12` is completely correct and mathematically equivalent to `4p = 12`; `C` and `c` are identical). Classify as "correct".
   - Treat `\\pm` and `\\mp` as completely interchangeable for sets of roots.
   - Arabic procedural annotations confirm valid student methodology:
     * Student steps may include bracketed annotations extracted from handwriting, e.g. `[يهمل]`, `[يهمل \\notin R]`, or `[نعوض 2 في 1]`.
     * "يهمل" or "يهمل \\notin R" written under, beside, or bracketed with a non-real root (e.g., under `x^2 + 1 = 0` or `x^2 + 9 = 0` or written as `x^2 + 1 = 0 [يهمل]`) satisfies the milestone requirement to discard the extraneous non-real solution! Award FULL CREDIT for discarding.
     * "بجذر الطرفين" = taking square root of both sides.
     * "بالتربيع" = by squaring both sides.
     * "نعوض ... في ..." = substitution step (e.g., substituting equation 2 into equation 1).
10. In each StepResult, 'expected' MUST be the specific mathematical equation or expression from the teacher's rubric milestone (e.g. 'c^2 = -17' or 'x = 2'). 'student' MUST be the corresponding mathematical equation or expression written by the student (e.g. '\\sqrt{{c^2}} = \\sqrt{{-17}}' or 'x = 2.5'). If not attempted, leave 'student' empty. Leave 'student_lines' as [] (populated automatically by the server).
11. In each StepResult, keep 'reason' concise (at most 8-10 words explaining why points were awarded or deducted).
12. **MANDATORY RUBRIC COMPLETENESS (NEVER OMIT UNANSWERED STEPS)**:
    - You MUST output exactly ONE StepResult for EVERY rubric milestone listed in the Rubric Breakdown ({[obj.id for obj in rubric.objectives]}).
    - If a student left a question partially or half unanswered, or stopped working before completing all steps, YOU MUST STILL INCLUDE ALL REMAINING RUBRIC STEPS with status="not_attempted", points_awarded=0, and student="".
    - Under NO circumstances may you omit, skip, or combine unattempted rubric steps. The number of StepResult items in your output MUST EXACTLY equal the number of rubric milestones ({len(rubric.objectives)}).
13. For points_awarded, set it equal to points_possible for correct, and 0 for all other statuses. The server will apply partial credit multipliers deterministically.

Grading Strictness Mode: {config.strictness}
"""

    try:
        if images:
            result = GradingResult(**await complete_vision_json(
                "grading",
                prompt + PHOTO_RULES,
                schema=GradingResult,
                detail="high",
                images=images,
                system="You are a precise, fair, and mathematically rigorous grading API.",
            ))
        else:
            result = await complete_structured(
                "grading",
                prompt,
                GradingResult,
                system="You are a precise, fair, and mathematically rigorous grading API.",
            )
    except LLMUnavailableError as e:
        raise ValueError(f"LLM grading failed: {e}")

    # ── Rubric Alignment ──────────────────────────────────────────────────
    # The LLM echoes section ids and points_possible; never trust them. Rebuild
    # the step list in rubric order with the rubric's own point values, and mark
    # any milestone the LLM skipped as uncertain so it gets flagged for review.
    llm_steps = {}
    for step in result.steps:
        llm_steps.setdefault(step.section, step)
    aligned_steps: List[StepResult] = []
    for obj_idx, obj in enumerate(rubric.objectives):
        expected_text = ""
        if reference and obj_idx < len(reference):
            expected_text = str(reference[obj_idx].get("raw_text", "")).strip()
        if not expected_text:
            expected_text = obj.objective

        step = llm_steps.get(obj.id)
        if step is None:
            step = StepResult(
                section=obj.id,
                status="uncertain",
                points_awarded=0.0,
                points_possible=obj.points,
                reason="The grader returned no verdict for this rubric milestone.",
                expected=expected_text
            )
        step.points_possible = obj.points
        if not step.expected:
            step.expected = expected_text
        aligned_steps.append(step)
    result.steps = aligned_steps

    # Sanitize LLM-generated string fields from control characters / escape anomalies
    for step in result.steps:
        if step.expected:
            step.expected = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', step.expected).strip()
        if step.student:
            step.student = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', step.student).strip()
            if not step.student_lines:
                step.student_lines = _split_math_clauses(step.student) or [step.student]
                step.lines_detected = len(step.student_lines)
        if step.reason:
            step.reason = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', step.reason).strip()

    def _post_llm_symbolic_passes(res: GradingResult) -> GradingResult:
        # ── Deterministic Equivalence Guard ───────────────────────────────────
        for step in res.steps:
            if step.status != "correct" and step.expected and step.student:
                try:
                    verdict = verify_equivalence(step.expected, step.student)
                    if verdict.equivalent is True and verdict.status == "certain":
                        step.status = "correct"
                        step.reason = "Matches expected answer via mathematical equivalence."
                except Exception:
                    pass

        # ── Deterministic Propagated Error Recovery ─────────────────────────────
        _recover_propagated_errors(res, student)

        # ── Deterministic Rubric Reconciler & Completeness Enforcer ────────────
        return _reconcile_and_complete_rubric_steps(res, reference, rubric, config)

    result = await asyncio.to_thread(_post_llm_symbolic_passes, result)
    return result


def _reconcile_and_complete_rubric_steps(
    result: GradingResult,
    reference: List[dict],
    rubric: Rubric,
    config: GradingConfig
) -> GradingResult:
    """
    Enforces strict 1-to-1 completeness between the teacher's rubric and the grading result.
    
    If a student solved only part of the problem and left remaining steps unanswered:
    - This function guarantees that ALL unattempted teacher steps are preserved.
    - Each missing step is assigned status='not_attempted', points_awarded=0.0,
      and points_possible=obj.points.
    - The question max_score is ALWAYS the full total points of the teacher's rubric.
    - The score reflects deductions for all unanswered steps.
    """
    if not rubric.objectives:
        result.score = 0.0
        result.max_score = 0.0
        result.steps = []
        return result

    returned_steps = result.steps or []
    used_indices = set()
    reconciled_steps: List[StepResult] = []

    def get_clean_id(text: str) -> str:
        return re.sub(r'[^a-zA-Z0-9]', '', str(text or "")).lower()

    def get_step_num(text: str) -> Optional[int]:
        m = re.search(r'\d+', str(text or ""))
        return int(m.group()) if m else None

    for obj_idx, obj in enumerate(rubric.objectives):
        target_id_clean = get_clean_id(obj.id)
        target_num = get_step_num(obj.id) or (obj_idx + 1)
        expected_text = ""
        if reference and obj_idx < len(reference):
            expected_text = str(reference[obj_idx].get("raw_text", "")).strip()
        if not expected_text:
            expected_text = obj.objective

        matched_step: Optional[StepResult] = None
        matched_idx: Optional[int] = None

        # Pass A: Exact or normalized section ID match (e.g. 'step_1' vs 'step_1')
        for r_idx, s in enumerate(returned_steps):
            if r_idx in used_indices:
                continue
            s_clean = get_clean_id(s.section)
            if s_clean == target_id_clean:
                matched_step = s
                matched_idx = r_idx
                break

        # Pass B: Step number match (e.g. 'step_2' matches '2' or 'Step 2')
        if matched_step is None and target_num is not None:
            for r_idx, s in enumerate(returned_steps):
                if r_idx in used_indices:
                    continue
                s_num = get_step_num(s.section)
                if s_num == target_num:
                    matched_step = s
                    matched_idx = r_idx
                    break

        # Pass C: Positional fallback if counts match exactly
        if matched_step is None and len(returned_steps) == len(rubric.objectives):
            if obj_idx not in used_indices:
                matched_step = returned_steps[obj_idx]
                matched_idx = obj_idx

        # Pass D: Positional or first remaining unused step with student work
        if matched_step is None:
            if obj_idx < len(returned_steps) and obj_idx not in used_indices:
                matched_step = returned_steps[obj_idx]
                matched_idx = obj_idx
            else:
                for r_idx, s in enumerate(returned_steps):
                    if r_idx not in used_indices:
                        matched_step = s
                        matched_idx = r_idx
                        break

        if matched_step is not None:
            used_indices.add(matched_idx)
            # Ensure section and points_possible match rubric objective exactly
            matched_step.section = obj.id
            matched_step.points_possible = float(obj.points)
            if not matched_step.expected:
                matched_step.expected = expected_text
            if matched_step.student and not matched_step.student_lines:
                matched_step.student_lines = _split_math_clauses(matched_step.student) or [matched_step.student]
                matched_step.lines_detected = len(matched_step.student_lines)

            # Compute points_awarded deterministically based on verified status
            status = matched_step.status
            if status == "correct":
                matched_step.points_awarded = float(obj.points)
            elif status == "partially_correct":
                matched_step.points_awarded = round(float(obj.points) * config.partial_credit_multiplier, 2)
            elif status == "propagated_error":
                matched_step.points_awarded = round(float(obj.points) * config.propagated_error_multiplier, 2)
            else:
                matched_step.points_awarded = 0.0

            reconciled_steps.append(matched_step)
        else:
            # Step was completely omitted or discarded by LLM because student left it unanswered!
            # Restore the step as not_attempted with full points possible and 0 awarded
            reconciled_steps.append(StepResult(
                section=obj.id,
                status="not_attempted",
                points_awarded=0.0,
                points_possible=float(obj.points),
                reason="Student left this step unanswered / omitted from solution.",
                expected=expected_text,
                student="",
                student_lines=[],
                lines_detected=0
            ))

    max_possible = sum(float(obj.points) for obj in rubric.objectives)
    total_awarded = sum(float(s.points_awarded) for s in reconciled_steps)

    result.steps = reconciled_steps
    result.score = round(total_awarded, 2)
    result.max_score = round(max_possible, 2)
    return result


def calculate_grade(
    reference: List[dict], 
    student: List[dict], 
    rubric: Rubric, 
    config: GradingConfig = GradingConfig(),
    images: Optional[list] = None,
):
    """
    Grades student solution against teacher reference and rubric.
    Supports both synchronous callers and asynchronous (await / asyncio.run) callers.
    """
    max_total = sum(obj.points for obj in rubric.objectives)
    # Blank lines carry no work; treat an all-blank submission as empty
    student = [s for s in student if (s.get("raw_text") or "").strip()]

    if not rubric.objectives:
        return GradingResult(score=0.0, max_score=0.0, confidence=1.0, steps=[])

    has_student_work = any(bool(s.get("raw_text", "").strip()) for s in student) if student else False
    if not has_student_work and not images:
        # Fast path for empty student solutions
        steps = []
        for i, obj in enumerate(rubric.objectives):
            exp_text = reference[i].get("raw_text", "") if (reference and i < len(reference)) else obj.objective
            steps.append(StepResult(
                section=obj.id,
                status="not_attempted",
                points_awarded=0.0,
                points_possible=float(obj.points),
                reason="Student did not provide any work.",
                expected=exp_text,
                student="",
                student_lines=[]
            ))
        return GradingResult(score=0.0, max_score=max_total, confidence=1.0, steps=steps)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # When called inside an async event loop, run Tier 1 inside _async_calculate_grade
        # via asyncio.to_thread so we never block the event loop.
        return _async_calculate_grade(reference, student, rubric, config, _skip_deterministic=False, images=images)

    # Synchronous caller: run Tier 1 directly on the current thread
    deterministic_result = _attempt_deterministic_grading(reference, student, rubric)
    if deterministic_result is not None:
        return deterministic_result
    return asyncio.run(_async_calculate_grade(reference, student, rubric, config, _skip_deterministic=True, images=images))
