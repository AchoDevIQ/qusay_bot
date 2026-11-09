"""
Symbolic math verifier using SymPy.

Provides deterministic mathematical equivalence checking as a complement
to the LLM grader. When SymPy can verify equivalence, its result is 
authoritative (confidence=1.0). When it can't parse an expression,
we gracefully fall back to the LLM.
"""
import cmath
import random
import re
from functools import lru_cache
from typing import List, Optional
from pydantic import BaseModel
from sympy import (
    sympify, simplify, expand, factor, Eq, solve, oo, pi, E, I,
    Symbol, symbols, Rational, Float, Integer, S,
    sin, cos, tan, log, exp, sqrt, Abs,
)
from sympy.parsing.sympy_parser import (
    standard_transformations,
    implicit_multiplication_application,
    convert_xor,
)
from math_engine.normalizer import normalize_expr, extract_equation_sides, generate_confusion_alternatives, strip_annotations
from math_engine.safe_expr import safe_parse_expr
from math_engine.clauses import clause_set, has_inequality


class VerificationResult(BaseModel):
    """Result of a symbolic equivalence check."""
    equivalent: Optional[bool] = None
    confidence: float = 0.0
    method: str = "unknown"
    status: str = "uncertain"  # "certain", "uncertain", "parse_failed"
    detail: str = ""


# SymPy parser transformations: handle implicit multiplication and ^ as **
TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)

# Local namespace for parse_expr — maps common names to SymPy objects
LOCAL_DICT = {
    'e': E,
    'pi': pi,
    'oo': oo,
    'i': I,
    'inf': oo,
    # Greek letters as SymPy symbols
    'alpha': Symbol('alpha'),
    'beta': Symbol('beta'),
    'gamma': Symbol('gamma'),
    'delta': Symbol('delta'),
    'epsilon': Symbol('epsilon'),
    'theta': Symbol('theta'),
    'mu': Symbol('mu'),
    'sigma': Symbol('sigma'),
    'phi': Symbol('phi'),
    'omega': Symbol('omega'),
    'Delta': Symbol('Delta'),
    'Sigma': Symbol('Sigma'),
    'Omega': Symbol('Omega'),
    # Common function aliases
    'ln': log,
}


@lru_cache(maxsize=2048)
def safe_parse(expr_str: str) -> Optional[object]:
    """
    Attempt to parse a normalized math string into a SymPy expression.
    
    Returns None if parsing fails for any reason.
    """
    if not expr_str or not expr_str.strip():
        return None
    
    normalized = normalize_expr(expr_str)
    if not normalized:
        return None
    
    try:
        return safe_parse_expr(normalized, TRANSFORMATIONS, LOCAL_DICT)
    except Exception:
        # Try a second pass: sometimes extra cleanup helps
        try:
            # Remove any remaining non-math characters
            cleaned = normalized.replace(' ', '')
            if cleaned:
                return safe_parse_expr(cleaned, TRANSFORMATIONS, LOCAL_DICT)
        except Exception:
            pass
    
    return None

@lru_cache(maxsize=2048)
def safe_parse_with_fallback(expr_str: str) -> Optional[object]:
    """Parse expression, with fallback to OCR confusion alternatives, equations, and chained clauses."""
    if not expr_str or not expr_str.strip():
        return None

    try:
        # Handle implication / deduction chains: A \implies B or A; B or A => B
        import re
        implication_pattern = r'\\(?:implies|Longrightarrow|Rightarrow|rightarrow|iff|to)\b|=>|;'
        if re.search(implication_pattern, expr_str):
            clauses = [c.strip() for c in re.split(implication_pattern, expr_str) if c.strip()]
            if len(clauses) > 1:
                parsed_clauses = [safe_parse_with_fallback(c) for c in clauses]
                valid = [p for p in parsed_clauses if p is not None]
                if valid:
                    return valid[0] if len(valid) == 1 else valid

        # Handle equations: LHS = RHS or chained equalities A = B = C
        if '=' in expr_str and '<=' not in expr_str and '>=' not in expr_str and '!=' not in expr_str:
            sides = extract_equation_sides(expr_str)
            if len(sides) == 2:
                p_lhs = safe_parse(sides[0])
                p_rhs = safe_parse(sides[1])
                if p_lhs is not None and p_rhs is not None:
                    try:
                        return Eq(p_lhs, p_rhs)
                    except Exception:
                        return p_lhs
            elif len(sides) > 2:
                p_sides = [safe_parse(s) for s in sides]
                if all(p is not None for p in p_sides):
                    try:
                        return [Eq(p_sides[i], p_sides[i+1]) for i in range(len(p_sides)-1)]
                    except Exception:
                        return p_sides[0]

        parsed = safe_parse(expr_str)
        if parsed is not None:
            return parsed
            
        # Try alternatives from the confusion table
        alts = generate_confusion_alternatives(expr_str)
        for alt in alts:
            parsed = safe_parse(alt)
            if parsed is not None:
                return parsed
                
        return None
    except Exception:
        return None


