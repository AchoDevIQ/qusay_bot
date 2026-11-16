// باب تطبيق قصي: رمز الدخول يتحقق بمفاتيح كوكل، الطالب ينربط بحسابه بالبوت، وفصوله المشتراة بالتطبيق تفتح ملازمه
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-app-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });

const { find, insert, one } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { appKey, verifyHomeToken } = await import("../lib/webAuth.ts");
const { verifyAppIdToken, linkAppStudent, appChapters, chapterOf, enterFromApp, isAppUid } = await import("../lib/appLink.ts");
const { ownedChapters, myBooks } = await import("../lib/notes.ts");
const { checkDevice, checkPhone } = await import("../lib/deviceLock.ts");
await ensure();

// مفتاح تجريبي بدل مفاتيح كوكل
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEYS = { k1: publicKey.export({ type: "spki", format: "pem" }).toString() };
const now = Math.floor(Date.now() / 1000);
function jwt(body: object, kid = "k1") {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "RS256", kid, typ: "JWT" }), pay = enc(body);
  const sig = createSign("RSA-SHA256").update(`${head}.${pay}`).sign(privateKey).toString("base64url");
  return `${head}.${pay}.${sig}`;
}
const good = (sub: string, o: object = {}) => jwt({ aud: "qmath-iq", iss: "https://securetoken.google.com/qmath-iq", sub, iat: now - 10, exp: now + 3600, ...o });

test("رمز الدخول: يقبل بس رمز مشروع التطبيق الموقع والصالح", async () => {
  assert.equal(await verifyAppIdToken(good("fu1"), now, KEYS), "fu1");
  assert.equal(await verifyAppIdToken(good("fu1", { aud: "other" }), now, KEYS), null);
  assert.equal(await verifyAppIdToken(good("fu1", { iss: "https://securetoken.google.com/other" }), now, KEYS), null);
  assert.equal(await verifyAppIdToken(good("fu1", { exp: now - 1 }), now, KEYS), null);
  assert.equal(await verifyAppIdToken(jwt({ aud: "qmath-iq", iss: "https://securetoken.google.com/qmath-iq", sub: "fu1", iat: now, exp: now + 60 }, "nokey"), now, KEYS), null);
  const t = good("fu1").split(".");
  assert.equal(await verifyAppIdToken(`${t[0]}.${Buffer.from(JSON.stringify({ aud: "qmath-iq", iss: "https://securetoken.google.com/qmath-iq", sub: "admin", iat: now, exp: now + 60 })).toString("base64url")}.${t[2]}`, now, KEYS), null);
  assert.equal(await verifyAppIdToken("x.y", now, KEYS), null);
});

test("أرقام الفصول بالتطبيق تصير أسماء فصول البوت", () => {
  assert.equal(chapterOf(1), "الفصل الأول");
  assert.equal(chapterOf(3), "الفصل الثالث");
  assert.equal(chapterOf(0), "");
  assert.equal(chapterOf(9), "");
});

const base = { telegramId: "", name: "طالب تطبيق", phone: "07700000000", parentPhone: "07800000000", province: "بغداد", grade: "السادس", lang: "ar" as const, gender: "ذكر", birth: "2008-01-01", chapters: ["الفصل الأول"], examChapters: [] as string[] };

test("المربوط بتلگرام ياخذ نفس حسابه بالبوت، وغيره رقم جديد ثابت", async () => {
  await insert("students", { user_id: 555000111, name: "قديم بالبوت", curr: "إنجليزي", exam: "حضوري", center_id: 3, created: "2026-01-01 10:00:00" });
  const a = await linkAppStudent("prod", { ...base, fu: "fuA", telegramId: "555000111" });
  assert.equal(a, 555000111);
  assert.equal((await one("students", { user_id: a }))?.name, "قديم بالبوت", "معلوماته بالبوت ما تتغير");
  assert.equal((await one("students", { user_id: a }))?.exam, "حضوري", "نوع امتحانه بالبوت يبقى");
  const b = await linkAppStudent("prod", { ...base, fu: "fuB" });
  assert.ok(isAppUid(b));
  assert.equal(await linkAppStudent("prod", { ...base, fu: "fuB", chapters: ["الفصل الثالث"] }), b, "نفس الحساب بكل دخول");
  const c = await linkAppStudent("staging", { ...base, fu: "fuC", lang: "en" });
  assert.notEqual(c, b);
  const st = await one("students", { user_id: c });
  assert.equal(st?.curr, "إنجليزي");
  assert.equal(st?.phone1, "07700000000");
  assert.equal(st?.exam, "إلكتروني", "طالب التطبيق امتحانه إلكتروني");
  assert.deepEqual(await appChapters(b), ["الفصل الثالث"], "الفصول تتحدث كل دخول");
});

