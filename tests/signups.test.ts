// تسجيلات الفصول: التقرير اليومي لصاحب البوت واللي عنده الصلاحية، والرسالة الجماعية أو للأفراد بالكتابة أو بالصوت
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-su-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"])) : JSON.parse(init.body);
  calls.push({ method, p });
  const result = method === "sendAudio" ? { message_id: 1, audio: { file_id: "AUD1" } } : { message_id: 1 };
  return new Response(JSON.stringify({ ok: true, result }));
}) as typeof fetch;
const { signupsAction, sweepSignups } = await import("../lib/signups.ts");
const { initDb, insert, put } = await import("../lib/db.ts");
const { todayStr } = await import("../lib/util.ts");
const { addDays } = await import("../lib/scheduleRules.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const su = (uid: number, action: string, x: object = {}) => signupsAction({ initData: sign(uid), action, ...x }) as Promise<any>;
const today = todayStr(), old = addDays(today, -3);
await put("staff", { user_id: 30, name: "مساعد التسجيل", perms: "signups" });
await put("staff", { user_id: 31, name: "مصحح", perms: "grade" });
const office = await insert("orders", { user_id: 60, name: "x", office_id: 1, created: today });
for (const [uid, name, ch, day, oid] of [[60, "علي", "الفصل الأول", today, office], [61, "زهراء", "الفصل الأول", today, null], [62, "حسين", "الفصل الأول", old, null], [61, "زهراء", "الفصل الثاني", today, null]] as const) {
  await put("students", { user_id: uid, name, exam: "إلكتروني", created: "x" });
  await insert("exam_access", { user_id: uid, chapter: ch, order_id: oid, created: `${day} 10:00` });
}

test("الصفحة لصاحب الصلاحية بس، وتبين كل فصل: اللي سجلوا باليوم ومنين، وعدد الفصل كله", async () => {
  await assert.rejects(su(31, "list"), (e: any) => e.status === 403);
  const r = await su(30, "list");
  const c1 = r.chapters.find((c: any) => c.chapter === "الفصل الأول");
  assert.deepEqual([c1.total, c1.students.map((s: any) => s.name)], [3, ["علي", "زهراء"]]);
  assert.equal(c1.students[0].source, "🏪 المكتب");
  assert.equal(r.days.length, 7);
  const back = await su(30, "list", { date: old });
  assert.deepEqual(back.chapters.find((c: any) => c.chapter === "الفصل الأول").students.map((s: any) => s.name), ["حسين"]);
});

test("التقرير اليومي يوصل لصاحب البوت واللي عنده الصلاحية، مرة وحدة باليوم", async () => {
  calls.length = 0;
  assert.equal(await sweepSignups(true), 2);
  const to = calls.filter((c) => c.method === "sendMessage").map((c) => c.p.chat_id).sort();
  assert.deepEqual(to, [1, 30]);
  assert.match(calls[0].p.text, /الفصل الأول: <b>2<\/b>[\s\S]*الفصل الثاني: <b>1<\/b>[\s\S]*المجموع: <b>3<\/b>/);
  calls.length = 0;
  assert.equal(await sweepSignups(), 0);
});

test("الرسالة: لليوم، لكل الفصل، أو للمحددين، بالكتابة", async () => {
  calls.length = 0;
  let r = await su(30, "send", { chapter: "الفصل الأول", scope: "day", text: "أهلاً <بيكم>" });
  assert.match(r.notice, /2 من 2/);
  assert.deepEqual(calls.map((c) => c.p.chat_id).sort(), [60, 61]);
  assert.equal(calls[0].p.text, "أهلاً &lt;بيكم&gt;");
  calls.length = 0;
  r = await su(30, "send", { chapter: "الفصل الأول", scope: "all", text: "للكل" });
  assert.deepEqual(calls.map((c) => c.p.chat_id).sort(), [60, 61, 62]);
  calls.length = 0;
  await su(30, "send", { chapter: "الفصل الأول", scope: "picked", ids: [62, 999], text: "إلك" });
  assert.deepEqual(calls.map((c) => c.p.chat_id), [62]);
  await assert.rejects(su(30, "send", { chapter: "الفصل الأول", scope: "picked", ids: [], text: "x" }), /حدد طالب/);
  await assert.rejects(su(30, "send", { chapter: "الفصل الأول", scope: "all", text: " " }), /اكتب الرسالة أو سجل صوت/);
});

test("الصوت: يترفع مرة وحدة، والباقين ياخذون نفس الملف", async () => {
  calls.length = 0;
  const f = new FormData();
  f.set("initData", sign(1)); f.set("action", "send"); f.set("chapter", "الفصل الأول"); f.set("scope", "all"); f.set("text", "");
  f.set("voice", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" }), "voice");
  const r = await signupsAction(f) as any;
  assert.match(r.notice, /3 من 3/);
  const audio = calls.filter((c) => c.method === "sendAudio");
  assert.equal(audio.length, 3);
  assert.equal(audio.filter((c) => c.p.audio === "<file>").length, 1);
  assert.equal(audio.filter((c) => c.p.audio === "AUD1").length, 2);
});

test("🔁 فصل تعويضي: اللي يشتري امتحاناته من المكتبة ينبهك وقت البيع، والتوصيل ثاني يوم من التجهيز ويا فعّل/ما فعّل", async () => {
  const { unlockFromSale } = await import("../lib/exams.ts");
  const { sweepMakeup } = await import("../lib/makeup.ts");
  const { stamp } = await import("../lib/util.ts");
  const items = (n: string) => JSON.stringify([{ name: n, qty: 1, price: 5000 }]);
  await assert.rejects(su(31, "makeup", { chapter: "الفصل الثالث", on: true }), (e: any) => e.status === 403);
  // قبل ما يصير تعويضي: ما ينحسب
  const before = await insert("orders", { user_id: 79, name: "قديم", phone1: "07700000079", items: items("امتحانات الفصل الثالث"), printed: 3, office_id: 1, created: `${addDays(today, -5)} 09:00` });
  const on = await su(30, "makeup", { chapter: "الفصل الثالث", on: true });
  assert.match(on.notice, /تعويضي/);
  // صار تعويضي قبل يومين
  const { kvSet } = await import("../lib/db.ts");
  await kvSet("makeup_chapters", JSON.stringify({ "الفصل الثالث": `${addDays(today, -2)} 00:00` }));
  // بيع مكتبة: تنبيه وقتها
  await put("students", { user_id: 70, name: "مريم المكتبة", exam: "إلكتروني", created: "x", phone1: "07701111111" });
  const lib = await insert("orders", { user_id: 70, name: "مريم المكتبة", phone1: "07701111111", username: "maryam70", items: items("امتحانات الفصل الثالث"), printed: 3, office_id: 1, created: stamp() });
  calls.length = 0;
  await unlockFromSale(70, JSON.parse(items("امتحانات الفصل الثالث")), lib);
  const alert = calls.find((c) => c.p.chat_id === 1 && /فصل تعويضي/.test(c.p.text ?? ""));
  assert.ok(alert && /مريم المكتبة/.test(alert.p.text) && /07701111111/.test(alert.p.text) && /t\.me\/maryam70/.test(alert.p.text));
  assert.ok(calls.some((c) => c.p.chat_id === 30 && /فصل تعويضي/.test(c.p.text ?? "")));
  assert.ok(!calls.some((c) => c.p.chat_id === 31 && /فصل تعويضي/.test(c.p.text ?? "")));
  // توصيل تجهز البارحة: واحد فعّل وواحد لا. ومحاضرات بس ما ينحسب. واللي تجهز اليوم ينتظر لباجر
  const y = `${addDays(today, -1)} 15:00`;
  const d1 = await insert("orders", { user_id: 71, name: "علي التوصيل", phone1: "07702222222", items: items("محاضرات وامتحانات الفصل الثالث"), printed: 1, created: y, printed_at: y });
  const d2 = await insert("orders", { user_id: 72, name: "سارة التوصيل", phone1: "07703333333", items: items("امتحانات الفصل الثالث"), printed: 1, created: y, printed_at: y });
  await insert("orders", { user_id: 73, name: "محاضرات بس", phone1: "07704444444", items: items("محاضرات الفصل الثالث"), printed: 1, created: y, printed_at: y });
  await insert("orders", { user_id: 74, name: "تجهز اليوم", phone1: "07705555555", items: items("امتحانات الفصل الثالث"), printed: 1, created: stamp(), printed_at: stamp() });
  await put("order_codes", { code: "111111", order_id: d1, chapters: "[]", used_at: stamp() });
  await put("order_codes", { code: "222222", order_id: d2, chapters: "[]", used_at: null });
  calls.length = 0;
  assert.equal(await sweepMakeup(true), 2);
  const rep = calls.find((c) => c.p.chat_id === 1)!.p.text;
  assert.match(rep, /✅ فعّلوا الكود \(1\)[\s\S]*علي التوصيل/);
  assert.match(rep, /⏳ بعدهم ما فعّلوا \(1\)[\s\S]*سارة التوصيل/);
  assert.ok(!/محاضرات بس|تجهز اليوم|مريم/.test(rep));
  assert.equal(await sweepMakeup(true), 0);   // مرة وحدة لكل طلب
  // الصفحة: القائمة بيها الكل ويا التليفون
  const r = await su(30, "list");
  const names = r.makeup.buyers.map((b: any) => b.name).sort();
  assert.deepEqual(names, ["تجهز اليوم", "سارة التوصيل", "علي التوصيل", "مريم المكتبة"].sort());
  assert.ok(!names.includes("قديم") && before > 0);
  // شيله: ماكو قائمة
  const off = await su(30, "makeup", { chapter: "الفصل الثالث", on: false });
  assert.equal(off.makeup.buyers.length, 0);
});
