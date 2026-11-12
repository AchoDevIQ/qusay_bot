"""
Final-answer check for the QMath rubric engine: the teacher's final values against the
student's, compared as numbers (complex allowed). Same input, same verdict, every time.

Parsing runs in the SymPy sandbox (math_engine/sandbox.py: killable worker processes with
no API keys, through the safe parser), so text read from a student's page can neither run
code nor stall the server. The calls block: async code uses `amatch`.

What it understands (math_engine/finals.py):
- "sqrt(3 + 4i) = 2 + i or -2 - i (or +-(2 + i))": two values; the bracketed restatement is ignored.
- "c = +- sqrt(17)i", "c = ±√17 i": ± and ∓ give both values.
- "x = 2 , y = 1 or x = -2 , y = -1": pairs, so x = 3, y = 2 does not match x = 2, y = 3.
- Arabic digits, «أو», and the unknowns س ص ع.
- Rounded decimals: "0.707 + 0.707i" matches 1/sqrt(2) + i/sqrt(2). A written value must be the
  exact one rounded or cut off at its last digit: 0.67 and 0.66 are 2/3, 0.68 is not; "113" is 36π.
- A root the writer rejected ("x = -1 يهمل", "(rejected)") is not part of the answer, on either side.
- Chains ("x^2 = 4 => x = ±2"), sets ("S = {2, -2}"), "(x, y) = (2, 3)", numbered roots (x1, x2),
  mixed numbers ("1 1/2"), and degrees against radians (30° and π/6).
- The same root written twice counts once; labels such as "(Equation 1)" are ignored.
- Rates and function values with units: "dh/dt = -0.1 m/h", "V = 144π cm³", "f(a+h) ≅ 4.963",
  "5 سم/ثا". A reference written with ≅ / ≈ was rounded, so its own decimals count as well.
- An equation such as "x^2 - y^2 = 7" is not a final value: no verdict (None).
"""
import asyncio
from typing import Dict, List, Optional

from math_engine.sandbox import final_values

TOLERANCE = 1e-6
DEGREE = 3.141592653589793 / 180.0


def _part_close(exact: float, written: float, unit: float) -> bool:
    """
    One real number against the reference. Equal, or written to a digit (unit = that digit's
    size) and then either rounded there (off by at most half a unit) or cut off there (smaller
    in size by less than a unit). 0.67 and 0.66 are both 2/3; 0.68 is not, and 0.1 is not 0.2.
    """
    d = abs(written - exact)
    if d <= TOLERANCE * max(1.0, abs(exact)):
        return True
    if unit <= 0:
        return False
    if d <= 0.5 * unit * (1 + 1e-9):
        return True
    return d < unit * (1 - 1e-9) and abs(written) <= abs(exact) and written * exact >= 0


def _close(a: List[float], b: List[float], unit: float = 0.0, scale_a: float = 1.0, scale_b: float = 1.0) -> bool:
    """The reference value a against the written value b: real and imaginary parts each."""
    return all(_part_close(x * scale_a, y * scale_b, unit * scale_b) for x, y in zip(a, b))


def _same(a: Dict, b: Dict) -> bool:
    """a: the reference value, b: the student's. Only the student's decimals count as rounded;
    a teacher who writes 3.5 means exactly 3.5, but one who writes ≅ 4.963 rounded it.
    An angle in degrees on one side also matches the same angle in radians on the other."""
    unit = max(float(b.get("tol") or 0.0), float(a.get("tol") or 0.0) if a.get("approx") else 0.0)
    scales = [(1.0, 1.0)]
    if bool(a.get("deg")) != bool(b.get("deg")):
        scales.append((DEGREE, 1.0) if a.get("deg") else (1.0, DEGREE))
    for scale_a, scale_b in scales:
        if "value" in a and "value" in b:
            if _close(a["value"], b["value"], unit, scale_a, scale_b):
                return True
        elif "vars" in a and "vars" in b:
            if set(a["vars"]) == set(b["vars"]) and all(_close(a["vars"][k], b["vars"][k], unit, scale_a, scale_b) for k in a["vars"]):
                return True
    return False


def _distinct(solutions: List[Dict]) -> List[Dict]:
    """The same root written twice ("x = ±2" and then "x = 2") is one answer, not a guess."""
    out: List[Dict] = []
    for sol in solutions:
        if not any(_same(sol, kept) for kept in out):
            out.append(sol)
    return out


def values(text: str) -> Optional[List[Dict]]:
    """The solutions one final line states, or None (not values, unreadable, or timed out)."""
    return final_values(text or "")


def match(teacher: str, student: List[str]) -> Optional[float]:
    """
    Share of the teacher's final values the student got (0..1), minus wrong extra values,
    or None when either side cannot be read as values (the model's verdict then stands).
    One right and one wrong: half. Writing more values than the answer has costs the extras.
    """
    t = values(teacher)
    if not t:
        return None
    s: List[Dict] = []
    for item in student or []:
        if not (item or "").strip():
            continue
        v = values(item)
        if v is None:
            return None
        s += v
    if not s:
        return 0.0
    s = _distinct(s)
    if {("vars" in x) for x in t} != {("vars" in x) for x in s}:
        return None  # pairs on one side, single values on the other: not comparable
    left = list(s)
    hit = 0
    for a in t:
        j = next((k for k, b in enumerate(left) if _same(a, b)), None)
        if j is not None:
            hit += 1
            left.pop(j)
    extra = max(0, len(s) - len(t))
    return max(0.0, (hit - extra) / len(t))


def _shape(solution: Dict) -> tuple:
    """What kind of answer a solution is, without its numbers: a single value or the unknowns it
    pairs, and whether each number is real or complex."""
    if "vars" in solution:
        names = sorted(solution["vars"])
        return ("vars", tuple(names), tuple(abs(solution["vars"][k][1]) > TOLERANCE for k in names))
    return ("value", abs(solution["value"][1]) > TOLERANCE)


def same_format(teacher: str, student: List[str]) -> bool:
    """
    True when the student's final answer has the form of the teacher's, whatever its numbers:
    as many solutions, of the same kind (single values, or the same unknowns paired), real where
    the teacher's are real and complex where they are complex. An answer keeps this form when
    only an earlier mistake changed its numbers: "x = 3 or x = -3" for "x = 2 or x = -2".
    """
    t = values(teacher)
    if not t:
        return False
    s: List[Dict] = []
    for item in student or []:
        if not (item or "").strip():
            continue
        v = values(item)
        if v is None:
            return False
        s += v
    t, s = _distinct(t), _distinct(s)
    return bool(s) and sorted(map(repr, map(_shape, t))) == sorted(map(repr, map(_shape, s)))


async def amatch(teacher: str, student: List[str]) -> Optional[float]:
    return await asyncio.to_thread(match, teacher, student)


async def asame_format(teacher: str, student: List[str]) -> bool:
    return await asyncio.to_thread(same_format, teacher, student)
