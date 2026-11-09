"""
Normalizer for human mathematical notation → SymPy-parseable expressions.

Handles all symbols from the math keypad (Unicode, LaTeX, implicit multiplication,
Greek letters, etc.) and converts them to a format SymPy's parse_expr can consume.
"""
import re


import itertools

OCR_CONFUSION_PAIRS = [
    ('z', '2'), ('2', 'z'),
    ('i', '1'), ('1', 'i'),
    ('i', 'l'), ('l', 'i'),
    ('1', 'l'), ('l', '1'),
    ('±', '+'), ('+', '±'),
    ('S.S', '55'), ('55', 'S.S'),
    ('S.S', '5.5'), ('5.5', 'S.S'),
]

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_AR_LETTER = "\u0621-\u063A\u0641-\u064A\u066E-\u06D3"
_AR_MARK = "\u0640\u064B-\u065F\u0670"
# Letters Iraqi textbooks use as unknowns
_ARABIC_VARIABLES = {"س": "x", "ص": "y", "ع": "z"}


def strip_arabic_text(s: str) -> str:
    """
    Keeps the math in mixed Arabic/Latin text. Arabic digits and decimal marks become
    ASCII, the variable letters س ص ع become x y z, and words (annotations such as يهمل)
    are removed. Any other lone Arabic letter is left in place, so the text fails to
    parse instead of silently meaning something else.
    """
    if not s:
        return s
    s = s.translate(_ARABIC_DIGITS)
    # Arabic decimal separator, or an Arabic comma between digits, is a decimal point
    s = re.sub(r"(\d)\s*[\u066B\u060C]\s*(\d)", r"\1.\2", s)
    s = s.replace("\u066C", "").replace("\u060C", ",").replace("\u061B", ";").replace("\u061F", " ")
    s = re.sub(rf"\\text\{{[^}}]*[{_AR_LETTER}][^}}]*\}}", " ", s)
    s = re.sub(rf"[\[(][^\[\]()]*[{_AR_LETTER}]{{2,}}[^\[\]()]*[\])]", " ", s)
    s = re.sub(rf"[{_AR_LETTER}{_AR_MARK}]{{2,}}", " ", s)
    s = re.sub(rf"(?<![{_AR_LETTER}])([سصع])(?![{_AR_LETTER}])", lambda m: _ARABIC_VARIABLES[m.group(1)], s)
    return s


# Words that only ever appear in explanations, never in the math of these exams
_LABEL_WORDS = {
    "eq", "eqn", "equation", "let", "be", "the", "since", "where", "because", "as", "discard",
    "discarded", "neglect", "ignore", "reject", "rejected", "root", "roots", "square", "answer",
    "from", "by", "sub", "substitute", "substituting", "substitution", "given", "step", "case",
    "note", "check", "real", "imaginary", "both", "sides", "side", "is", "are", "not", "of",
    "and", "then", "we", "get", "has", "no", "solution", "solutions", "taking", "take",
}
# Names that can appear inside real math brackets
_MATH_NAMES = {
    "sqrt", "sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp", "abs", "asin", "acos",
    "atan", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "pi", "inf", "alpha", "beta",
    "gamma", "delta", "theta", "lambda", "mu", "sigma", "phi", "omega", "epsilon", "frac",
}
_INNER_BRACKET = re.compile(r"\(([^()]*)\)")
# An equation number written after the line: "x^2 - y^2 = 3 ____ (1)", "y = 3/x ---(2)", "... ①"
_TRAILING_NUMBER = re.compile(r"(?:\s*[-_.—–…]{2,}\s*|\s{2,})\(\s*\d{1,2}\s*\)\s*$")
_CIRCLED_DIGITS = re.compile(r"[①-⑳⓵-⓾❶-❿]")


def _is_annotation(inner: str) -> bool:
    words = [w.lower() for w in re.findall(r"[A-Za-z]+", inner)]
    if not words:
        return False
    if any(w in _LABEL_WORDS and len(w) >= 2 for w in words) and any(len(w) >= 3 for w in words):
        return True
    # Prose: two or more words, at least one of them a long non-math word ("(see above)")
    long_words = [w for w in words if len(w) >= 4 and w not in _MATH_NAMES]
    return len(words) >= 2 and bool(long_words) and " " in inner.strip()


