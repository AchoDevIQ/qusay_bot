"""
grading/red_pen_renderer.py — Authentic Human-Like Red Pen Grading & Image Overlay Engine.

Generates realistic teacher red-pen annotations directly over student solution papers:
  - 2x supersampled anti-aliased organic checkmarks (✓) for correct steps
  - 2x supersampled organic crosses (✗) for incorrect steps
  - Double-looped hand-drawn ovals/circles around blunders and algebraic errors
  - Slanted strike-through strokes across erroneous equations
  - Clean mathematical symbol corrections (LaTeX converted to readable Unicode math)
  - Full Arabic contextual glyph shaping & RTL bidirectional rendering for teacher notes/comments
  - Collision-avoidant marginal pills with strict page-boundary clamping
  - Large organic circled final score badge at the top-right corner with Arabic/English teacher notes.
"""

import io
import math
import os
import random
import re
from typing import List, Dict, Any, Optional, Tuple, Union
from PIL import Image, ImageDraw, ImageFont


# Default authentic red-pen ink palette
INK_RED = (210, 32, 32, 242)           # Primary vibrant red ink
INK_RED_DARK = (175, 24, 24, 250)      # Core pressure line
INK_RED_BLEED = (239, 68, 68, 65)      # Soft paper bleed / halo
INK_GREEN = (22, 163, 74, 240)         # Green checkmark option if requested
INK_YELLOW = (217, 119, 6, 240)        # Partial warning ink

_ARABIC_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")
_SPECIAL_MATH_RE = re.compile(r"[√±∓×÷≠≤≥∉∈⇒²³⁴]")

# Built-in fallback Arabic contextual forms table: base -> (isolated, final, initial, medial)
_AR_FORMS: Dict[str, Tuple[str, str, Optional[str], Optional[str]]] = {
    "\u0621": ("\uFE80", "\uFE80", None, None),
    "\u0622": ("\uFE81", "\uFE82", None, None),
    "\u0623": ("\uFE83", "\uFE84", None, None),
    "\u0624": ("\uFE85", "\uFE86", None, None),
    "\u0625": ("\uFE87", "\uFE88", None, None),
    "\u0626": ("\uFE89", "\uFE8A", "\uFE8B", "\uFE8C"),
    "\u0627": ("\uFE8D", "\uFE8E", None, None),
    "\u0628": ("\uFE8F", "\uFE90", "\uFE91", "\uFE92"),
    "\u0629": ("\uFE93", "\uFE94", None, None),
    "\u062A": ("\uFE95", "\uFE96", "\uFE97", "\uFE98"),
    "\u062B": ("\uFE99", "\uFE9A", "\uFE9B", "\uFE9C"),
    "\u062C": ("\uFE9D", "\uFE9E", "\uFE9F", "\uFEA0"),
    "\u062D": ("\uFEA1", "\uFEA2", "\uFEA3", "\uFEA4"),
    "\u062E": ("\uFEA5", "\uFEA6", "\uFEA7", "\uFEA8"),
    "\u062F": ("\uFEA9", "\uFEAA", None, None),
    "\u0630": ("\uFEAB", "\uFEAC", None, None),
    "\u0631": ("\uFEAD", "\uFEAE", None, None),
    "\u0632": ("\uFEAF", "\uFEB0", None, None),
    "\u0633": ("\uFEB1", "\uFEB2", "\uFEB3", "\uFEB4"),
    "\u0634": ("\uFEB5", "\uFEB6", "\uFEB7", "\uFEB8"),
    "\u0635": ("\uFEB9", "\uFEBA", "\uFEBB", "\uFEBC"),
    "\u0636": ("\uFEBD", "\uFEBE", "\uFEBF", "\uFEC0"),
    "\u0637": ("\uFEC1", "\uFEC2", "\uFEC3", "\uFEC4"),
    "\u0638": ("\uFEC5", "\uFEC6", "\uFEC7", "\uFEC8"),
    "\u0639": ("\uFEC9", "\uFECA", "\uFECB", "\uFECC"),
    "\u063A": ("\uFECD", "\uFECE", "\uFECF", "\uFED0"),
    "\u0641": ("\uFED1", "\uFED2", "\uFED3", "\uFED4"),
    "\u0642": ("\uFED5", "\uFED6", "\uFED7", "\uFED8"),
    "\u0643": ("\uFED9", "\uFEDA", "\uFEDB", "\uFEDC"),
    "\u0644": ("\uFEDD", "\uFEDE", "\uFEDF", "\uFEE0"),
    "\u0645": ("\uFEE1", "\uFEE2", "\uFEE3", "\uFEE4"),
    "\u0646": ("\uFEE5", "\uFEE6", "\uFEE7", "\uFEE8"),
    "\u0647": ("\uFEE9", "\uFEEA", "\uFEEB", "\uFEEC"),
    "\u0648": ("\uFEED", "\uFEEE", None, None),
    "\u0649": ("\uFEEF", "\uFEF0", None, None),
    "\u064A": ("\uFEF1", "\uFEF2", "\uFEF3", "\uFEF4"),
}

