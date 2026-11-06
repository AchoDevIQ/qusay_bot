// السيطرة: ورا كل كم امتحان من الفصل تنحسب، والطالب اللي ما يعبر تنوقف عليه الامتحانات (والمحاضرات إذا مشتريها)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-cp-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
delete process.env.NO_WORD_CHECK;
delete process.env.FIREBASE_STORAGE_BUCKET;
const calls: { method: string; p: any }[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  const p = init.body instanceof FormData ? {} : JSON.parse(init.body);
  calls.push({ method: String(url).split("/").pop()!, p });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;
const { checkpointsAction, runCheckpoints, lecturesStopped, activeStop } = await import("../lib/checkpoints.ts");
const { myExamAction } = await import("../lib/schedApi.ts");
const { initDb, insert, put } = await import("../lib/db.ts");
const { homeToken } = await import("../lib/webAuth.ts");
await initDb();
const sign = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const cp = (action: string, x: object = {}, uid = 1) => checkpointsAction({ initData: sign(uid), action, ...x }) as Promise<any>;
const exams: number[] = [];
for (let i = 1; i <= 6; i++) exams.push(await insert("bank_exams", { slug: "c1", chapter: "الفصل الأول", ord: i, title: `امتحان ${i}`, minutes: 60, pos: 1 }));
const reg = async (uid: number, name: string) => put("students", { user_id: uid, name, exam: "إلكتروني", created: "2026-01-01 00:00:00" });
const graded = (uid: number, n: number, total: number) => insert("sched_items", { user_id: uid, exam_id: exams[n], at: `2026-02-0${n + 1} 10:00:00`, status: "done", total, graded_at: "x", submitted_at: "x" });
const missed = (uid: number, n: number) => insert("sched_items", { user_id: uid, exam_id: exams[n], at: `2026-02-0${n + 1} 10:00:00`, status: "missed" });

test("صفحة السيطرة لصاحب البوت بس، والسيطرة تنحط ورا أي امتحان وتشمل اللي من بعد السيطرة اللي قبلها", async () => {
  await put("staff", { user_id: 30, name: "مساعد", perms: "grade" });
  await assert.rejects(cp("list", {}, 30), (e: any) => e.status === 403);
  const r = await cp("list");
  assert.deepEqual(r.chapters.map((c: any) => [c.chapter, c.exams.length]), [["الفصل الأول", 6]]);
  assert.deepEqual(r.chapters[0].exams.map((e: any) => e.since), [1, 2, 3, 4, 5, 6]);
  await assert.rejects(cp("saveCp", { exam: exams[2], min: 400, absent: 0 }), /من 0 إلى 300/);
  await assert.rejects(cp("saveCp", { exam: exams[2], min: 0, absent: 0 }), /حط أقل مجموع/);
  await cp("saveCp", { exam: exams[2], min: 150, absent: 2 });
  // السيطرة الثانية تبدي من بعد الأولى: امتحانين بس
  const s = await cp("saveCp", { exam: exams[4], min: 100, absent: 0 });
  assert.deepEqual(s.chapters[0].exams.map((e: any) => e.since), [1, 2, 3, 1, 2, 1]);
  assert.deepEqual(s.chapters[0].exams[4].cp, { min: 100, absent: 0, bands: [] });
  await assert.rejects(cp("saveCp", { exam: exams[4], min: 300, absent: 0 }), /من 0 إلى 200/);
  const d = await cp("delCp", { exam: exams[4] });
  assert.equal(d.chapters[0].exams[4].cp, null);
});

test("اللي يعبر ما ينوقف، والسيطرة تنتظر لحد ما تنصحح كل الامتحانات", async () => {
  await reg(50, "عابر");
  await graded(50, 0, 60); await graded(50, 1, 50);
  await insert("sched_items", { user_id: 50, exam_id: exams[2], at: "2026-02-03 10:00:00", status: "done", submitted_at: "x" });
  await runCheckpoints(50);
  assert.equal(await activeStop(50), null);
  await graded(50, 3, 90);   // الرابع من السيطرة الثانية، والثالثة لسه ما انصححت
  await runCheckpoints(50);
  assert.equal(await activeStop(50), null);
});

test("درجة قليلة: تنوقف الامتحانات، والرسالة توصل للطالب وولي أمره وصاحب البوت", async () => {
  await reg(51, "واطي");
  await put("guardians", { guardian_id: 71, student_id: 51, created: "x" });
  await graded(51, 0, 40); await graded(51, 1, 50); await graded(51, 2, 30);
  calls.length = 0;
  await runCheckpoints(51);
  const s = (await activeStop(51))!;
  assert.equal(s.score, 120);
  assert.match(String(s.reason), /عدم تحقيق الدرجة المطلوبة/);
  const to = calls.filter((c) => c.method === "sendMessage").map((c) => c.p.chat_id);
  assert.deepEqual(to, [51, 71, 1]);
  assert.match(calls[0].p.text, /توقفت عليك الامتحانات\n[\s\S]*مجموعك 120 من 300، والمطلوب 150/);
  assert.match(calls[1].p.text, /على الطالب واطي/);
  assert.equal(await lecturesStopped(51), false);   // ما مشتري محاضرات
  // صفحة امتحاناته ما تنفتح
  await assert.rejects(myExamAction({ token: homeToken(51), device: "dev-00000000000051", action: "info" }), (e: any) => e.status === 423 && /توقفت عليك الامتحانات/.test(e.message));
  // مرة ثانية ما توصل رسالة ثانية
  calls.length = 0;
  await runCheckpoints(51);
  assert.equal(calls.length, 0);
});

test("الغياب: صفر ويوقف إذا وصل العدد، واللي مشتري محاضرات تنوقف عليه هي هم", async () => {
  await reg(52, "غايب");
  await insert("orders", { user_id: 52, items: JSON.stringify([{ name: "محاضرات الفصل الأول" }]), created: "2026-01-02 00:00:00", printed: 0 });
  await graded(52, 0, 100); await missed(52, 1); await missed(52, 2);
  await runCheckpoints(52);
  const s = (await activeStop(52))!;
  assert.equal(s.absent, 2);
  assert.equal(s.reason, "عدم تحقيق الدرجة المطلوبة للعبور وكثرة الغيابات");   // 100 أقل من 150، وغاب مرتين
  assert.equal(await lecturesStopped(52), true);
});

test("فك الإيقاف يرجعه، والرسائل تتعدل", async () => {
  const r = await cp("list");
  assert.ok(r.stopped.some((s: any) => s.id === 51));
  calls.length = 0;
  const after = await cp("lift", { id: 51 });
  assert.ok(!after.stopped.some((s: any) => s.id === 51));
  assert.equal(await activeStop(51), null);
  assert.match(calls[0].p.text, /رجعت الامتحانات/);
  await myExamAction({ token: homeToken(51), device: "dev-00000000000051", action: "info" });
  const t = await cp("saveTexts", { student: "وقف {الاسم} {الدرجة}", guardian: "ولي {الاسم}" });
  assert.equal(t.student, "وقف {الاسم} {الدرجة}");
  assert.equal((await cp("resetTexts")).student.startsWith("⛔"), true);
});

test("السيطرة الثانية تحسب بس الامتحانات اللي بعد الأولى، والحضوري اللي ما بيه أجوبة غياب", async () => {
  await cp("saveCp", { exam: exams[4], min: 120, absent: 0 });
  await reg(54, "ثاني");
  await graded(54, 0, 90); await graded(54, 1, 90); await graded(54, 2, 90);   // الأولى: 270 يعبر
  await graded(54, 3, 50); await graded(54, 4, 60);                         // الثانية: 110 من 200 والمطلوب 120
  await runCheckpoints(54);
  const s = (await activeStop(54))!;
  assert.equal(s.score, 110);
  assert.equal(s.max, 200);
  await put("students", { user_id: 55, name: "حضوري", exam: "حضوري", created: "2026-01-01 00:00:00" });
  await graded(55, 0, 100);
  await insert("sched_items", { user_id: 55, exam_id: exams[1], at: "2026-02-02 10:00", status: "waiting" });
  await insert("sched_items", { user_id: 55, exam_id: exams[2], at: "2026-02-03 10:00", status: "waiting" });
  await runCheckpoints(55);
  assert.equal((await activeStop(55))!.absent, 2);
});

test("الإعادة: الغياب ينمسح إذا اجت درجة بعده، والسيطرة تنتظر الإعادة، وإذا الأول مصحح تنحسب درجته", async () => {
  const { find } = await import("../lib/db.ts");
  await reg(80, "معيد");
  await missed(80, 0); await missed(80, 1); await graded(80, 2, 60);
  // إعادة الأول بعدها ما صارت: السيطرة تنتظر
  const r0 = await insert("sched_items", { user_id: 80, exam_id: exams[0], at: "2099-01-01 10:00", status: "waiting", fixed: "retake" });
  await runCheckpoints(80);
  assert.equal((await find("checkpoint_done", { user_id: 80 })).length, 0);
  // صارت الإعادتين وانصححن: الغياب راح وتبقى الدرجات
  await put("sched_items", { id: r0, user_id: 80, exam_id: exams[0], at: "2026-03-01 10:00", status: "done", total: 70, graded_at: "x", fixed: "retake" });
  await insert("sched_items", { user_id: 80, exam_id: exams[1], at: "2026-03-02 10:00", status: "done", total: 80, graded_at: "x", fixed: "retake" });
  await runCheckpoints(80);
  const d = (await find("checkpoint_done", { user_id: 80 }))[0];
  assert.deepEqual([d.score, d.absent, d.passed], [210, 0, 1]);
  assert.equal(await activeStop(80), null);
  // الأول مصحح والإعادة أعلى: تنحسب الأولى، والثنتين يبينن
  await reg(81, "معيد ثاني");
  await graded(81, 0, 40); await graded(81, 1, 40); await graded(81, 2, 40);
  await insert("sched_items", { user_id: 81, exam_id: exams[0], at: "2026-03-01 10:00", status: "done", total: 100, graded_at: "x", fixed: "retake" });
  await runCheckpoints(81);
  assert.equal((await find("checkpoint_done", { user_id: 81 }))[0].score, 120);
});

test("نتيجة اللي عبر: لكل سيطرة درجاتها ورسالتها وصورها، الطالب ما توصله نفس الصورة مرتين، وولي أمره الكتابة بس", async () => {
  const { find } = await import("../lib/db.ts");
  const pic = (n: number) => new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n])], { type: "image/png" });
  const form = (x: Record<string, string>, pics: Blob[] = []) => { const f = new FormData(); f.set("initData", sign(1)); for (const [k, v] of Object.entries(x)) f.set(k, v); for (const p of pics) f.append("file", p); return f; };
  await assert.rejects(cp("saveBand", { exam: exams[1], from: 1, to: 2, text: "x" }), /أنشئ السيطرة أول/);
  await assert.rejects(cp("saveBand", { exam: exams[2], from: 200, to: 400, text: "x" }), /من 0 إلى 300/);
  await assert.rejects(cp("saveBand", { exam: exams[2], from: 290, to: 250, text: "x" }), /أصغر/);
  // السيطرة الثانية (بعد الامتحان الخامس) تشمل الرابع والخامس: من 200
  await checkpointsAction(form({ action: "saveBand", exam: String(exams[2]), from: "250", to: "300", text: "🌹 عاشت إيدك يا {الاسم}، جبت {الدرجة} من {الكلي}" }, [pic(1), pic(2)]));
  await checkpointsAction(form({ action: "saveBand", exam: String(exams[4]), from: "160", to: "200", text: "🌹 مرة ثانية يا {الاسم}" }, [pic(1), pic(2)]));
  await assert.rejects(cp("saveBand", { exam: exams[2], from: 200, to: 260, text: "y" }), /تتداخل ويا 250 إلى 300/);
  const r = await cp("saveBand", { exam: exams[2], from: 150, to: 249, text: "👍 زين يا {الاسم}" });
  const c2 = r.chapters[0].exams[2].cp;
  assert.deepEqual(c2.bands.map((b: any) => [b.from, b.to, b.pics.length]), [[250, 300, 2], [150, 249, 0]]);
  // نفس الصورة بسيطرتين: نفس الاسم
  assert.deepEqual(r.chapters[0].exams[4].cp.bands[0].pics.map((p: any) => p.ref).sort(), c2.bands[0].pics.map((p: any) => p.ref).sort());
  // حفظ شرط السيطرة ما يمسح نتائجها
  const kept = await cp("saveCp", { exam: exams[2], min: 150, absent: 2 });
  assert.equal(kept.chapters[0].exams[2].cp.bands.length, 2);
  const st = await checkpointsAction(form({ action: "stopImage" }, [])).catch((e) => e);
  assert.match(String(st.message), /اختار صورة/);
  // طالب جاب 270: صورة ورسالة إله، وولي أمره الرسالة بس
  await reg(90, "شاطر");
  await put("guardians", { guardian_id: 91, student_id: 90, created: "x" });
  for (const n of [0, 1, 2]) await graded(90, n, 90);
  calls.length = 0;
  await runCheckpoints(90);
  assert.equal(await activeStop(90), null);
  assert.equal(calls.filter((c) => c.method === "sendPhoto").length, 1);
  const msgs = calls.filter((c) => c.method === "sendMessage");
  assert.deepEqual(msgs.map((m) => m.p.chat_id), [90, 91]);
  assert.match(msgs[0].p.text, /عاشت إيدك يا شاطر، جبت 270 من 300/);
  const first = (await find("checkpoint_done", { user_id: 90 }))[0].image;
  assert.ok(first);
  // الكارت بصفحته بنفس الصورة، ومن يدوس تمام يختفي
  const { checkpointCard, seeCheckpoint } = await import("../lib/checkpoints.ts");
  const card = (await checkpointCard(90))!;
  assert.match(card.text, /جبت 270 من 300/);
  assert.ok(card.image.includes(encodeURIComponent(first)));
  await seeCheckpoint(90, card.key);
  assert.equal(await checkpointCard(90), null);
  // السيطرة الثانية بنفس الدرجات: صورة غير اللي شافها
  for (const n of [3, 4]) await graded(90, n, 90);
  await runCheckpoints(90);
  const rows = await find("checkpoint_done", { user_id: 90 });
  assert.equal(rows.length, 2);
  assert.notEqual(rows.find((x) => x.block === exams[4])!.image, first);
});

