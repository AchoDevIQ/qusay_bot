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
    s = re.sub(r'[\u0600-\u06FF]+', ' ', s)
    
    # ── Step 2: Unicode symbol replacement ─────────────────────────────────
    # These come directly from the math keypad and OCR output
    unicode_map = {
        '−': '-',       # U+2212 MINUS SIGN
        '×': '*',       # U+00D7 MULTIPLICATION SIGN
        '÷': '/',       # U+00F7 DIVISION SIGN
        '·': '*',       # U+00B7 MIDDLE DOT (dot product / multiplication)
        '±': '+',       # U+00B1 PLUS-MINUS (take positive branch for comparison)
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

    # Arabic and regional decimal comma normalization (e.g. 2,5 or 2،5 -> 2.5)
    s = re.sub(r'(\d+)[\u060C,](\d+)', r'\1.\2', s)
    
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
    s = re.sub(r'\\(?:mathbf|mathrm|mathit|textbf|textit|text)\{([^}]*)\}', r'\1', s)

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
    
    # \pm → + (take positive branch)
    s = s.replace('\\pm', '+')
    
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

    # Remove any remaining formatting/spacing backslash commands
    s = re.sub(r'\\[a-zA-Z]+\s*', '', s)
    
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


def _convert_latex_frac(s: str) -> str:
    """Convert \\frac{num}{den} → ((num)/(den)), handling nested braces."""
    result = []
    i = 0
    while i < len(s):
        if s[i:].startswith('\\frac{'):
            i += 6  # skip \frac{
            num, i = _extract_braced(s, i)
            # Skip optional whitespace
            while i < len(s) and s[i] == ' ':
                i += 1
            if i < len(s) and s[i] == '{':
                i += 1  # skip {
                den, i = _extract_braced(s, i)
                result.append(f'(({num})/({den}))')
            else:
                result.append(f'({num})')
        else:
            result.append(s[i])
            i += 1
    return ''.join(result)


def _convert_latex_sqrt(s: str) -> str:
    """Convert \\sqrt{x} → sqrt(x) and \\sqrt[n]{x} → ((x)**(1/(n))), handling nested braces."""
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
            while j < len(s) and s[j] == ' ':
                j += 1
            if j < len(s) and s[j] == '{':
                body, j = _extract_braced(s, j + 1)
                body = _convert_latex_sqrt(body)
                result.append(f'(({body})**(1/({index})))' if index else f'sqrt({body})')
                i = j
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
    s_clean = re.sub(r'[\u0600-\u06FF]+', ' ', s_clean).strip()

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