def strip_annotations(s: str) -> str:
    """
    Removes explanations written next to the math, so they are not read as variables:
    "(Equation 1)", "(let c be the square root)", "(discard x^2 = -1 since x in R)", and
    equation numbers after a line ("____ (1)", "①"). Math in brackets, such as "(x + yi)"
    or "(2xyi)", is kept.
    """
    if not s:
        return s
    previous = None
    while previous != s:
        previous = s
        s = _INNER_BRACKET.sub(lambda m: " " if _is_annotation(m.group(1)) else m.group(0), s)
    s = _CIRCLED_DIGITS.sub(" ", s)
    s = _TRAILING_NUMBER.sub("", s)
    return re.sub(r"\s{2,}", " ", s).strip()


def generate_confusion_alternatives(raw: str) -> list[str]:
    """Generate alternate strings by substituting known OCR confusion pairs."""
    alternatives = set()
    for old, new in OCR_CONFUSION_PAIRS:
        if old in raw:
            alternatives.add(raw.replace(old, new))
    return list(alternatives)

def normalize_expr(raw: str) -> str:
    """
    Convert a human-written math string into a SymPy-parseable expression.
    
    Handles:
    - Unicode operators: − × ÷ · ² ³ ∂ ∞ π
    - LaTeX commands: \\frac{}{}, \\sqrt{}, \\int, \\lim, etc.
    - Implicit multiplication: 2x, (x-2)(x-3), x(x+1)
    - Caret exponents: x^2 → x**2
    - Greek letter names: alpha, beta, theta, etc.
    - Equation extraction: splits on = and returns LHS or expression
    
    Args:
        raw: The raw math string from user input or OCR.
    
    Returns:
        A cleaned string suitable for sympy.parse_expr().
        Returns empty string if input is empty or unparseable.
    """
    if not raw or not raw.strip():
        return ""
    
    s = raw.strip()
    
    # ── Step 1: Strip non-math decorators and math delimiters ──────────────
    # Remove math delimiters: $, $$, \(, \)
    s = re.sub(r'^\${1,2}\s*', '', s)
    s = re.sub(r'\s*\${1,2}$', '', s)
    s = re.sub(r'^\\\(', '', s)
    s = re.sub(r'\\\)$', '', s)
    s = s.replace('$', '').strip()

    # Remove leading labels like "Step 1:", "Therefore:", etc.
    s = re.sub(r'^(step\s*\d+\s*[:.]?\s*)', '', s, flags=re.IGNORECASE)
    s = re.sub(r'^(therefore|hence|so|since|thus|we get|we have)\s*[:.,]?\s*', '', s, flags=re.IGNORECASE)
    
    # Strip discard / neglect clauses and parenthetical annotations
    s = re.sub(r'\((?:discard|neglect|ignore)\s+[^)]+\)', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\[(?:discard|neglect|ignore)\s+[^\]]+\]', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\[يهمل[^\]]*\]', '', s)
    s = re.sub(r'\(يهمل[^)]*\)', '', s)
    s = re.sub(r'\\text\{\s*\[?\s*يهمل[^}]*\]?\s*\}', '', s)
    s = re.sub(r'\b(?:discard|neglect|ignore)\b', '', s, flags=re.IGNORECASE)
    s = strip_annotations(s)
    s = strip_arabic_text(s)
    
    # ── Step 2: Unicode symbol replacement ─────────────────────────────────
    # These come directly from the math keypad and OCR output
    unicode_map = {
        '−': '-',       # U+2212 MINUS SIGN
        '×': '*',       # U+00D7 MULTIPLICATION SIGN
        '÷': '/',       # U+00F7 DIVISION SIGN
        '·': '*',       # U+00B7 MIDDLE DOT (dot product / multiplication)
        # verify_equivalence expands ± into both signs before it gets here (clauses.py);
        # anything left only needs to parse, e.g. when checking whether OCR text is readable
        '±': '+',       # U+00B1 PLUS-MINUS
        '∓': '-',       # U+2213 MINUS-PLUS
        '≈': '=',       # U+2248 ALMOST EQUAL (treat as equal for equivalence)
        '≡': '=',       # U+2261 IDENTICAL TO
        '≠': '!=',      # U+2260 NOT EQUAL
        '≤': '<=',      # U+2264 LESS THAN OR EQUAL
        '≥': '>=',      # U+2265 GREATER THAN OR EQUAL
        '∞': 'oo',      # U+221E INFINITY → SymPy's oo
        '∂': 'd',       # U+2202 PARTIAL DERIVATIVE
        '′': "'",       # U+2032 PRIME
        '″': "''",      # U+2033 DOUBLE PRIME
        '\u200b': '',    # Zero-width space
        '\u00a0': ' ',   # Non-breaking space
    }
    for uni, repl in unicode_map.items():
        s = s.replace(uni, repl)

    # Radical sign from handwriting OCR and keypads: √(3+4i) → sqrt(3+4i), √17 i → sqrt(17) i.
    # Without a bracket it covers one number or one letter, as written.
    s = re.sub(r'√\s*\(', 'sqrt(', s)
    s = re.sub(r'√\s*\{([^{}]*)\}', r'sqrt(\1)', s)
    s = re.sub(r'√\s*(\d+(?:\.\d+)?|[A-Za-z])', r'sqrt(\1)', s)

    # An ASCII comma separates values ("x = 2,3" is two roots, "(1,2)" a point) and is never
    # a decimal mark; Arabic decimal marks were converted by strip_arabic_text above.
    
    # Superscript digits: ⁰¹²³⁴⁵⁶⁷⁸⁹
    superscript_map = {
        '⁰': '**0', '¹': '**1', '²': '**2', '³': '**3', '⁴': '**4',
        '⁵': '**5', '⁶': '**6', '⁷': '**7', '⁸': '**8', '⁹': '**9',
    }
    for sup, repl in superscript_map.items():
        s = s.replace(sup, repl)
    
    # ── Step 3: LaTeX command conversion ───────────────────────────────────
    # \dfrac → \frac
    s = s.replace('\\dfrac', '\\frac')

    # Strip styling commands like \mathbf{x} -> x, \mathrm{x} -> x, \text{x} -> x
    s = re.sub(r'\\(?:mathbf|mathrm|mathit|mathsf|textbf|textit|text|boxed|operatorname)\{([^}]*)\}', r'\1', s)
    # Pure layout commands with an argument that carries no math
    s = re.sub(r'\\(?:hspace|vspace|tag|label|color)\*?\{[^}]*\}', ' ', s)

    # Remove spacing and environment tags: \quad, \qquad, \begin{cases}, \end{cases}
    s = re.sub(r'\\(?:quad|qquad)\b', ' ', s)
    s = re.sub(r'\\[,:;!]', ' ', s)
    s = re.sub(r'\\(?:begin|end)\{[^}]*\}', ' ', s)
    s = re.sub(r'\\(?:therefore|because)\b', ' ', s)
    s = s.replace('\\\\', '; ')

    # \frac{d}{dx} → remove (derivative notation, structural).
    # Must run before \frac conversion, which would otherwise consume it.
    s = re.sub(r'\\frac\{d\}\{d([a-zA-Z])\}\s*', '', s)

    # \frac{a}{b} → ((a)/(b))
    s = _convert_latex_frac(s)

    # \sqrt{expr} → sqrt(expr), \sqrt[n]{expr} → nth root (handles nested braces)
    s = _convert_latex_sqrt(s)

    # \int, \iint → remove (integrals are structural, not algebraic)
    s = re.sub(r'\\i?int\s*', '', s)

    # \lim_{expr} → remove (limits are structural context)
    s = re.sub(r'\\lim_\{[^}]*\}\s*', '', s)

    # \cdot → *
    s = s.replace('\\cdot', '*')
    
    # \times → *
    s = s.replace('\\times', '*')
    
    # \div → /
    s = s.replace('\\div', '/')
    
    # \pm / \mp: see the note on '±' above
    s = s.replace('\\pm', '+')
    s = s.replace('\\mp', '-')
    
    # \pi → pi
    s = s.replace('\\pi', 'pi')
    
    # \infty → oo
    s = s.replace('\\infty', 'oo')
    
    # \left, \right → remove (visual delimiters)
    s = s.replace('\\left', '')
    s = s.replace('\\right', '')

    # Known math functions and Greek letters in LaTeX: strip leading backslash
    known_latex = [
        'arcsin', 'arccos', 'arctan', 'asin', 'acos', 'atan',
        'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
        'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta',
        'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
        'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
        'Delta', 'Gamma', 'Theta', 'Lambda', 'Sigma', 'Phi', 'Psi', 'Omega',
        'exp', 'log', 'ln'
    ]
    for cmd in known_latex:
        s = re.sub(rf'\\{cmd}\b', cmd, s)

    # Remove layout-only commands. Every other command is kept, so text such as \bar{z},
    # \overline, \in or an unbraced \sqrt23 fails to parse (uncertain) instead of having
    # its meaning silently dropped.
    s = re.sub(
        r'\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle|limits|nolimits|middle|mathstrut'
        r'|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|biggl|biggr|Biggl|Biggr)(?![A-Za-z])\s*',
        '', s,
    )
    s = s.replace('\\ ', ' ')
    
    # ── Step 4: Caret → Python exponent ────────────────────────────────────
    # Normalize pix2tex asterisk exponents: x^{*}2 or x^{*2} -> x**2
    s = re.sub(r'\^\{?\*\}?(\d+)', r'**\1', s)
    # x^2 → x**2, x^{12} → x**12, x^(n+1) → x**(n+1)
    s = re.sub(r'\^{([^}]*)}', r'**(\1)', s)  # x^{expr} → x**(expr)
    s = re.sub(r'\^(\d+)', r'**\1', s)         # x^2 → x**2
    s = re.sub(r'\^([a-zA-Z])', r'**\1', s)    # x^n → x**n
    
    # ── Step 5: Handle ln → log for SymPy ─────────────────────────────────
    # SymPy's log() is natural log by default, so ln(x) → log(x)
    s = re.sub(r'\bln\b', 'log', s)
    # Ensure bare trig/log functions have arguments parenthesized if followed by simple identifier: e.g. sin x -> sin(x)
    s = re.sub(r'\b(sin|cos|tan|cot|sec|csc|log|exp)\s+([a-zA-Z0-9]+)\b', r'\1(\2)', s)
    
    # ── Step 5b: Implicit multiplication ────────────────────────────────────
    # Must run BEFORE case normalization so that "4P" becomes "4*P",
    # allowing the word-boundary regex to match isolated "P".
    s = _add_implicit_multiplication(s)

    # ── Step 6: Case-normalize single-letter variables ────────────────────
    # In math grading, P and p should be treated as the same variable.
    # Lowercase isolated single uppercase letters that are used as variables,
    # but preserve multi-letter identifiers (sin, cos, sqrt, etc.)
    _preserved = {'Abs', 'Eq', 'S', 'E', 'I', 'N', 'O', 'Q', 'R', 'Z',
                  'Delta', 'Sigma', 'Omega'}
    
    def _lower_single_vars(match):
        word = match.group(0)
        if word in _preserved:
            return word
        if len(word) == 1 and word.isupper():
            return word.lower()
        return word
    
    s = re.sub(r'\b[A-Za-z_]\w*\b', _lower_single_vars, s)
    
    # ── Step 7: Clean up ───────────────────────────────────────────────────
    # Remove stray brackets that aren't parens (SymPy uses parens only)
    s = s.replace('[', '(').replace(']', ')')
    s = s.replace('{', '(').replace('}', ')')
    
    # Remove absolute value bars for now (|x| → Abs(x) is complex to parse)
    # We leave them — parse_expr can fail gracefully
    
    # Collapse multiple spaces and strip
    s = re.sub(r'\s+', ' ', s).strip()
    
    # Remove trailing operators
    s = re.sub(r'[+\-*/=]\s*$', '', s).strip()
    
    return s


