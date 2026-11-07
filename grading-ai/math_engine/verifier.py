"""
Symbolic math verifier using SymPy.

Provides deterministic mathematical equivalence checking as a complement
to the LLM grader. When SymPy can verify equivalence, its result is 
authoritative (confidence=1.0). When it can't parse an expression,
we gracefully fall back to the LLM.
"""
from functools import lru_cache
from typing import Optional
from pydantic import BaseModel
from sympy import (
    sympify, simplify, expand, factor, Eq, solve, oo, pi, E, I,
    Symbol, symbols, Rational, Float, Integer, S,
    sin, cos, tan, log, exp, sqrt, Abs,
)
from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
    convert_xor,
)
from math_engine.normalizer import normalize_expr, extract_equation_sides, generate_confusion_alternatives


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
        result = parse_expr(
            normalized,
            transformations=TRANSFORMATIONS,
            local_dict=LOCAL_DICT,
            evaluate=True
        )
        return result
    except Exception:
        # Try a second pass: sometimes extra cleanup helps
        try:
            # Remove any remaining non-math characters
            cleaned = normalized.replace(' ', '')
            if cleaned:
                result = parse_expr(
                    cleaned,
                    transformations=TRANSFORMATIONS,
                    local_dict=LOCAL_DICT,
                    evaluate=True
                )
                return result
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
    if not expr_a or not expr_b:
        return VerificationResult(
            equivalent=None,
            confidence=0.0,
            method="empty_input",
            status="parse_failed",
            detail="One or both expressions are empty."
        )
    
    # Check if either expression contains compound clauses, implication arrows, or chained equations
    import re
    def _split_clauses_internal(text: str) -> list[str]:
        if not text:
            return []
        parts = re.split(r'\s*(?:\\(?:implies|Longrightarrow|Rightarrow|rightarrow|to)\b|=>|;)\s*', text)
        clauses = []
        for p in parts:
            p = p.strip()
            if not p:
                continue
            if ',' in p:
                sub = [s.strip() for s in p.split(',') if s.strip()]
                if len(sub) > 1 and any('=' in s for s in sub):
                    clauses.extend(sub)
                    continue
            clauses.append(p)
        return clauses

    clauses_a = _split_clauses_internal(expr_a)
    clauses_b = _split_clauses_internal(expr_b)

    def _certain(a: str, b: str) -> Optional[VerificationResult]:
        res = verify_equivalence(a, b)
        return res if res.equivalent is True and res.status == "certain" else None

    if len(clauses_a) > 1 and len(clauses_b) > 1:
        # Both compound (e.g. root sets "x = 2, 3" or systems "x = 2, y = 3"): every clause
        # on each side must be matched. Matching any single pair gave full credit to
        # "x = 2, y = 5" against "x = 2, y = 3".
        a_matched = all(any(_certain(ca, cb) for cb in clauses_b) for ca in clauses_a)
        b_matched = a_matched and all(any(_certain(ca, cb) for ca in clauses_a) for cb in clauses_b)
        if a_matched and b_matched:
            return VerificationResult(
                equivalent=True, confidence=1.0, method="clause_set_equality", status="certain",
                detail=f"All clauses match: {clauses_a} vs {clauses_b}"
            )
    elif len(clauses_a) > 1 or len(clauses_b) > 1:
        # One single milestone vs a derivation chain: the chain demonstrates the milestone
        # if any of its clauses (normally the final one) is equivalent to it.
        single, chain = (clauses_a[0], clauses_b) if len(clauses_a) == 1 else (clauses_b[0], clauses_a)
        for clause in reversed(chain):
            hit = _certain(clause, single) if single is clauses_b[0] else _certain(single, clause)
            if hit:
                return hit

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
    is_equation_a = '=' in expr_a and '<=' not in expr_a and '>=' not in expr_a
    is_equation_b = '=' in expr_b and '<=' not in expr_b and '>=' not in expr_b
    
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
        
        # Method 4: Numeric evaluation with random values
        result = _numeric_equivalence(parsed_a, parsed_b)
        if result is not None:
            return result
        
        # If we get here, they're definitely not equivalent
        return VerificationResult(
            equivalent=False,
            confidence=0.9,
            method="simplification",
            status="certain",
            detail=f"simplify(a - b) = {diff}"
        )
        
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
    
    # Handle tuple expressions (e.g., x = 2, 3 or (x, y) = (1, 2))
    def _is_tuple(obj):
        return isinstance(obj, (tuple, list))
    
    if any(_is_tuple(s) for s in parsed_sides_a + parsed_sides_b):
        if _is_tuple(parsed_sides_a[-1]) and _is_tuple(parsed_sides_b[-1]):
            t_a = parsed_sides_a[-1]
            t_b = parsed_sides_b[-1]
            if len(t_a) == len(t_b):
                all_match = True
                for elem_a, elem_b in zip(t_a, t_b):
                    sub_res = _verify_expressions(str(elem_a), str(elem_b))
                    if not sub_res.equivalent:
                        all_match = False
                        break
                if all_match:
                    return VerificationResult(
                        equivalent=True,
                        confidence=1.0,
                        method="tuple_comparison",
                        status="certain",
                        detail=f"Coordinate tuples match: {t_a} == {t_b}"
                    )
        if parsed_sides_a[0] == parsed_sides_b[0]:
            val_a = parsed_sides_a[-1]
            val_b = parsed_sides_b[-1]
            items_a = set(val_a) if _is_tuple(val_a) else {val_a}
            items_b = set(val_b) if _is_tuple(val_b) else {val_b}
            matched_a = 0
            for ia in items_a:
                if any(simplify(ia - ib) == 0 for ib in items_b):
                    matched_a += 1
            if matched_a == len(items_a) and len(items_a) == len(items_b):
                return VerificationResult(
                    equivalent=True,
                    confidence=1.0,
                    method="tuple_set_equality",
                    status="certain",
                    detail=f"Root sets match: {items_a} == {items_b}"
                )
            elif matched_a > 0:
                # Only some roots agree (missing or extra roots): this is partial
                # work, not equivalence. Leave the verdict to the LLM grader.
                return VerificationResult(
                    equivalent=None,
                    confidence=0.5,
                    method="tuple_subset",
                    status="uncertain",
                    detail=f"Root sets only partially overlap: {items_a} vs {items_b}"
                )
            else:
                return VerificationResult(
                    equivalent=False,
                    confidence=0.9,
                    method="tuple_mismatch",
                    status="certain",
                    detail=f"Root sets differ: {items_a} vs {items_b}"
                )
        return VerificationResult(
            equivalent=False,
            confidence=0.8,
            method="tuple_mismatch",
            status="certain",
            detail="Tuple structures differ."
        )

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
        
        # Fallback: solve both equations and compare solution sets
        return _compare_solutions(canonical_a, canonical_b)
        
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


