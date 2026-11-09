"""
One place for score rounding, the pass mark and grade bands, so the API, the app,
Excel and the PDF report never disagree about a student's result.
"""
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, List, Optional, Tuple

PASS_PERCENTAGE = 50.0

# Iraqi grading scale: (minimum %, Arabic label, English label, colour)
GRADE_BANDS = (
    (90.0, "ممتاز", "Excellent", "#047857"),
    (80.0, "جيد جداً", "Very Good", "#0d9488"),
    (70.0, "جيد", "Good", "#2563eb"),
    (60.0, "متوسط", "Average", "#7c3aed"),
    (PASS_PERCENTAGE, "مقبول", "Pass", "#d97706"),
    (0.0, "راسب", "Fail", "#dc2626"),
)


def round_score(value, places: int = 2) -> float:
    """Half-up rounding (Python's round() sends 1.25 to 1.2). Scores keep 2 decimals."""
    try:
        quantum = Decimal(1).scaleb(-places)
        return float(Decimal(str(float(value))).quantize(quantum, rounding=ROUND_HALF_UP))
    except (TypeError, ValueError, ArithmeticError):
        return 0.0


def percentage(score, max_score) -> float:
    try:
        max_score = float(max_score)
        return round_score(float(score) / max_score * 100.0, 1) if max_score > 0 else 0.0
    except (TypeError, ValueError):
        return 0.0


def is_passing(pct) -> bool:
    return float(pct or 0.0) >= PASS_PERCENTAGE


def grade_band(pct) -> Tuple[str, str, str]:
    """(Arabic label, English label, colour) for a percentage."""
    pct = float(pct or 0.0)
    for minimum, arabic, english, colour in GRADE_BANDS:
        if pct >= minimum:
            return arabic, english, colour
    return GRADE_BANDS[-1][1:]


def whole_marks(scores: Iterable[float], total: Optional[float] = None) -> Tuple[List[int], int]:
    """
    Whole-number marks for display whose parts add up to the displayed total
    (largest remainder method). Rounding each question separately could show
    7 + 7 for a total of 13.
    """
    values = [max(0.0, float(s or 0.0)) for s in scores]
    exact_total = sum(values) if total is None else float(total)
    target = int(Decimal(str(exact_total)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    floors = [int(v) for v in values]
    shortfall = target - sum(floors)
    order = sorted(range(len(values)), key=lambda i: values[i] - floors[i], reverse=True)
    for i in order[:max(0, shortfall)]:
        floors[i] += 1
    return floors, target