def _latex_argument(s: str, i: int):
    """
    One LaTeX argument starting at s[i]: a braced group, or a single character as TeX
    reads it ("\\frac12" is 1/2). Returns (text, next_index), or None when absent.
    """
    while i < len(s) and s[i] == ' ':
        i += 1
    if i < len(s) and s[i] == '{':
        return _extract_braced(s, i + 1)
    if i < len(s) and s[i].isalnum():
        return s[i], i + 1
    return None


def _convert_latex_frac(s: str) -> str:
    """Convert \\frac{num}{den} (and TeX's unbraced \\frac12) → ((num)/(den)), handling nested braces."""
    result = []
    i = 0
    while i < len(s):
        if s.startswith('\\frac', i) and not (i + 5 < len(s) and s[i + 5].isalpha()):
            num = _latex_argument(s, i + 5)
            den = _latex_argument(s, num[1]) if num else None
            # "\\frac123" reads as 1/2 then 3 in TeX but was almost certainly meant otherwise
            ambiguous = (
                den is not None and len(den[0]) == 1 and s[num[1]:num[1] + 1] != '{'
                and den[1] < len(s) and s[den[1]].isdigit()
            )
            if num and den and not ambiguous:
                result.append(f'(({_convert_latex_frac(num[0])})/({_convert_latex_frac(den[0])}))')
                i = den[1]
                continue
        result.append(s[i])
        i += 1
    return ''.join(result)


