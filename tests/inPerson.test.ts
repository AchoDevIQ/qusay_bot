// الحضوري: كود الطالب، تسجيل الحضور، الطباعة، ورفع أوراق السكانر للتصحيح
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-ip-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.NO_WORD_CHECK;
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ method: String(url).split("/").pop()!, p: init.body instanceof FormData ? {} : JSON.parse(init.body) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const ip = await import("../lib/inPerson.ts");
const { myExamAction } = await import("../lib/schedApi.ts");
const { initDb, insert, one, find, put } = await import("../lib/db.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { stamp, todayStr } = await import("../lib/util.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const at = (uid: number, action: string, x: object = {}) => ip.attendAction({ initData: sign(uid), action, ...x }) as Promise<any>;
const jpg = () => new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: "image/jpeg" });
const upload = (uid: number, item: number, q: number) => { const fd = new FormData(); fd.set("initData", sign(uid)); fd.set("item", String(item)); fd.set("q", String(q)); fd.set("file", jpg(), "p.jpg"); return ip.scanUpload(fd); };

const area = await insert("areas", { gov: "بغداد", name: "البنوك" });
const center = await insert("centers", { area_id: area, name: "معهد تجربة", active: 1 });
const ex = await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: 1, title: "الأوميگا", minutes: 60, pos: 1 });
const ver = await insert("bank_versions", { exam_id: ex, model: "A", kind: "mandatory", ok: 1 });
for (const n of [1, 2]) await insert("bank_questions", { version_id: ver, n, max_mark: 50, q_file: `none/q${n}.png` });
await put("students", { user_id: 80, name: "حضوري أول", exam: "حضوري", center_id: center, created: "2026-01-01 00:00" });
await put("students", { user_id: 81, name: "إلكتروني", exam: "إلكتروني", created: "2026-01-01 00:00" });
await put("staff", { user_id: 40, name: "مساعد الحضور", perms: "attend" });
await put("staff", { user_id: 41, name: "مصحح", perms: "grade" });
const item = await insert("sched_items", { user_id: 80, exam_id: ex, at: stamp(), status: "waiting" });

test("كود الطالب موقع، وكود مزور مرفوض", () => {
  const c = ip.studentCode(80);
  assert.equal(ip.verifyStudentCode(c), 80);
  assert.equal(ip.verifyStudentCode(c.replace("QS:80", "QS:81")), null);
  assert.equal(ip.verifyStudentCode("hello"), null);
});

test("الحضور: بس اللي عنده صلاحية، والطالب الإلكتروني أو اللي ما عنده امتحان اليوم مرفوض", async () => {
  await assert.rejects(at(41, "list"), (e: any) => e.status === 403);
  await assert.rejects(at(40, "scan", { code: ip.studentCode(81) }), /إلكتروني/);
  await assert.rejects(at(40, "scan", { code: "QS:80.000000000000" }), /مو كود طالب/);
  const r = await at(40, "scan", { code: ip.studentCode(80) });
  assert.equal(r.card.name, "حضوري أول");
  assert.equal(r.card.already, false);
  assert.equal(r.card.print, "label");
  const it = (await one("sched_items", { id: item }))!;
  assert.deepEqual([it.status, it.version_id, it.attended_by], ["attended", ver, 40]);
  // مرة ثانية: يگله كان مسجل، وبالرقم يشتغل هم
  assert.equal((await at(40, "scan", { code: "80" })).card.already, true);
  assert.equal(r.today, 1);
});

test("الطباعة: الرابط موقع، والليبل والورقة بيها الأكواد", async () => {
  const t = ip.printToken("l", item);
  assert.deepEqual(ip.verifyPrintToken(t), { kind: "l", id: item });
  assert.equal(ip.verifyPrintToken(t.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), null);
  assert.equal(ip.verifyPrintToken(ip.printToken("l", item, 0)), null);   // انتهى
  const label = await ip.labelHtml(item);
  assert.match(label, /size:58mm 39mm/);
  assert.match(label, /حضوري أول/);
  const paper = await ip.paperHtml("i", item);
  assert.equal((paper.match(/class="p"/g) ?? []).length, 2);   // كل سؤال بصفحة
  assert.match(paper, /سؤال 2 من 2/);
  const copy = await ip.paperHtml("v", ver);
  assert.match(copy, /الصق الليبل هنا/);
});

test("إعدادات المركز لصاحب البوت بس، والورقة الكاملة تصير الطباعة الأساسية", async () => {
  await assert.rejects(at(40, "saveCenter", { center, print: "paper" }), (e: any) => e.status === 403);
  const r = await at(1, "saveCenter", { center, print: "paper", photos: true });
  assert.deepEqual(r.centers.find((c: any) => c.id === center), { id: center, name: "معهد تجربة", print: "paper", photos: true });
  assert.equal((await at(40, "scan", { code: "80" })).card.print, "paper");
  // التصوير من التلفون: كود الحضور يطلع بصفحته
  const info = await myExamAction({ token: homeToken(80), pf: "ios", device: "dev-00000000000080", action: "info" }) as any;
  assert.equal(info.attendCode, ip.studentCode(80));
});

