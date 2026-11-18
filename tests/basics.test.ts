// بنين لو بنات والصف إجباريات: الطالب القديم الناقص يختارهن قبل ما يرتب امتحاناته، وطالب التطبيق ياخذهن من التطبيق
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-basics-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;
const { myExamAction } = await import("../lib/schedApi.ts");
const { linkAppStudent } = await import("../lib/appLink.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { initDb, one, put } = await import("../lib/db.ts");
await initDb();
const act = (uid: number, action: string, extra: object = {}) => myExamAction({ token: homeToken(uid), pf: "ios", device: "dev-" + String(uid).padStart(14, "0"), action, ...extra }) as Promise<any>;
const old = (uid: number, o: object = {}) => put("students", { user_id: uid, name: "طالب قديم", curr: "عربي", grade: "", gov: "بغداد", area: "x", phone1: "07701234567", phone2: "07801234567", exam: "إلكتروني", created: "2026-01-01 10:00", ...o });

test("الطالب القديم الناقص: يختار بنين لو بنات وصفه قبل ما يرتب، وبعدها تنقفل", async () => {
  await old(301);
  const info = await act(301, "info");
  assert.deepEqual(info.basics, { gender: true, grade: true });
  await assert.rejects(act(301, "joinPlace", { picks: {} }), /قبل كل شي اختار/);
  await assert.rejects(act(301, "setBasics", { gender: "بنين" }), /صفك/);
  const r = await act(301, "setBasics", { gender: "بنات", grade: "الخامس العلمي" });
  assert.equal(r.basics, null);
  const st = await one("students", { user_id: 301 });
  assert.deepEqual([st!.gender, st!.grade], ["بنات", "الخامس العلمي"]);
  await assert.rejects(act(301, "setBasics", { gender: "بنين" }), /معلوماتك كاملة/);
});

test("طالب التطبيق: الناقص بالبوت ياخذه من التطبيق («ذكر» تصير بنين)، واللي محفوظ ما يتغير، وفصوله تنضاف", async () => {
  await old(302, { grade: "السادس العلمي" });
  await put("app_links", { fu: "fu302", uid: 302, env: "prod", chapters: "[]", created: "x", updated: "x" });
  const s = { fu: "fu302", telegramId: "", name: "اسم ثاني", phone: "", parentPhone: "", province: "", grade: "fifth_preparatory", lang: "ar" as const, gender: "ذكر", birth: "2009-01-02", chapters: ["الفصل الأول", "الفصل الثاني"], examChapters: ["الفصل الأول", "الفصل الثاني"] };
  await linkAppStudent("prod", s);
  const st = await one("students", { user_id: 302 });
  assert.deepEqual([st!.gender, st!.grade, st!.birth, st!.name], ["بنين", "السادس العلمي", "2009-01-02", "طالب قديم"]);
  assert.ok(await one("exam_access", { user_id: 302, chapter: "الفصل الثاني" }));
  // طالب جديد من التطبيق: صفه بكلمة البوت
  const uid = await linkAppStudent("prod", { ...s, fu: "fu-new", gender: "أنثى" });
  const n = await one("students", { user_id: uid });
  assert.deepEqual([n!.gender, n!.grade], ["بنات", "الخامس العلمي"]);
});
