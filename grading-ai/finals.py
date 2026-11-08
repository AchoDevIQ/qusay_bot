"""
Final-answer check for the rubric engine: the teacher's final values against the student's,
compared as numbers (complex allowed) with SymPy. Same input, same verdict, every time.

    teacher_values("sqrt(4-3i) = 3/sqrt(2) - 1/sqrt(2) i or -3/sqrt(2) + 1/sqrt(2) i")
    -> two complex numbers
"""
import re
from typing import List, Optional

from sympy import I, N, sqrt, pi, E
from sympy.parsing.sympy_parser import (
    convert_xor, implicit_multiplication_application, parse_expr, standard_transformations,
)

_T = standard_transformations + (implicit_multiplication_application, convert_xor)
_LOCAL = {"i": I, "I": I, "sqrt": sqrt, "pi": pi, "e": E}


def _clean(s: str) -> str:
    s = s.replace("√", "sqrt").replace("−", "-").replace("–", "-").replace("·", "*").replace("×", "*")
    for _ in range(4):  # roots first (they sit inside fractions), then fractions, a few levels deep
        s = re.sub(r"\\sqrt\{([^{}]*)\}", r"sqrt(\1)", s)
        s = re.sub(r"\\frac\{([^{}]*)\}\{([^{}]*)\}", r"((\1)/(\2))", s)
    s = s.replace("\\pm", "±").replace("\\mp", "∓").replace("\\cdot", "*").replace("{", "(").replace("}", ")").replace("\\", "")
    return s.strip().strip(".")


def _one(s: str) -> List[complex]:
    """One written value; ± or ∓ gives both signs."""
    s = _clean(s)
    if not s:
        return []
    if "±" in s or "∓" in s:
        return _one(s.replace("±", "+", 1).replace("∓", "-", 1)) + _one(s.replace("±", "-", 1).replace("∓", "+", 1))
    try:
        v = complex(N(parse_expr(s, local_dict=_LOCAL, transformations=_T, evaluate=True)))
        return [v]
    except Exception:
        return []


def values(text: str) -> Optional[List[complex]]:
    """All values in a final line: «… = A or B», «A , B», «C1 = A ; C2 = B». None if any part can't be read."""
    out: List[complex] = []
    parts = [p for p in re.split(r"\bor\b|\bأو\b|\bاو\b|;|,|،|\band\b", text) if p.strip()]
    for p in parts:
        rhs = p.split("=")[-1]
        v = _one(rhs)
        if not v:
            return None
        out += v
    return out or None


def match(teacher: str, student: List[str]) -> Optional[float]:
    """Share of the teacher's final values the student got (0..1), minus wrong extra values. None if unreadable."""
    t = values(teacher)
    if not t:
        return None
    s: List[complex] = []
    for x in student:
        v = values(x)
        if v is None:
            return None
        s += v
    if not s:
        return 0.0
    left = list(s)
    hit = 0
    for a in t:
        j = next((k for k, b in enumerate(left) if abs(a - b) < 1e-6 * max(1.0, abs(a))), None)
        if j is not None:
            hit += 1
            left.pop(j)
    # one right and one wrong: half. Writing more values than the answer has (guessing) costs the extra ones
    extra = max(0, len(s) - len(t))
    return max(0.0, (hit - extra) / len(t))