_LAM_ALEF_LIGATURES: Dict[str, Tuple[str, str]] = {
    "\u0622": ("\uFEF5", "\uFEF6"),
    "\u0623": ("\uFEF7", "\uFEF8"),
    "\u0625": ("\uFEF9", "\uFEFA"),
    "\u0627": ("\uFEFB", "\uFEFC"),
}


def has_arabic(text: str) -> bool:
    """Returns True if the string contains any Arabic script characters."""
    return bool(_ARABIC_RE.search(text or ""))


def _fallback_shape_and_bidi(text: str) -> str:
    """
    Zero-dependency fallback that performs contextual Arabic glyph joining
    (Presentation Forms-B + Lam-Alef ligatures) and visual RTL reordering.
    """
    if not text or not has_arabic(text):
        return text

    chars = list(text)
    n = len(chars)

    def _can_connect_after(ch: str) -> bool:
        forms = _AR_FORMS.get(ch)
        return bool(forms and forms[2] is not None)

    def _can_connect_before(ch: str) -> bool:
        return ch in _AR_FORMS

    shaped: List[str] = []
    i = 0
    while i < n:
        ch = chars[i]
        # Handle Lam + Alef ligature
        if ch == "\u0644" and i + 1 < n and chars[i + 1] in _LAM_ALEF_LIGATURES:
            prev_connects = i > 0 and _can_connect_after(chars[i - 1])
            iso_lig, fin_lig = _LAM_ALEF_LIGATURES[chars[i + 1]]
            shaped.append(fin_lig if prev_connects else iso_lig)
            i += 2
            continue

        forms = _AR_FORMS.get(ch)
        if not forms:
            shaped.append(ch)
            i += 1
            continue

        prev_connects = i > 0 and _can_connect_after(chars[i - 1])
        next_connects = (i + 1 < n) and _can_connect_before(chars[i + 1]) and (forms[2] is not None)

        if prev_connects and next_connects and forms[3]:
            shaped.append(forms[3])
        elif prev_connects and forms[1]:
            shaped.append(forms[1])
        elif next_connects and forms[2]:
            shaped.append(forms[2])
        else:
            shaped.append(forms[0])
        i += 1

    # Segment-level visual BiDi reordering for RTL line
    tokens = re.findall(r"[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]+|[0-9.+\-*/=()]+|\s+|[^\s\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF0-9.+\-*/=()]+", "".join(shaped))
    visual_tokens = []
    for tok in reversed(tokens):
        if _ARABIC_RE.search(tok):
            visual_tokens.append(tok[::-1])
        else:
            visual_tokens.append(tok)
    return "".join(visual_tokens)


def shape_arabic_text(text: str) -> str:
    """
    Shapes Arabic text into connected presentation forms and applies Unicode BiDi
    algorithm so PIL ImageDraw.text() renders connected right-to-left Arabic cleanly.
    """
    if not text or not has_arabic(text):
        return text or ""
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display
        reshaped = arabic_reshaper.reshape(text)
        return str(get_display(reshaped))
    except Exception:
        return _fallback_shape_and_bidi(text)


_LATEX_SYMBOLS = (
    ("pm", "±"), ("mp", "∓"), ("times", "×"), ("cdot", "·"), ("div", "÷"),
    ("neq", "≠"), ("ne", "≠"), ("leq", "≤"), ("le", "≤"), ("geq", "≥"), ("ge", "≥"),
    ("notin", "∉"), ("in", "∈"), ("Rightarrow", "⇒"), ("implies", "⇒"),
    ("rightarrow", "→"), ("to", "→"), ("infty", "∞"), ("pi", "π"),
)
_SUPERSCRIPTS = {"2": "²", "3": "³", "4": "⁴"}


