"""
Slim HTTP service that lets the QMath Telegram bot use the Math-Grading engine.

The bot stays the source of truth: it sends each question's rubric (teacher steps
and points) together with the student's pages, and gets back a suggested mark per
step. Nothing is stored here, so the service keeps no student data.

Every request needs the header  X-Bot-Key: <BOT_KEY>.  With BOT_KEY unset the
service refuses everything, so a deploy without the secret is never open.

Engine source: https://github.com/Muammal/Math-Grading (see UPSTREAM.md).
"""
import base64
import hmac
import os
from typing import List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from grading_service import extract_student_steps_from_pages, grade_single_question
from llm.router import USAGE_COLLECTOR, any_credentials, complete_vision_json

MAX_IMAGES = 12
MAX_IMAGE_BYTES = 8 * 1024 * 1024

app = FastAPI(title="QMath grading engine", docs_url=None, redoc_url=None, openapi_url=None)


def check_key(x_bot_key: Optional[str] = Header(default=None)) -> None:
    want = os.getenv("BOT_KEY", "").strip()
    if not want or not x_bot_key or not hmac.compare_digest(want.encode(), x_bot_key.strip().encode()):
        raise HTTPException(status_code=401, detail="bad key")


class Step(BaseModel):
    text: str = ""
    points: float = Field(ge=0)
    objective: str = ""


class GradeReq(BaseModel):
    max_points: float = Field(gt=0)
    steps: List[Step] = Field(min_length=1)
    images: List[str] = Field(default_factory=list)  # base64 pages of the student's answer
    strictness: str = "standard"


class RubricReq(BaseModel):
    max_points: float = Field(gt=0)
    images: List[str] = []  # base64 pages of the teacher's solution for this question
    pdf: Optional[str] = None  # or: base64 PDF of the whole exam's model solution...
    question: Optional[int] = None  # ...and the question number to take from it


MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_PDF_PAGES = 20


def pdf_pages(raw: str) -> List[bytes]:
    """Render each page of the solution PDF to PNG (about 130 dpi, enough to read handwriting)."""
    import fitz  # PyMuPDF
    if "," in raw[:100]:
        raw = raw.split(",", 1)[1]
    try:
        data = base64.b64decode(raw, validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail="bad pdf")
    if not data or len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail="bad pdf size")
    doc = fitz.open(stream=data, filetype="pdf")
    if doc.page_count > MAX_PDF_PAGES:
        raise HTTPException(status_code=400, detail="pdf has too many pages")
    return [page.get_pixmap(dpi=130).tobytes("png") for page in doc]


def decode_images(raw: List[str]) -> List[bytes]:
    if len(raw) > MAX_IMAGES:
        raise HTTPException(status_code=400, detail="too many images")
    out = []
    for s in raw:
        if "," in s[:100]:
            s = s.split(",", 1)[1]
        try:
            b = base64.b64decode(s, validate=False)
        except Exception:
            raise HTTPException(status_code=400, detail="bad image")
        if not b or len(b) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=400, detail="bad image size")
        out.append(b)
    return out


def split_points(n: int, total: float) -> List[float]:
    """Whole points shared as evenly as possible; the remainder goes to the last steps."""
    if n <= 0:
        return []
    whole = int(round(total))
    if whole < n:
        return [round(total / n, 2)] * n
    base, extra = divmod(whole, n)
    return [float(base + (1 if i >= n - extra else 0)) for i in range(n)]


def start_usage() -> list:
    bucket: list = []
    USAGE_COLLECTOR.set(bucket)
    return bucket


def usage_report(bucket: list) -> list:
    """Tokens per model for this request; the bot turns them into money with its own prices."""
    out: dict = {}
    for u in bucket:
        row = out.setdefault(u.model, {"model": u.model, "calls": 0, "input": 0, "output": 0})
        row["calls"] += 1
        row["input"] += int(u.input_tokens or 0)
        row["output"] += int(u.output_tokens or 0)
    return list(out.values())


@app.get("/health")
async def health():
    return {"ok": True, "llm": any_credentials()}


@app.post("/bot/grade", dependencies=[Depends(check_key)])
async def bot_grade(req: GradeReq):
    bucket = start_usage()
    pages = decode_images(req.images)
    lines = await extract_student_steps_from_pages(pages) if pages else []
    texts = [l.get("text", "") for l in lines if (l.get("text") or "").strip()]
    ocr_failed = any(l.get("ocr_error") for l in lines)
    question = {
        "max_points": req.max_points,
        "steps": [s.model_dump() for s in req.steps],
    }
    res = await grade_single_question(question, texts, strictness=req.strictness)
    # The rubric's points decide the scale; keep the mark inside the question's max
    score = max(0.0, min(float(res["score"]), float(req.max_points)))
    # QMath: the AI grades on its own. A paper goes to a human only on real doubt (the page could
    # not be read, grading did not finish, a step it is unsure of, or very low confidence), not
    # because the student lost many marks: heavy deductions are part of normal grading.
    uncertain = [st for st in res.get("steps", []) if st.get("status") == "uncertain"]
    confidence = float(res.get("confidence") or 0.0)
    if ocr_failed:
        doubt = "قراءة الصورة فشلت"
    elif not res.get("success", False):
        doubt = "التصحيح ما كمل"
    elif uncertain:
        doubt = f"{len(uncertain)} خطوة ما متأكد منها"
    elif confidence < 0.5:
        doubt = f"ثقته بالتصحيح قليلة ({confidence:.2f})"
    else:
        doubt = ""
    return {
        "score": round(score, 1),
        "max_score": float(req.max_points),
        "confidence": confidence,
        "requires_review": bool(doubt),
        "review_reason": doubt,
        "student_lines": texts,
        "usage": usage_report(bucket),
        "steps": [
            {
                "status": s.get("status"),
                "awarded": s.get("points_awarded", 0.0),
                "possible": s.get("points_possible", 0.0),
                "reason": s.get("reason", ""),
                "expected": s.get("expected", ""),
                "student": s.get("student", ""),
            }
            for s in res.get("steps", [])
        ],
    }


