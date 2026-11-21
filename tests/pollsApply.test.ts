// التصويت (2026-11-22): الفئة بالمنهج والفصل اللي شاريه، صفحة «🗳 التصويت» للطالب (التطبيق والبوت)، رابط القناة،
// و«⚡ طبّق على المصوتين» يبدي الفصل الرابع مبكر لكل اللي اختاروه (ويا المراجعات لو بدونها)، مرة وحدة، ويطلع منو ما انثبت وليش
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-pollapply-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ method: String(url).split("/").pop()!, p: init?.body ? JSON.parse(init.body) : {} });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;

const { pollAction, voteAction } = await import("../lib/polls.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { addDays } = await import("../lib/scheduleRules.ts");
const { initDb, find, insert, kvSet, put } = await import("../lib/db.ts");
const { todayStr } = await import("../lib/util.ts");
const { GET: channelLink } = await import("../app/v/[id]/route.ts");
await initDb();

const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const pa = (action: string, x: object = {}) => pollAction({ initData: sign(1), action, ...x }) as Promise<any>;
const va = (uid: number, x: object = {}) => voteAction({ token: homeToken(uid), device: "dev-" + String(uid).padStart(14, "0"), ...x }) as Promise<any>;
const sentTo = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.p.chat_id).sort((a, b) => a - b);

for (const [i, ar] of ["الأعداد المركبة", "القطوع", "التفاضل", "التكامل", "المعادلات"].entries()) await insert("chapters", { ord: i + 1, ar, en: ar, active: 1 });
const T = (n: number) => addDays(todayStr(), n);
const ALL = { "0": "16:00", "1": "16:00", "2": "16:00", "3": "16:00", "4": "16:00", "5": "16:00", "6": "16:00" };
const join = async (uid: number, curr: string, chapters: string[]) => {
  await put("students", { user_id: uid, username: "", gender: "بنين", name: `طالب ${uid}`, curr, grade: "السادس العلمي", gov: "البصرة", side: "", area: "ع", phone1: "07701234567", phone2: "07801234567", exam: "إلكتروني", created: "2026-01-01 10:00" });
  for (const ch of chapters) await put("exam_access", { user_id: uid, chapter: ch, order_id: 1, created: "1" });
  await put("schedules", { user_id: uid, mode: "general", center_id: 0, picks: JSON.stringify(ALL), created: "1" });
};
const exam = async (slug: string, chapter: string, ord: number, day: string) => {
  const id = await insert("bank_exams", { slug, chapter, ord, title: `${chapter} ${ord}`, info: "", minutes: 60 });
  await insert("bank_versions", { exam_id: id, model: "A", kind: "mandatory", ok: 1 });
  await put("place_dates", { center_id: 0, exam_id: id, day, versions: "{}" });
  return id as number;
};
// نفس جدول تجربة الفصل المبكر: الثالث باچر، المراجعة بعده، العطلة بعد شهر، والرابع وراها. خيار الطلاب مسدود
await put("place_slots", { center_id: 0, slots: JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, t: "16:00" }))) });
await exam("c3", "الفصل الثالث", 1, T(1));
const review = await exam("c1", "الفصل الأول", 9, T(3));
await kvSet("exam_with_chapter", JSON.stringify({ [review]: "الفصل الثالث" }));
await exam("c4", "الفصل الرابع", 1, T(50));
await exam("c4", "الفصل الرابع", 2, T(51));
await kvSet("sched_settings", JSON.stringify({ holidayStart: T(30), holidayDays: 15, holidayNote: "عطلة نصف السنة", earlyOpen: false }));

await join(700, "عربي", ["الفصل الثالث", "الفصل الرابع"]);
await join(701, "عربي", ["الفصل الثالث", "الفصل الرابع"]);
await join(702, "عربي", ["الفصل الثالث", "الفصل الرابع"]);
await join(703, "إنجليزي", ["الفصل الثالث", "الفصل الرابع"]);
await join(704, "عربي", ["الفصل الثالث"]);
const OPTS = ["أبدي هسه ويا المراجعات", "أبدي هسه بدون المراجعات", "بعد العطلة"];

test("الفئة بالمنهج والفصل: عربي وشاري الفصل الرابع بس", async () => {
  const page = await pa("list");
  assert.deepEqual(page.currs, ["عربي", "إنجليزي"]);
  assert.ok(page.chapters.includes("الفصل الرابع"));
  assert.ok(page.acts.some((a: any) => a.key === "early_with"));
  await assert.rejects(pa("create", { question: "س", options: ["أ", "ب"], curr: "فرنسي" }), /عربي أو إنجليزي/);
  await assert.rejects(pa("create", { question: "س", options: ["أ", "ب"], chapters: ["الفصل العشرين"] }), /فصل غير معروف/);
  calls.length = 0;
  const r = await pa("create", { question: "منو يبدي التكامل هسه؟", options: OPTS, acts: ["early_with", "early_without", ""], curr: "عربي", chapters: ["الفصل الرابع"] });
  assert.match(r.notice, /لـ 3 من 3 طالب/);
  assert.deepEqual(sentTo(), [700, 701, 702]);
  const p = r.polls[0];
  assert.equal(p.target, "كل الطلاب · منهج عربي · شاري الفصل الرابع");
  assert.deepEqual(p.acts, ["early_with", "early_without", ""]);
  assert.equal(p.results.targets, 3);
  assert.equal(p.link, `https://x.test/v/${p.id}`);
});

