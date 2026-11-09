import os
import re
import asyncio
import collections.abc
import time
import base64
import json
import logging
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv
load_dotenv()

from preprocessing.pipeline import deskew_and_enhance_page
from llm.router import complete_vision_json
from math_engine.clauses import ARROW_PATTERN

logger = logging.getLogger(__name__)

class MathRegionList(list, collections.abc.Coroutine):
    def send(self, val):
        raise StopIteration(self)

    def throw(self, typ, val=None, tb=None):
        raise typ(val)

    def close(self):
        pass

    def __await__(self):
        yield from ()
        return self

class MathRegion(BaseModel):
    region_id: str
    content: str
    ocr_confidence: float  # Map "high"->1.0, "medium"->0.7, "low"->0.3
    type: str
    annotations: List[str] = Field(default_factory=list)
    discarded_attempts: List[str] = Field(default_factory=list)
    # Normalized [x0, y0, x1, y1] (0-1) on the preprocessed page; empty when unknown.
    # Used to place grading marks on the student's image (grading/overlay.py).
    bbox: List[float] = Field(default_factory=list)


def _clean_bbox(value) -> List[float]:
    """Accept only a well-formed normalized box; anything else becomes 'unknown'."""
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return []
    try:
        x0, y0, x1, y1 = (min(max(float(v), 0.0), 1.0) for v in value)
    except (TypeError, ValueError):
        return []
    if x1 <= x0 or y1 <= y0:
        return []
    return [x0, y0, x1, y1]


class ExtractedStep(BaseModel):
    region_id: str = "r_01"
    content: str = ""
    ocr_confidence: str = "high" # high, medium, low
    ambiguous_alternatives: List[str] = Field(default_factory=list)
    type: str = "solution_step"
    annotations: List[str] = Field(default_factory=list)
    discarded_attempts: List[str] = Field(default_factory=list)
    bbox: List[float] = Field(default_factory=list, description="Normalized [x0, y0, x1, y1] location of this step's ink on the page (0-1).")

    @field_validator("bbox", mode="before")
    @classmethod
    def _validate_bbox(cls, v):
        return _clean_bbox(v)

class GptResponse(BaseModel):
    reasoning: str = ""
    steps: List[ExtractedStep] = Field(default_factory=list)
    # Crossed-out work, kept apart so it never counts against (or for) the student
    discarded: List[str] = Field(default_factory=list)

