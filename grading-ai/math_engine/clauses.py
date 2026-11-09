"""
Splitting written math into the separate statements it makes.

One implementation for the verifier, the grader and the visual grader, so a line is
read the same way everywhere:

- Arrows, semicolons, line breaks and "or" separate statements.
- A comma separates statements only at the top level ("x = 2, y = 3"), never inside
  brackets, so the coordinate pair "(1, 2)" stays one statement.
- "±" and "∓" stand for two statements, one per sign, so "x = ±2" is the root set
  {x = 2, x = -2} rather than just "x = 2".
"""
import re
from typing import List

ARROW_PATTERN = (
    r"\\(?:implies|Longrightarrow|longrightarrow|Rightarrow|rightarrow|to|iff)(?![A-Za-z])"
    r"|=>|⇒|→|⟹"
)
_SEPARATOR = re.compile(
    rf"\s*(?:{ARROW_PATTERN}|;|\n|\\text\{{\s*(?:or|and|أو|و)\s*\}}|\s(?:or|أو)\s)\s*",
    re.IGNORECASE,
)

_PLUS_MINUS = re.compile(r"\\pm(?![A-Za-z])|±")
_MINUS_PLUS = re.compile(r"\\mp(?![A-Za-z])|∓")

# Relations other than "=" cannot be compared by the symbolic checker
INEQUALITY_PATTERN = re.compile(
    r"<|>|≤|≥|≠|!=|\\(?:neq|ne|leq|le|geq|ge|lt|gt|not|nless|ngtr)(?![A-Za-z])"
)


def split_top_level(text: str, separator: str = ",") -> List[str]:
    """Splits on separator only outside (), [] and {}."""
    parts, depth, current = [], 0, []
    for ch in text:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if ch == separator and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
    parts.append("".join(current))
    return parts


def split_math_clauses(text: str) -> List[str]:
    """Statements in one written line, in order. "x = 2, 3" gives ["x = 2", "3"]."""
    if not text or not text.strip():
        return []
    clauses: List[str] = []
    for part in _SEPARATOR.split(text):
        part = (part or "").strip()
        if not part:
            continue
        pieces = [p.strip() for p in split_top_level(part) if p.strip()]
        if len(pieces) > 1 and any("=" in p for p in pieces):
            clauses.extend(pieces)
        else:
            clauses.append(part)
    return clauses


def expand_plus_minus(clause: str) -> List[str]:
    """"x = ±2" -> ["x = +2", "x = -2"]. Every ± in a clause takes the same sign; ∓ the opposite."""
    if not (_PLUS_MINUS.search(clause) or _MINUS_PLUS.search(clause)):
        return [clause]
    branches = []
    for plus, minus in (("+", "-"), ("-", "+")):
        branch = _PLUS_MINUS.sub(plus, clause)
        branch = _MINUS_PLUS.sub(minus, branch)
        branches.append(branch)
    return list(dict.fromkeys(branches))


def clause_set(text: str) -> List[str]:
    """All statements a line asserts, with ± expanded."""
    out: List[str] = []
    for clause in split_math_clauses(text):
        out.extend(expand_plus_minus(clause))
    return list(dict.fromkeys(out))


def has_inequality(text: str) -> bool:
    # Arrows such as "=>" and "->" contain ">" but separate statements
    without_arrows = re.sub(rf"{ARROW_PATTERN}|-->|->", " ", text or "")
    return bool(INEQUALITY_PATTERN.search(without_arrows))