class RubricStepOut(BaseModel):
    text: str = Field(description="The step exactly as written on the solution, as plain math (e.g. x^2 - y^2 = 7)")
    points: float = Field(ge=0, description="Marks the teacher wrote for this step; 0 when none is written")


class RubricOut(BaseModel):
    steps: List[RubricStepOut]
    marks_written: bool = Field(description="True when the teacher wrote marks next to the steps on the page")


RUBRIC_PROMPT = """These pages are a math teacher's model solution for ONE exam question worth {max} marks in total.
The teacher usually writes the mark of each step next to it (a number such as 2, (2), 2 درجة, or a circled number).

List the solution's marking steps in order, top to bottom:
- One entry per marked step. When the teacher's marks group several lines under one mark, keep them as ONE step (join the lines with "  ;  ").
- text: the math of the step, copied faithfully as plain text (use ^ for powers, sqrt() for roots, i for the imaginary unit). Do not include the mark number itself in the text.
- points: the mark written for that step. If no marks are written anywhere, set marks_written to false and give every step 0.
Ignore page headers, question numbers and decoration."""

PDF_PART = """

IMPORTANT: these pages hold the model solutions of the WHOLE exam, not just one question.
Use ONLY question {n}. Its solution starts at the label for question {n} (written like س{n}, سؤال {n} or Q{n}, usually at the right margin)
and ends where question {next} starts (or at the end of the pages). Ignore every other question."""


def page_media(b: bytes) -> str:
    return "image/png" if b[:4] == bytes([0x89, 0x50, 0x4E, 0x47]) else "image/webp" if b[8:12] == b"WEBP" else "image/jpeg"


def fit_points(points: List[float], total: float) -> List[float]:
    """Keep the teacher's marks when they add up; otherwise scale them to the question's mark
    (or split evenly when none were written). Whole marks, the remainder on the last steps."""
    n = len(points)
    if n == 0:
        return []
    s = sum(points)
    if abs(s - total) < 0.01:
        return [float(p) for p in points]
    if s <= 0:
        return split_points(n, total)
    scaled = [p * total / s for p in points]
    whole = [float(int(x)) for x in scaled]
    left = int(round(total - sum(whole)))
    order = sorted(range(n), key=lambda i: scaled[i] - whole[i], reverse=True)
    for i in order[:max(0, left)]:
        whole[i] += 1
    if abs(sum(whole) - total) > 0.01:
        whole[-1] += total - sum(whole)
    return whole


@app.post("/bot/rubric", dependencies=[Depends(check_key)])
async def bot_rubric(req: RubricReq):
    """Draft steps from the teacher's solution pages, with the marks the teacher wrote next to
    each step. Falls back to one step per written line with points shared evenly."""
    bucket = start_usage()
    if req.pdf and req.question:
        pages = pdf_pages(req.pdf)
        prompt = RUBRIC_PROMPT.format(max=req.max_points) + PDF_PART.format(n=req.question, next=req.question + 1)
    else:
        if not req.images:
            raise HTTPException(status_code=400, detail="no solution pages")
        pages = decode_images(req.images)
        prompt = RUBRIC_PROMPT.format(max=req.max_points)
    try:
        out = await complete_vision_json(
            "visual", prompt, schema=RubricOut, detail="high",
            images=[(b, page_media(b), f"Solution page {i + 1}") for i, b in enumerate(pages)],
        )
        steps = [s for s in out.get("steps", []) if (s.get("text") or "").strip()]
        if steps:
            pts = fit_points([float(s.get("points") or 0) for s in steps], req.max_points)
            return {"steps": [{"text": s["text"].strip(), "points": p, "objective": s["text"].strip()} for s, p in zip(steps, pts)],
                    "marks_written": bool(out.get("marks_written")), "usage": usage_report(bucket)}
    except Exception:
        pass
    if req.pdf:
        raise HTTPException(status_code=502, detail="could not read this question from the pdf")
    lines = await extract_student_steps_from_pages(pages)
    if any(l.get("ocr_error") for l in lines) and not any((l.get("text") or "").strip() for l in lines):
        raise HTTPException(status_code=502, detail="ocr failed")
    texts = [l["text"].strip() for l in lines if (l.get("text") or "").strip()]
    pts = split_points(len(texts), req.max_points)
    return {"steps": [{"text": t, "points": p, "objective": t} for t, p in zip(texts, pts)], "marks_written": False, "usage": usage_report(bucket)}
