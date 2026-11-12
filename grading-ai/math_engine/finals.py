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
    final_values("dh/dt = -0.1 m/h")
    -> [{"value": [-0.1, 0.0], "tol": 0.1}]   (a rate, with its unit)
    final_values("f(a+h) ≅ 4.963")
    -> [{"value": [4.963, 0.0], "tol": 0.001, "approx": True}]   (both sides' rounding counts)
    final_values("x = 3 or x = -1 يهمل")
    -> [{"value": [3.0, 0.0], "tol": 0.0}]   (a rejected root is not part of the answer)
    final_values("x^2 = 4 => x = ±2")
    -> [{"value": [2.0, 0.0], "tol": 0.0}, {"value": [-2.0, 0.0], "tol": 0.0}]   (what the chain arrives at)
    final_values("θ = 30°")
    -> [{"value": [30.0, 0.0], "tol": 0.0, "deg": True}]   (matches π/6 written in radians)

"tol" is the unit of the last digit the value was written to (0.001 for 0.707, 1 for a whole
number of three or more digits, 0 otherwise). finals.py decides what counts as a rounding of it.
"""
import cmath
import re
from typing import Dict, List, Optional, Tuple

from sympy import N

from math_engine.clauses import ARROW_PATTERN, clause_set, has_inequality, split_top_level
from math_engine.normalizer import strip_annotations, strip_arabic_text
from math_engine.verifier import safe_parse

MAX_FINAL_CHARS = 400
MAX_SOLUTIONS = 12

# Arabic "or" / "and" between answers, read before strip_arabic_text removes Arabic words
_ARABIC_OR = re.compile(r"(?:^|\s)(?:أو|او)(?:\s|$)")
_AND = re.compile(r"\s(?:و|and)\s", re.IGNORECASE)
# Typed "+-" / "-+" for ± / ∓ at the start of a value: "x = +-2", "(+-(2 + i))"
_PLUS_MINUS_TEXT = re.compile(r"(^|[=\s(,:;])\+\s*-")
_MINUS_PLUS_TEXT = re.compile(r"(^|[=\s(,:;])-\s*\+")
# A variable being assigned: x, y, z, c, z1, z_2, θ
_BARE_VAR = re.compile(r"(?:[A-Za-z]|[α-ωΑ-Ω])(?:_?\d)?")
# The same unknown numbered: x1, x_2 are two roots of x, not a pair of unknowns
_INDEXED_VAR = re.compile(r"((?:[A-Za-z]|[α-ωΑ-Ω]))_?(\d)")
_SUBSCRIPTS = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
# A rate or a function's value names what the line gives: dh/dt, dθ/dt, dy/dx, f(a+h), v(4.01), f'(2)
_DERIVATIVE = re.compile(r"d(?:[A-Za-z]|[α-ωΑ-Ω])(?:_?\d)?/d[A-Za-z]")
_AT_POINT = re.compile(r"[A-Za-z]'*\([^()=]*\)")
# "Approximately equal": the value was rounded, so the reference's own decimals count too
_APPROX = re.compile(r"≅|≈|≃|~=|=~")
# An angle written in degrees: it also matches the same angle in radians (30° and π/6)
_DEGREES = re.compile(r"°|º|\bdeg(?:rees?)?\b|درجة|درجات", re.IGNORECASE)
# A unit after a value: cm, cm³, cm^2, m/s, km/h, cm/sec, unit/sec, rad/s, and سم/ثا, م/د, كم/ساعة, درجة.
# Longer names come first ("min" before "m"); a unit must end the value, so "2 sqrt(3)" keeps its "s".
# A one-letter unit (m, s, h) needs a space before it unless it is part of a rate: "x = 2m" may be 2·m.
_UNIT_LONG = r"(?:km|cm|mm|min|units?|sec|hr|rad|degrees?|deg|سم|ملم|كم|ثانية|ثا|دقيقة|ساعة|سا|درجة|وحدة)"
_UNIT_SHORT = r"(?:m|s|h|م|د)"
_UNIT_POWER = r"(?:[²³]|\^\s*[23])?"
_UNIT_ANY = rf"(?:{_UNIT_LONG}|{_UNIT_SHORT}){_UNIT_POWER}"
_UNIT = re.compile(rf"(?<=[\d\sπ)√])\s*(?:{_UNIT_ANY}\s*/\s*{_UNIT_ANY}|{_UNIT_LONG}{_UNIT_POWER}|(?<=\s){_UNIT_SHORT}{_UNIT_POWER})"
                   rf"(?=$|[\s,;)]|or\b)")
# A named quantity in geometry: "angle C", "∠ABC", "m∠A", "side AB", "AB", "arc AB"
# Capital point names only, so a product such as "xy = 3" is never taken for a quantity
_NAMED = re.compile(r"(?:(?i:m?∠|angle|side|arc|length))?([A-Z]{1,3})")
# Marks and labels around an answer that say nothing about its value: ∴, a tick, "Ans:"
_NOISE = re.compile(r"[∴∵✓✔☑]|\\therefore(?![A-Za-z])|\\because(?![A-Za-z])")
_LABEL = re.compile(r"^\s*(?:ans(?:wer)?|sol(?:ution)?|result|final\s+answer)\b\s*[:：=]?\s*", re.IGNORECASE)
# "c = 2 ∈ (0, 4)", "x = 3 ∈ R": where the value lies is a remark, not part of the value
_MEMBERSHIP_NOTE = re.compile(r"\s*(?:∈|\\in(?![A-Za-z]))\s*(?:[(\[][^()\[\]{}]*[)\]]|[RℝZℤNℕQℚCℂ](?![A-Za-z0-9]))")
# A solution set: "S = {2, -2}", "x ∈ {1, 2}", "{2, -2}". Never LaTeX braces (\frac{1}{2}, x^{2})
_SET = re.compile(r"(?:([^\s=∈{},;]+)\s*(?:=|∈|\\in(?![A-Za-z]))\s*)?(?<![\\A-Za-z^_}])\{([^{}=]*)\}")
# "(x, y) = (2, 3)"
_TUPLE_PAIR = re.compile(r"\(\s*([A-Za-z])\s*,\s*([A-Za-z])\s*\)\s*=\s*\(\s*([^(),]+?)\s*,\s*([^(),]+?)\s*\)")
# "1 1/2" is one and a half, not 1 × 1/2
_MIXED_NUMBER = re.compile(r"(?<![\d./^*])(\d+)\s+(\d+)\s*/\s*(\d+)(?![\d.])")
# "1,000" may be one thousand or the values 1 and 0: it cannot be read safely
_THOUSANDS = re.compile(r"(?<![\d.,])\d{1,3},\d{3}(?![\d])")
# A root the writer threw out: "x = -1 يهمل", "x = -1 (rejected)", "x = -1 ∉ R"
_REJECTED = re.compile(
    r"يهمل|تهمل|مهمل|يُهمل|مرفوضة|مرفوض|ترفض|يرفض|لا\s+يحقق|لا\s+تحقق|غير\s+مقبولة|غير\s+مقبول|∉|\\notin(?![A-Za-z])"
    r"|(?<![A-Za-z])(?:reject(?:ed)?|discard(?:ed)?|neglect(?:ed)?|ignored?|extraneous|refused|not\s+(?:accepted|valid|a\s+solution))(?![A-Za-z])",
    re.IGNORECASE)
_BECAUSE = re.compile(r"(?<![A-Za-z])(?:since|because|as)(?![A-Za-z])|لأن|لان|حيث", re.IGNORECASE)
_STATEMENT_BREAK = re.compile(rf"(\s+(?:or|أو|او)\s+|{ARROW_PATTERN}|;|\n)", re.IGNORECASE)
# What a chain arrives at comes after its last arrow, semicolon or line break
_CHAIN_BREAK = re.compile(rf"{ARROW_PATTERN}|;|\n")
# Decimals as written: "0.707" was written to three places
_DECIMAL = re.compile(r"\d\.(\d+)")
_WHOLE_NUMBER = re.compile(r"[+-]?\s*(\d{3,})")
# A parenthesised alternative wording of the same answer: "(or +-(2 + i))", "(أو ...)"
_ALTERNATIVE_OPEN = re.compile(r"\(\s*(?:or|i\.e\.|أو|او)\b", re.IGNORECASE)


def _quantity(lhs_compact: str) -> Optional[str]:
    """The name of what a final line gives a value for, or None when it is an expression."""
    if _BARE_VAR.fullmatch(lhs_compact) or _DERIVATIVE.fullmatch(lhs_compact) or _AT_POINT.fullmatch(lhs_compact):
        return lhs_compact
    m = _NAMED.fullmatch(lhs_compact)
    if not m:
        return None
    kind = "∠" if re.match(r"m?∠|angle", lhs_compact, re.IGNORECASE) else ""
    return kind + m.group(1).upper()


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


def _drop_rejected(text: str) -> str:
    """
    Removes the values the writer rejected, so a discarded root is neither required from the
    student nor counted against one who wrote it and crossed it out:
    "x = 3 or x = -1 يهمل" -> "x = 3";  "x = 3 , x = -1 (rejected)" -> "x = 3";
    "x = 3 or x = -1 , rejected since x > 0" -> "x = 3" (a bare note rejects the value before it).
    """
    if not _REJECTED.search(text):
        return text
    chunks = _STATEMENT_BREAK.split(text)
    units: List[List[str]] = []
    for k in range(0, len(chunks), 2):
        separator = chunks[k + 1] if k + 1 < len(chunks) else ""
        pieces = split_top_level(chunks[k].replace("،", ","))
        for n, piece in enumerate(pieces):
            units.append([piece, "," if n < len(pieces) - 1 else separator])
    kept: List[List[str]] = []
    for piece, separator in units:
        m = _REJECTED.search(piece)
        if not m:
            kept.append([piece, separator])
            continue
        before = re.sub(r"[\s()\[\]:،,.-]", "", piece[:m.start()])
        after = _BECAUSE.split(piece[m.end():])[0]
        if not before and not re.search(r"[\d=]", after) and kept:
            kept.pop()  # the note stands alone, so it is about the value written before it
    if kept:
        kept[-1][1] = ""
    return "".join(piece + separator for piece, separator in kept)


def _expand_sets(text: str) -> str:
    """"S = {2, -2}" -> "S = 2 or S = -2";  "x ∈ {1, 2}" -> "x = 1 or x = 2";  "{2, -2}" -> "2 or -2"."""
    def spell(m):
        items = [i.strip() for i in split_top_level(m.group(2)) if i.strip()]
        if not items:
            return m.group(0)
        name = m.group(1)
        return " or ".join(f"{name} = {i}" if name else i for i in items)
    return _SET.sub(spell, text)


def _prepare(text: str) -> str:
    s = (text or "").strip().translate(_SUBSCRIPTS)
    s = _NOISE.sub(" ", s)
    s = _ARABIC_OR.sub(" or ", s)
    s = _drop_rejected(s)
    s = _AND.sub(" , ", s)
    s = _drop_alternatives(s)
    s = _APPROX.sub("=", s)
    s = s.replace("−", "-").replace("–", "-").replace("°", " ").replace("º", " ")
    # Units go before Arabic words are removed: "5 سم/ثا" would otherwise leave "5 /"
    s = _UNIT.sub(" ", s)
    s = strip_annotations(s)
    s = strip_arabic_text(s)
    s = _LABEL.sub("", s.strip().lstrip(":：").strip())
    s = _MEMBERSHIP_NOTE.sub(" ", s)
    s = _TUPLE_PAIR.sub(r"\1 = \3 , \2 = \4", s)
    s = _expand_sets(s)
    s = _MIXED_NUMBER.sub(r"(\1+\2/\3)", s)
    s = s.replace("π", "(pi)")
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


def _rounding(written: List[str]) -> float:
    """
    The unit of the last digit the values were written to, taking the least precise one:
    0.01 for "1.41", 1 for a whole number of three or more digits ("113" for 36π), else 0.
    finals.py accepts a written value that is the exact one rounded or cut off at that digit.
    """
    places = [len(m.group(1)) for text in written for m in _DECIMAL.finditer(text or "")]
    if places:
        return 10.0 ** -min(places)
    if written and all(_WHOLE_NUMBER.fullmatch((text or "").strip()) for text in written):
        return 1.0
    return 0.0


def _values(s: str, extra: Dict) -> Optional[List[Dict]]:
    """The solutions the prepared text states, or None when it is not a list of values."""
    if not s or has_inequality(s) or _THOUSANDS.search(s):
        return None

    items: List[Tuple[str, Optional[str], complex]] = []
    written: List[str] = []  # the values as written: their decimals give the rounding, not "f(1.001)"
    for clause in clause_set(s):
        if "=" in clause:
            sides = [p.strip() for p in clause.split("=")]
            lhs, rhs = sides[0], sides[-1]
            value = _number(rhs)
            if value is None:
                return None
            written.append(rhs)
            compact = lhs.replace(" ", "")
            name = _quantity(compact)
            if name:
                items.append(("assign", name, value))
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
                written.append(piece)
                items.append(("value", None, value))
        if len(items) > MAX_SOLUTIONS * 3:
            return None

    if not items:
        return None
    tol = _rounding(written)

    # "x1 = 2 , x2 = -3": the roots of one unknown, numbered, not a pair of unknowns
    names = [name for kind, name, _ in items if kind == "assign"]
    indexed = [_INDEXED_VAR.fullmatch(name) for name in names]
    if len(set(names)) > 1 and all(indexed) and len({m.group(1) for m in indexed}) == 1:
        base = indexed[0].group(1)
        items = [(kind, base if kind == "assign" else name, value) for kind, name, value in items]

    assigned = {name for kind, name, _ in items if kind == "assign"}
    if len(assigned) <= 1:
        # "x = 2 or x = -2", "z = 2 + i or -2 - i": one unknown, so each value is a solution
        return [{"value": _pair(v), "tol": tol, **extra} for _, _, v in items][:MAX_SOLUTIONS]
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
    return [{"vars": {k: _pair(v) for k, v in sorted(sol.items())}, "tol": tol, **extra} for sol in solutions][:MAX_SOLUTIONS]


def final_values(text: str) -> Optional[List[Dict]]:
    """
    The solutions a final line states, or None when it is not a list of values (an
    equation, an inequality, unreadable text, or x/y pairs that cannot be paired).
    An empty list when the line holds only a value its writer rejected.
    """
    if not text or len(text) > MAX_FINAL_CHARS:
        return None
    extra: Dict = {}
    if _APPROX.search(text):
        extra["approx"] = True
    if _DEGREES.search(text):
        extra["deg"] = True
    s = _prepare(text)
    if not s and _REJECTED.search(text):
        return []  # only a rejected value ("x = -1 يهمل"): it states no answer, which is not the same as unreadable
    result = _values(s, extra)
    if result is None:
        # A chain ("x^2 = 4 => x = ±2", "x^2 - 4 = 0 ; x = ±2"): the answer is what it arrives at
        segments = [seg for seg in _CHAIN_BREAK.split(s) if seg and seg.strip()]
        for k in range(1, len(segments)):
            result = _values(" ; ".join(segments[k:]), extra)
            if result is not None:
                break
    return result