test("الشغل لازم: «ويا» و«بدون» واختيار يبقى ويا جماعته", async () => {
  await assert.rejects(pa("create", { question: "س", options: ["أ", "ب"], acts: ["early_with", ""] }), /بدون المراجعات/);
  await assert.rejects(pa("create", { question: "س", options: ["أ", "ب"], acts: ["early_with", "early_without"] }), /بلا شغل/);
});

test("صفحة التصويت للطالب: يشوف تصويته، يصوت مرة وحدة، واللي مو من الفئة يطلعله ليش", async () => {
  const p = (await pa("list")).polls[0];
  const a = await va(700, { action: "list", p: p.id });
  assert.equal(a.why, "");
  assert.equal(a.list.length, 1);
  assert.equal(a.list[0].mine, null);
  assert.deepEqual(a.list[0].options, OPTS);
  const v = await va(700, { action: "vote", id: p.id, choice: 1 });
  assert.equal(v.notice, "✅ انحسب صوتك");
  assert.equal(v.list[0].mine, 1);
  const again = await va(700, { action: "vote", id: p.id, choice: 0 });
  assert.match(again.notice, /صوتت قبل/);
  assert.equal((await find("poll_votes", { poll_id: p.id, user_id: 700 }))[0].choice, 1);
  await va(701, { action: "vote", id: p.id, choice: 0 });
  await va(702, { action: "vote", id: p.id, choice: 2 });
  // الإنجليزي واللي ما شاري الرابع: ما يطلعله، ورابط القناة يگله ليش
  const en = await va(703, { action: "list", p: p.id });
  assert.equal(en.list.length, 0);
  assert.equal(en.why, "هذا التصويت مو إلك");
  await assert.rejects(va(704, { action: "vote", id: p.id, choice: 0 }), /مو إلك/);
  await assert.rejects(voteAction({ token: "x", action: "list" }) as Promise<any>, /قديم/);
});

test("رابط القناة: يفتح التطبيق على التصويت (أندرويد وآيفون) أو البوت", async () => {
  const p = (await pa("list")).polls[0];
  const res = await channelLink(new Request(`https://x.test/v/${p.id}`), { params: Promise.resolve({ id: String(p.id) }) });
  const html = await res.text();
  assert.match(html, new RegExp(`qmath://loginToken\\?vote=${p.id}`));
  assert.match(html, new RegExp(`intent://loginToken\\?vote=${p.id}#Intent;scheme=qmath;package=com.achodev.qmath;end`));
  assert.match(html, new RegExp(`t.me/Qusay_Alomairi_Bot\\?start=vote_${p.id}`));
  assert.match(html, /افتح التطبيق، التصويت بالرئيسية/);
  assert.doesNotMatch(html, /طالب 700/);
  assert.equal((await channelLink(new Request("https://x.test/v/abc"), { params: Promise.resolve({ id: "abc" }) })).status, 404);
});

test("⚡ طبّق على المصوتين: بعد الإنهاء بس، مرة وحدة، حتى لو خيار الطلاب مسدود، ويطلع منو ما انثبت وليش", async () => {
  const p = (await pa("list")).polls[0];
  await assert.rejects(pa("apply", { id: p.id }), /أنهي التصويت أول/);
  await pa("close", { id: p.id });
  const r = await pa("apply", { id: p.id });
  assert.match(r.notice, /انطبق على 2 طالب/);
  // 701 ويا المراجعات: المراجعة بمكانها. 700 بدونها: المراجعة انشالت. 702 بعد العطلة: ما تغير شي
  assert.equal((await find("sched_items", { user_id: 701, kind: "early" })).length, 2);
  assert.equal((await find("sched_items", { user_id: 701, kind: "early_skip" })).length, 0);
  assert.equal((await find("sched_items", { user_id: 700, kind: "early" })).length, 2);
  assert.deepEqual((await find("sched_items", { user_id: 700, exam_id: review })).map((i) => i.status), ["skipped"]);
  assert.equal((await find("sched_items", { user_id: 700 })).every((i) => i.kind !== "early" || i.catch_place === "online"), true);
  assert.equal((await find("sched_items", { user_id: 702, kind: "early" })).length, 0);
  const card = r.polls.find((x: any) => x.id === p.id);
  assert.equal(card.applied.ok, 2);
  assert.deepEqual(card.applied.fail, []);
  await assert.rejects(pa("apply", { id: p.id }), /انطبق من قبل/);
});

test("اللي ما ينفع يطلع اسمه وليش: مبدي من قبل", async () => {
  calls.length = 0;
  const r = await pa("create", { question: "مرة ثانية؟", options: OPTS, acts: ["early_with", "early_without", ""], chapters: ["الفصل الرابع"] });
  const p = r.polls[0];
  await va(700, { action: "vote", id: p.id, choice: 0 });
  await va(703, { action: "vote", id: p.id, choice: 1 });
  await pa("close", { id: p.id });
  const done = await pa("apply", { id: p.id });
  assert.match(done.notice, /انطبق على 1 طالب، وما انطبق على 1/);
  const card = done.polls.find((x: any) => x.id === p.id);
  assert.deepEqual(card.applied.fail.map((f: any) => [f.id, f.name]), [[700, "طالب 700"]]);
  assert.match(card.applied.fail[0].why, /مو مفتوح إلك/);
  assert.equal((await find("sched_items", { user_id: 703, kind: "early" })).length, 2);
});