@lru_cache(maxsize=4096)
def verify_equivalence(expr_a: str, expr_b: str) -> VerificationResult:
    """
    Deterministically check if two math expressions are equivalent.
    
    Handles three cases:
    1. Both are plain expressions (e.g., 'x^2 - 5x + 6' vs '(x-2)(x-3)')
       → Check if their difference simplifies to 0.
    2. Both are equations (e.g., 'x^2 - 5x + 6 = 0' vs '(x-2)(x-3) = 0')
       → Check if both sides are equivalent, or if solution sets match.
    3. Both are numeric values (e.g., '2' vs '2.0')
       → Direct numeric comparison.
    
    Args:
        expr_a: First expression (typically teacher's reference).
        expr_b: Second expression (typically student's answer).
    
    Returns:
        VerificationResult with equivalence verdict and confidence.
    """
    # Explanations next to the math ("(Equation 1)", "(discard ... since x in R)") are not
    # statements; removed before the line is split, as they can contain "=" themselves
    expr_a, expr_b = strip_annotations(expr_a or ""), strip_annotations(expr_b or "")
    if not expr_a or not expr_b:
        return VerificationResult(
            equivalent=None,
            confidence=0.0,
            method="empty_input",
            status="parse_failed",
            detail="One or both expressions are empty."
        )
    
    if has_inequality(expr_a) or has_inequality(expr_b):
        if re.sub(r"\s+", "", expr_a) == re.sub(r"\s+", "", expr_b):
            return VerificationResult(equivalent=True, confidence=1.0, method="identical_text",
                                      status="certain", detail="Identical relation.")
        return VerificationResult(equivalent=None, confidence=0.0, method="relation_unsupported",
                                  status="uncertain",
                                  detail="Inequalities and other relations are not compared symbolically.")

    clauses_a = clause_set(expr_a) or [expr_a]
    clauses_b = clause_set(expr_b) or [expr_b]
    if len(clauses_a) == 1 and len(clauses_b) == 1:
        return _verify_single(clauses_a[0], clauses_b[0])
    return _verify_clause_sets(clauses_a, clauses_b)


def _verify_clause_sets(clauses_a: List[str], clauses_b: List[str]) -> VerificationResult:
    """
    Compares lines that make several statements (root sets, systems, derivation chains).
    Direction matters: expr_a is the reference milestone, expr_b the student's answer.
    """
    def _certain(a: str, b: str) -> bool:
        res = verify_equivalence(a, b)
        return res.equivalent is True and res.status == "certain"

    if len(clauses_a) > 1 and len(clauses_b) > 1:
        # Every statement on each side needs a partner: "x = 2, y = 5" is not "x = 2, y = 3"
        if (all(any(_certain(a, b) for b in clauses_b) for a in clauses_a)
                and all(any(_certain(a, b) for a in clauses_a) for b in clauses_b)):
            return VerificationResult(equivalent=True, confidence=1.0, method="clause_set_equality",
                                      status="certain", detail=f"All statements match: {clauses_a} vs {clauses_b}")
        return VerificationResult(equivalent=None, confidence=0.0, method="clause_sets_differ",
                                  status="uncertain", detail=f"Statements differ: {clauses_a} vs {clauses_b}")

    if len(clauses_a) == 1:
        # One milestone against a derivation chain: the chain shows the milestone if it contains it
        for clause in reversed(clauses_b):
            if _certain(clauses_a[0], clause):
                return VerificationResult(equivalent=True, confidence=1.0, method="chain_contains_milestone",
                                          status="certain", detail=f"'{clause}' matches '{clauses_a[0]}'")
        return VerificationResult(equivalent=None, confidence=0.0, method="milestone_not_in_chain",
                                  status="uncertain", detail="No statement in the answer matches the milestone.")

    # The reference makes several statements and the answer only one: at most partial work
    # ("x = 2" against "x = ±2"), which is for the grader to weigh, never full equivalence
    return VerificationResult(equivalent=None, confidence=0.0, method="partial_answer", status="uncertain",
                              detail=f"The reference makes {len(clauses_a)} statements; the answer makes one.")