test("بالنسبة لكل السيطرات: نسبة وحدة توقف، ونتائجها بالنسبة، وترجع للدرجات بزر", async () => {
  const { find } = await import("../lib/db.ts");
  await assert.rejects(cp("savePct", { min: 0, absent: 0 }), /حط نسبة/);
  await cp("savePct", { min: 60, absent: 0 });
  await cp("saveMode", { mode: "percent" });
  // السيطرة تنحط بمكانها بدون شرط
  const r = await cp("saveCp", { exam: exams[0] });
  assert.equal(r.mode, "percent");
  await assert.rejects(cp("saveBand", { exam: "pct", from: 80, to: 120, text: "x" }), /من 0 إلى 100%/);
  await cp("saveBand", { exam: "pct", from: 90, to: 100, text: "🌹 {الاسم} جبت {النسبة}" });
  // سيطرة الأول (امتحان واحد من 100): 60% يعني 60
  await reg(95, "واطي بالنسبة"); await graded(95, 0, 55);
  await runCheckpoints(95);
  assert.equal((await activeStop(95))!.need, 60);
  await reg(96, "عالي بالنسبة"); await graded(96, 0, 95);
  calls.length = 0;
  await runCheckpoints(96);
  assert.equal(await activeStop(96), null);
  assert.match(calls.find((c) => c.method === "sendMessage")!.p.text, /عالي بالنسبة جبت 95%/);
  assert.ok((await find("checkpoint_done", { user_id: 96 }))[0].band);
  const back = await cp("saveMode", { mode: "marks" });
  assert.equal(back.mode, "marks");
  await cp("delCp", { exam: exams[0] });
});
