"""
Final answers as values, so the teacher's final line and the student's can be compared
as numbers (complex allowed) instead of as text.

This module runs inside the SymPy worker (math_engine/worker.py). Request handlers call
math_engine.sandbox.final_values, which is time-limited and never raises; the parsing
itself goes through math_engine.safe_expr, so student text is never evaluated as code.

    final_values("sqrt(3 + 4i) = 2 + i or -2 - i (or +-(2 + i))")
    -> [{"value": [2.0, 1.0], "tol": 0.0}, {"value": [-2.0, -1.0], "tol": 0.0}]
    final_values("x = 2 , y = 1 or x = -2 , y = -1")
    -> [{"vars": {"x": [2.0, 0.0], "y": [1.0, 0.0]}, "tol": 0.0}, {"vars": {...}, "tol": 0.0}]
    final_values("0.707 + 0.707i")
    -> [{"value": [0.707, 0.707], "tol": 0.001}]   (rounded: matches 1/sqrt(2) + i/sqrt(2))
    final_values("x^2 - y^2 = 7")
    -> None   (an equation, not a final value)
"""
import cmath
import re
from typing import Dict, List, Optional, Tuple

from sympy import N

from math_engine.clauses import clause_set, has_inequality, split_top_level
from math_engine.normalizer import strip_annotations, strip_arabic_text
from math_engine.verifier import safe_parse

MAX_FINAL_CHARS = 400
MAX_SOLUTIONS = 12

# Arabic "or" / "and" between answers, read before strip_arabic_text removes Arabic words
_ARABIC_OR = re.compile(r"(?:^|\s)(?:أو|او)(?:\s|$)")
_ARABIC_AND = re.compile(r"\s(?:و)\s")
# Typed "+-" / "-+" for ± / ∓ at the start of a value: "x = +-2", "(+-(2 + i))"
_PLUS_MINUS_TEXT = re.compile(r"(^|[=\s(,:;])\+\s*-")
_MINUS_PLUS_TEXT = re.compile(r"(^|[=\s(,:;])-\s*\+")
# A variable being assigned: x, y, z, c, z1, z_2, θ
_BARE_VAR = re.compile(r"(?:[A-Za-z]|[α-ωΑ-Ω])(?:_?\d)?")
# Decimals the student wrote: "0.707" was rounded, so it matches within half its last digit
_DECIMAL = re.compile(r"\d\.(\d+)")
# A parenthesised alternative wording of the same answer: "(or +-(2 + i))", "(أو ...)"
_ALTERNATIVE_OPEN = re.compile(r"\(\s*(?:or|i\.e\.|أو|او)\b", re.IGNORECASE)


def _drop_alternatives(text: str) -> str:
    """Removes "(or ...)" groups, which restate the answer, by matching brackets."""
    while True:
        m = _ALTERNATIVE_OPEN.search(text)
        if not m:
            return text
        depth, end = 0, None
        for k in range(m.start(), len(text)):
            if text[k] == "(":
                depth += 1
            elif text[k] == ")":
                depth -= 1
                if depth == 0:
                    end = k
                    break
        if end is None:
            return text[:m.start()]
        text = text[:m.start()] + " " + text[end + 1:]


def _prepare(text: str) -> str:
    s = (text or "").strip()
    s = _ARABIC_OR.sub(" or ", s)
    s = _ARABIC_AND.sub(" , ", s)
    s = _drop_alternatives(s)
    s = strip_annotations(s)
    s = strip_arabic_text(s)
    s = s.replace("−", "-").replace("–", "-")
    s = _PLUS_MINUS_TEXT.sub(lambda m: m.group(1) + "±", s)
    s = _MINUS_PLUS_TEXT.sub(lambda m: m.group(1) + "∓", s)
    return s.strip().rstrip(".")


def _number(text: str) -> Optional[complex]:
    """The value of a closed expression (no unknowns), else None."""
    text = (text or "").strip()
    if not text:
        return None
    expr = safe_parse(text)
    if expr is None or not hasattr(expr, "free_symbols") or expr.free_symbols:
        return None
    try:
        value = complex(N(expr, 30))
    except (TypeError, ValueError):
        return None
    if not (cmath.isfinite(value)):
        return None
    return value


def _pair(value: complex) -> List[float]:
    return [float(value.real), float(value.imag)]


def _rounding(text: str) -> float:
    """How far a written value may be from the exact one because it was rounded: up to one
    unit of its least precise decimal (both parts of a complex number can be rounded)."""
    places = [len(m.group(1)) for m in _DECIMAL.finditer(text or "")]
    return 10.0 ** -min(places) if places else 0.0


def final_values(text: str) -> Optional[List[Dict]]:
    """
    The solutions a final line states, or None when it is not a list of values (an
    equation, an inequality, unreadable text, or x/y pairs that cannot be paired).
    """
    if not text or len(text) > MAX_FINAL_CHARS:
        return None
    s = _prepare(text)
    if not s or has_inequality(s):
        return None

    tol = _rounding(s)
    items: List[Tuple[str, Optional[str], complex]] = []
    for clause in clause_set(s):
        if "=" in clause:
            sides = [p.strip() for p in clause.split("=")]
            lhs, rhs = sides[0], sides[-1]
            value = _number(rhs)
            if value is None:
                return None
            compact = lhs.replace(" ", "")
            if _BARE_VAR.fullmatch(compact):
                items.append(("assign", compact, value))
            elif not compact or _number(lhs) is not None:
                # "sqrt(3 + 4i) = 2 + i": the left side is the quantity being found
                items.append(("value", None, value))
            else:
                return None  # "x^2 - y^2 = 7" is an equation, not a final value
        else:
            for piece in split_top_level(clause):
                if not piece.strip():
                    continue
                value = _number(piece)
                if value is None:
                    return None
                items.append(("value", None, value))
        if len(items) > MAX_SOLUTIONS * 3:
            return None

    if not items:
        return None
    assigned = {name for kind, name, _ in items if kind == "assign"}
    if len(assigned) <= 1:
        # "x = 2 or x = -2", "z = 2 + i or -2 - i": one unknown, so each value is a solution
        return [{"value": _pair(v), "tol": tol} for _, _, v in items][:MAX_SOLUTIONS]
    if any(kind == "value" for kind, _, _ in items):
        return None  # mixes "x = 2" with bare values: the pairing is unclear

    solutions: List[Dict[str, complex]] = []
    current: Dict[str, complex] = {}
    for _, name, value in items:
        if name in current:
            solutions.append(current)
            current = {}
        current[name] = value
    solutions.append(current)
    if any(set(sol) != assigned for sol in solutions):
        return None  # "x = ±2, y = ±1" does not say which x goes with which y
    return [{"vars": {k: _pair(v) for k, v in sorted(sol.items())}, "tol": tol} for sol in solutions][:MAX_SOLUTIONS]