def latex_to_unicode(text: str, strip_checkmarks: bool = False) -> str:
    """
    Raw LaTeX to readable Unicode math, for text people read (feedback, notes). Commands
    are matched whole, so \\infty is ∞ rather than "∈fty".
    """
    if not text:
        return ""
    s = str(text).strip()
    if strip_checkmarks:
        s = re.sub(r"^[\s✓✔✗✘•:]+(?=[\+\-]?\d|[a-zA-Z\u0600-\u06FF])", "", s).strip()
        if s in ("✓", "✔", "✗", "✘"):
            return ""

    # Remove dollar delimiters and display math wrappers
    s = s.replace("$$", "").replace("$", "")
    s = re.sub(r"\\(?:left|right|displaystyle|textstyle)\b", "", s)

    # Fractions and roots
    for _ in range(3):
        s = re.sub(r"\\(?:d?frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r"(\1)/(\2)", s)
        s = re.sub(r"\\sqrt\s*\{([^{}]*)\}", r"√(\1)", s)

    for command, symbol in _LATEX_SYMBOLS:
        s = re.sub(rf"\\{command}(?![A-Za-z])", symbol, s)
    # x^2 → x², but x^23 stays x^23 and x^{2} → x²
    s = re.sub(r"\^\{?([234])\}?(?![\d}])", lambda m: _SUPERSCRIPTS[m.group(1)], s)

    # Strip remaining backslashes before command names and redundant braces
    s = re.sub(r"\\([a-zA-Z]+)", r"\1", s)
    s = s.replace("{", "").replace("}", "")
    return re.sub(r"\s+", " ", s).strip()


def format_math_for_overlay(text: str, strip_checkmarks: bool = False) -> str:
    """
    latex_to_unicode() plus Arabic shaping for drawing with PIL. The result is in visual
    order, so it is only for images: never store or display it as text.
    """
    s = latex_to_unicode(text, strip_checkmarks=strip_checkmarks)
    return shape_arabic_text(s) if has_arabic(s) else s


def _get_font(font_size: int, is_handwriting: bool = True, text: str = "") -> ImageFont.FreeTypeFont:
    """
    Loads an appropriate TrueType font. Automatically selects a high-clarity
    Arabic/Unicode font whenever `text` contains Arabic script or special math glyphs,
    avoiding handwriting fonts (like Inkfree) that lack Arabic/math glyphs.
    """
    font_size = max(10, int(font_size))
    needs_unicode = has_arabic(text) or bool(_SPECIAL_MATH_RE.search(text or ""))

    candidates: List[str] = []
    if os.getenv("OVERLAY_FONT_PATH"):
        candidates.append(os.getenv("OVERLAY_FONT_PATH"))
    if needs_unicode or not is_handwriting:
        candidates.extend([
            "C:/Windows/Fonts/tahoma.ttf",
            "C:/Windows/Fonts/tahomabd.ttf",
            "C:/Windows/Fonts/arial.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/calibri.ttf",
            # Linux: Noto and DejaVu both cover Arabic and math symbols
            "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansArabic-Regular.ttf",
            "/usr/share/fonts/noto/NotoSansArabic-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            # macOS
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/Library/Fonts/Arial Unicode.ttf",
            "/System/Library/Fonts/GeezaPro.ttc",
        ])
    else:
        candidates.extend([
            "C:/Windows/Fonts/segoepr.ttf",
            "C:/Windows/Fonts/Inkfree.ttf",
            "C:/Windows/Fonts/comic.ttf",
            "C:/Windows/Fonts/tahoma.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ])

    for c in candidates:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, font_size)
            except Exception:
                continue
    if not _FONT_WARNING_SHOWN:
        _warn_missing_font()
    try:
        return ImageFont.load_default(size=font_size)  # Pillow >= 10.1: scalable fallback
    except TypeError:
        return ImageFont.load_default()


_FONT_WARNING_SHOWN = False


def _warn_missing_font() -> None:
    global _FONT_WARNING_SHOWN
    _FONT_WARNING_SHOWN = True
    import logging
    logging.getLogger(__name__).warning(
        "No Arabic-capable font found; install fonts-noto or fonts-dejavu, or set OVERLAY_FONT_PATH."
    )


def _draw_organic_line(
    draw: ImageDraw.ImageDraw,
    points: List[Tuple[float, float]],
    color: Tuple[int, int, int, int] = INK_RED,
    width: float = 3.0
):
    """Draws a smooth line with subtle ink halo/bleed and rounded joints."""
    if len(points) < 2:
        return
    bleed_color = (color[0], color[1], color[2], max(28, color[3] // 4))
    w_bleed = max(2, int(round(width * 1.45)))
    w_core = max(1, int(round(width)))
    draw.line(points, fill=bleed_color, width=w_bleed, joint="curve")
    draw.line(points, fill=color, width=w_core, joint="curve")


def _draw_checkmark(
    draw: ImageDraw.ImageDraw,
    x: float,
    y: float,
    size: float = 35.0,
    color: Tuple[int, int, int, int] = INK_RED,
    width: float = 3.5
):
    """
    Renders an organic teacher's checkmark:
    starts with a quick downward-right hook, reaches vertex, then sweeps upward-right.
    """
    p1 = (x, y + size * 0.45)
    p2 = (x + size * 0.28, y + size * 0.88)
    p3 = (x + size * 0.65, y + size * 0.25)
    p4 = (x + size * 1.05, y - size * 0.15)

    steps = 20
    pts = []
    for i in range(steps + 1):
        t = i / steps
        if t <= 0.35:
            st = t / 0.35
            px = (1 - st) * p1[0] + st * p2[0]
            py = (1 - st) * p1[1] + st * p2[1]
        else:
            st = (t - 0.35) / 0.65
            bx = (1 - st)**2 * p2[0] + 2 * (1 - st) * st * p3[0] + st**2 * p4[0]
            by = (1 - st)**2 * p2[1] + 2 * (1 - st) * st * p3[1] + st**2 * p4[1]
            px, py = bx, by
        pts.append((px, py))

    _draw_organic_line(draw, pts, color=color, width=width)


def _draw_cross(
    draw: ImageDraw.ImageDraw,
    x: float,
    y: float,
    size: float = 30.0,
    color: Tuple[int, int, int, int] = INK_RED,
    width: float = 3.5
):
    """Renders a natural hand-drawn cross (✗) with organic tilt."""
    s1_start = (x, y)
    s1_mid = (x + size * 0.52, y + size * 0.48)
    s1_end = (x + size, y + size)
    _draw_organic_line(draw, [s1_start, s1_mid, s1_end], color=color, width=width)

    s2_start = (x + size * 0.95, y + size * 0.05)
    s2_mid = (x + size * 0.48, y + size * 0.52)
    s2_end = (x + size * 0.05, y + size * 0.95)
    _draw_organic_line(draw, [s2_start, s2_mid, s2_end], color=color, width=width)


def _draw_circle_error(
    draw: ImageDraw.ImageDraw,
    box: Tuple[float, float, float, float],
    color: Tuple[int, int, int, int] = INK_RED,
    width: float = 3.0
):
    """
    Renders an organic hand-drawn ellipse/loop around a mistake with a soft translucent
    highlight and overlapping pen tail.
    """
    xmin, ymin, xmax, ymax = box
    pad_x = max(10.0, (xmax - xmin) * 0.12)
    pad_y = max(8.0, (ymax - ymin) * 0.15)

    cx = (xmin + xmax) / 2.0
    cy = (ymin + ymax) / 2.0
    rx = (xmax - xmin) / 2.0 + pad_x
    ry = (ymax - ymin) / 2.0 + pad_y

    # Subtle translucent red tint inside error region so the mistake stands out
    draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(254, 226, 226, 48))

    num_pts = 56
    pts = []
    total_angle = 2.20 * math.pi

    # Local generator: reseeding the global one changed every other random draw in the process
    rng = random.Random(int(cx * 10 + cy))
    wobble_offsets = [rng.uniform(-1.2, 1.2) for _ in range(num_pts + 1)]

    for i in range(num_pts + 1):
        angle = (i / num_pts) * total_angle
        tilt = -0.07
        cur_rx = rx + wobble_offsets[i]
        cur_ry = ry + wobble_offsets[i]

        px0 = cur_rx * math.cos(angle)
        py0 = cur_ry * math.sin(angle)

        px = cx + px0 * math.cos(tilt) - py0 * math.sin(tilt)
        py = cy + px0 * math.sin(tilt) + py0 * math.cos(tilt)
        pts.append((px, py))

    _draw_organic_line(draw, pts, color=color, width=width)


def _draw_strikethrough(
    draw: ImageDraw.ImageDraw,
    box: Tuple[float, float, float, float],
    color: Tuple[int, int, int, int] = INK_RED,
    width: float = 3.5
):
    """Draws a natural red-pen slanted strike through an erroneous equation."""
    xmin, ymin, xmax, ymax = box
    y_mid = (ymin + ymax) / 2.0

    start_pt = (xmin - 10.0, y_mid + 2.0)
    mid_pt = ((xmin + xmax) / 2.0, y_mid - 3.0)
    end_pt = (xmax + 15.0, y_mid + 1.0)
    _draw_organic_line(draw, [start_pt, mid_pt, end_pt], color=color, width=width)


def _rects_overlap(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float], pad: float = 4.0) -> bool:
    return not (a[2] + pad < b[0] or a[0] - pad > b[2] or a[3] + pad < b[1] or a[1] - pad > b[3])


def _draw_text_pill(
    draw: ImageDraw.ImageDraw,
    text: str,
    x: float,
    y: float,
    font: ImageFont.FreeTypeFont,
    color: Tuple[int, int, int, int],
    canvas_w: int,
    canvas_h: int,
    scale: float,
    occupied: List[Tuple[float, float, float, float]],
    center_x: bool = False,
) -> Tuple[float, float, float, float]:
    """
    Draws shaped text inside a high-contrast, semi-translucent pill clamped strictly
    within the page boundaries and nudged vertically to avoid colliding with prior labels.
    """
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    pad_x = 7.0 * scale
    pad_y = 4.0 * scale

    tx = (x - tw / 2.0) if center_x else x
    margin = 10.0 * scale
    tx = max(margin + pad_x, min(canvas_w - tw - pad_x - margin, tx))
    ty = max(margin + pad_y, min(canvas_h - th - pad_y - margin, y))

    pill_rect = (tx - pad_x, ty - pad_y, tx + tw + pad_x, ty + th + pad_y)
    step_y = 10.0 * scale
    for _ in range(16):
        if not any(_rects_overlap(pill_rect, r) for r in occupied):
            break
        if ty + th + pad_y + step_y < canvas_h - margin:
            ty += step_y
        else:
            ty = max(margin + pad_y, ty - step_y)
        pill_rect = (tx - pad_x, ty - pad_y, tx + tw + pad_x, ty + th + pad_y)

    occupied.append(pill_rect)
    draw.rounded_rectangle(
        list(pill_rect),
        radius=max(4, int(6 * scale)),
        fill=(255, 251, 251, 232),
        outline=(color[0], color[1], color[2], 165),
        width=max(1, int(round(1.3 * scale))),
    )
    draw.text((tx - bbox[0], ty - bbox[1]), text, fill=color, font=font)
    return pill_rect


def _draw_score_badge(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    score_text: str,
    teacher_note: str = "",
    color: Tuple[int, int, int, int] = INK_RED,
    scale: float = 1.0,
    canvas_w: int = 1600,
    canvas_h: int = 2000,
    occupied: Optional[List[Tuple[float, float, float, float]]] = None,
):
    """
    Renders the teacher's circled final grade bubble at the top-right margin.
    Includes a soft paper backing inside the double-loop oval so the grade is crystal clear,
    and shapes Arabic teacher notes with proper RTL glyph joining.
    """
    shaped_score = format_math_for_overlay(score_text)
    shaped_note = format_math_for_overlay(teacher_note) if teacher_note else ""

    font_score = _get_font(int(36 * scale), is_handwriting=False, text=shaped_score)
    font_note = _get_font(int(20 * scale), is_handwriting=False, text=shaped_note)

    score_bbox = draw.textbbox((0, 0), shaped_score, font=font_score)
    s_w = score_bbox[2] - score_bbox[0]
    s_h = score_bbox[3] - score_bbox[1]

    rx = max(s_w / 2.0 + 24.0 * scale, 58.0 * scale)
    ry = max(s_h / 2.0 + 18.0 * scale, 44.0 * scale)

    # Clamp badge center so neither the loop nor the teacher note clips off the right/top edge
    cx = max(rx + 14.0 * scale, min(canvas_w - rx - 14.0 * scale, cx))
    cy = max(ry + 14.0 * scale, min(canvas_h - ry - 50.0 * scale, cy))

    # Soft translucent cream backing inside the score circle so underlying lines don't obscure the grade
    draw.ellipse(
        [cx - rx, cy - ry, cx + rx, cy + ry],
        fill=(255, 250, 250, 225),
    )

    score_x = cx - s_w / 2.0 - score_bbox[0]
    score_y = cy - s_h / 2.0 - score_bbox[1]
    draw.text((score_x, score_y), shaped_score, fill=color, font=font_score)

    pts_loop1 = []
    pts_loop2 = []
    num_steps = 56
    for i in range(num_steps):
        angle = (i / float(num_steps)) * 2.15 * math.pi
        px1 = cx + (rx + math.sin(angle * 3) * 1.5 * scale) * math.cos(angle)
        py1 = cy + (ry + math.cos(angle * 2) * 1.5 * scale) * math.sin(angle)
        pts_loop1.append((px1, py1))

        px2 = cx + (rx - 3.5 * scale + math.cos(angle * 2) * 1.2 * scale) * math.cos(angle - 0.18)
        py2 = cy + (ry - 2.5 * scale + math.sin(angle * 3) * 1.2 * scale) * math.sin(angle - 0.18)
        pts_loop2.append((px2, py2))

    _draw_organic_line(draw, pts_loop1, color=color, width=max(2.5, 3.2 * scale))
    _draw_organic_line(draw, pts_loop2, color=color, width=max(1.8, 2.2 * scale))

    if occupied is not None:
        occupied.append((cx - rx, cy - ry, cx + rx, cy + ry))

    if shaped_note:
        note_y = cy + ry + 10.0 * scale
        _draw_text_pill(
            draw=draw,
            text=shaped_note,
            x=cx,
            y=note_y,
            font=font_note,
            color=color,
            canvas_w=canvas_w,
            canvas_h=canvas_h,
            scale=scale,
            occupied=occupied if occupied is not None else [],
            center_x=True,
        )


def render_red_pen_overlay(
    image_input: Union[bytes, Image.Image],
    annotations: List[Dict[str, Any]],
    overall_score_badge: str = "",
    teacher_note: str = "",
    pen_color: Tuple[int, int, int, int] = INK_RED,
    canvas_scale: float = 1.0
) -> Image.Image:
    """
    Renders realistic, anti-aliased (2x supersampled) red-pen grading annotations
    onto a student paper image with full Arabic RTL shaping and clean math formatting.
    """
    if isinstance(image_input, bytes):
        base_img = Image.open(io.BytesIO(image_input)).convert("RGBA")
    else:
        base_img = image_input.copy().convert("RGBA")

    orig_w, orig_h = base_img.size

    # 2x supersampling factor for crisp anti-aliased strokes and high-DPI typography
    ss = 2
    width = orig_w * ss
    height = orig_h * ss

    overlay = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)

    ref_scale = (height / 1000.0) * canvas_scale
    base_pen_width = max(2.2 * ss, 3.2 * ref_scale)

    def to_pixels(box: Union[List[Union[int, float]], Tuple[Union[int, float], ...]]) -> Tuple[float, float, float, float]:
        if not box or len(box) < 4:
            return (0.0, 0.0, 100.0 * ss, 100.0 * ss)
        ymin, xmin, ymax, xmax = [max(0.0, min(1000.0, float(v))) for v in box[:4]]
        ymin, ymax = sorted((ymin, ymax))
        xmin, xmax = sorted((xmin, xmax))
        px_xmin = (xmin / 1000.0) * width
        px_ymin = (ymin / 1000.0) * height
        px_xmax = (xmax / 1000.0) * width
        px_ymax = (ymax / 1000.0) * height
        return (px_xmin, px_ymin, px_xmax, px_ymax)

    occupied_rects: List[Tuple[float, float, float, float]] = []

    # Render Top-Right Teacher Circled Score Bubble first so its bounding box is registered
    # in occupied_rects and step annotations never draw over the grade badge
    if overall_score_badge:
        badge_cx = width - max(115.0 * ref_scale, width * 0.16)
        badge_cy = max(72.0 * ref_scale, height * 0.08)
        _draw_score_badge(
            draw=draw,
            cx=badge_cx,
            cy=badge_cy,
            score_text=overall_score_badge,
            teacher_note=teacher_note,
            color=pen_color,
            scale=ref_scale,
            canvas_w=width,
            canvas_h=height,
            occupied=occupied_rects,
        )

    for ann in annotations or []:
        if not isinstance(ann, dict):
            continue
        ann_type = (ann.get("type") or "checkmark").lower().strip()
        raw_content = str(ann.get("content") or ann.get("corrected_text") or "").strip()
        box = ann.get("box") or [0, 0, 0, 0]
        if not isinstance(box, (list, tuple)) or len(box) < 4:
            continue
        px_box = to_pixels(box)
        b_xmin, b_ymin, b_xmax, b_ymax = px_box

        mid_x = (b_xmin + b_xmax) / 2.0
        b_h = max(22.0 * ref_scale, b_ymax - b_ymin)

        if ann_type in ("checkmark", "check", "correct"):
            clean_tag = format_math_for_overlay(raw_content, strip_checkmarks=True)
            chk_size = min(max(26.0 * ref_scale, b_h * 0.65), 48.0 * ref_scale)
            chk_x = min(b_xmax + 14.0 * ref_scale, width - chk_size - 95.0 * ref_scale)
            chk_x = max(12.0 * ref_scale, chk_x)
            chk_y = max(12.0 * ref_scale, b_ymin + (b_h - chk_size) * 0.35)
            chk_rect = (chk_x, chk_y - chk_size * 0.2, chk_x + chk_size * 1.1, chk_y + chk_size)
            for r in occupied_rects:
                if _rects_overlap(chk_rect, r, pad=6.0 * ref_scale):
                    if b_xmax + chk_size * 1.2 < r[0]:
                        chk_x = max(12.0 * ref_scale, r[0] - chk_size * 1.2 - 10.0 * ref_scale)
                    else:
                        chk_y = min(height - chk_size - 14.0 * ref_scale, r[3] + 12.0 * ref_scale)
                    chk_rect = (chk_x, chk_y - chk_size * 0.2, chk_x + chk_size * 1.1, chk_y + chk_size)
            occupied_rects.append(chk_rect)
            _draw_checkmark(draw, chk_x, chk_y, size=chk_size, color=pen_color, width=base_pen_width)

            if clean_tag:
                font_tag = _get_font(int(19 * ref_scale), is_handwriting=False, text=clean_tag)
                _draw_text_pill(
                    draw=draw,
                    text=clean_tag,
                    x=chk_x + chk_size + 8.0 * ref_scale,
                    y=chk_y + 2.0 * ref_scale,
                    font=font_tag,
                    color=pen_color,
                    canvas_w=width,
                    canvas_h=height,
                    scale=ref_scale,
                    occupied=occupied_rects,
                )

        elif ann_type in ("cross", "incorrect", "x"):
            clean_tag = format_math_for_overlay(raw_content, strip_checkmarks=True)
            cross_size = min(max(24.0 * ref_scale, b_h * 0.60), 44.0 * ref_scale)
            cross_x = min(b_xmax + 14.0 * ref_scale, width - cross_size - 95.0 * ref_scale)
            cross_x = max(12.0 * ref_scale, cross_x)
            cross_y = max(12.0 * ref_scale, b_ymin + (b_h - cross_size) * 0.35)
            cross_rect = (cross_x, cross_y, cross_x + cross_size, cross_y + cross_size)
            for r in occupied_rects:
                if _rects_overlap(cross_rect, r, pad=6.0 * ref_scale):
                    if b_xmax + cross_size * 1.2 < r[0]:
                        cross_x = max(12.0 * ref_scale, r[0] - cross_size * 1.2 - 10.0 * ref_scale)
                    else:
                        cross_y = min(height - cross_size - 14.0 * ref_scale, r[3] + 12.0 * ref_scale)
                    cross_rect = (cross_x, cross_y, cross_x + cross_size, cross_y + cross_size)
            occupied_rects.append(cross_rect)
            _draw_cross(draw, cross_x, cross_y, size=cross_size, color=pen_color, width=base_pen_width)

            if clean_tag:
                font_tag = _get_font(int(19 * ref_scale), is_handwriting=False, text=clean_tag)
                _draw_text_pill(
                    draw=draw,
                    text=clean_tag,
                    x=cross_x + cross_size + 8.0 * ref_scale,
                    y=cross_y + 2.0 * ref_scale,
                    font=font_tag,
                    color=pen_color,
                    canvas_w=width,
                    canvas_h=height,
                    scale=ref_scale,
                    occupied=occupied_rects,
                )

        elif ann_type in ("circle_error", "circle", "loop"):
            _draw_circle_error(draw, px_box, color=pen_color, width=base_pen_width)
            clean_corr = format_math_for_overlay(raw_content, strip_checkmarks=True)
            if clean_corr:
                font_corr = _get_font(int(20 * ref_scale), is_handwriting=False, text=clean_corr)
                pill_rect = _draw_text_pill(
                    draw=draw,
                    text=clean_corr,
                    x=mid_x,
                    y=max(12.0 * ref_scale, b_ymin - 34.0 * ref_scale),
                    font=font_corr,
                    color=pen_color,
                    canvas_w=width,
                    canvas_h=height,
                    scale=ref_scale,
                    occupied=occupied_rects,
                    center_x=True,
                )
                _draw_organic_line(
                    draw,
                    [(mid_x, pill_rect[3] + 2.0 * ref_scale), (mid_x, max(pill_rect[3] + 4.0 * ref_scale, b_ymin - 2.0 * ref_scale))],
                    color=pen_color,
                    width=base_pen_width * 0.65,
                )

        elif ann_type in ("strikethrough", "strike", "cross_out"):
            _draw_strikethrough(draw, px_box, color=pen_color, width=base_pen_width)
            clean_corr = format_math_for_overlay(raw_content, strip_checkmarks=True)
            if clean_corr:
                font_corr = _get_font(int(20 * ref_scale), is_handwriting=False, text=clean_corr)
                _draw_text_pill(
                    draw=draw,
                    text=clean_corr,
                    x=mid_x,
                    y=max(12.0 * ref_scale, b_ymin - 32.0 * ref_scale),
                    font=font_corr,
                    color=pen_color,
                    canvas_w=width,
                    canvas_h=height,
                    scale=ref_scale,
                    occupied=occupied_rects,
                    center_x=True,
                )

        elif ann_type in ("correction", "fix_symbol", "replace"):
            clean_corr = format_math_for_overlay(raw_content, strip_checkmarks=True)
            if clean_corr:
                font_corr = _get_font(int(20 * ref_scale), is_handwriting=False, text=clean_corr)
                _draw_text_pill(
                    draw=draw,
                    text=clean_corr,
                    x=mid_x,
                    y=max(12.0 * ref_scale, b_ymin - 34.0 * ref_scale),
                    font=font_corr,
                    color=pen_color,
                    canvas_w=width,
                    canvas_h=height,
                    scale=ref_scale,
                    occupied=occupied_rects,
                    center_x=True,
                )
                caret_x = mid_x
                caret_y = b_ymin
                _draw_organic_line(
                    draw,
                    [
                        (caret_x - 6.0 * ref_scale, caret_y),
                        (caret_x, caret_y - 8.0 * ref_scale),
                        (caret_x + 6.0 * ref_scale, caret_y),
                    ],
                    color=pen_color,
                    width=base_pen_width * 0.75,
                )

        elif ann_type in ("comment", "margin_note", "note", "score_tag"):
            clean_comment = format_math_for_overlay(raw_content, strip_checkmarks=False)
            if clean_comment:
                font_comment = _get_font(int(19 * ref_scale), is_handwriting=False, text=clean_comment)
                target_x = min(width - 210.0 * ref_scale, max(15.0 * ref_scale, b_xmax + 18.0 * ref_scale))
                target_y = max(12.0 * ref_scale, b_ymin)
                _draw_text_pill(
                    draw=draw,
                    text=clean_comment,
                    x=target_x,
                    y=target_y,
                    font=font_comment,
                    color=pen_color,
                    canvas_w=width,
                    canvas_h=height,
                    scale=ref_scale,
                    occupied=occupied_rects,
                )

    # Downsample 2x supersampled overlay with LANCZOS for smooth anti-aliased edges
    resample_filter = getattr(Image, "Resampling", Image).LANCZOS
    smooth_overlay = overlay.resize((orig_w, orig_h), resample=resample_filter)

    composite = Image.alpha_composite(base_img, smooth_overlay).convert("RGB")
    return composite


def render_red_pen_overlay_bytes(
    image_input: Union[bytes, Image.Image],
    annotations: List[Dict[str, Any]],
    overall_score_badge: str = "",
    teacher_note: str = "",
    format: str = "PNG",
    quality: int = 95
) -> bytes:
    """Helper that renders the red-pen overlay and exports directly as bytes."""
    composite = render_red_pen_overlay(
        image_input=image_input,
        annotations=annotations,
        overall_score_badge=overall_score_badge,
        teacher_note=teacher_note
    )
    buf = io.BytesIO()
    if format.upper() == "JPEG":
        composite.save(buf, format="JPEG", quality=quality)
    else:
        composite.save(buf, format="PNG")
    return buf.getvalue()
