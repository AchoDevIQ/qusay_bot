# Grading engine

Copied from https://github.com/Muammal/Math-Grading at commit
`5894b99d1ab467c893db4f2b775bf17040779627` (main): the engine folders
(`feedback/ grading/ llm/ math_engine/ ocr/ preprocessing/ review/`), `grading_service.py`,
and the bot service files `bot_api.py`, `rubric_engine.py`, `figure_engine.py`, `finals.py`.
`requirements.txt` is that commit's `requirements-bot.txt`.

Left out on purpose: student papers (`Exams/`), graded reports (`reports/`), results
and databases (`data/`), and the Streamlit/REST apps. They hold real student data and
the bot does not need them.

There are no local changes any more: the bot's additions (Claude Haiku 5.5 defaults,
`USAGE_COLLECTOR`, the optional `images` argument with `PHOTO_RULES`) are upstream now.

To update the engine, from the repository root on the `qmath-bot` branch:

    python tools/sync_grading_ai.py --commit <the main commit>
    python -m pytest -q

The script copies every engine file, removes files the root no longer has, and writes the commit
above. `tests/test_engine_copy.py` fails while this folder differs from the root, and
`python tools/sync_grading_ai.py --check` lists what differs. Do not edit files here by hand.
See `agent-docs/qmath-bot.md` at the repository root.

What this version changes for the bot (all requests and responses stay compatible):
- Student, OCR and model text never reaches `eval`: math is parsed by `math_engine/safe_expr.py`
  in killable SymPy workers with no secrets (`math_engine/sandbox.py`).
- The final answer is checked by `math_engine/finals.py`: ± answers get both roots, x/y pairs
  must pair, and an equation is never read as a final value.
- Grading runs at effort `medium`; `strictness` must be `strict`, `standard` or `lenient`.
- Requests need `Content-Length` (fetch sets it) and stay under 40 MB; only JPEG/PNG/WEBP/GIF
  images and real PDFs are accepted.
- Optional `lang: "en"` on `/bot/grade` and `/bot/objection` writes the student's text in English
  (`reason_en` instead of `reason_ar`); the default stays Arabic.
- Every call runs on Claude Haiku 5.5: any other model in the environment is replaced by it, unless
  `ALLOW_NON_HAIKU_MODELS=1` is set.
- Rounded decimals in final answers (0.707 + 0.707i) count as right; labels such as "(Equation 1)"
  in rubric steps are ignored; the algebra check compares the student's line with the step's result.

Added 2026-11-10 to 2026-11-12 (requests stay compatible; responses only gain fields):
- `engine: "figure"` (also chosen automatically when the rubric asks for a drawing): graphs, plots and
  geometry, with a graph checked against the function's exact features. Response field `figure`.
- Every step carries `analysis_failed` and, when true, `student_message` ("send another image").
- Final answers: a decimal must be the exact value rounded or cut off at its last digit; a root marked
  «يهمل» / "rejected" is left out on both sides; rates, units, π, ≅, sets, chains and degrees are read.
- A final answer wrong only through an earlier mistake gets the follow-through share when it has the
  teacher's form. A "wrong" step that follows exactly from the student's previous wrong line becomes a
  carried error (`carried_steps`).
- No photo is refused (changed 2026-11-12 at the owner's request): every paper is graded. When a page
  is close to black or has no sharp edge, the response gains `photo_quality`, one entry per page in page
  order with `problem` "dark", "blurred" or "". The bot only tells the teacher which page it was.
  `PHOTO_GATE=0` turns the measurement off.
- `/bot/rubric` separates the teacher's alternative ways to solve one question (changed 2026-11-13 at the owner's
  request). When the model answer solves the question again under «الطريقة الثانية» / «طريقة أخرى» / «حل آخر», `steps`
  is the first way and the new field `alternatives` holds the others, each worth the question's full marks (before, all
  ways were one list and the marks were scaled, so each way was worth about half). The split is made only when the marks
  written for every way add up to the question's mark; parts of one question (1/ 2/) never do, so they stay one list and
  the note `methods_unclear` is added. Issues found in another way carry `method` (2, 3...). The bot grades with the first
  way and, when the student did not get full marks, with each alternative, and keeps the highest result.
- `POST /bot/rubric/check` checks a rubric; `/bot/rubric` returns the same `issues` with its draft.
- `engine_version` in `/health` and in every grade response: the bot keys its cache on it.
- `final_answer` in the grade response: both final answers and what the algebra made of them.
- `examples[].steps` and `examples[].note` are optional detail on what the teacher marked differently.
- A paper with every step right is worded without a second model call.