def _verify_single(expr_a: str, expr_b: str) -> VerificationResult:
    """Compares two single statements (an expression or one equation each)."""
    # Extract equation sides
    sides_a = extract_equation_sides(expr_a)
    sides_b = extract_equation_sides(expr_b)

    if not sides_a or not sides_b:
        return VerificationResult(
            equivalent=None,
            confidence=0.0,
            method="extraction_failed",
            status="parse_failed",
            detail="Could not extract equation sides."
        )

    # Case 1: Both are equations (have = sign) — compare as equations
    is_equation_a = '=' in expr_a
    is_equation_b = '=' in expr_b

    if is_equation_a and is_equation_b and len(sides_a) >= 2 and len(sides_b) >= 2:
        return _verify_equations(sides_a, sides_b)

    # Case 2: Both are plain expressions — compare directly.
    # Mixed case (one equation, one bare expression such as 'x = 2' vs '2'):
    # compare the equation's value side, never its LHS — otherwise 'x = 2'
    # vs 'x' would be reported as equivalent. A '... = 0' form compares its LHS.
    def _value_side(sides: list, is_equation: bool) -> str:
        if not is_equation or len(sides) < 2 or sides[-1].strip() == "0":
            return sides[0]
        return sides[-1]
    return _verify_expressions(_value_side(sides_a, is_equation_a),
                               _value_side(sides_b, is_equation_b))


def _verify_expressions(norm_a: str, norm_b: str) -> VerificationResult:
    """Compare two normalized expressions for algebraic equivalence."""
    parsed_a = safe_parse_with_fallback(norm_a)
    parsed_b = safe_parse_with_fallback(norm_b)
    
    if parsed_a is None or parsed_b is None:
        return VerificationResult(
            equivalent=None,
            confidence=0.0,
            method="parse_failed",
            status="parse_failed",
            detail=f"Could not parse: a={norm_a!r}, b={norm_b!r}"
        )
    
    # Handle list of parsed clauses from deduction chains / implications
    if isinstance(parsed_a, list) or isinstance(parsed_b, list):
        list_a = parsed_a if isinstance(parsed_a, list) else [parsed_a]
        list_b = parsed_b if isinstance(parsed_b, list) else [parsed_b]
        for item_a in list_a:
            for item_b in list_b:
                if item_a is not None and item_b is not None:
                    try:
                        diff = simplify(item_a - item_b)
                        if diff == 0 or diff is S.Zero:
                            return VerificationResult(
                                equivalent=True,
                                confidence=1.0,
                                method="simplification",
                                status="certain",
                                detail=f"simplify({item_a} - {item_b}) = 0"
                            )
                        if expand(expand(item_a) - expand(item_b)) == 0:
                            return VerificationResult(
                                equivalent=True,
                                confidence=1.0,
                                method="expansion",
                                status="certain",
                                detail=f"expand({item_a}) == expand({item_b})"
                            )
                    except Exception:
                        pass
        parsed_a = list_a[-1]
        parsed_b = list_b[-1]

    try:
        # Method 1: Direct symbolic comparison after simplification
        diff = simplify(parsed_a - parsed_b)
        if diff == 0 or diff is S.Zero:
            return VerificationResult(
                equivalent=True,
                confidence=1.0,
                method="simplification",
                status="certain",
                detail=f"simplify({norm_a} - {norm_b}) = 0"
            )
        
        # Method 2: Try expanding both and comparing
        expanded_a = expand(parsed_a)
        expanded_b = expand(parsed_b)
        if expand(expanded_a - expanded_b) == 0:
            return VerificationResult(
                equivalent=True,
                confidence=1.0,
                method="expansion",
                status="certain",
                detail=f"expand(a) == expand(b)"
            )
        
        # Method 3: Try factoring both
        try:
            factored_a = factor(parsed_a)
            factored_b = factor(parsed_b)
            if simplify(factored_a - factored_b) == 0:
                return VerificationResult(
                    equivalent=True,
                    confidence=1.0,
                    method="factoring",
                    status="certain",
                    detail=f"factor(a) == factor(b)"
                )
        except Exception:
            pass
        
        # Method 4: numeric evaluation at fixed sample points
        verdict = _numeric_compare(parsed_a, parsed_b)
        if verdict is True:
            return VerificationResult(equivalent=True, confidence=0.9, method="numeric_sampling",
                                      status="certain", detail="Equal at every sample point.")
        if verdict is False:
            return VerificationResult(equivalent=False, confidence=0.95, method="numeric_counterexample",
                                      status="certain", detail=f"Values differ at a sample point; simplify(a - b) = {diff}")
        # Simplification failed and sampling could not decide: that proves nothing either way
        return VerificationResult(equivalent=None, confidence=0.0, method="unproven", status="uncertain",
                                  detail=f"Could not decide; simplify(a - b) = {diff}")

    except Exception as e:
        return VerificationResult(
            equivalent=None,
            confidence=0.0,
            method="error",
            status="uncertain",
            detail=f"Verification error: {str(e)}"
        )