def _convert_latex_sqrt(s: str) -> str:
    """Convert \\sqrt{x} → sqrt(x), \\sqrt[n]{x} → ((x)**(1/(n))), and TeX's unbraced \\sqrt2."""
    result = []
    i = 0
    while i < len(s):
        if s.startswith('\\sqrt', i):
            j = i + len('\\sqrt')
            index = None
            if j < len(s) and s[j] == '[':
                close = s.find(']', j)
                if close != -1:
                    index = s[j + 1:close].strip()
                    j = close + 1
            arg = _latex_argument(s, j)
            braced = arg is not None and s[j:].lstrip(' ').startswith('{')
            # "\\sqrt17" is sqrt(1)*7 to TeX and sqrt(17) to most writers: leave it unparseable
            ambiguous = arg is not None and not braced and arg[1] < len(s) and s[arg[1]].isalnum()
            if arg is not None and not ambiguous:
                body = _convert_latex_sqrt(arg[0])
                result.append(f'(({body})**(1/({index})))' if index else f'sqrt({body})')
                i = arg[1]
                continue
        result.append(s[i])
        i += 1
    return ''.join(result)


def _extract_braced(s: str, start: int) -> tuple:
    """Extract content from a brace-delimited region, handling nesting."""
    depth = 1
    i = start
    content = []
    while i < len(s) and depth > 0:
        if s[i] == '{':
            depth += 1
            content.append(s[i])
        elif s[i] == '}':
            depth -= 1
            if depth > 0:
                content.append(s[i])
        else:
            content.append(s[i])
        i += 1
    return ''.join(content), i