BASE_PROMPT = r"""You are a STRICT optical character recognition (OCR) engine for handwritten mathematics.
Your ONLY responsibility is to transcribe the EXACT visual mathematical expressions physically written on the paper into LaTeX format.

CRITICAL TRANSCRIPTION DIRECTIVES (ZERO ASSUMPTIONS, ZERO AUTO-CORRECTION):
1. **LITERAL OPTICAL COPYING ONLY**: You are a camera scanner, NOT a mathematician, NOT a solver, and NOT an auto-complete tool. You MUST transcribe ONLY the exact characters, numbers, variables, and symbols visibly drawn on the paper.
2. **SCAN THE FULL PAGE FROM TOP TO BOTTOM**:
   - Begin transcription from the very first handwritten equation directly beneath the question header line. NEVER skip introductory operations (such as multiplying by conjugate `a+bi = \frac{3+i}{1-i} \cdot \frac{1+i}{1+i}` or preliminary definitions) written near the top margin.
3. **FORKED / BRANCHING ARROWS & TWO-CASE ROOTS**:
   - When final roots or solutions are written with a bracket or two diverging arrows:
     \sqrt{Z} = \begin{cases} \longrightarrow (z_1) \\ \longrightarrow (z_2) \end{cases}
   - YOU MUST TRANSCRIBE BOTH BRANCHES as separate steps in the "steps" array! Never omit or drop one branch. Ensure both the top branch and bottom branch are captured faithfully.
4. **CRITICAL GLYPH DISTINCTION: IMAGINARY UNIT 'i' VS DIGIT '1'**:
   - Look closely for the handwritten dot (tittle) above vertical strokes.
   - In complex number equations, such as `i = x^2 + 2xyi - y^2` or `-i^3 = i`, the isolated character on the left is the imaginary unit `i`, NOT the digit `1`! Never transcribe `i = x^2...` as `1 = x^2...`.
5. **ATOMIC STEP SEGMENTATION (MANDATORY)**:
   - When the writer writes multiple mathematical steps or equations chained horizontally using arrows (\to, \longrightarrow, \implies, =>), semicolons (;), commas, or side-by-side expressions (e.g. -17 \longrightarrow \sqrt{c^2} = \sqrt{-17} \longrightarrow c = \pm \sqrt{17}i or 2xy = 6   y = 3/x), YOU MUST SPLIT EACH INTO A SEPARATE STEP in the "steps" array!
   - NEVER combine chained arrows or separate equations into a single step string.
   - Do NOT include connecting arrows (\to, \implies, =>) in the transcribed content; record each clean mathematical equation or expression as its own atomic step in visual reading order.
6. **RADICAL OVERBARS & RULED NOTEBOOK LINES**:
   - CAREFULLY inspect horizontal radical vinculums (the top bar of \sqrt{...}) on lined/notebook paper. A horizontal bar often runs directly along, above, or below a notebook rule line. Look for the radical checkmark/hook (\sqrt{}) on the left!
   - If a radical checkmark is present on the left of an expression (e.g. \sqrt{-17} or \sqrt{c^2}), you MUST transcribe it as \sqrt{...}. NEVER omit a radical symbol because its top bar blends with a notebook rule line.
   - Also check for negative signs before fractions (e.g. -\frac{1}{\sqrt{2}} - \frac{1}{\sqrt{2}}i vs +\frac{1}{\sqrt{2}} - \frac{1}{\sqrt{2}}i).
7. **NEVER ASSUME OR ADD MISSING SYMBOLS**:
   - If a student wrote "3 + 3 + - 1" or omitted an "i", a variable, a sign, or a parenthesis, transcribe EXACTLY what is written. NEVER add "i", never add variables, and never insert missing terms.
   - If a student wrote "2xy = 4" without specifying "x != 0", do NOT add constraints.
   - NEVER guess what the student "intended" or "meant" to write. Copy ONLY what their hand physically wrote.
8. **NEVER FIX ERRORS OR TYPOS**:
   - If the student made an arithmetic blunder (e.g. 2 + 2 = 5), an algebraic error, or copied a number incorrectly, transcribe the EXACT incorrect equation.
   - Downstream automated grading DEPENDS on seeing the student's REAL mistakes! If you "fix" or "auto-correct" their work, grading will fail.
9. **NEVER INVENT OR INTERPOLATE INTERMEDIATE STEPS**:
   - If a student skipped steps and wrote line 1 then line 3, transcribe ONLY lines 1 and 3. DO NOT insert unwritten steps.
10. **NEVER AUTO-COMPLETE UNFINISHED WORK**:
   - If an expression ends abruptly or was left incomplete, transcribe only the visual ink present.
11. **CROSSED-OUT & SCRATCH WORK**:
   - Isolate strikethrough, crossed-out, or scribbled work and put it in the top-level "discarded" array. Do NOT include it in "steps".
12. **ARABIC ANNOTATIONS, DIGITS AND VARIABLES**:
    - Copy an Arabic annotation written beside a step (e.g. "يهمل", "بجذر الطرفين", "بالتربيع", "نعوض 2 في 1") at the end of that step in square brackets, e.g. `x^2 + 1 = 0 [يهمل]`. Never drop it: graders award marks for it.
    - Keep Arabic digits (٠١٢٣٤٥٦٧٨٩) and Arabic variable letters (س, ص) exactly as written; do not translate them.

Output format (COMPACT JSON):
CRITICAL: Do NOT output any "reasoning" key, visual observations, explanations, or redundant metadata. Output ONLY the extracted steps, plus "discarded" when something is crossed out:
{
  "steps": [
    "Exact literal LaTeX string for step 1",
    "Exact literal LaTeX string for step 2"
  ],
  "discarded": []
}
"""