def _verify_equations(sides_a: list, sides_b: list) -> VerificationResult:
    """
    Compare two equations by checking if they represent the same relationship.
    
    For equations like 'x^2 - 5x + 6 = 0' vs '(x-2)(x-3) = 0':
    1. First try: compare LHS-RHS expressions directly
    2. Fallback: solve both and compare solution sets
    """
    # Parse all sides
    parsed_sides_a = [safe_parse_with_fallback(s) for s in sides_a]
    parsed_sides_b = [safe_parse_with_fallback(s) for s in sides_b]
    
    if any(s is None for s in parsed_sides_a) or any(s is None for s in parsed_sides_b):
        return VerificationResult(
            equivalent=None,
            confidence=0.0,
            method="parse_failed",
            status="parse_failed",
            detail="Could not parse one or more equation sides."
        )
    
    # Coordinate tuples such as (x, y) = (1, 2): order matters and every component must match.
    # Root lists like "x = 2, 3" never reach here: clauses.py splits them into statements.
    def _is_tuple(obj):
        return isinstance(obj, (tuple, list))

    if any(_is_tuple(s) for s in parsed_sides_a + parsed_sides_b):
        t_a, t_b = parsed_sides_a[-1], parsed_sides_b[-1]
        if _is_tuple(t_a) and _is_tuple(t_b) and len(t_a) == len(t_b):
            verdicts = [_verify_expressions(str(a), str(b)) for a, b in zip(t_a, t_b)]
            if all(v.equivalent is True for v in verdicts):
                return VerificationResult(equivalent=True, confidence=1.0, method="tuple_comparison",
                                          status="certain", detail=f"Coordinate tuples match: {t_a} == {t_b}")
            if any(v.equivalent is False and v.status == "certain" for v in verdicts):
                return VerificationResult(equivalent=False, confidence=0.95, method="tuple_mismatch",
                                          status="certain", detail=f"Coordinates differ: {t_a} vs {t_b}")
        return VerificationResult(equivalent=None, confidence=0.0, method="tuple_structure", status="uncertain",
                                  detail="Tuple structures could not be compared.")

    try:
        # Build canonical form: LHS - RHS = 0
        canonical_a = parsed_sides_a[0] - parsed_sides_a[-1]
        canonical_b = parsed_sides_b[0] - parsed_sides_b[-1]
        
        # Check if canonical forms are proportional (equivalent equations)
        diff = simplify(canonical_a - canonical_b)
        if diff == 0:
            return VerificationResult(
                equivalent=True,
                confidence=1.0,
                method="canonical_comparison",
                status="certain",
                detail="LHS-RHS forms are identical."
            )
        
        # Check if one is a scalar multiple of the other
        try:
            ratio = simplify(canonical_a / canonical_b)
            if ratio.is_number and ratio != 0:
                return VerificationResult(
                    equivalent=True,
                    confidence=1.0,
                    method="proportional_comparison",
                    status="certain",
                    detail=f"Equations are proportional (ratio={ratio})."
                )
        except Exception:
            pass
        
        # Check if expanded forms match
        if expand(canonical_a - canonical_b) == 0:
            return VerificationResult(
                equivalent=True,
                confidence=1.0,
                method="expansion_comparison",
                status="certain",
                detail="Expanded canonical forms are identical."
            )

        # Check rational denominator clearing (e.g. x^2 - (3/x)^2 = 8 vs x^4 - 8x^2 - 9 = 0)
        try:
            num_a, den_a = canonical_a.as_numer_denom()
            num_b, den_b = canonical_b.as_numer_denom()
            # Cross-multiplication form: num_a * den_b - num_b * den_a = 0
            cross_diff = simplify(num_a * den_b - num_b * den_a)
            if cross_diff == 0 or expand(cross_diff) == 0:
                return VerificationResult(
                    equivalent=True,
                    confidence=1.0,
                    method="rational_clearing",
                    status="certain",
                    detail="Equations match after clearing rational denominators."
                )
            if den_b != 1 and den_a == 1:
                ratio_b = simplify(num_b / canonical_a)
                if ratio_b.is_number and ratio_b != 0:
                    return VerificationResult(
                        equivalent=True,
                        confidence=1.0,
                        method="rational_clearing",
                        status="certain",
                        detail=f"Numerator matches after clearing rational denominator (ratio={ratio_b})."
                    )
            elif den_a != 1 and den_b == 1:
                ratio_a = simplify(num_a / canonical_b)
                if ratio_a.is_number and ratio_a != 0:
                    return VerificationResult(
                        equivalent=True,
                        confidence=1.0,
                        method="rational_clearing",
                        status="certain",
                        detail=f"Numerator matches after clearing rational denominator (ratio={ratio_a})."
                    )
        except Exception:
            pass
        
        # A final answer ("x = 2") has the same roots as the equation it came from
        # ("x^2 - 4x + 4 = 0") but does not show that step, so root sets only decide
        # between two equations of the same kind
        verdict = _compare_solutions(canonical_a, canonical_b)
        if verdict.equivalent is True and _is_solved_form(parsed_sides_a) != _is_solved_form(parsed_sides_b):
            return VerificationResult(
                equivalent=None, confidence=0.0, method="solved_form_vs_equation", status="uncertain",
                detail="Same roots, but one side is a final value and the other an equation to solve.",
            )
        return verdict
        
    except Exception as e:
        return VerificationResult(
            equivalent=None,
            confidence=0.0,
            method="error",
            status="uncertain",
            detail=f"Equation verification error: {str(e)}"
        )


