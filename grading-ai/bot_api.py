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
from llm.router import USAGE_COLLECTOR, any_credentials

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
    images: List[str] = Field(min_length=1)  # base64 pages of the teacher's solution


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
    return {
        "score": round(score, 1),
        "max_score": float(req.max_points),
        "confidence": res.get("confidence", 0.0),
        "requires_review": bool(res.get("requires_review")) or ocr_failed or not res.get("success", False),
        "review_reason": res.get("review_reason") or ("قراءة الصورة فشلت" if ocr_failed else ""),
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


@app.post("/bot/rubric", dependencies=[Depends(check_key)])
async def bot_rubric(req: RubricReq):
    """Draft steps from the teacher's solution pages: one step per written line, points
    shared evenly. The owner reviews and edits them in the bot before they are used."""
    bucket = start_usage()
    pages = decode_images(req.images)
    lines = await extract_student_steps_from_pages(pages)
    if any(l.get("ocr_error") for l in lines) and not any((l.get("text") or "").strip() for l in lines):
        raise HTTPException(status_code=502, detail="ocr failed")
    texts = [l["text"].strip() for l in lines if (l.get("text") or "").strip()]
    pts = split_points(len(texts), req.max_points)
    return {"steps": [{"text": t, "points": p, "objective": t} for t, p in zip(texts, pts)], "usage": usage_report(bucket)}
