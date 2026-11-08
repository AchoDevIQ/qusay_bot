"""
Rubric engine: the same paper gets the same mark.

The model no longer decides marks. For each step of the teacher's solution it answers one fixed
question (what did the student write for it, and which verdict fits), reading the PHOTO itself.
The code turns verdicts into marks with fixed rules, and the final answer is checked by SymPy
as numbers, so a wrong sign in the final roots always costs the same.

Verdict -> share of the step's marks:
    correct, other_route, implied -> 1     follow_through -> 1/2     wrong, missing -> 0
    unreadable -> 0 and the question goes to a human
"""
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from finals import match as finals_match
from llm.router import complete_vision_json

Verdict = Literal["correct", "other_route", "implied", "follow_through", "wrong", "missing", "unreadable"]
SHARE = {"correct": 1.0, "other_route": 1.0, "implied": 1.0, "follow_through": 0.5, "wrong": 0.0, "missing": 0.0, "unreadable": 0.0}
STATUS = {"correct": "correct", "other_route": "correct", "implied": "correct", "follow_through": "partially_correct",
          "wrong": "incorrect", "missing": "not_attempted", "unreadable": "uncertain"}


class JudgeStep(BaseModel):
    index: int = Field(description="Step number from the teacher's list (1-based)")
    wrote: str = Field(description="What the student wrote for this step, as plain math (^ powers, / fractions, sqrt(), i); empty if nothing")
    verdict: Verdict
    reason: str = Field(description="One short English sentence: why this verdict")


class JudgeOut(BaseModel):
    steps: List[JudgeStep]
    student_finals: List[str] = Field(description="Each final value the student wrote at the very end, one value per item, plain math; empty list if none")
    lines: List[str] = Field(description="The student's lines for this question, transcribed in order, plain math")


JUDGE_PROMPT = """You check one student's handwritten answer to a math question against the teacher's solution steps.
Read the PHOTOS carefully yourself (signs, fractions, powers, ± and the pairing of x with y).

Teacher's solution steps (number, marks, expected result):
{rubric}

For EVERY step, in order and with the same count, give exactly one verdict:
- correct: the student wrote this step's result, in any mathematically equivalent form (sides swapped, multiplied by -1, reordered, simplified, rationalised).
- other_route: the student reached this step's result, or did this step's job, by a different valid method.
- implied: not written, but the student's next written line is correct and could only come from it.
- follow_through: the method of this step is right, but a value is wrong only because of an earlier mistake.
- wrong: the student's work for this step has its own mathematical mistake (a sign, arithmetic, a wrong pairing of x with y, a wrong root).
- missing: nothing for this step, and nothing later depends on it.
- unreadable: the photo cannot be read for this step.
Fixed rules, apply them the same way every time:
- A pair (x, y) whose signs do not satisfy the equations (for example 2xy = -3 needs opposite signs) is wrong.
- Writing x = ±a and y = ±b without the right pairing, then listing a wrongly paired root, is wrong for those steps.
- A correct final answer does not make an earlier wrong step correct.
- If unsure between two verdicts, take the stricter one, except that an equivalent form is always correct.
{examples}"""


def rubric_lines(steps) -> str:
    return "\n".join(f"{i + 1}. ({s.points:g} marks) {s.text or s.objective}" for i, s in enumerate(steps))


async def judge(steps, pages: List[bytes], page_media, examples: str = "") -> Optional[dict]:
    """Grades one question. None when the model's answer doesn't fit the rubric (the caller falls back)."""
    imgs = [(b, page_media(b), f"Student's answer, page {k + 1}") for k, b in enumerate(pages)]
    prompt = JUDGE_PROMPT.replace("{rubric}", rubric_lines(steps)).replace("{examples}", examples)
    out = JudgeOut(**await complete_vision_json("grading", prompt, schema=JudgeOut, detail="high", images=imgs))
    by = {s.index: s for s in out.steps}
    if sorted(by) != list(range(1, len(steps) + 1)):
        return None
    rows = []
    for i, s in enumerate(steps):
        j = by[i + 1]
        rows.append({"status": STATUS[j.verdict], "verdict": j.verdict, "awarded": round(float(s.points) * SHARE[j.verdict], 2),
                     "possible": float(s.points), "reason": j.reason, "expected": s.text, "student": j.wrote})
    # The final answer by algebra, not by the model: the share of the teacher's final values the student got
    final = None
    if out.student_finals:
        final = finals_match(steps[-1].text or "", out.student_finals)
    if final is not None:
        last, pts = rows[-1], float(steps[-1].points)
        mark = round(pts * final * 2) / 2  # to the nearest half mark
        last["awarded"] = mark
        last["status"] = "correct" if mark >= pts else ("partially_correct" if mark > 0 else "incorrect")
        last["reason"] = f"Final answer checked by algebra: {final:.0%} of the teacher's values. " + last["reason"]
    score = sum(r["awarded"] for r in rows)
    unsure = sum(1 for r in rows if r["verdict"] == "unreadable")
    return {"steps": rows, "score": score, "final": final, "unreadable": unsure, "lines": [l for l in out.lines if l.strip()]}