def _numeric_equivalence(expr_a, expr_b, num_tests: int = 5) -> Optional[VerificationResult]:
    """
    Test equivalence by evaluating both expressions at random numeric points.
    
    This catches cases where symbolic simplification fails but the expressions
    are actually equivalent (e.g., trigonometric identities).
    """
    try:
        free_vars = list(expr_a.free_symbols | expr_b.free_symbols)
        
        if not free_vars:
            # Both are constants — direct comparison
            val_a = complex(expr_a.evalf())
            val_b = complex(expr_b.evalf())
            if abs(val_a - val_b) < 1e-10:
                return VerificationResult(
                    equivalent=True, confidence=1.0,
                    method="numeric_constant", status="certain",
                    detail=f"Constants equal: {val_a}"
                )
            return None
        
        # Test at several random points
        import random
        test_points = [
            {v: Rational(random.randint(1, 10), random.randint(1, 5)) for v in free_vars}
            for _ in range(num_tests)
        ]
        
        all_equal = True
        evaluated = 0
        for point in test_points:
            try:
                val_a = complex(expr_a.subs(point).evalf())
                val_b = complex(expr_b.subs(point).evalf())
            except Exception:
                continue
            evaluated += 1
            if abs(val_a - val_b) > 1e-8:
                all_equal = False
                break
        
        # Require at least one successful evaluation; otherwise nothing was tested
        if all_equal and evaluated > 0:
            return VerificationResult(
                equivalent=True,
                confidence=0.9,
                method="numeric_sampling",
                status="certain",
                detail=f"Equal at {num_tests} random test points."
            )
        
        return None  # Let the caller handle non-equivalence
        
    except Exception:
        return None

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
