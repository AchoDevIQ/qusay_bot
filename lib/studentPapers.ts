// أوراق الطالب بصفحة الطلاب: كل امتحان سلمه، درجته ودرجة كل سؤال، منو صححه، الاعتراضات،
// وصور ورقته المصححة (أو صور جوابه إذا بعدها ما انصححت، أو صححها نظام التصحيح AI)
import { find, one } from "./db.ts";
import { AI_GRADER, staffName } from "./data.ts";
import { aiResultOf } from "./aiGrade.ts";
import { gradedPages } from "./gradeApi.ts";

export async function studentPapers(uid: number) {
  const items = (await find("sched_items", { user_id: uid })).filter((i) => i.submitted_at || i.graded_at || i.status === "done")
    .sort((a, b) => String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? "")));
  return await Promise.all(items.map(async (it) => {
    const e = await one("bank_exams", { id: it.exam_id });
    const v = it.version_id ? await one("bank_versions", { id: it.version_id }) : null;
    const qs = it.version_id ? await find("bank_questions", { version_id: it.version_id }, { order: ["n"] }) : [];
    const marks = new Map((await find("question_marks", { item_id: it.id })).map((m) => [m.q, m.mark]));
    const objs = await find("objections", { item_id: it.id });
    const graded = await gradedPages(it.id);
    const answers = (await find("exam_answers", { item_id: it.id }, { order: ["q", "id"] })).map((a) => a.file as string);
    const ai = it.grader_id === AI_GRADER || !!(await aiResultOf(it.id));
    return {
      id: it.id, title: e?.title ?? "امتحان", chapter: e?.chapter ?? "", model: v?.model ?? "", optional: it.kind === "optional",
      submitted: it.submitted_at ?? "", graded: it.graded_at ?? "", total: it.total ?? null,
      grader: it.grader_id ? await staffName(it.grader_id) : "", ai,
      marks: qs.map((q) => ({ n: q.n, max: q.max_mark, mark: marks.get(q.n) ?? null })),
      objections: { open: objs.filter((o) => o.status === "open").length, ok: objs.filter((o) => o.status === "accepted").length, no: objs.filter((o) => o.status === "rejected").length },
      // الصور: الورقة المصححة إذا انحفظت، وإلا جوابه مثل ما رفعه
      pages: graded.length ? graded : answers.filter((f) => /\.(jpe?g|png)$/i.test(f)),
      gradedPages: graded.length > 0,
    };
  }));
}