def _detect_media_type(image_bytes: bytes, fallback: str = "image/jpeg") -> str:
    """Sniff the real image format so the data URI never mislabels PNG/WEBP bytes as JPEG."""
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    if image_bytes[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return fallback

class LeanOcrResponse(BaseModel):
    """Compact OCR schema (changes/12): one literal LaTeX string per step."""
    steps: List[str] = Field(default_factory=list)
    discarded: List[str] = Field(default_factory=list)


class LocatedStep(BaseModel):
    t: str = Field(description="Exact literal LaTeX for this atomic step")
    b: List[float] = Field(default_factory=list, description="[x0, y0, x1, y1] fractions of the image (0-1)")


class LocatedOcrResponse(BaseModel):
    """Compact OCR schema with step locations for the graded overlay."""
    steps: List[LocatedStep] = Field(default_factory=list)
    discarded: List[str] = Field(default_factory=list)


# Appended only when step locations are requested. Short keys keep the extra
# output to ~15-20 tokens per step on top of the lean schema.
LOCATION_ADDENDUM = """
STEP LOCATIONS (REQUIRED FOR THIS REQUEST):
Instead of plain strings, output each step as {"t": "<literal LaTeX>", "b": [x0, y0, x1, y1]}, where "b" is the tight box
around that step's ink as fractions of the image size (0,0 = top-left, 1,1 = bottom-right), 2 decimals.
Locations only place grading marks; never change a transcription to fit a location.
{"steps": [{"t": "Exact literal LaTeX string for step 1", "b": [0.08, 0.21, 0.62, 0.27]}]}
"""


def step_locations_enabled() -> bool:
    """
    Per-step boxes for the graded overlay (grading/overlay.py): the Settings page choice
    when saved, otherwise OCR_STEP_LOCATIONS.
    """
    from llm.router import saved_settings
    saved = saved_settings().get("ocr_step_locations")
    if isinstance(saved, bool):
        return saved
    return os.getenv("OCR_STEP_LOCATIONS", "false").strip().lower() in ("1", "true", "yes", "on")


async def _call_gpt(image_bytes: bytes, prompt: str, detail: Optional[str] = None,
                    with_locations: bool = False) -> GptResponse:
    """
    One vision OCR call, routed by OCR_MODEL (GPT or Claude) with OCR_FALLBACK_MODEL
    failover. Retries and backoff are handled inside llm.router by the SDKs.
    """
    # Low detail by default; high-fidelity/auto when explicitly requested (~26k tokens)
    detail_mode = detail or os.getenv("OCR_DETAIL", "low")
    data = await complete_vision_json(
        "ocr",
        prompt + (LOCATION_ADDENDUM if with_locations else ""),
        image_bytes,
        media_type=_detect_media_type(image_bytes),
        schema=LocatedOcrResponse if with_locations else LeanOcrResponse,
        detail=detail_mode,
    )

    steps_data = data.get("steps", [])
    if isinstance(steps_data, dict):
        steps_data = [steps_data]
        
    steps = []
    if isinstance(steps_data, list):
        for idx, d in enumerate(steps_data):
            if isinstance(d, dict):
                r_id = d.get("region_id") or f"r_{idx+1:02d}"
                c = d.get("content") or d.get("t") or d.get("latex") or d.get("text") or ""
                conf = d.get("ocr_confidence") or d.get("confidence") or d.get("conf") or "high"
                steps.append(ExtractedStep(
                    region_id=r_id,
                    content=str(c).strip(),
                    ocr_confidence=conf if conf in ("high", "medium", "low") else "high",
                    ambiguous_alternatives=d.get("ambiguous_alternatives", []) if isinstance(d.get("ambiguous_alternatives"), list) else [],
                    type=d.get("type", "solution_step"),
                    annotations=d.get("annotations", []) if isinstance(d.get("annotations"), list) else [],
                    discarded_attempts=d.get("discarded_attempts", []) if isinstance(d.get("discarded_attempts"), list) else [],
                    bbox=d.get("bbox") or d.get("b") or []
                ))
            elif isinstance(d, str):
                steps.append(ExtractedStep(
                    region_id=f"r_{idx+1:02d}",
                    content=d.strip(),
                    ocr_confidence="high",
                    type="solution_step"
                ))
            else:
                logger.warning(f"Unexpected step format: {d}")

    # Fallback: if top-level JSON contains step fields directly
    if not steps and ("content" in data or "region_id" in data):
        steps.append(ExtractedStep(
            region_id=data.get("region_id", "r_01"),
            content=data.get("content", ""),
            ocr_confidence=data.get("ocr_confidence", "high"),
            ambiguous_alternatives=data.get("ambiguous_alternatives", []) if isinstance(data.get("ambiguous_alternatives"), list) else [],
            type=data.get("type", "solution_step"),
            annotations=data.get("annotations", []) if isinstance(data.get("annotations"), list) else [],
            discarded_attempts=data.get("discarded_attempts", []) if isinstance(data.get("discarded_attempts"), list) else [],
            bbox=data.get("bbox", [])
        ))

    discarded = data.get("discarded") or data.get("discarded_attempts") or []
    discarded = [str(d).strip() for d in discarded if str(d).strip()] if isinstance(discarded, list) else []
    return GptResponse(reasoning="", steps=steps, discarded=discarded)

async def run_gpt_batch_verification(image_bytes: bytes, steps: List[ExtractedStep], detail: Optional[str] = None) -> List[ExtractedStep]:
    """Single batch verification pass: inspects all flagged steps in ONE single API call."""
    if not steps:
        return []
    
    steps_json = json.dumps([{"region_id": s.region_id, "content": s.content} for s in steps], indent=2, ensure_ascii=False)
    verify_prompt = f"""Review the following extracted math steps against the image in a single pass.
Pay specific attention to visually ambiguous glyph pairs: i/1/l, z/2, \\pm vs separate +/-, and radical scopes.

CRITICAL RULES:
1. Only correct VISUAL OCR misidentifications (e.g. if the letter 'z' was misread as digit '2').
2. NEVER correct mathematical mistakes or arithmetic blunders made by the student.
3. NEVER add missing symbols, variables, or terms that the student omitted.
4. Copy ONLY what is physically drawn on the page.

Extracted steps to verify:
{steps_json}

Output a compact JSON object (NO reasoning or commentary):
{{
  "steps": [
    "literal visual LaTeX string for step 1",
    "literal visual LaTeX string for step 2"
  ]
}}
"""
    resp = await _call_gpt(image_bytes, verify_prompt, detail=detail)
    return resp.steps

async def run_gpt_verification(image_bytes: bytes, step: ExtractedStep, detail: Optional[str] = None) -> ExtractedStep:
    """Two-pass self-verification for a single step (calls batch verification)."""
    verified = await run_gpt_batch_verification(image_bytes, [step], detail=detail)
    if verified:
        return verified[0]
    return step

def are_equivalent(content1: str, content2: str) -> bool:
    """Helper to check if two LaTeX strings from OCR passes visually agree."""
    if not content1 or not content2:
        return False
    c1 = content1.strip().replace(" ", "").replace(r"\dfrac", r"\frac")
    c2 = content2.strip().replace(" ", "").replace(r"\dfrac", r"\frac")
    if c1 == c2:
        return True
    from math_engine.normalizer import normalize_expr
    try:
        n1 = normalize_expr(content1)
        n2 = normalize_expr(content2)
        if n1 and n2 and n1.replace(" ", "") == n2.replace(" ", ""):
            return True
    except Exception:
        pass
    return False

def resolve_verification(step_A: ExtractedStep, step_B: Optional[ExtractedStep]) -> ExtractedStep:
    """
    Resolves initial extraction with second-pass verification.
    If the second pass agrees or refines ambiguous glyphs, confidence is boosted.
    """
    if not step_B:
        return step_A

    final = step_A.model_copy()
    A_eq_B = are_equivalent(step_A.content, step_B.content)

    if A_eq_B:
        final.ocr_confidence = "high"
        logger.info(f"Verification: double-check confirmed step {step_A.region_id}.")
    else:
        logger.info(f"Verification: double-check refined step {step_A.region_id}: '{step_A.content}' -> '{step_B.content}'")
        if step_B.ocr_confidence in ("high", "medium"):
            final.content = step_B.content
            final.ocr_confidence = step_B.ocr_confidence
        else:
            final.ocr_confidence = "low"

        if step_A.content not in final.ambiguous_alternatives:
            final.ambiguous_alternatives.append(step_A.content)
        if step_B.content not in final.ambiguous_alternatives and step_B.content != final.content:
            final.ambiguous_alternatives.append(step_B.content)

    return final

def _needs_verification(step: ExtractedStep) -> bool:
    """
    "on_low_confidence" trigger. The lean schema returns no confidence, so besides an
    explicit "low" a step is flagged when SymPy cannot parse it: misread glyphs
    (i/1, z/2, broken radicals) usually leave a transcription unparseable.
    """
    if step.ocr_confidence == "low":
        return True
    content = (step.content or "").strip()
    if not content or not any(ch.isdigit() or ch.isalpha() for ch in content):
        return False
    try:
        from math_engine.verifier import safe_parse_with_fallback
        return safe_parse_with_fallback(content) is None
    except Exception:
        return False


def map_confidence(conf_str) -> float:
    if isinstance(conf_str, (int, float)):
        return float(conf_str)
    s = str(conf_str).lower().strip()
    if s == "high": return 1.0
    if s == "medium": return 0.7
    if s == "low": return 0.3
    try:
        return float(conf_str)
    except Exception:
        return 0.5


def sanitize_ocr_math_text(text: str) -> str:
    r"""
    Sanitizes raw OCR math text extracted from vision models:
    - Repairs accidental control-character LaTeX escapes (e.g. '\x0crac' -> '\frac').
    - Removes non-printable ASCII control characters (0x00-0x08, 0x0B-0x0C, 0x0E-0x1F).
    - Preserves printable characters, standard whitespace, and valid Unicode.
    """
    if not text:
        return ""
    text = text.replace("\x0crac", r"\frac")
    # Strip illegal ASCII control characters (allow \t, \n, \r)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
    return text.strip()

def _split_bbox_horizontally(bbox: List[float], parts: List[str]) -> List[List[float]]:
    """Chained steps are written left-to-right on one line: share the box by text length."""
    if not bbox or len(parts) <= 1:
        return [list(bbox) for _ in parts]
    x0, y0, x1, y1 = bbox
    weights = [max(len(p.strip()), 1) for p in parts]
    total = float(sum(weights))
    boxes, cursor = [], x0
    for w in weights:
        nxt = cursor + (x1 - x0) * (w / total)
        boxes.append([cursor, y0, nxt, y1])
        cursor = nxt
    return boxes

_AR_WORD = (
    r"[\u0621-\u063A\u0641-\u064A\u066E-\u06D3]"
    r"[\u0621-\u063A\u0641-\u064A\u066E-\u06D3\u0640\u064B-\u065F\u0670]+"
)
_AR_RUN = re.compile(rf"{_AR_WORD}(?:\s+{_AR_WORD})*")


def _bracket_arabic_annotations(text: str):
    """
    Arabic words in a step are annotations (يهمل, نعوض ...). They stay in the step inside
    square brackets so the grader sees them, and are also listed as annotations. Single
    Arabic letters (س, ص) are variables and Arabic digits are numbers, so both stay as math.
    """
    text = re.sub(
        r"\\text\{\s*([^{}]*?)\s*\}",
        lambda m: f"[{m.group(1)}]" if _AR_RUN.search(m.group(1)) else m.group(0),
        text,
    )
    bracket_spans = [m.span() for m in re.finditer(r"\[[^\[\]]*\]", text)]
    annotations, pieces, last = [], [], 0
    for m in _AR_RUN.finditer(text):
        annotations.append(m.group(0))
        inside = any(a <= m.start() and m.end() <= b for a, b in bracket_spans)
        pieces.append(text[last:m.start()])
        pieces.append(m.group(0) if inside else f"[{m.group(0)}]")
        last = m.end()
    pieces.append(text[last:])
    return re.sub(r"\s+", " ", "".join(pieces)).strip(), annotations


def split_compound_steps(steps: List[ExtractedStep]) -> List[ExtractedStep]:
    r"""
    Post-processes extracted steps to enforce atomic segmentation.
    If the vision model combined multiple steps connected by arrows (\to, \implies, =>),
    semicolons, or wide spaces into a single step, this splits them into clean atomic steps.
    Arabic annotations stay in the step in brackets (see _bracket_arabic_annotations).
    """
    split_steps: List[ExtractedStep] = []
    arrow_pattern = re.compile(rf"\s*(?:{ARROW_PATTERN}|-->|->|;)\s*")

    for step in steps:
        raw = sanitize_ocr_math_text(step.content)
        if not raw:
            continue

        sub_parts = []
        for p in arrow_pattern.split(raw):
            p_str = (p or "").strip()
            if not p_str:
                continue
            if ('\\quad' in p_str or '\\qquad' in p_str or '   ' in p_str) and p_str.count('=') >= 2:
                space_splits = re.split(r'\s*(?:\\qquad|\\quad|\s{3,})\s*', p_str)
                if len(space_splits) > 1 and all('=' in s or len(s) > 2 for s in space_splits):
                    sub_parts.extend([s.strip() for s in space_splits if s.strip()])
                    continue
            sub_parts.append(p_str)
        if len(sub_parts) <= 1:
            sub_parts = [raw]

        part_boxes = _split_bbox_horizontally(step.bbox, sub_parts)
        for idx, part in enumerate(sub_parts):
            content, found = _bracket_arabic_annotations(part.strip())
            if not content:
                continue
            annotations = list(step.annotations or [])
            annotations += [a for a in found if a not in annotations]
            split_steps.append(ExtractedStep(
                region_id=step.region_id,
                content=content,
                ocr_confidence=step.ocr_confidence,
                ambiguous_alternatives=step.ambiguous_alternatives if idx == 0 else [],
                type=step.type,
                annotations=annotations,
                discarded_attempts=step.discarded_attempts if idx == 0 else [],
                bbox=part_boxes[idx],
            ))

    for i, s in enumerate(split_steps):
        s.region_id = f"r_{i+1:02d}"

    return split_steps


def _readability(content: str) -> float:
    """
    Lean OCR returns no confidence of its own, so readability stands in for it: a step
    SymPy cannot parse is often a misread glyph (i/1, z/2, a broken radical).
    """
    if not re.search(r"[0-9A-Za-z]", content or ""):
        return 1.0
    try:
        from math_engine.verifier import safe_parse_with_fallback
        return 1.0 if safe_parse_with_fallback(content) is not None else 0.5
    except Exception:
        return 1.0


def _build_regions(final_segmented: List[ExtractedStep], discarded: List[str]) -> "MathRegionList":
    regions = MathRegionList()
    for i, step in enumerate(final_segmented):
        content = sanitize_ocr_math_text(step.content)
        regions.append(MathRegion(
            region_id=step.region_id or f"r_{i+1:02d}",
            content=content,
            ocr_confidence=min(map_confidence(step.ocr_confidence), _readability(content)),
            type=step.type or "solution_step",
            annotations=step.annotations or [],
            discarded_attempts=(step.discarded_attempts or []) + (discarded if i == 0 else []),
            bbox=step.bbox or [],
        ))
    return regions


async def _async_extract_regions_from_image(
    image_bytes: bytes, 
    media_type: str = "image/jpeg", 
    ensemble_mode: str = "on_low_confidence",
    detail: Optional[str] = None
) -> MathRegionList:
    """
    Internal asynchronous region extractor using the OCR vision model (Claude Haiku 5.5).

    Architecture (single vision model):
    1. Preprocess & Deskew Page (OpenCV deskewing, padding protection, contrast optimization).
    2. Primary Vision Extraction with atomic step splitting.
       Detail defaults to 'low' (~2.8k tokens, $0.00045), and supports 'auto' for high fidelity.
    3. Targeted Double-Check: On low confidence (or 'always'), the model performs
       a secondary focused inspection on ambiguous glyphs (i/1, z/2, ±, missing/added signs).
    4. Deterministic Atomic Step Splitting to separate chained arrow expressions.

    Ensemble Modes:
    - "on_low_confidence": Runs single pass, triggers a double-check only on low confidence steps.
    - "always": Triggers double-check verification on every step.
    - "fast_single_pass" (Recommended Default): Runs single pass with zero verification overhead.
    """
    # 1. Preprocess & Deskew Page (offloaded to thread pool so OpenCV does not block the async event loop)
    enhanced_bytes = await asyncio.to_thread(deskew_and_enhance_page, image_bytes)
    
    # 2. Primary Page Vision OCR Extraction
    # Boxes are only meaningful on the preprocessed frame the overlay rebuilds, so the
    # raw-bytes fallbacks below never request them.
    with_locations = step_locations_enabled()
    logger.info("Running primary full-page vision OCR extraction (OCR_MODEL via llm.router)")
    try:
        gpt_resp = await _call_gpt(enhanced_bytes, BASE_PROMPT, detail=detail, with_locations=with_locations)
    except Exception as e:
        logger.warning(f"Enhanced page OCR failed: {e}. Retrying with original bytes.")
        gpt_resp = await _call_gpt(image_bytes, BASE_PROMPT, detail=detail)

    if not gpt_resp.steps:
        # Fallback with raw bytes if enhanced returned no steps
        gpt_resp = await _call_gpt(image_bytes, BASE_PROMPT, detail=detail)
        
    if not gpt_resp.steps:
        return MathRegionList([MathRegion(region_id="r_01", content="", ocr_confidence=0.0, type="solution_step",
                                          discarded_attempts=gpt_resp.discarded)])
        
    # Enforce atomic segmentation on primary extraction steps
    initial_steps = split_compound_steps(gpt_resp.steps)
    
    # 3. Targeted Batch Double-Check (At most ONE single verification call)
    if ensemble_mode == "fast_single_pass":
        resolved_steps = initial_steps
    else:
        steps_to_verify = []
        for step in initial_steps:
            if ensemble_mode == "always" or (ensemble_mode == "on_low_confidence" and _needs_verification(step)):
                steps_to_verify.append(step)

        if steps_to_verify:
            try:
                logger.info(f"Running single batch verification for {len(steps_to_verify)} flagged steps.")
                verified_steps = await run_gpt_batch_verification(enhanced_bytes, steps_to_verify, detail=detail)
                # The compact verification reply carries no region ids: its steps come back in
                # the order they were sent, so match by position. Only accept the reply when
                # the counts agree; otherwise a dropped/merged step would shift every match.
                verified_map = {}
                if len(verified_steps) == len(steps_to_verify):
                    verified_map = {orig.region_id: v for orig, v in zip(steps_to_verify, verified_steps)}
                else:
                    logger.warning(
                        f"Verification returned {len(verified_steps)} steps for {len(steps_to_verify)} sent; keeping initial steps."
                    )
                resolved_steps = []
                for s in initial_steps:
                    if s.region_id in verified_map:
                        resolved_steps.append(resolve_verification(s, verified_map[s.region_id]))
                    else:
                        resolved_steps.append(s)
            except Exception as e:
                logger.warning(f"Batch verification failed: {e}. Keeping initial steps.")
                resolved_steps = initial_steps
        else:
            resolved_steps = initial_steps
                
    # Final pass: guarantee atomic segmentation across all resolved steps
    final_segmented = split_compound_steps(resolved_steps)
    
    # Parsing for the readability score blocks, so it stays off the event loop
    return await asyncio.to_thread(_build_regions, final_segmented, gpt_resp.discarded)


def extract_regions_from_image(
    image_bytes: bytes, 
    media_type: str = "image/jpeg", 
    ensemble_mode: str = "on_low_confidence",
    detail: Optional[str] = None
):
    """
    Extracts mathematical regions from a full page image using the OCR vision model (Claude Haiku 5.5).
    Supports both synchronous callers and asynchronous (await / asyncio.run) callers.
    Detail defaults to 'low' (~2.8k tokens, $0.00045) unless 'auto'/'high' is explicitly requested.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        return _async_extract_regions_from_image(image_bytes, media_type, ensemble_mode, detail=detail)
    else:
        return asyncio.run(_async_extract_regions_from_image(image_bytes, media_type, ensemble_mode, detail=detail))
