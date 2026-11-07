from typing import Optional, List
from pydantic import BaseModel
from grading.grader import GradingResult

class ReviewTask(BaseModel):
    requires_review: bool
    priority: str
    reason: str
    confidence: float
    affected_sections: List[str]

def detect_review_needed(
    result: GradingResult,
    threshold: float = 0.8,
    avg_ocr_confidence: Optional[float] = None,
    ambiguous_glyphs_count: Optional[int] = None,
    has_discarded_work: Optional[bool] = None,
    has_unattempted_with_work: Optional[bool] = None,
) -> ReviewTask:
    """
    Multi-Signal Objective Risk Detector (Solution 5):
    Replaces brittle LLM self-confidence with Bayesian Objective Risk Scoring (ORS).
    Evaluates:
      1. OCR extraction confidence & glyph ambiguity.
      2. Heavy point deductions on high-stakes milestones (>=3.0 pts).
      3. Cascading propagated errors across multiple steps.
      4. Discarded scratch work on imperfect submissions.
      5. Borderline failure scores (0% < score < 50%).
      6. Explicit uncertain status tags from grading.
    """
    risk_score = 0.0
    risk_reasons: List[str] = []
    affected_sections: List[str] = []

    # 1. Uncertain Steps
    uncertain_steps = [s for s in result.steps if s.status == "uncertain"]
    if uncertain_steps:
        risk_score += 0.35 * len(uncertain_steps)
        affected_sections.extend(s.section for s in uncertain_steps)
        risk_reasons.append(f"{len(uncertain_steps)} steps have uncertain status")

    # 2. LLM Self-Confidence Drop
    if result.confidence < threshold:
        risk_score += 0.30
        risk_reasons.append(f"Grading confidence ({result.confidence:.2f}) < {threshold:.2f}")

    # 3. OCR Confidence & Ambiguity Signals
    if avg_ocr_confidence is not None:
        if avg_ocr_confidence < 0.70:
            risk_score += 0.45
            risk_reasons.append(f"Critical low OCR confidence ({avg_ocr_confidence*100:.1f}%)")
        elif avg_ocr_confidence < 0.85:
            risk_score += 0.25
            risk_reasons.append(f"Moderate OCR confidence ({avg_ocr_confidence*100:.1f}%)")
            
    if ambiguous_glyphs_count and ambiguous_glyphs_count > 1:
        risk_score += 0.20
        risk_reasons.append(f"{ambiguous_glyphs_count} ambiguous glyphs detected")

    # 4. High-Stakes Milestone Deduction (lost >=3.0 points on an attempted step)
    heavy_deductions = [
        s for s in result.steps 
        if s.points_possible >= 3.0 and s.points_awarded == 0.0 and s.status != "not_attempted"
    ]
    if heavy_deductions:
        risk_score += 0.35
        affected_sections.extend(s.section for s in heavy_deductions)
        risk_reasons.append(f"Heavy deduction on high-stakes milestones: {', '.join(s.section for s in heavy_deductions)}")

    # 5. Cascading Propagated Errors
    prop_steps = [s for s in result.steps if s.status == "propagated_error"]
    if len(prop_steps) >= 2:
        risk_score += 0.30
        affected_sections.extend(s.section for s in prop_steps)
        risk_reasons.append(f"{len(prop_steps)} cascading propagated errors require teacher verification")

    # 6. Discarded Scratch Work on Imperfect Solutions
    pct = (result.score / result.max_score * 100.0) if result.max_score > 0 else 0.0
    if has_discarded_work and (0.0 < pct < 85.0):
        risk_score += 0.20
        risk_reasons.append("Discarded scratch work detected on imperfect submission")

    # 7. Borderline Score (e.g., failing score with partial attempt)
    if 0.0 < pct < 50.0 and any(s.status == "correct" for s in result.steps):
        risk_score += 0.20
        risk_reasons.append(f"Low overall mastery score ({pct:.1f}%) with partial attempt")

    requires_review = (risk_score >= 0.30) or (len(uncertain_steps) > 0)
    
    if requires_review:
        priority = "high" if (risk_score >= 0.60 or len(uncertain_steps) > 1) else "medium"
        reason_str = " | ".join(risk_reasons) if risk_reasons else "Review flagged by risk heuristics."
        unique_affected = list(dict.fromkeys(affected_sections))
        return ReviewTask(
            requires_review=True,
            priority=priority,
            reason=reason_str,
            confidence=result.confidence,
            affected_sections=unique_affected
        )

    return ReviewTask(
        requires_review=False,
        priority="low",
        reason="Submission passes all objective risk checks.",
        confidence=result.confidence,
        affected_sections=[]
    )
