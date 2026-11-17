// تسجيل الطالب الجديد بالتطبيق بطريقة البوت: الزر، والحساب بالمكانين، ويكمل من نفس الخطوة إذا وقف
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-appreg-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none"), APP_WEB_API_KEY: "k" });
const calls: string[] = [];
let failComplete = 1;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  const json = (o: object, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (u.includes("api.telegram.org")) return json({ ok: true, result: { message_id: 1 } });
  if (u.includes("identitytoolkit")) { calls.push("signIn"); return json({ idToken: "tok" }); }
  if (u.includes("executeQuery")) {
    if (body.operationName === "GetCurriculums") return json({ data: { curricula: [{ id: "c5", arabicTitle: "الخامس", status: "published" }, { id: "c6", arabicTitle: "السادس العلمي", status: "published" }] } });
    if (body.operationName === "GetExamCenters") return json({ data: { examCenters: [{ id: "x1", name: "مركز", provinces: ["البصرة"] }, { id: "on", name: "الامتحان الإلكتروني", provinces: [] }] } });
  }
  const name = u.split("/").pop()!;
  calls.push(name);
  if (name === "createStudentAuthAccount") return json({ result: { success: true, uid: "fuNEW", password: "pass1234" } });
  if (name === "signupCreateAccount") { assert.equal(body.data.gender, "ذكر"); assert.equal(body.data.gradeLevel, "sixth_preparatory"); assert.equal(body.data.district, "المنصور"); return json({ result: { success: true } }); }
  if (name === "completeStudentProfile") {
    assert.deepEqual(body.data, { curriculumId: "c6", track: "arabic", examCenterId: "on" });
    if (failComplete-- > 0) return json({ error: { message: "يجب ربط حساب تيليغرام الخاص بك أولاً", status: "INVALID_ARGUMENT" } }, 400);
    return json({ result: { success: true } });
  }
  return json({}, 404);
}) as typeof fetch;

const { ensure } = await import("../lib/webApi.ts");
const { one } = await import("../lib/db.ts");
const { appRegAction, setAppReg } = await import("../lib/appReg.ts");
const { verifyPassword } = await import("../lib/password.ts");
await ensure();
const phone = "07711112222";
const form = { n: "علي حسن محمد كاظم", cu: "عربي", gr: "السادس العلمي", g: "بغداد", s: "الكرخ", a: "شارع 14", p1: phone, p2: "07800001111", e: "إلكتروني", c: 0, sx: "بنين", b: "2008-05-04", dz: "المنصور" };

test("الزر مطفي: التسجيل من البوت مسدود", async () => {
  await assert.rejects(appRegAction({ action: "info", phone }), /مسدود/);
});
test("مشغّل: يسوي الحساب بالتطبيق وبالبوت، وإذا وقف يكمل من نفس الخطوة", async () => {
  await setAppReg(true);
  const info: any = await appRegAction({ action: "info", phone, env: "staging" });
  assert.ok(info.districts.includes("المنصور") && info.g.includes("بغداد"));
  await assert.rejects(appRegAction({ action: "register", phone, env: "staging", rev: info.rev, form: { ...form, p1: "07700000000" } }), /نفس الرقم/);
  await assert.rejects(appRegAction({ action: "register", phone, env: "staging", rev: info.rev, form: { ...form, dz: "" } }), /منطقتك/);
  await assert.rejects(appRegAction({ action: "register", phone, env: "staging", rev: info.rev, form }), /تليگرام/);
  assert.deepEqual(calls.filter((c) => c !== "signIn"), ["createStudentAuthAccount", "signupCreateAccount", "completeStudentProfile"]);
  calls.length = 0;
  const r: any = await appRegAction({ action: "register", phone, env: "staging", rev: info.rev, form });
  assert.equal(r.password, "pass1234");
  assert.deepEqual(calls.filter((c) => c !== "signIn"), ["completeStudentProfile"], "يكمل من الخطوة اللي وقف بيها");
  const link = await one("app_links", { fu: "fuNEW" });
  const uid = Number(link!.uid);
  assert.ok(uid >= 10_000_000_000_000);
  assert.equal((await one("students", { user_id: uid }))!.name, "علي حسن محمد كاظم");
  assert.ok(verifyPassword("pass1234", String((await one("student_pass", { user_id: uid }))!.hash)));
});