@lru_cache(maxsize=1024)
def _solve_cached(eq, var):
    """Cached symbolic solver + root simplification for a (canonical_eq, var) pair."""
    sols = set(solve(eq, var))
    simp = {simplify(s) for s in sols} if sols else set()
    return sols, simp


def _compare_solutions(eq_a, eq_b) -> VerificationResult:
    """Compare solution sets of two equations."""
    try:
        vars_a = eq_a.free_symbols
        vars_b = eq_b.free_symbols
        # Get free symbols from both equations
        all_vars = vars_a | vars_b
        
        if not all_vars:
            # Both are numeric — just check equality
            if simplify(eq_a) == simplify(eq_b):
                return VerificationResult(
                    equivalent=True, confidence=1.0,
                    method="numeric", status="certain",
                    detail="Both are numeric and equal."
                )
            return VerificationResult(
                equivalent=False, confidence=1.0,
                method="numeric", status="certain",
                detail="Numeric values differ."
            )

        # Fast path: if two equations don't involve the same variables even after
        # simplification (e.g., x^2 - y^2 = 8 vs x^4 - 8x^2 - 9 = 0), their solution
        # sets cannot match — skip expensive symbolic polynomial root solving.
        if vars_a != vars_b:
            simp_eq_a = simplify(eq_a)
            simp_eq_b = simplify(eq_b)
            if simp_eq_a.free_symbols != simp_eq_b.free_symbols:
                return VerificationResult(
                    equivalent=False,
                    confidence=0.95,
                    method="variable_mismatch",
                    status="certain",
                    detail=f"Equations have different free variables: {vars_a} vs {vars_b}"
                )
        
        # Solve for each variable
        solved_any = False
        for var in all_vars:
            try:
                sols_a, simp_a = _solve_cached(eq_a, var)
                sols_b, simp_b = _solve_cached(eq_b, var)
                
                if sols_a or sols_b:
                    solved_any = True
                
                if sols_a and sols_b:
                    # Direct set equality
                    if simp_a == simp_b:
                        return VerificationResult(
                            equivalent=True,
                            confidence=0.95,
                            method="solution_set",
                            status="certain",
                            detail=f"Solution sets match: {simp_a}"
                        )
                    
                    # Fast cardinality check before pairwise root subtraction
                    if len(simp_a) != len(simp_b):
                        return VerificationResult(
                            equivalent=False,
                            confidence=0.9,
                            method="solution_set",
                            status="certain",
                            detail=f"Solution set sizes differ: {simp_a} vs {simp_b}"
                        )

                    # Element-wise simplification matching (handles 1/sqrt(2) vs sqrt(2)/2)
                    remaining_b = list(simp_b)
                    matched_count = 0
                    for sa in simp_a:
                        for sb in remaining_b:
                            if simplify(sa - sb) == 0:
                                remaining_b.remove(sb)
                                matched_count += 1
                                break
                    if matched_count == len(simp_a) and len(simp_a) == len(simp_b):
                        return VerificationResult(
                            equivalent=True,
                            confidence=0.95,
                            method="solution_set",
                            status="certain",
                            detail=f"Solution sets match via simplification: {simp_a}"
                        )
                    else:
                        return VerificationResult(
                            equivalent=False,
                            confidence=0.9,
                            method="solution_set",
                            status="certain",
                            detail=f"Solution sets differ: {simp_a} vs {simp_b}"
                        )
            except Exception:
                continue
        
        if not solved_any:
            return VerificationResult(
                equivalent=None,
                confidence=0.0,
                method="solution_set",
                status="uncertain",
                detail="Could not compute solution sets."
            )
        
        return VerificationResult(
            equivalent=False,
            confidence=0.8,
            method="solution_set",
            status="certain",
            detail="Solution sets differ or could not be computed."
        )
        
    except Exception as e:
        return VerificationResult(
            equivalent=None,
            confidence=0.0,
            method="error",
            status="uncertain",
            detail=f"Solution comparison error: {str(e)}"
        )


