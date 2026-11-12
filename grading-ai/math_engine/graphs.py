"""
Key features of a function's graph, computed exactly, so a student's sketch can be checked
against numbers instead of against a model's impression.

Runs inside the SymPy worker (math_engine/worker.py); request handlers call
math_engine.sandbox.graph_features, which is time-limited and never raises. The function
text is parsed by math_engine.safe_expr, so it is never evaluated as code.

    graph_features("f(x) = x^2 - 4")
    -> {"function": "x**2 - 4", "x_intercepts": [-2.0, 2.0], "y_intercept": -4.0,
        "turning_points": [{"x": 0.0, "y": -4.0, "kind": "min"}], "inflection_points": [],
        "vertical_asymptotes": [], "horizontal_asymptotes": [], "holes": [],
        "domain": "all real numbers", "symmetry": "even",
        "increasing": [[0.0, None]], "decreasing": [[None, 0.0]],
        "concave_up": [[None, None]], "concave_down": []}

A turning point is a peak or a trough: f' changes sign there. Where f' is 0 but keeps its sign
(x^5 at 0) the curve only flattens, so that point is an inflection point, not a turning point.
A list is None when it is not finite or cannot be worked out (the intercepts of sin x, the
asymptotes of tan x): there is then nothing exact to compare a sketch with.
"""
import re
from typing import Dict, List, Optional, Sequence

from sympy import (
    FiniteSet, Interval, Symbol, Union, diff, exp, fraction, limit, nsimplify, oo, S, simplify, solveset, together,
)
from sympy.calculus.singularities import singularities
from sympy.calculus.util import continuous_domain

from math_engine.normalizer import strip_annotations, strip_arabic_text
from math_engine.verifier import safe_parse

MAX_FEATURES = 12
X = Symbol("x", real=True)

# Typeset dashes and operators that SymPy does not read: "x² – 3x", "2 × x"
_SYMBOLS = str.maketrans({"–": "-", "—": "-", "−": "-", "×": "*", "÷": "/", "·": "*"})
# "|x - 2|" is abs(x - 2)
_BARS = re.compile(r"\|([^|]+)\|")
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
    expr = safe_parse(_BARS.sub(r"abs(\1)", rhs))
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


def _limit(f, point, side: str = "+"):
    """limit(), with a^x spelled as e^(x ln a) first: SymPy gets 2^x at -oo wrong otherwise."""
    try:
        return limit(f.rewrite(exp), X, point, side)
    except Exception:
        return limit(f, X, point, side)


def _infinite(value) -> bool:
    return value in (oo, -oo) or bool(getattr(value, "is_infinite", False)) or value.has(oo, -oo, S.ComplexInfinity)


def _excluded(f, den) -> Optional[List]:
    """The real points where f is not defined (poles, holes, the edge of ln x): a finite list, or
    None when there are infinitely many (tan x)."""
    try:
        points = singularities(f, X, S.Reals)
    except Exception:
        points = S.EmptySet
    if den.free_symbols:
        points = Union(points, solveset(den, X, S.Reals))
    return _finite_real(points)


def _domain(f):
    try:
        return continuous_domain(f, X, S.Reals)
    except Exception:
        return None


def _domain_edges(domain) -> List[float]:
    """The finite end points of the domain's intervals (0 for sqrt(x), -2 and 2 for sqrt(4 - x^2))."""
    parts = domain.args if isinstance(domain, Union) else [domain]
    edges = []
    for part in parts:
        if isinstance(part, Interval):
            edges += [v for v in (_num(part.start), _num(part.end)) if v is not None]
    return edges


def _domain_text(domain) -> Optional[str]:
    if domain is None:
        return None
    if domain == S.Reals:
        return "all real numbers"
    parts = domain.args if isinstance(domain, Union) else [domain]
    out = []
    for part in parts:
        if not isinstance(part, Interval):
            return None
        lo = "-inf" if part.start == -oo else f"{_num(part.start):g}"
        hi = "inf" if part.end == oo else f"{_num(part.end):g}"
        out.append(("(" if part.left_open or part.start == -oo else "[") + f"{lo}, {hi}"
                   + (")" if part.right_open or part.end == oo else "]"))
    return " U ".join(out)


