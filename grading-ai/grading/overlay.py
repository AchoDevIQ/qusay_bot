"""
Graded overlay renderer: draws the grading verdict for each rubric step directly
on the student's submitted page.

Pipeline (CPU only, zero tokens):
1. Rebuild the exact page frame the OCR model saw (deskew_and_enhance_page is deterministic).
2. Detect handwritten text lines with OpenCV (ruled notebook lines removed first).
3. Place every OCR step: the vision model's normalized bbox is snapped to the detected
   line(s) it covers; steps without a bbox take the next free line in reading order.
4. Match each graded rubric step to the OCR line it was graded from
   (exact text -> SymPy equivalence -> fuzzy similarity).
5. Render: tinted highlight + anti-aliased status mark + points beside each step, a score header,
   and a high-DPI TrueType side panel listing every rubric step (with full Arabic RTL & math support).
"""
import difflib
import re
import textwrap
from typing import Any, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw

from preprocessing.pipeline import deskew_and_enhance_page
from grading.red_pen_renderer import (
    _get_font,
    format_math_for_overlay,
    has_arabic,
)

# BGR colors per grading status
STATUS_STYLE = {
    "correct": {"color": (67, 160, 46), "label": "Correct"},
    "partially_correct": {"color": (0, 165, 245), "label": "Partial"},
    "propagated_error": {"color": (0, 140, 230), "label": "Carried error"},
    "incorrect": {"color": (48, 48, 220), "label": "Incorrect"},
    "uncertain": {"color": (170, 90, 150), "label": "Needs review"},
    "not_attempted": {"color": (140, 140, 140), "label": "Missing"},
}
UNMATCHED_COLOR = (175, 175, 175)

MIN_PAGE_WIDTH = 1200     # upscale small pages so labels stay legible
PANEL_WIDTH = 440
HEADER_HEIGHT = 68
FONT = cv2.FONT_HERSHEY_SIMPLEX
MATCH_THRESHOLD = 0.55

Box = Tuple[int, int, int, int]  # x0, y0, x1, y1 in page pixels


# ─────────────────────────────────────────────────────────────────────────────
# Input normalization
# ─────────────────────────────────────────────────────────────────────────────

def _as_dict(obj: Any) -> Dict[str, Any]:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    return dict(getattr(obj, "__dict__", {}))


def _step_dicts(steps: Sequence[Any]) -> List[Dict[str, Any]]:
    out = []
    for s in steps or []:
        d = _as_dict(s)
        out.append({
            "section": d.get("section", ""),
            "status": d.get("status", "uncertain"),
            "points_awarded": float(d.get("points_awarded", 0.0) or 0.0),
            "points_possible": float(d.get("points_possible", 0.0) or 0.0),
            "reason": d.get("reason", "") or "",
            "student": d.get("student", "") or "",
            "student_lines": list(d.get("student_lines") or []),
            "page_hint": d.get("page_hint", ""),
        })
    return out


def _region_dicts(regions: Sequence[Any]) -> List[Dict[str, Any]]:
    out = []
    for r in regions or []:
        d = _as_dict(r)
        content = (d.get("content") or d.get("text") or "").strip()
        if content:
            out.append({"content": content, "bbox": list(d.get("bbox") or [])})
    return out


def _ascii(text: str) -> str:
    """Fallback ASCII cleaner for Hershey-only contexts."""
    text = re.sub(r"\\(?:frac|dfrac)\{([^{}]*)\}\{([^{}]*)\}", r"(\1)/(\2)", text or "")
    text = re.sub(r"\\sqrt\{([^{}]*)\}", r"sqrt(\1)", text)
    text = text.replace("\\pm", "+/-").replace("\\cdot", "*").replace("\\times", "x")
    text = re.sub(r"\\[a-zA-Z]+", "", text).replace("{", "").replace("}", "")
    text = text.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", text).strip()


# ─────────────────────────────────────────────────────────────────────────────
# Page geometry
# ─────────────────────────────────────────────────────────────────────────────

