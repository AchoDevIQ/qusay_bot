// صفحة «تست التطبيق»: صاحب البوت بس
import { kvGet, kvSet, type Row } from "./db.ts";
import { TEST_PLAN, stepKey, type TestMarks } from "./testPlan.ts";
import { stamp } from "./util.ts";
import { authed, need } from "./webApi.ts";

const KEY = "test_marks";
async function readMarks(): Promise<TestMarks> {
  try { return JSON.parse(await kvGet(KEY) ?? "{}"); } catch { return {}; }
}
const stepOf = (key: string) => {
  for (const s of TEST_PLAN) for (const st of s.steps) if (stepKey(s.id, st.id) === key) return st;
  return null;
};
export async function testPlanAction(body: Row) {
  await authed(body?.initData, "owner");
  const a = String(body.action ?? "");
  if (a === "list") return { marks: await readMarks() };
  const key = String(body.key ?? "");
  const step = stepOf(key);
  need(step, "الخطوة غير موجودة");
  const marks = await readMarks();
  if (a === "clear") delete marks[key];
  else {
    need(a === "ok" || a === "bad", "أمر غير معروف");
    const note = String(body.note ?? "").trim().slice(0, 500);
    if (a === "bad") need(note, "اكتب شنو المشكلة");
    marks[key] = { state: a as "ok" | "bad", rev: step!.rev ?? 1, ...(a === "bad" ? { note } : {}), at: stamp() };
  }
  await kvSet(KEY, JSON.stringify(marks));
  return { marks };
}