def _sign_intervals(f, expr, breaks: Sequence[float], open_points: Sequence[float]):
    """
    The real line cut at the break points, sorted by the sign of expr inside each piece:
    (where it is positive, where it is negative), as [low, high] with None for no bound.
    Neighbouring pieces with the same sign join up unless a point f is undefined at lies between.
    Pieces outside f's domain are left out (x < 0 for ln x, although 1/x has a sign there).
    """
    points = sorted({b for b in breaks if b is not None})
    edges = [None] + points + [None]
    signed = []
    for lo, hi in zip(edges, edges[1:]):
        at = 0.0 if lo is None and hi is None else hi - 1.0 if lo is None else lo + 1.0 if hi is None else (lo + hi) / 2
        sign = _sign(expr, at) if _num(f.subs(X, at)) is not None else 0
        if sign and signed and signed[-1][0] == sign and signed[-1][1][1] == lo and lo not in open_points:
            signed[-1][1][1] = hi
        elif sign:
            signed.append((sign, [lo, hi]))
    return [iv for sign, iv in signed if sign > 0], [iv for sign, iv in signed if sign < 0]


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
    # Points outside the domain: a vertical asymptote where f runs off to infinity, a hole where it does not
    excluded = _excluded(f, den)
    vertical, holes = [], []
    reduced = simplify(f)
    for p in excluded or []:
        right, left = _limit(reduced, p, "+"), _limit(reduced, p, "-")
        if _infinite(right) or _infinite(left):
            vertical.append(_num(p))
        elif _num(right) is not None and _num(right) == _num(left):
            holes.append({"x": _num(p), "y": _num(right)})
    poles = [_num(p) for p in excluded or []]

    roots = _finite_real(solveset(num, X, S.Reals))
    x_intercepts = None if roots is None else sorted(
        _num(r) for r in roots if not den.free_symbols or _num(den.subs(X, r)) not in (None, 0.0))

    y0 = None if 0.0 in poles else _num(f.subs(X, 0))

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
        lim = _limit(f, end)
        value = _num(lim) if lim.is_finite else None
        if value is not None and value not in horizontal:
            horizontal.append(value)

    # Where the curve rises, falls and bends, for the written steps of a curve sketch
    domain = _domain(f)
    edges = _domain_edges(domain) if domain is not None else []
    rising = falling = cup = cdown = None
    if excluded is not None and critical is not None:
        rising, falling = _sign_intervals(f, d1, [_num(c) for c in critical] + poles + edges, poles)
    if excluded is not None and candidates is not None:
        cup, cdown = _sign_intervals(f, d2, [_num(c) for c in candidates] + poles + edges, poles)
    mirrored = f.subs(X, -X)
    symmetry = "even" if simplify(mirrored - f) == 0 else "odd" if simplify(mirrored + f) == 0 else "none"

    return {
        "function": str(nsimplify(f) if f.is_polynomial(X) else f),
        "x_intercepts": x_intercepts,  # None: infinitely many or not solvable
        "y_intercept": y0,
        # None: infinitely many (sin x) or not solvable
        "turning_points": None if critical is None else sorted(turning, key=lambda t: t["x"])[:MAX_FEATURES],
        "inflection_points": None if candidates is None else sorted(inflection, key=lambda t: t["x"])[:MAX_FEATURES],
        "vertical_asymptotes": None if excluded is None else sorted(v for v in vertical if v is not None),  # None: tan x
        "horizontal_asymptotes": sorted(horizontal),
        "holes": holes,
        "domain": _domain_text(domain),
        "symmetry": symmetry,  # even: about the y-axis; odd: about the origin
        "increasing": rising,
        "decreasing": falling,
        "concave_up": cup,
        "concave_down": cdown,
    }
