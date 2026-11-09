"""
Safe parsing of untrusted math text.

SymPy's parse_expr() ends in eval(), and with its default namespace that means every
builtin and all of SymPy, so student, OCR and API text must never reach it unchecked.
This module is the only place that calls it, in three steps:

1. Text allowlist: math characters only. No quotes, no attribute access, no dunder
   names, no Python keywords, no shift operators, bounded length and digit count.
2. Size check: parse once with evaluation off and every function inert, then bound
   the numbers the expression would produce (9^9^9 never gets computed).
3. Parse for real against a namespace holding only math functions and no builtins.
"""
import keyword
import math
import re
from typing import Any, Dict, Optional

from sympy import (
    Abs, Add, E, Eq, Float, Function, Ge, Gt, I, Integer, Le, Lt, Mul, Ne, Pow,
    Rational, Symbol, Tuple, acos, asin, atan, cos, cosh, cot, csc, exp, factorial,
    factorial2, log, pi, sec, sign, sin, sinh, sqrt, tan, tanh,
)
from sympy.core.numbers import Number
from sympy.parsing.sympy_parser import parse_expr

MAX_EXPR_CHARS = 400
MAX_NUMBER_DIGITS = 40
MAX_EXPONENT = 1000
MAX_RESULT_DIGITS = 3000
MAX_FACTORIAL_ARG = 170


class UnsafeExpression(ValueError):
    """Raised when text is not plain math, or would be too large to evaluate."""


# ASCII only, plus Greek letters. Python folds identifiers with NFKC, so allowing other
# Unicode would let fullwidth characters spell banned names.
_ALLOWED_TEXT = re.compile(r"[0-9A-Za-z_+\-*/^().,!<>=\sΑ-Ωα-ω]*")
_NAME = re.compile(r"[A-Za-z_Α-Ωα-ω][A-Za-z0-9_Α-Ωα-ω]*")
# The lookbehind matters: without it, "1." inside "x1.real" would hide an attribute access.
_NUMBER = re.compile(r"(?<![A-Za-z0-9_.])(?:\d+\.\d*|\.\d+|\d+)")
_DIGIT_RUN = re.compile(r"\d+")

# Function names available to student expressions
_MATH_FUNCTIONS = {
    "sqrt": sqrt, "exp": exp, "log": log, "Abs": Abs, "abs": Abs, "sign": sign,
    "sin": sin, "cos": cos, "tan": tan, "cot": cot, "sec": sec, "csc": csc,
    "asin": asin, "acos": acos, "atan": atan,
    "arcsin": asin, "arccos": acos, "arctan": atan,
    "sinh": sinh, "cosh": cosh, "tanh": tanh,
    "factorial": factorial, "factorial2": factorial2,
}

# Names the parser's own generated code refers to
_PARSER_NAMES = {
    "Symbol": Symbol, "Function": Function, "Integer": Integer, "Float": Float,
    "Rational": Rational, "Add": Add, "Mul": Mul, "Pow": Pow,
    "Eq": Eq, "Ne": Ne, "Lt": Lt, "Le": Le, "Gt": Gt, "Ge": Ge,
}

_EVAL_GLOBALS: Dict[str, Any] = {
    "__builtins__": {}, "E": E, "I": I, "pi": pi, **_PARSER_NAMES, **_MATH_FUNCTIONS,
}

# Same names, but functions do nothing, so the size check cannot trigger any work
_GUARD_GLOBALS: Dict[str, Any] = {
    **_EVAL_GLOBALS,
    **{name: Function(name) for name in _MATH_FUNCTIONS},
}


def check_text(text: str) -> None:
    """Rejects anything that is not plain math notation."""
    if len(text) > MAX_EXPR_CHARS:
        raise UnsafeExpression("expression is too long")
    if not _ALLOWED_TEXT.fullmatch(text):
        raise UnsafeExpression("expression contains non-math characters")
    if "<<" in text or ">>" in text:
        raise UnsafeExpression("shift operators are not math notation")
    if any(len(run) > MAX_NUMBER_DIGITS for run in _DIGIT_RUN.findall(text)):
        raise UnsafeExpression("number is too long")
    if "." in _NUMBER.sub("", text):
        raise UnsafeExpression("attribute access is not allowed")
    for name in _NAME.findall(text):
        if "__" in name or keyword.iskeyword(name):
            raise UnsafeExpression(f"name '{name}' is not allowed")


def _number_log10(value: Number) -> float:
    if value.is_Rational:
        return math.log10(max(abs(value.p), value.q, 1))
    if value.is_finite:
        magnitude = abs(float(value))
        return math.log10(magnitude) if magnitude > 1 else 0.0
    return 0.0


def _log10_bound(node: Any) -> float:
    """
    Upper bound on log10(|value|), treating symbols as 1. Works on the unevaluated tree,
    so nothing large is computed. Raises UnsafeExpression when the bound is too big.
    """
    if isinstance(node, (tuple, list, Tuple)):
        return max((_log10_bound(item) for item in node), default=0.0)
    if isinstance(node, Number):
        return _number_log10(node)

    args = getattr(node, "args", ())
    if isinstance(node, (Add, Mul, Pow)) and any(isinstance(a, Tuple) for a in args):
        # "(1, 2) * 10^9" repeats a Python tuple a billion times
        raise UnsafeExpression("arithmetic on a tuple is not allowed")

    if isinstance(node, Pow):
        base_bound = _log10_bound(node.base)
        exponent_bound = _log10_bound(node.exp)
        if exponent_bound > math.log10(MAX_EXPONENT):
            raise UnsafeExpression("exponent is too large")
        bound = base_bound * (10 ** exponent_bound)
    elif isinstance(node, Mul):
        bound = sum(_log10_bound(a) for a in args)
    elif isinstance(node, Add):
        bound = max((_log10_bound(a) for a in args), default=0.0) + math.log10(max(len(args), 1))
    else:
        if getattr(getattr(node, "func", None), "__name__", "") in ("factorial", "factorial2"):
            if any(_log10_bound(a) > math.log10(MAX_FACTORIAL_ARG) for a in args):
                raise UnsafeExpression("factorial argument is too large")
        bound = max((_log10_bound(a) for a in args), default=0.0)

    if bound > MAX_RESULT_DIGITS:
        raise UnsafeExpression("result would be too large")
    return bound


def safe_parse_expr(text: str, transformations: tuple, local_dict: Optional[Dict[str, Any]] = None) -> Any:
    """parse_expr() for untrusted text. Raises UnsafeExpression or a parse error."""
    check_text(text)
    local_names = dict(local_dict or {})
    guard_locals = {
        # local_dict maps "ln" to the real log, which must stay inert during the size check
        name: Function(name) if name == "ln" else value
        for name, value in local_names.items()
    }
    unevaluated = parse_expr(
        text,
        transformations=transformations,
        local_dict=guard_locals,
        global_dict=dict(_GUARD_GLOBALS),
        evaluate=False,
    )
    _log10_bound(unevaluated)
    return parse_expr(
        text,
        transformations=transformations,
        local_dict=local_names,
        global_dict=dict(_EVAL_GLOBALS),
        evaluate=True,
    )
