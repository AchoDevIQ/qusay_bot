# Grading engine

Copied from https://github.com/Muammal/Math-Grading at commit
`1469ea83b0829424dc71b96c6c6c8725c610f1bf` (main): the engine folders
(`feedback/ grading/ llm/ math_engine/ ocr/ preprocessing/ review/`), `grading_service.py`,
and the bot service files `bot_api.py`, `rubric_engine.py`, `figure_engine.py`, `finals.py`.
`requirements.txt` is that commit's `requirements-bot.txt`.

Left out on purpose: student papers (`Exams/`), graded reports (`reports/`), results
and databases (`data/`), and the Streamlit/REST apps. They hold real student data and
the bot does not need them.

There are no local changes any more: the bot's additions (Claude Haiku 5.5 defaults,
`USAGE_COLLECTOR`, the optional `images` argument with `PHOTO_RULES`) are upstream now.

To update the engine: copy the same files again from a newer commit of the repository root,
change the commit above, and run `python -m pytest tests/test_qmath_bot.py` at the root.
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