def _ink_mask(gray: np.ndarray) -> np.ndarray:
    """Binary handwriting mask with long ruled/margin lines removed."""
    h, w = gray.shape[:2]
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 15)
    horiz = cv2.morphologyEx(binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(40, w // 6), 1)))
    vert = cv2.morphologyEx(binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(40, h // 6))))
    ink = cv2.subtract(binary, cv2.bitwise_or(horiz, vert))
    return cv2.medianBlur(ink, 3)


def detect_text_lines(ink: np.ndarray) -> List[Tuple[int, int]]:
    """Horizontal bands (y0, y1) that contain handwriting, top to bottom."""
    h, w = ink.shape[:2]
    profile = (ink > 0).sum(axis=1).astype(np.float32)
    k = max(3, h // 150)
    profile = np.convolve(profile, np.ones(k, dtype=np.float32) / k, mode="same")
    if profile.max() <= 0:
        return []
    threshold = max(profile.max() * 0.08, w * 0.004)
    active = profile > threshold

    bands: List[List[int]] = []
    y = 0
    while y < h:
        if active[y]:
            start = y
            while y < h and active[y]:
                y += 1
            bands.append([start, y])
        y += 1

    # Merge bands split by small gaps (descenders, fraction bars), drop specks
    merge_gap = max(4, int(h * 0.008))
    merged: List[List[int]] = []
    for b in bands:
        if merged and b[0] - merged[-1][1] <= merge_gap:
            merged[-1][1] = b[1]
        else:
            merged.append(b)
    min_height = max(6, int(h * 0.008))
    return [(a, b) for a, b in merged if b - a >= min_height]


def _ink_x_extent(ink: np.ndarray, y0: int, y1: int, x_lo: int, x_hi: int) -> Optional[Tuple[int, int]]:
    """Horizontal span of the handwriting in a band; percentiles ignore page-edge shadows and specks."""
    _, xs = np.nonzero(ink[y0:y1, x_lo:x_hi])
    if xs.size < 20:
        return None
    return x_lo + int(np.percentile(xs, 1.5)), x_lo + int(np.percentile(xs, 98.5)) + 1


def locate_regions(ink: np.ndarray, regions: List[Dict[str, Any]]) -> List[Optional[Box]]:
    """Pixel box for every OCR region, snapped to detected handwriting lines."""
    h, w = ink.shape[:2]
    bands = detect_text_lines(ink)
    used = set()
    boxes: List[Optional[Box]] = []
    last_y = 0
    # Reading-order assignment is only trustworthy when OCR lines and ink lines
    # correspond exactly one-to-one. Even one extra ink line (typically the
    # student's name at the top) would shift every mark, so otherwise leave
    # unlocated steps unplaced rather than marking the wrong line.
    unboxed = sum(1 for r in regions if len(r.get("bbox") or []) != 4)
    allow_sequential = unboxed > 0 and len(bands) == len(regions)

    for region in regions:
        bbox = region.get("bbox") or []
        box: Optional[Box] = None
        if len(bbox) == 4:
            bx0, by0, bx1, by1 = int(bbox[0] * w), int(bbox[1] * h), int(bbox[2] * w), int(bbox[3] * h)
            margin = max(4, int((by1 - by0) * 0.3))
            hits = [i for i, (a, b) in enumerate(bands)
                    if by0 - margin <= (a + b) / 2 <= by1 + margin]
            if hits:
                y0, y1 = bands[hits[0]][0], bands[hits[-1]][1]
                used.update(hits)
            else:
                y0, y1 = by0, by1
            pad_x = int(w * 0.05)
            extent = _ink_x_extent(ink, y0, y1, max(0, bx0 - pad_x), min(w, bx1 + pad_x))
            x0, x1 = extent if extent else (bx0, bx1)
            box = (x0, y0, x1, y1)
        elif allow_sequential:
            # No location from the model: take the next free line below the previous step
            for i, (a, b) in enumerate(bands):
                if i not in used and a >= last_y - 2:
                    used.add(i)
                    extent = _ink_x_extent(ink, a, b, 0, w) or (0, w)
                    box = (extent[0], a, extent[1], b)
                    break
        if box:
            pad = 6
            box = (max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad))
            last_y = box[3]
        boxes.append(box)
    return boxes


# ─────────────────────────────────────────────────────────────────────────────
# Step <-> OCR line matching
# ─────────────────────────────────────────────────────────────────────────────

def _norm_text(text: str) -> str:
    try:
        from math_engine.normalizer import normalize_expr
        normalized = normalize_expr(text)
    except Exception:
        normalized = text
    return re.sub(r"\s+", "", (normalized or text).lower())


def _text_similarity(step_text: str, region_text: str) -> float:
    a, b = _norm_text(step_text), _norm_text(region_text)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    # A step quoted as part of a longer line (chained work) still belongs to that line
    if len(a) >= 3 and (a in b or b in a):
        ratio = max(ratio, 0.75)
    return ratio


def _symbolic_similarity(step_text: str, region_text: str) -> float:
    """Equivalent-but-rewritten lines; SymPy is cached via lru_cache."""
    try:
        from math_engine.verifier import verify_equivalence
        verdict = verify_equivalence(step_text, region_text)
        if verdict.equivalent is True and verdict.status == "certain":
            return 0.9
    except Exception:
        pass
    return 0.0


def _similarity(step_text: str, region_text: str) -> float:
    score = _text_similarity(step_text, region_text)
    return score if score >= MATCH_THRESHOLD else max(score, _symbolic_similarity(step_text, region_text))


def match_steps_to_regions(steps: List[Dict[str, Any]], regions: List[Dict[str, Any]]) -> Dict[int, List[int]]:
    """step index -> region indices it was graded from (greedy, best score first)."""
    candidates = []
    for si, step in enumerate(steps):
        texts = [t for t in [step["student"], *step["student_lines"]] if t and t.strip()]
        if step["status"] == "not_attempted" or not texts:
            continue
        found = False
        for ri, region in enumerate(regions):
            score = max((_text_similarity(t, region["content"]) for t in texts), default=0.0)
            if score >= MATCH_THRESHOLD:
                candidates.append((score, si, ri))
                found = True
        if not found:
            for ri, region in enumerate(regions):
                score = max((_symbolic_similarity(t, region["content"]) for t in texts), default=0.0)
                if score >= MATCH_THRESHOLD:
                    candidates.append((score, si, ri))
    candidates.sort(key=lambda c: (-c[0], c[1], c[2]))

    mapping: Dict[int, List[int]] = {}
    taken = set()
    for score, si, ri in candidates:
        if ri in taken or si in mapping:
            continue
        mapping[si] = [ri]
        taken.add(ri)
    return mapping


# ─────────────────────────────────────────────────────────────────────────────
# Drawing primitives
# ─────────────────────────────────────────────────────────────────────────────

def _draw_mark(img: np.ndarray, status: str, center: Tuple[int, int], size: int, color) -> None:
    cx, cy = center
    s = size // 2
    t = max(2, size // 9)
    if status == "correct":
        pts = np.array([[cx - s, cy], [cx - s // 4, cy + s * 2 // 3], [cx + s, cy - s * 2 // 3]], np.int32)
        cv2.polylines(img, [pts], False, color, t + 1, cv2.LINE_AA)
    elif status in ("partially_correct", "propagated_error"):
        pts = np.array([[cx - s, cy], [cx - s // 4, cy + s * 2 // 3], [cx + s, cy - s * 2 // 3]], np.int32)
        cv2.polylines(img, [pts], False, color, t + 1, cv2.LINE_AA)
        cv2.line(img, (cx - s // 2, cy + s), (cx + s // 2, cy - s), color, t, cv2.LINE_AA)
    elif status == "incorrect":
        cv2.line(img, (cx - s, cy - s), (cx + s, cy + s), color, t + 1, cv2.LINE_AA)
        cv2.line(img, (cx - s, cy + s), (cx + s, cy - s), color, t + 1, cv2.LINE_AA)
    elif status == "not_attempted":
        cv2.circle(img, center, s, color, t, cv2.LINE_AA)
        cv2.line(img, (cx - s // 2, cy), (cx + s // 2, cy), color, t, cv2.LINE_AA)
    else:
        (tw, th), _ = cv2.getTextSize("?", FONT, size / 26.0, t)
        cv2.putText(img, "?", (cx - tw // 2, cy + th // 2), FONT, size / 26.0, color, t, cv2.LINE_AA)


def _tint(img: np.ndarray, box: Box, color, alpha: float = 0.16) -> None:
    x0, y0, x1, y1 = box
    roi = img[y0:y1, x0:x1]
    if roi.size == 0:
        return
    layer = np.full_like(roi, color)
    img[y0:y1, x0:x1] = cv2.addWeighted(layer, alpha, roi, 1 - alpha, 0)


def _label(img: np.ndarray, text: str, org: Tuple[int, int], color, scale: float = 0.55, bg=(255, 255, 255)) -> None:
    (tw, th), base = cv2.getTextSize(text, FONT, scale, 1)
    x, y = org
    cv2.rectangle(img, (x - 3, y - th - 4), (x + tw + 3, y + base + 2), bg, -1)
    cv2.putText(img, text, (x, y), FONT, scale, color, 1, cv2.LINE_AA)


def _fmt_pts(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".") if v != int(v) else str(int(v))


def _bgr_to_rgb(bgr: Tuple[int, int, int]) -> Tuple[int, int, int]:
    return (bgr[2], bgr[1], bgr[0])


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def compute_overlay_layout(image_bytes: bytes, regions: Sequence[Any], steps: Sequence[Any]) -> Dict[str, Any]:
    """
    Machine-readable overlay: where each rubric step sits on the preprocessed page.
    Boxes are normalized [x0, y0, x1, y1] so clients (e.g. Flutter) can draw natively.
    """
    page = cv2.imdecode(np.frombuffer(deskew_and_enhance_page(image_bytes, max_dimension=1800), np.uint8), cv2.IMREAD_COLOR)
    if page is None:
        raise ValueError("Could not decode the submitted image.")
    h, w = page.shape[:2]
    region_list = _region_dicts(regions)
    step_list = _step_dicts(steps)
    ink = _ink_mask(cv2.cvtColor(page, cv2.COLOR_BGR2GRAY))
    boxes = locate_regions(ink, region_list)
    mapping = match_steps_to_regions(step_list, region_list)

    items = []
    for si, step in enumerate(step_list):
        located = [boxes[ri] for ri in mapping.get(si, []) if boxes[ri]]
        box = None
        if located:
            box = (min(b[0] for b in located), min(b[1] for b in located),
                   max(b[2] for b in located), max(b[3] for b in located))
        items.append({
            **step,
            "region_indices": mapping.get(si, []),
            "box": [box[0] / w, box[1] / h, box[2] / w, box[3] / h] if box else None,
        })
    matched = {ri for ris in mapping.values() for ri in ris}
    unmatched = [
        {"content": region_list[ri]["content"],
         "box": [b[0] / w, b[1] / h, b[2] / w, b[3] / h]}
        for ri, b in enumerate(boxes) if b and ri not in matched
    ]
    return {"width": w, "height": h, "steps": items, "unmatched_lines": unmatched, "_page": page}


def render_overlay(
    image_bytes: bytes,
    regions: Sequence[Any],
    steps: Sequence[Any],
    *,
    score: Optional[float] = None,
    max_score: Optional[float] = None,
    title: str = "",
    requires_review: bool = False,
    page_label: str = "",
    layout: Optional[Dict[str, Any]] = None,
) -> bytes:
    """Render the graded overlay for one page and return high-DPI PNG bytes with Arabic & math support."""
    layout = dict(layout or compute_overlay_layout(image_bytes, regions, steps))
    page = layout.pop("_page")
    h, w = page.shape[:2]
    scale = max(1.0, MIN_PAGE_WIDTH / float(w))
    if scale > 1.0:
        page = cv2.resize(page, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    ph, pw = page.shape[:2]

    def to_px(nbox):
        return (int(nbox[0] * pw), int(nbox[1] * ph), int(nbox[2] * pw), int(nbox[3] * ph))

    # Lines the grader did not tie to a rubric step: thin neutral outline only
    for line in layout["unmatched_lines"]:
        x0, y0, x1, y1 = to_px(line["box"])
        cv2.rectangle(page, (x0, y0), (x1, y1), UNMATCHED_COLOR, 1, cv2.LINE_AA)

    # Graded steps: tint + border + mark + points, marks in a lane right of the ink
    page_step_labels: List[Tuple[str, int, int, Tuple[int, int, int]]] = []
    for idx, item in enumerate(layout["steps"]):
        if not item["box"]:
            continue
        style = STATUS_STYLE.get(item["status"], STATUS_STYLE["uncertain"])
        color = style["color"]
        x0, y0, x1, y1 = to_px(item["box"])
        _tint(page, (x0, y0, x1, y1), color)
        cv2.rectangle(page, (x0, y0), (x1, y1), color, 2, cv2.LINE_AA)
        mark_size = int(min(max(y1 - y0, 26), 46))
        mark_x = min(pw - mark_size, x1 + mark_size // 2 + 8)
        _draw_mark(page, item["status"], (mark_x, (y0 + y1) // 2), mark_size, color)
        page_step_labels.append((
            f"S{idx + 1}  {_fmt_pts(item['points_awarded'])}/{_fmt_pts(item['points_possible'])}",
            x0 + 2,
            max(4, y0 - 22) + HEADER_HEIGHT,
            _bgr_to_rgb(color),
        ))

    # Canvas: header on top, step panel on the right
    canvas_h = max(ph, 540) + HEADER_HEIGHT
    canvas = np.full((canvas_h, pw + PANEL_WIDTH, 3), 255, np.uint8)
    canvas[HEADER_HEIGHT:HEADER_HEIGHT + ph, :pw] = page
    cv2.rectangle(canvas, (0, 0), (pw + PANEL_WIDTH, HEADER_HEIGHT), (41, 30, 15), -1)
    cv2.line(canvas, (pw, HEADER_HEIGHT), (pw, canvas_h), (226, 232, 240), 2)

    if score is None:
        score = sum(i["points_awarded"] for i in layout["steps"])
    if max_score is None:
        max_score = sum(i["points_possible"] for i in layout["steps"])
    pct = (score / max_score * 100.0) if max_score else 0.0

    # Draw status icons on canvas first (OpenCV anti-aliased polylines)
    px0 = pw + 18
    y_cursor = HEADER_HEIGHT + 58
    row_positions: List[Tuple[int, int]] = []
    for idx, item in enumerate(layout["steps"]):
        if y_cursor > canvas_h - 95:
            break
        style = STATUS_STYLE.get(item["status"], STATUS_STYLE["uncertain"])
        _draw_mark(canvas, item["status"], (px0 + 12, y_cursor + 10), 20, style["color"])
        row_positions.append((idx, y_cursor))
        reason_raw = item.get("reason") or ""
        wrapped_lines = textwrap.wrap(reason_raw, 46)[:2] if reason_raw else []
        y_cursor += 28 + len(wrapped_lines) * 20

    # Legend marks
    ly = canvas_h - 48
    lx = px0
    legend_positions: List[Tuple[str, int, int]] = []
    for status in ("correct", "partially_correct", "incorrect", "not_attempted", "uncertain"):
        style = STATUS_STYLE[status]
        _draw_mark(canvas, status, (lx + 9, ly), 15, style["color"])
        legend_positions.append((style["label"], lx + 22, ly - 8))
        lx += 26 + len(style["label"]) * 8 + 12
        if lx > pw + PANEL_WIDTH - 95:
            lx, ly = px0, ly + 22

    # Switch to PIL TrueType rendering for crisp Unicode, Arabic RTL, and math typography
    pil_img = Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil_img)

    font_header = _get_font(26, is_handwriting=False, text="0/0")
    font_sub = _get_font(17, is_handwriting=False, text=title or page_label)
    font_badge = _get_font(14, is_handwriting=False, text="NEEDS TEACHER REVIEW")
    font_panel_title = _get_font(20, is_handwriting=False, text="Step-by-step grading")
    font_row = _get_font(16, is_handwriting=False, text="S1 Correct")
    font_legend = _get_font(13, is_handwriting=False, text="Correct")

    header_str = f"{_fmt_pts(score)} / {_fmt_pts(max_score)}  ({pct:.0f}%)"
    draw.text((18, 18), header_str, fill=(255, 255, 255), font=font_header)
    hdr_bbox = draw.textbbox((18, 18), header_str, font=font_header)

    sub_parts = [format_math_for_overlay(t) for t in (title, page_label) if t and t.strip()]
    sub_str = "  •  ".join(sub_parts)
    if sub_str:
        draw.text((hdr_bbox[2] + 22, 23), sub_str, fill=(226, 232, 240), font=font_sub)

    if requires_review:
        badge_txt = "NEEDS TEACHER REVIEW"
        b_bbox = draw.textbbox((0, 0), badge_txt, font=font_badge)
        bw = b_bbox[2] - b_bbox[0]
        bh = b_bbox[3] - b_bbox[1]
        bx = pw + PANEL_WIDTH - bw - 26
        draw.rounded_rectangle([bx - 10, 16, bx + bw + 10, 16 + bh + 16], radius=5, fill=(230, 140, 0))
        draw.text((bx, 22), badge_txt, fill=(255, 255, 255), font=font_badge)

    draw.text((px0, HEADER_HEIGHT + 18), "Step-by-step grading", fill=(15, 30, 41), font=font_panel_title)

    for tag_str, tx, ty, rgb_col in page_step_labels:
        tb = draw.textbbox((0, 0), tag_str, font=font_legend)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        draw.rounded_rectangle([tx - 4, ty - 2, tx + tw + 6, ty + th + 4], radius=3, fill=(255, 255, 255), outline=rgb_col, width=1)
        draw.text((tx + 1 - tb[0], ty + 1 - tb[1]), tag_str, fill=rgb_col, font=font_legend)

    for idx, y_row in row_positions:
        item = layout["steps"][idx]
        style = STATUS_STYLE.get(item["status"], STATUS_STYLE["uncertain"])
        rgb_col = _bgr_to_rgb(style["color"])
        row_str = f"S{idx + 1}  {style['label']}  {_fmt_pts(item['points_awarded'])}/{_fmt_pts(item['points_possible'])}"
        if not item["box"] and item["status"] != "not_attempted":
            row_str += f"  ({item['page_hint']})" if item.get("page_hint") else "  (not located)"
        draw.text((px0 + 30, y_row), row_str, fill=rgb_col, font=font_row)

        reason_raw = (item.get("reason") or "").strip()
        if reason_raw:
            font_reason = _get_font(14, is_handwriting=False, text=reason_raw)
            for l_idx, line in enumerate(textwrap.wrap(reason_raw, 46)[:2]):
                shaped_line = format_math_for_overlay(line)
                draw.text((px0 + 30, y_row + 22 + l_idx * 19), shaped_line, fill=(75, 85, 99), font=font_reason)

    for lbl_txt, lx_pos, ly_pos in legend_positions:
        draw.text((lx_pos, ly_pos), lbl_txt, fill=(70, 70, 70), font=font_legend)

    final_bgr = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    ok, encoded = cv2.imencode(".png", final_bgr)
    if not ok:
        raise ValueError("Failed to encode overlay image.")
    return encoded.tobytes()


def render_question_overlays(
    pages: Sequence[Dict[str, Any]],
    steps: Sequence[Any],
    **kwargs,
) -> List[bytes]:
    """
    Multi-page question: `pages` is a list of {"image_bytes", "regions"}. Each rubric
    step is drawn on the page whose OCR line it matches best; the panel lists all steps.
    """
    step_list = _step_dicts(steps)
    if len(pages) <= 1:
        return [render_overlay(p["image_bytes"], p.get("regions", []), step_list, **kwargs) for p in pages]

    # Assign each step to its best page, then hide its box on the other pages
    best_page = {}
    for si, step in enumerate(step_list):
        texts = [t for t in [step["student"], *step["student_lines"]] if t]
        best = (0.0, None)
        for pi, page in enumerate(pages):
            for region in _region_dicts(page.get("regions", [])):
                score = max((_similarity(t, region["content"]) for t in texts), default=0.0)
                if score > best[0]:
                    best = (score, pi)
        best_page[si] = best[1]

    images = []
    for pi, page in enumerate(pages):
        page_steps = []
        for si, step in enumerate(step_list):
            # Steps belonging to another page keep their panel row but get no text to match
            owner = best_page.get(si)
            if owner == pi:
                page_steps.append(step)
            else:
                hint = f"on page {owner + 1}" if owner is not None else ""
                page_steps.append({**step, "student": "", "student_lines": [], "page_hint": hint})
        images.append(render_overlay(page["image_bytes"], page.get("regions", []), page_steps,
                                     page_label=f"Page {pi + 1} of {len(pages)}", **kwargs))
    return images
