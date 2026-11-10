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
- Rounded decimals: "0.707 + 0.707i" matches 1/sqrt(2) + i/sqrt(2) (within its last digit).
- The same root written twice counts once; labels such as "(Equation 1)" are ignored.
- Rates and function values with units: "dh/dt = -0.1 m/h", "V = 144π cm³", "f(a+h) ≅ 4.963",
  "5 سم/ثا". A reference written with ≅ / ≈ was rounded, so its own decimals count as well.
- An equation such as "x^2 - y^2 = 7" is not a final value: no verdict (None).
"""
import asyncio
from typing import Dict, List, Optional

from math_engine.sandbox import final_values

TOLERANCE = 1e-6


def _close(a: List[float], b: List[float], rounding: float = 0.0) -> bool:
    """Equal values; a value written with decimals may be off by its rounding (0.707 for 1/sqrt(2))."""
    za, zb = complex(*a), complex(*b)
    return abs(za - zb) <= max(TOLERANCE * max(1.0, abs(za)), rounding)


def _same(a: Dict, b: Dict) -> bool:
    """a: the reference value, b: the student's. Only the student's decimals count as rounded;
    a teacher who writes 3.5 means exactly 3.5, but one who writes ≅ 4.963 rounded it."""
    rounding = max(float(b.get("tol") or 0.0), float(a.get("tol") or 0.0) if a.get("approx") else 0.0)
    if "value" in a and "value" in b:
        return _close(a["value"], b["value"], rounding)
    if "vars" in a and "vars" in b:
        return set(a["vars"]) == set(b["vars"]) and all(_close(a["vars"][k], b["vars"][k], rounding) for k in a["vars"])
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


async def amatch(teacher: str, student: List[str]) -> Optional[float]:
    return await asyncio.to_thread(match, teacher, student)