test("امتحانات الفصل المشتراة بالتطبيق تنفتح، وما تنسحب", async () => {
  const d = await linkAppStudent("prod", { ...base, fu: "fuE", examChapters: ["الفصل الأول", "الفصل الثاني"] });
  assert.deepEqual((await find("exam_access", { user_id: d })).map((r) => r.chapter).sort(), ["الفصل الأول", "الفصل الثاني"]);
  await linkAppStudent("prod", { ...base, fu: "fuE", examChapters: ["الفصل الأول"] });
  assert.equal((await find("exam_access", { user_id: d })).length, 2);
});

test("فصل التطبيق يفتح ملازم نفس الفصل ونفس المنهج", async () => {
  await insert("note_books", { title: "ثالث عربي", chapter: "الفصل الثالث", lang: "ar", file: "a1", pages: 2, created: "2026-01-01 10:00:00" });
  await insert("note_books", { title: "ثالث انكليزي", chapter: "الفصل الثالث", lang: "en", file: "a2", pages: 2, created: "2026-01-01 10:00:00" });
  const b = Number((await one("app_links", { fu: "fuB" }))?.uid);
  assert.deepEqual(await ownedChapters(b), ["الفصل الثالث"]);
  assert.deepEqual((await myBooks(b)).map((x) => x.title), ["ثالث عربي"]);
});

test("مفتاح التطبيق يعبر قفل الجهاز وشرط تلگرام الموبايل، بس لصاحبه", async () => {
  const b = Number((await one("app_links", { fu: "fuB" }))?.uid);
  await checkDevice(b, `app-${appKey(b)}`);
  await checkPhone(b, `app.${appKey(b)}`);
  assert.equal(await one("student_devices", { user_id: b }), null, "ما ينقفل على جهاز بالبوت");
  await assert.rejects(checkPhone(b, `app.${appKey(b + 1)}`));
  await assert.rejects(checkPhone(b, "web"));
  // مفتاح غلط ينحسب جهاز عادي: أول جهاز ينقفل عليه، والثاني ينرفض
  await checkDevice(b, `app-${appKey(b + 1)}`);
  await assert.rejects(checkDevice(b, "dev-00000000000099"));
});

test("الدخول من التطبيق: يقرا الطالب وفصوله ويحول لملازمي باسمه", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    const json = (o: object, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
    if (u.includes("securetoken@system")) return json(KEYS);
    if (u.includes("firestore.googleapis.com")) {
      assert.match(u, /databases\/staging\/documents\/student_access\/fuD$/);
      assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${tok}`);
      return json({ fields: { lessonChapterIds: { arrayValue: { values: [{ stringValue: "C3" }, { stringValue: "T1" }] } }, examChapterIds: { arrayValue: { values: [{ stringValue: "C5" }] } } } });
    }
    const body = JSON.parse(String(init?.body));
    assert.match(u, /services\/qmath-iq-staging-service\/connectors\/main:executeQuery$/);
    assert.equal((init?.headers as Record<string, string>)["X-Firebase-Auth-Token"], tok);
    if (body.operationName === "GetStudent") return json({ data: { students: [{ fullName: "طالب جديد", phone: "07711111111", curriculumLanguage: "ar", telegramId: null, curriculum: { id: "cur" } }] } });
    if (body.operationName === "GetChaptersByCurriculum") return json({ data: { chapters: [{ id: "c3", orderPosition: 3 }, { id: "t1", orderPosition: 6, isTestChapter: true }, { id: "c4", orderPosition: 4 }, { id: "c5", orderPosition: 5 }] } });
    return json({}, 404);
  }) as typeof fetch;
  const tok = good("fuD");
  try {
    const to = await enterFromApp({ id: tok, env: "staging", page: "notes" });
    assert.ok(to?.startsWith("/store/notes?"));
    const q = new URLSearchParams(to!.split("?")[1]);
    const uid = verifyHomeToken(q.get("t"));
    assert.ok(uid && isAppUid(uid));
    assert.equal(q.get("app"), appKey(uid!));
    assert.deepEqual(await appChapters(uid!), ["الفصل الثالث", "الفصل الخامس"]);
    assert.deepEqual((await find("exam_access", { user_id: uid! })).map((r) => r.chapter), ["الفصل الخامس"], "الامتحانات بس من examChapterIds");
    const ex = await enterFromApp({ id: tok, env: "staging", page: "myexams" });
    assert.ok(ex?.startsWith("/store/myexams?"));
    assert.ok((await enterFromApp({ id: tok, env: "staging", page: "admin" }))?.startsWith("/store/notes?"), "صفحة غير مسموحة ترجع لملازمي");
    assert.equal(await enterFromApp({ id: good("fuD", { aud: "x" }), env: "staging" }), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
