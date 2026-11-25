// 🧭 «التست الكامل»: صاحب البوت بس. التأشير (تم / بيها مشكلة)، طالب التجربة، وفتح أي صفحة مثل ما يشوفها
import { find, kvGet, kvSet, type Row } from "./db.ts";
import { JOURNEY, jKey } from "./fullTest.ts";
import { stamp } from "./util.ts";
import { authed, need } from "./webApi.ts";
import { appKey, homeToken } from "./webAuth.ts";

const MARKS = "fulltest_marks", STUDENT = "fulltest_student";
type Mark = { state: "ok" | "bad"; rev: number; note?: string; at: string };
async function readMarks(): Promise<Record<string, Mark>> { try { return JSON.parse(await kvGet(MARKS) ?? "{}"); } catch { return {}; } }
const stepOf = (key: string) => { for (const s of JOURNEY) for (const st of s.steps) if (jKey(s.id, st.id) === key) return st; return null; };
const PAGE = /^[a-z]{2,20}$/;

async function testStudent() {
  const uid = Number(await kvGet(STUDENT)) || 0;
  if (!uid) return null;
  const st = (await find("students", { user_id: uid }))[0];
  return st ? { uid, name: String(st.name ?? ""), phone: String(st.phone1 ?? "") } : null;
}

export async function fullTestAction(body: Row) {
  const uid = await authed(body?.initData, "owner");
  const a = String(body.action ?? "");
  const out = async (notice = "") => ({ marks: await readMarks(), student: await testStudent(), notice });
  if (a === "list") return out();
  if (a === "setStudent") {
    const phone = String(body.phone ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");
    need(/^07\d{9}$/.test(phone), "اكتب رقم الطالب 07xxxxxxxxx");
    const st = (await find("students")).filter((s) => String(s.phone1 ?? "") === phone).sort((x, y) => String(y.created ?? "").localeCompare(String(x.created ?? "")))[0];
    need(st, "ما لگيت طالب بهذا الرقم. سجّله أول بالتطبيق");
    await kvSet(STUDENT, String(st!.user_id));
    return out(`✅ طالب التجربة: ${st!.name}`);
  }
  if (a === "open") {
    const page = String(body.page ?? "");
    need(PAGE.test(page), "صفحة غلط");
    const q = typeof body.q === "string" && /^[\w=&%-]{0,200}$/.test(body.q) ? `&${body.q}` : "";
    const v = `v=${Math.floor(Date.now() / 1000)}`;
    if (body.as === "student") {
      const s = await testStudent();
      need(s, "أول اختار طالب التجربة فوك الصفحة");
      // نفس دخول التطبيق: الرمز ومفتاح التطبيق، فالصفحة تطلع بالضبط مثل ما يشوفها جوه التطبيق
      return { url: `/store/${page}?${v}${q}&t=${encodeURIComponent(homeToken(s!.uid))}&app=${appKey(s!.uid)}` };
    }
    return { url: `/store/${page}?${v}${q}&t=${encodeURIComponent(homeToken(uid))}` };
  }
  const key = String(body.key ?? "");
  const step = stepOf(key);
  need(step, "الخطوة غير موجودة");
  const marks = await readMarks();
  if (a === "clear") delete marks[key];
  else {
    need(a === "ok" || a === "bad", "أمر غير معروف");
    const note = String(body.note ?? "").trim().slice(0, 800);
    if (a === "bad") need(note, "اكتب شنو المشكلة");
    marks[key] = { state: a as "ok" | "bad", rev: step!.rev ?? 1, ...(a === "bad" ? { note } : {}), at: stamp() };
    if (a === "bad") {
      // المشكلة توصلني بالمحادثة حتى أصلحها
      const { ADMIN_IDS } = await import("./config.ts");
      const { send } = await import("./telegram.ts");
      const { esc } = await import("./util.ts");
      for (const x of ADMIN_IDS) try { await send(x, `🧭 <b>مشكلة بالتست الكامل</b>\n${esc(step!.text)}\n\n✍️ ${esc(note)}`); } catch { /* */ }
    }
  }
  await kvSet(MARKS, JSON.stringify(marks));
  return out();
}
