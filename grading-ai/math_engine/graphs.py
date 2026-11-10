"""
Key features of a function's graph, computed exactly, so a student's sketch can be checked
against numbers instead of against a model's impression.

Runs inside the SymPy worker (math_engine/worker.py); request handlers call
math_engine.sandbox.graph_features, which is time-limited and never raises. The function
text is parsed by math_engine.safe_expr, so it is never evaluated as code.

    graph_features("f(x) = x^2 - 4")
    -> {"function": "x**2 - 4", "x_intercepts": [-2.0, 2.0], "y_intercept": -4.0,
        "turning_points": [{"x": 0.0, "y": -4.0, "kind": "min"}], "inflection_points": [],
        "vertical_asymptotes": [], "horizontal_asymptotes": [], "holes": []}

A turning point is a peak or a trough: f' changes sign there. Where f' is 0 but keeps its sign
(x^5 at 0) the curve only flattens, so that point is an inflection point, not a turning point.
"""
import re
from typing import Dict, List, Optional, Sequence

from sympy import (
    Abs, FiniteSet, Symbol, diff, fraction, limit, nsimplify, oo, S, simplify, solveset, together,
)

from math_engine.normalizer import strip_annotations, strip_arabic_text
from math_engine.verifier import safe_parse

MAX_FEATURES = 12
X = Symbol("x", real=True)

# Typeset dashes and operators that SymPy does not read: "x² – 3x", "2 × x"
_SYMBOLS = str.maketrans({"–": "-", "—": "-", "−": "-", "×": "*", "÷": "/", "·": "*"})
# "f(x) = ...", "y = ...", "g(x)=...", with Arabic letters already mapped (ص -> y, س -> x)
_FUNCTION_LINE = re.compile(r"(?:\b[a-zA-Z]\s*\(\s*x\s*\)|\by)\s*=\s*([^;,\n=:،]+)")


def find_function(text: str) -> Optional[str]:
    """The right-hand side of the first "f(x) = ..." / "y = ..." in a text that uses x, or None."""
    s = strip_arabic_text(strip_annotations((text or "").translate(_SYMBOLS)))
    for m in _FUNCTION_LINE.finditer(s):
        rhs = m.group(1).strip()
        if re.search(r"(?<![A-Za-z])x(?![A-Za-z])", rhs):
            return rhs
    return None


def _num(v) -> Optional[float]:
    try:
        c = complex(v.evalf(15))
    except (TypeError, ValueError):
        return None
    if abs(c.imag) > 1e-9 or c.real != c.real or abs(c.real) == float("inf"):
        return None
    return round(c.real, 6)


def _finite_real(solutions) -> Optional[List]:
    """The points of a finite set of real solutions ([] when there are none), or None (infinitely
    many, or not solvable)."""
    if solutions is S.EmptySet:
        return []
    if not isinstance(solutions, FiniteSet) or len(solutions) > MAX_FEATURES:
        return None
    return [p for p in solutions if _num(p) is not None]


def _function(text: str):
    """f as a SymPy expression in the real symbol X, or None when the text is not a function of x alone."""
    rhs = find_function(text) or (text or "").translate(_SYMBOLS).strip()
    expr = safe_parse(rhs)
    if expr is None or not hasattr(expr, "free_symbols"):
        return None
    symbols = expr.free_symbols
    if len(symbols) != 1 or next(iter(symbols)).name != "x":
        return None
    return expr.subs(next(iter(symbols)), X)


def _sign(expr, at: float) -> int:
    v = _num(expr.subs(X, at))
    return 0 if v is None or v == 0 else (1 if v > 0 else -1)


def _step(p: float, others: Sequence[float]) -> float:
    """A step to either side of p that stays clear of the other special points."""
    gaps = [abs(p - q) for q in others if q is not None and abs(p - q) > 1e-9]
    return min([0.5] + [g / 2 for g in gaps])


def function_values(text: str, xs: Sequence[float]) -> Optional[List[Optional[float]]]:
    """f at each x (None where f is undefined), or None when the text is not a function of x."""
    f = _function(text)
    if f is None:
        return None
    return [_num(f.subs(X, nsimplify(x))) for x in list(xs)[:MAX_FEATURES * 2]]


def graph_features(text: str) -> Optional[Dict]:
    """Exact features of y = f(x), or None when the text is not a function of x alone."""
    f = _function(text)
    if f is None:
        return None

    num, den = fraction(together(f))
    # Points outside the domain: a vertical asymptote, or a hole where the factor cancels
    excluded = _finite_real(solveset(den, X, S.Reals)) if den.free_symbols else []
    vertical, holes = [], []
    for p in excluded or []:
        reduced = simplify(f)
        lim = limit(reduced, X, p)
        if lim in (oo, -oo) or lim.has(oo) or Abs(lim) is oo:
            vertical.append(_num(p))
        else:
            holes.append({"x": _num(p), "y": _num(lim)})

    roots = _finite_real(solveset(num, X, S.Reals))
    x_intercepts = None if roots is None else sorted(
        _num(r) for r in roots if not den.free_symbols or _num(den.subs(X, r)) not in (None, 0.0))

    y0 = None if 0.0 in [v for v in vertical] + [h["x"] for h in holes] else _num(f.subs(X, 0))

    poles = [_num(p) for p in excluded or []]
    turning = []
    d1 = simplify(diff(f, X))
    critical = _finite_real(solveset(d1, X, S.Reals)) if d1.free_symbols else []
    d2 = simplify(diff(d1, X))
    for c in critical or []:
        y, cx = _num(f.subs(X, c)), _num(c)
        if y is None:
            continue
        # First-derivative test: f' must change sign for a peak or a trough
        h = _step(cx, [_num(q) for q in critical] + poles)
        left, right = _sign(d1, cx - h), _sign(d1, cx + h)
        if left > 0 > right:
            kind = "max"
        elif left < 0 < right:
            kind = "min"
        elif left and left == right:
            continue  # flattens and carries on: an inflection point (found below), not a turning point
        else:
            curvature = _num(d2.subs(X, c))
            kind = "min" if curvature and curvature > 0 else "max" if curvature and curvature < 0 else "flat"
        turning.append({"x": cx, "y": y, "kind": kind})

    # Inflection points: f'' changes sign at a point of the domain
    candidates = _finite_real(solveset(d2, X, S.Reals)) if d2.free_symbols else []
    inflection = []
    for p in candidates or []:
        px = _num(p)
        y = _num(f.subs(X, p))
        if px is None or y is None or px in poles:
            continue
        h = _step(px, [_num(q) for q in candidates] + poles)
        left, right = _sign(d2, px - h), _sign(d2, px + h)
        if left and right and left != right:
            inflection.append({"x": px, "y": y})

    horizontal = []
    for end in (oo, -oo):
        lim = limit(f, X, end)
        value = _num(lim) if lim.is_finite else None
        if value is not None and value not in horizontal:
            horizontal.append(value)

    return {
        "function": str(nsimplify(f) if f.is_polynomial(X) else f),
        "x_intercepts": x_intercepts,  # None: infinitely many or not solvable
        "y_intercept": y0,
        # None: infinitely many (sin x) or not solvable
        "turning_points": None if critical is None else sorted(turning, key=lambda t: t["x"])[:MAX_FEATURES],
        "inflection_points": None if candidates is None else sorted(inflection, key=lambda t: t["x"])[:MAX_FEATURES],
        "vertical_asymptotes": sorted(v for v in vertical if v is not None),
        "horizontal_asymptotes": sorted(horizontal),
        "holes": holes,
    }
