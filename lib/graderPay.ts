// تعويض المصححين: لكل مصحح أجر للورقة الإجبارية وأجر للاختيارية، وخصم لكل اعتراض انقبل على ورقته.
// الرصيد هو اللي ما انحاسب بعد، والتسوية تصفره وتنحفظ بالأرشيف. أوراق التجربة ما تنحسب
import { find, insert, one, put, update, type Row } from "./db.ts";
import { isAdmin, staffName } from "./data.ts";
import { stamp } from "./util.ts";
import { need } from "./webApi.ts";

const money = (v: unknown, what: string) => {
  const n = Number(v ?? 0);
  need(Number.isInteger(n) && n >= 0 && n <= 1_000_000, `${what} لازم رقم كامل بالدينار`);
  return n;
};
export async function rateOf(uid: number) {
  const r = await one("grader_pay", { user_id: uid });
  return { mandatory: r?.mandatory ?? 0, optional: r?.optional ?? 0, deduct: r?.deduct ?? 0 };
}
/** الفصول اللي يصححها المصحح. فارغة يعني كل الفصول. صاحب البوت يصحح كلشي */
export async function chaptersOf(uid: number): Promise<string[]> {
  if (await isAdmin(uid)) return [];
  try { const j = JSON.parse((await one("grader_pay", { user_id: uid }))?.chapters || "[]"); return Array.isArray(j) ? j.map(String) : []; } catch { return []; }
}
export const allChapters = async () => [...new Set((await find("bank_exams", {}, { order: ["pos", "ord"] })).map((e) => e.chapter as string).filter(Boolean))];

/** اللي ما انحاسب: الأوراق اللي صححها، والاعتراضات اللي انقبلت على أوراقه */
export async function balanceOf(uid: number) {
  const rate = await rateOf(uid);
  const mine = (await find("sched_items", { grader_id: uid })).filter((p) => p.user_id > 0);
  const papers = mine.filter((p) => p.graded_at && !p.paid_id);
  const ids = new Set(mine.map((p) => p.id));
  const objs = (await find("objections", { status: "accepted" })).filter((o) => ids.has(o.item_id) && !o.paid_id);
  const mand = papers.filter((p) => p.kind !== "optional").length, opt = papers.length - mand;
  return {
    rate, mand, opt, obj: objs.length,
    amount: mand * rate.mandatory + opt * rate.optional - objs.length * rate.deduct,
    paperIds: papers.map((p) => p.id as number), objIds: objs.map((o) => o.id as number),
  };
}

const archiveOf = async (uid: number) => (await find("grader_settlements", { user_id: uid }, { order: ["-id"], limit: 12 }))
  .map((s) => ({ id: s.id, mand: s.n_mand, opt: s.n_opt, obj: s.n_obj, amount: s.amount, created: s.created }));

/** المصححين: كل اللي عدهم صلاحية التصحيح، ويا أجورهم ورصيدهم */
async function graders() {
  return (await find("staff")).filter((s) => String(s.perms ?? "").split(",").includes("grade")).map((s) => s.user_id as number);
}
async function card(uid: number) {
  const b = await balanceOf(uid);
  return { id: uid, name: await staffName(uid), chapters: await chaptersOf(uid), rate: b.rate, mand: b.mand, opt: b.opt, obj: b.obj, amount: b.amount, archive: await archiveOf(uid) };
}

/** صفحة التعويض: صاحب البوت يشوف كل المصححين ويعدل أجورهم ويسوي تسوية، والمصحح يشوف حسابه بس */
export async function payData(uid: number) {
  if (await isAdmin(uid)) return { all: true, chapters: await allChapters(), graders: await Promise.all((await graders()).map(card)) };
  return { all: false, chapters: [], graders: [await card(uid)] };
}

export async function payAction(uid: number, body: Row) {
  need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
  const id = Number(body.grader);
  need((await graders()).includes(id), "هذا مو مصحح");
  if (body.action === "setRate") {
    const all = await allChapters();
    const chapters = Array.isArray(body.chapters) ? [...new Set((body.chapters as unknown[]).map(String))] : [];
    need(chapters.every((c) => all.includes(c)), "فصل غير معروف");
    await put("grader_pay", { user_id: id, mandatory: money(body.mandatory, "أجر الإجباري"), optional: money(body.optional, "أجر الاختياري"), deduct: money(body.deduct, "خصم الاعتراض"), chapters: JSON.stringify(chapters.length === all.length ? [] : chapters) });
    return "✅ انحفظ";
  }
  const b = await balanceOf(id);
  need(b.paperIds.length || b.objIds.length, "ماكو شي ينحاسب");
  const sid = await insert("grader_settlements", { user_id: id, n_mand: b.mand, n_opt: b.opt, n_obj: b.obj, amount: b.amount, created: stamp(), by_id: uid });
  for (const p of b.paperIds) await update("sched_items", { id: p }, { paid_id: sid });
  for (const o of b.objIds) await update("objections", { id: o }, { paid_id: sid });
  return `✅ انحاسب ${await staffName(id)}: ${b.amount.toLocaleString("en")} دينار`;
}