test("أوراق السكانر: كل صفحة لسؤالها، وبعدها تروح للتصحيح ويوصل خبر للمصحح", async () => {
  await assert.rejects(upload(41, item, 1), (e: any) => e.status === 403);
  await assert.rejects(upload(40, item, 5), /السؤال 5 مو موجود/);
  await upload(40, item, 1); await upload(40, item, 2); await upload(40, item, 2);
  const its = await at(40, "items", { items: [item, 9999] });
  assert.deepEqual(its.items.map((x: any) => [x.ok, x.name, x.qs]), [[true, "حضوري أول", [1, 2]], [false, "", []]]);
  calls.length = 0;
  const r = await at(40, "finish", { items: [item] });
  assert.match(r.notice, /1 ورقة راحت للتصحيح/);
  assert.equal((await one("sched_items", { id: item }))!.status, "done");
  assert.equal((await find("exam_answers", { item_id: item })).length, 3);
  assert.ok(calls.some((c) => c.p.chat_id === 41 && /وصلتك أوراق/.test(c.p.text)));
});

test("تصوير الورقة بكاميرا المساعد: اللي عنده تصوير بس يلگى الطالب ويرفع ويدز، وما يگدر يطبع أو يغير المراكز", async () => {
  await put("staff", { user_id: 42, name: "مساعد الكاميرا", perms: "camup" });
  await put("students", { user_id: 82, name: "حضوري ثاني", exam: "حضوري", center_id: center, created: "2026-01-01 00:00" });
  const it2 = await insert("sched_items", { user_id: 82, exam_id: ex, at: stamp(), status: "waiting" });
  await assert.rejects(at(41, "cam", { code: "82" }), (e: any) => e.status === 403);
  await assert.rejects(at(42, "scan", { code: "82" }), (e: any) => e.status === 403);
  await assert.rejects(at(42, "saveCenter", { center, print: "paper" }), (e: any) => e.status === 403);
  const r = await at(42, "cam", { code: ip.studentCode(82) });
  assert.equal(r.full, false);
  assert.deepEqual([r.cam.item, r.cam.name, r.cam.qs, r.cam.have], [it2, "حضوري ثاني", [1, 2], []]);
  assert.equal((await one("sched_items", { id: it2 }))!.status, "attended");
  await upload(42, it2, 1); await upload(42, it2, 2);
  const f = await at(42, "finish", { items: [it2] });
  assert.match(f.notice, /1 ورقة راحت للتصحيح/);
  assert.equal((await one("sched_items", { id: it2 }))!.status, "done");
  assert.deepEqual((await at(42, "cam", { code: "82" })).cam.have.sort(), [1, 2]);
});

test("الحضوري بالآيباد: يختاره بنفسه، ما ينطبعله شي، والأسئلة تنفتح بس بعد الحضور والوقت يبدي من هسه", async () => {
  // مركز ثاني ما مفتوحله التصوير (اختبار قبل يفتحه لمركز الأول)
  const c2 = await insert("centers", { area_id: area, name: "معهد ثاني", active: 1 });
  await put("students", { user_id: 82, name: "حضوري آيباد", exam: "حضوري", center_id: c2, created: "2026-01-01 00:00" });
  await put("guardians", { guardian_id: 9082, student_id: 82, created: "x" });
  const it82 = await insert("sched_items", { user_id: 82, exam_id: ex, at: stamp(), status: "waiting" });
  const me = (uid: number, action: string, x: object = {}) => myExamAction({ token: homeToken(uid), pf: "ios", device: "dev-" + String(uid).padStart(14, "0"), action, ...x }) as Promise<any>;
  await assert.rejects(me(82, "openExam", { item: it82 }), /ينقدم بالمركز/);
  await assert.rejects(me(81, "ipadExam", { on: true }), /للطالب الحضوري/);
  assert.equal((await me(82, "info")).ipad, false);
  assert.equal((await me(82, "ipadExam", { on: true })).ipad, true);
  // قبل الحضور: مقفول، حتى لو قاعد بالبيت
  await assert.rejects(me(82, "openExam", { item: it82 }), /من يسجلون حضورك/);
  assert.equal((await me(82, "info")).items.find((i: any) => i.id === it82).state, "center");
  const r = await at(40, "scan", { code: ip.studentCode(82) });
  assert.equal(r.card.print, "ipad");
  assert.ok(!r.card.queued);
  assert.equal((await me(82, "info")).items.find((i: any) => i.id === it82).state, "open");
  const opened = await me(82, "openExam", { item: it82 });
  assert.equal(opened.room.id, it82);
  const row = (await one("sched_items", { id: it82 }))!;
  assert.equal(row.status, "started");
  assert.ok(row.started_at && row.started_at >= row.attended_at);
  // يرجع للورقة
  assert.equal((await me(82, "ipadExam", { on: false })).ipad, false);
});