def _is_solved_form(sides: list) -> bool:
    """True for 'x = value' (or 'value = x') where the value does not contain x."""
    lhs, rhs = sides[0], sides[-1]
    for var, value in ((lhs, rhs), (rhs, lhs)):
        if getattr(var, "is_Symbol", False) and var not in getattr(value, "free_symbols", set()):
            return True
    return False


# Negative and fractional points too: positive-only sampling called sqrt(x^2) and x equal
_SAMPLE_VALUES = (Rational(-7, 3), Rational(-2), Rational(-1, 2), Rational(1, 3),
                  Rational(3, 2), Rational(5, 2), Rational(7), Rational(-5, 4))


def _numeric_compare(expr_a, expr_b, num_tests: int = 6) -> Optional[bool]:
    """
    True when the expressions agree at every sample point tried (at least 3 for
    expressions with variables), False at the first point where both are finite and
    differ, None when it could not tell. The seed is fixed, so a verdict never changes.
    """
    try:
        free_vars = sorted(expr_a.free_symbols | expr_b.free_symbols, key=str)
    except Exception:
        return None
    rng = random.Random(1729)
    points = [{v: rng.choice(_SAMPLE_VALUES) for v in free_vars} for _ in range(num_tests)] if free_vars else [{}]
    agreed = 0
    for point in points:
        try:
            val_a = complex(expr_a.subs(point).evalf())
            val_b = complex(expr_b.subs(point).evalf())
        except Exception:
            continue
        if not (cmath.isfinite(val_a) and cmath.isfinite(val_b)):
            continue
        if abs(val_a - val_b) > 1e-8 * max(1.0, abs(val_a), abs(val_b)):
            return False
        agreed += 1
    return True if agreed >= (3 if free_vars else 1) else None