def _add_implicit_multiplication(s: str) -> str:
    """
    Insert explicit '*' where multiplication is implied in math notation.
    
    Patterns handled:
    - 2x → 2*x           (digit followed by letter)
    - 2(x+1) → 2*(x+1)   (digit followed by open paren)
    - x(x+1) → x*(x+1)   (letter followed by open paren, unless it's a function)
    - (x+1)(x-1) → (x+1)*(x-1)  (close paren followed by open paren)
    - (x+1)x → (x+1)*x   (close paren followed by letter)
    - (x+1)2 → (x+1)*2   (close paren followed by digit)
    - 3pi → 3*pi          (digit followed by known constant)
    """
    # Known function names that should NOT get implicit * before (
    functions = {'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
                 'asin', 'acos', 'atan', 'log', 'ln', 'exp',
                 'sqrt', 'abs', 'Abs', 'factorial',
                 'sinh', 'cosh', 'tanh', 'sign'}
    
    result = []
    i = 0
    while i < len(s):
        result.append(s[i])
        
        if i + 1 < len(s):
            curr = s[i]
            nxt = s[i + 1]
            
            # digit followed by letter: 2x → 2*x
            if curr.isdigit() and (nxt.isalpha() or nxt == '_'):
                result.append('*')
            
            # digit followed by '(': 2(x) → 2*(x)
            elif curr.isdigit() and nxt == '(':
                result.append('*')
            
            # letter followed by '(' — but only if not a function call
            elif curr.isalpha() and nxt == '(':
                # Look back to find the full word
                word = _get_word_ending_at(s, i)
                if word not in functions:
                    result.append('*')
            
            # ')' followed by '(': (a)(b) → (a)*(b)
            elif curr == ')' and nxt == '(':
                result.append('*')
            
            # ')' followed by letter: (a)x → (a)*x
            elif curr == ')' and (nxt.isalpha() or nxt == '_'):
                result.append('*')
            
            # ')' followed by digit: (a)2 → (a)*2
            elif curr == ')' and nxt.isdigit():
                result.append('*')
            
            # letter followed by digit only in specific patterns like x2 (subscript-like)
            # Skip this — x2 is ambiguous and better left to SymPy
        
        i += 1
    
    return ''.join(result)


