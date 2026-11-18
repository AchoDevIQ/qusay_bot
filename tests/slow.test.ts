// 🐢 الجدول البطيء لطلاب الخامس: يحط تاريخ ووقت كل امتحان بإيده، بالترتيب، ويغير الموعد قبل 24 ساعة
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-slow-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;
const { myExamAction } = await import("../lib/schedApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { addDays } = await import("../lib/scheduleRules.ts");
const { initDb, find, insert, one, put } = await import("../lib/db.ts");
const { todayStr } = await import("../lib/util.ts");
await initDb();
const act = (uid: number, action: string, extra: object = {}) => myExamAction({ token: homeToken(uid), pf: "ios", device: "dev-" + String(uid).padStart(14, "0"), action, ...extra }) as Promise<any>;
const kid = (uid: number, grade: string) => put("students", { user_id: uid, name: `طالب ${uid}`, curr: "عربي", grade, gov: "بغداد", area: "x", phone1: "07701234567", phone2: "07801234567", exam: "إلكتروني", gender: "بنين", created: "2026-01-01 10:00" });
const ex = [] as number[];
for (let i = 1; i <= 3; i++) { const e = Number(await insert("bank_exams", { slug: "s5", chapter: "الفصل الأول", ord: i, pos: 1, title: `امتحان ${i}`, info: "", minutes: 60 })); await insert("bank_versions", { exam_id: e, model: "A", kind: "mandatory", ok: 1 }); ex.push(e); }
await kid(401, "الخامس العلمي"); await kid(402, "السادس العلمي");
for (const u of [401, 402]) await put("exam_access", { user_id: u, chapter: "الفصل الأول", order_id: 1, created: "1" });
const d = (n: number) => addDays(todayStr(), n);

test("طالب الخامس يطلعله الجدول البطيء، والسادس لا", async () => {
  assert.equal((await act(401, "info")).slowOk, true);
  assert.equal((await act(402, "info")).slowOk, false);
  await assert.rejects(act(402, "slowSave", { items: [] }), /لطلاب الخامس بس/);
});

test("يحط تاريخ كل امتحان: لازم الكل، بالترتيب، ومن باچر؛ وينثبت ثابت", async () => {
  await assert.rejects(act(401, "slowSave", { items: [{ exam: ex[0], at: `${d(3)} 16:00` }] }), /اختار تاريخ ووقت «امتحان 2»/);
  await assert.rejects(act(401, "slowSave", { items: [{ exam: ex[0], at: `${d(10)} 16:00` }, { exam: ex[1], at: `${d(5)} 16:00` }, { exam: ex[2], at: `${d(20)} 16:00` }] }), /«امتحان 2» لازم يجي بعد «امتحان 1»/);
  await assert.rejects(act(401, "slowSave", { items: [{ exam: ex[0], at: `${todayStr()} 16:00` }, { exam: ex[1], at: `${d(5)} 16:00` }, { exam: ex[2], at: `${d(20)} 16:00` }] }), /من باچر/);
  await assert.rejects(act(401, "slowSave", { items: [{ exam: ex[0], at: `${d(3)} 03:00` }, { exam: ex[1], at: `${d(5)} 16:00` }, { exam: ex[2], at: `${d(20)} 16:00` }] }), /بس/);
  const r = await act(401, "slowSave", { items: [{ exam: ex[0], at: `${d(3)} 16:00` }, { exam: ex[1], at: `${d(10)} 16:00` }, { exam: ex[2], at: `${d(20)} 18:00` }] });
  assert.match(r.notice, /انثبت جدولك: 3 امتحان/);
  assert.equal(r.mode, "slow");
  assert.equal(r.needsBuild, false);
  const items = await find("sched_items", { user_id: 401 });
  assert.deepEqual(items.map((i) => [i.at, Number(i.fixed)]).sort(), [[`${d(10)} 16:00`, 1], [`${d(20)} 18:00`, 1], [`${d(3)} 16:00`, 1]].sort());
  assert.equal((await one("schedules", { user_id: 401 }))!.mode, "slow");
});

test("يغير موعد امتحان قبل 24 ساعة منه، وما يكسر الترتيب", async () => {
  const it = (await find("sched_items", { user_id: 401 })).find((i) => i.exam_id === ex[1])!;
  await assert.rejects(act(401, "slowMove", { item: it.id, at: `${d(25)} 16:00` }), /«امتحان 3» لازم يجي بعد «امتحان 2»/);
  const r = await act(401, "slowMove", { item: it.id, at: `${d(12)} 17:00` });
  assert.match(r.notice, /صار موعد امتحان 2/);
  assert.equal((await one("sched_items", { id: it.id }))!.at, `${d(12)} 17:00`);
});