def _numeric_equivalence(expr_a, expr_b, num_tests: int = 6) -> Optional[VerificationResult]:
    """A VerificationResult when the expressions agree numerically, otherwise None."""
    if _numeric_compare(expr_a, expr_b, num_tests) is True:
        return VerificationResult(equivalent=True, confidence=0.9, method="numeric_sampling",
                                  status="certain", detail="Equal at every sample point.")
    return None


def follows_from(prior_expr: str, candidate_expr: str) -> bool:
    """
    True when candidate_expr ("x = value") is a solution of the equation prior_expr,
    which is how an answer carried forward from an earlier wrong line is recognised.
    """
    prior_sides = extract_equation_sides(prior_expr)
    cand_sides = extract_equation_sides(candidate_expr)
    if len(prior_sides) < 2 or len(cand_sides) < 2:
        return False

    prior_lhs, prior_rhs = safe_parse(prior_sides[0]), safe_parse(prior_sides[1])
    cand_lhs, cand_rhs = safe_parse(cand_sides[0]), safe_parse(cand_sides[1])
    if prior_lhs is None or prior_rhs is None or cand_lhs is None or cand_rhs is None:
        return False
    if len(getattr(cand_lhs, "free_symbols", ())) != 1:
        return False

    var = next(iter(cand_lhs.free_symbols))
    try:
        return any(simplify(sol - cand_rhs) == 0 for sol in solve(prior_lhs - prior_rhs, var))
    except Exception:
        return False


def assignments_satisfy(prior_expr: str, assignment_exprs: List[str]) -> bool:
    """
    True when two or more assignments ("x = 1", "y = -3") satisfy the equation prior_expr,
    i.e. a substitution step that correctly follows from the student's own earlier line.
    """
    prior_sides = extract_equation_sides(prior_expr)
    if len(prior_sides) < 2:
        return False
    lhs, rhs = safe_parse(prior_sides[0]), safe_parse(prior_sides[-1])
    if lhs is None or rhs is None:
        return False
    values = {}
    for text in assignment_exprs:
        sides = extract_equation_sides(text)
        if len(sides) < 2:
            continue
        var, value = safe_parse(sides[0]), safe_parse(sides[-1])
        if (var is not None and value is not None and getattr(var, "is_Symbol", False)
                and var not in getattr(value, "free_symbols", set())):
            values[var] = value
    try:
        equation = lhs - rhs
        if len(values) < 2 or not equation.free_symbols or not equation.free_symbols <= set(values):
            return False
        return simplify(equation.subs(values)) == 0
    except Exception:
        return False


def check_step_derivability(expr_prev: str, expr_curr: str) -> VerificationResult:
    """
    Check if expr_curr is a valid consequence of expr_prev.
    Checks for equivalence or valid derivations, and flags structural anomalies 
    (like variables vanishing) as strong OCR-error signals.
    """
    # Check if they are algebraically equivalent
    res = verify_equivalence(expr_prev, expr_curr)
    if res.equivalent:
        return res
        
    # Check for structural anomaly (vanishing variables)
    parsed_prev = safe_parse_with_fallback(expr_prev)
    parsed_curr = safe_parse_with_fallback(expr_curr)
    
    if parsed_prev is not None and parsed_curr is not None:
        vars_prev = parsed_prev.free_symbols if hasattr(parsed_prev, 'free_symbols') else set()
        vars_curr = parsed_curr.free_symbols if hasattr(parsed_curr, 'free_symbols') else set()
        
        # If a variable vanished, it's a structural anomaly
        vanished = vars_prev - vars_curr
        if vanished:
            return VerificationResult(
                equivalent=False,
                confidence=1.0,  # We are certain it's an anomaly
                method="structural_anomaly",
                status="certain",
                detail=f"Variables {vanished} vanished from step N to N+1."
            )
            
    return res