def _get_word_ending_at(s: str, pos: int) -> str:
    """Get the word (sequence of alphanumeric chars) ending at position pos."""
    end = pos + 1
    start = pos
    while start > 0 and s[start - 1].isalpha():
        start -= 1
    return s[start:end]


def extract_equation_sides(expr_str: str) -> list:
    """
    Split an equation on '=' and return the parts.
    
    For 'x^2 - 5x + 6 = 0', returns ['x**2 - 5*x + 6', '0'].
    For 'x = 2', returns ['x', '2'].
    For a plain expression '2x + 3', returns ['2*x + 3'].
    
    Handles chained equalities: 'a = b = c' → ['a', 'b', 'c']
    Skips comparison operators (<=, >=, !=, ==).
    """
    if not expr_str:
        return []

    # Strip discard / neglect clauses and Arabic annotations before splitting on '='
    s_clean = expr_str
    s_clean = re.sub(r'\((?:discard|neglect|ignore)\s+[^)]+\)', '', s_clean, flags=re.IGNORECASE)
    s_clean = re.sub(r'\[(?:discard|neglect|ignore)\s+[^\]]+\]', '', s_clean, flags=re.IGNORECASE)
    s_clean = re.sub(r'\[يهمل[^\]]*\]', '', s_clean)
    s_clean = re.sub(r'\(يهمل[^)]*\)', '', s_clean)
    s_clean = re.sub(r'\\text\{\s*\[?\s*يهمل[^}]*\]?\s*\}', '', s_clean)
    s_clean = re.sub(r'\b(?:discard|neglect|ignore)\b', '', s_clean, flags=re.IGNORECASE)
    s_clean = strip_arabic_text(s_clean).strip()

    # Protect comparison operators from splitting
    protected = s_clean
    protected = protected.replace('<=', '\x00LE\x00')
    protected = protected.replace('>=', '\x00GE\x00')
    protected = protected.replace('!=', '\x00NE\x00')
    protected = protected.replace('==', '\x00EQ\x00')
    
    parts = protected.split('=')
    
    result = []
    for part in parts:
        # Restore comparison operators
        p = part.replace('\x00LE\x00', '<=')
        p = p.replace('\x00GE\x00', '>=')
        p = p.replace('\x00NE\x00', '!=')
        p = p.replace('\x00EQ\x00', '==')
        normalized = normalize_expr(p)
        if normalized:
            result.append(normalized)
    
    return result
