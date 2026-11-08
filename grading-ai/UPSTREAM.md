# Grading engine

Copied from https://github.com/Muammal/Math-Grading at commit
`fb6b9925ae69f47ad162dd0b425b9dfcbc850045` (engine folders and `grading_service.py` only).

Left out on purpose: student papers (`Exams/`), graded reports (`reports/`), results
and databases (`data/`), and the Streamlit/REST apps. They hold real student data and
the bot does not need them.

`bot_api.py` is new: a small locked service the bot calls (see its header).
To update the engine, copy the same folders again from a newer commit and change the
commit above.

Local changes to the engine: `llm/router.py` uses `claude-haiku-5-5` for every feature by default
(needs ANTHROPIC_API_KEY). Also: `llm/router.py` adds `USAGE_COLLECTOR` so each request reports
its token use (the bot shows what every paper cost). Keep it when updating.
`grading/grader.py` and `grading_service.py` take an optional `images` argument: the grader then also sees the
student's photos (`PHOTO_RULES`). Without images they behave exactly as upstream. Keep it when updating.
