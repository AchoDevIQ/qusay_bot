// المنافسة: مجموعة باسم ما يتكرر، الصديق يوافق بالرابط، نفس نوع الاشتراك بس، من 5 يروح الطلب للإدارة،
// والترتيب بالمعدل من كل الامتحانات (الغياب صفر). وترتيب المراكز: الطالب يشوف ترتيبه إذا من أول 100
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-cmp-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ method: String(url).split("/").pop()!, p: JSON.parse(init.body) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const c = await import("../lib/competition.ts");
const { initDb, insert, put, one, find } = await import("../lib/db.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const admin = (action: string, x: object = {}) => c.competitionAction({ initData: sign(1), action, ...x }) as Promise<any>;
const area = await insert("areas", { gov: "بغداد", name: "زيونة", active: 1 });
const center = await insert("centers", { area_id: area, name: "معهد زيونة", active: 1 });
const ex = await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: 1, title: "امتحان", minutes: 60, pos: 1 });
// طلاب امتحانات بس (8)، وواحد عنده محاضرات، وواحد ما عنده امتحانات
for (let i = 0; i < 8; i++) {
  const uid = 100 + i;
  await put("students", { user_id: uid, name: `طالب ${i}`, exam: "حضوري", center_id: center, created: "x" });
  await insert("exam_access", { user_id: uid, chapter: "الفصل الأول", created: "x" });
}
await put("students", { user_id: 200, name: "محاضرات", exam: "إلكتروني", created: "x" });
await insert("exam_access", { user_id: 200, chapter: "الفصل الأول", created: "x" });
await insert("orders", { user_id: 200, items: JSON.stringify([{ name: "محاضرات الفصل الأول", qty: 1 }]), printed: 3, created: "x" });
await put("students", { user_id: 300, name: "بدون امتحانات", exam: "إلكتروني", created: "x" });
// الدرجات: 100 جاب 90 و80، و101 جاب 100 وغاب مرة (يعني 50)
const mark = (uid: number, total: number | null) => insert("sched_items", { user_id: uid, exam_id: ex, at: "x", status: total === null ? "missed" : "done", graded_at: total === null ? null : "x", total });
await mark(100, 90); await mark(100, 80); await mark(101, 100); await mark(101, null); await mark(102, 70);

test("المجموعة: اسم ما يتكرر، وبس للي عنده امتحانات، وطالب بمجموعة وحدة", async () => {
  await assert.rejects(c.createGroup(300, "النجوم"), /بس للي عنده امتحانات/);
  await assert.rejects(c.createGroup(100, "مج"), /3 حروف/);
  await c.createGroup(100, "المجد");
  await assert.rejects(c.createGroup(101, " المَجد ".replace("َ", "")), /مستخدم قبل/);
  await assert.rejects(c.createGroup(100, "ثانية"), /إنت بمجموعة/);
});

test("الصديق يوافق بالرابط، ونوع الاشتراك لازم نفسه، ومن 5 يروح الطلب للإدارة", async () => {
  const g = (await one("comp_groups", { name: "المجد" }))!;
  calls.length = 0;
  await c.invitePrompt(101, 101, g.code);
  const kb = calls[0].p.reply_markup.inline_keyboard[0];
  assert.deepEqual(kb.map((b: any) => b.callback_data), [`cj:ok:${g.code}`, `cj:no:${g.code}`]);
  assert.equal(await c.inviteCb(101, 101, 5, `cj:no:${g.code}`), "تمام");
  assert.equal((await find("comp_members", { group_id: g.id })).length, 1);
  await assert.rejects(c.joinGroup(200, g.code), /امتحانات بس/);
  for (const uid of [101, 102, 103]) assert.equal(await c.inviteCb(uid, uid, 5, `cj:ok:${g.code}`), "✅ فتت للمجموعة");
  assert.equal((await one("comp_groups", { id: g.id }))!.status, "open");
  calls.length = 0;
  await c.joinGroup(104, g.code);
  assert.equal((await one("comp_groups", { id: g.id }))!.status, "pending");
  const review = calls.find((x) => x.p.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `cg:ok:${g.id}`)!;
  assert.equal(review.p.chat_id, 1);
  assert.match(review.p.text, /المجد[\s\S]*الطلاب \(5\)/);
});

test("قبل الموافقة ما يبين ترتيب، وبعدها يشوفون كلهم معدلاتهم، والغياب صفر", async () => {
  const before = (await c.studentComp(101))!;
  assert.equal(before.group!.status, "pending");
  assert.ok(before.group!.members.every((m) => m.avg === null));
  assert.equal(await c.reviewCb(1, 300, 5, "cg:ok:1"), "ما عندك صلاحية");
  calls.length = 0;
  assert.match(await c.reviewCb(1, 1, 5, `cg:ok:${(await one("comp_groups", { name: "المجد" }))!.id}`), /انقبلت/);
  assert.ok(calls.some((x) => x.method === "sendMessage" && /انقبلت مجموعة/.test(x.p.text)));
  const after = (await c.studentComp(101))!;
  assert.deepEqual(after.group!.members.map((m) => [m.name, m.avg, m.rank]).slice(0, 3), [["طالب 0", 85, 1], ["طالب 2", 70, 2], ["طالب 1", 50, 3]]);
});

test("ترتيب المركز: صاحب البوت يشوفه كامل، والطالب ترتيبه هو", async () => {
  const r = await admin("list");
  assert.deepEqual(r.centers[0].students.map((s: any) => s.name), ["طالب 0", "طالب 2", "طالب 1"]);
  const me = (await c.studentComp(102))!;
  assert.deepEqual([me.center!.rank, me.center!.total, me.center!.avg], [2, 3, 70]);
  assert.equal((await c.studentComp(105))!.center!.rank, null);   // ما امتحن
});

test("الطلوع: المجموعة تنتقل لغيره، وإذا ما بقى أحد تنشال", async () => {
  await c.createGroup(105, "الأبطال");
  await c.joinGroup(106, (await one("comp_groups", { name: "الأبطال" }))!.code);
  await c.leaveGroup(105);
  assert.equal((await one("comp_groups", { name: "الأبطال" }))!.owner_id, 106);
  await c.leaveGroup(106);
  assert.equal(await one("comp_groups", { name: "الأبطال" }), null);
});
