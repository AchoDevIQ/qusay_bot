// تسجيل الطالب الجديد من الصفحة: الشروط القابلة للتعديل، الحفظ، وكلمة المرور
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-regflow-"));
Object.assign(process.env, {
  DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp,
  CHROME_PATH: path.join(tmp, "none"), ASSETS_DIR: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none"),
});
delete process.env.NO_WORD_CHECK;

const calls: { method: string; p: any }[] = [];
let nextId = 100;
globalThis.fetch = (async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
  calls.push({ method, p });
  const result = method === "getChat" ? { username: "ali_tg" } : method === "getMe" ? { username: "test_bot" } : { message_id: ++nextId };
  return new Response(JSON.stringify({ ok: true, result }));
}) as typeof fetch;

const { homeAction } = await import("../lib/homeApi.ts");
const { termsAction } = await import("../lib/terms.ts");
const { studentAction } = await import("../lib/studentApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { regLink } = await import("../lib/keyboards.ts");
const { termWords } = await import("../lib/orderRules.ts");
const { verifyPassword } = await import("../lib/password.ts");
const { get } = await import("../lib/sqliteDriver.ts");

const initData = (uid: number) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const key = createHmac("sha256", "WebAppData").update("1:test").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const act = (uid: number, action: string, extra: object = {}) => homeAction({ token: homeToken(uid), action, ...extra });
const FORM = { n: "علي حسن محمد كاظم", cu: "عربي", gr: "السادس العلمي", g: "البصرة", s: "", a: "العشار قرب الجسر", p1: "07701234567", p2: "07801234567", e: "إلكتروني", c: 0 };

test("كلمات الترتيب بدون العلامات الوحدها", () => {
  assert.deepEqual(termWords("- سيتم *** عرض\nالتعليمات / 25"), ["سيتم", "عرض", "التعليمات", "25"]);
});

test("المدير يضيف ويعدل ويحذف، وغيره ممنوع", async () => {
  const admin = initData(1);
  await assert.rejects(termsAction({ initData: initData(5), action: "list" }), (e: any) => e.status === 403);
  const start = (await termsAction({ initData: admin, action: "list" })).terms;
  assert.equal(start.length, 7);
  const added = (await termsAction({ initData: admin, action: "add", text: "شرط جديد للتجربة" })).terms;
  const id = added.at(-1)!.id;
  assert.equal(added.length, 8);
  assert.equal((await termsAction({ initData: admin, action: "save", id, text: "شرط معدل" })).terms.at(-1)!.text, "شرط معدل");
  await assert.rejects(termsAction({ initData: admin, action: "save", id, text: "  " }), (e: any) => e.status === 400);
  assert.equal((await termsAction({ initData: admin, action: "del", id })).terms.length, 7);
});

test("الرابط يحمل الرمز للطالب الجديد بس، والتسجيل يحفظه ويرجع كلمة مروره", async () => {
  const d = (url: string) => JSON.parse(Buffer.from(new URL(url).searchParams.get("d")!, "base64url").toString("utf8"));
  assert.ok(d(await regLink(2)).tk);
  assert.equal(d(await regLink(1, 2)).tk, undefined);

  const info: any = await act(2, "regInfo");
  assert.equal(info.registered, false);
  await assert.rejects(act(2, "register", { rev: "old", form: FORM }), (e: any) => e.status === 409);
  await assert.rejects(act(2, "register", { rev: info.rev, form: { ...FORM, n: "علي" } }), (e: any) => e.status === 400);
  assert.equal(await get("SELECT user_id FROM students WHERE user_id=2"), null);

  calls.length = 0;
  const r: any = await act(2, "register", { rev: info.rev, form: FORM });
  assert.match(r.password, /^[a-z2-9]{8}$/);
  assert.equal(new URL(r.url).pathname, "/store/home");
  assert.equal((await get("SELECT username FROM students WHERE user_id=2"))!.username, "ali_tg");
  const stored = (await get("SELECT hash FROM student_pass WHERE user_id=2"))!.hash as string;
  assert.ok(!stored.includes(r.password));
  assert.ok(verifyPassword(r.password, stored));
  assert.ok(!verifyPassword("wrong-pass", stored));
  assert.ok(!JSON.stringify(calls).includes(r.password));   // الكلمة ما تنحفظ بالمحادثة

  await assert.rejects(act(2, "register", { rev: info.rev, form: FORM }), (e: any) => e.status === 400);
  assert.equal(((await act(2, "regInfo")) as any).registered, true);
  assert.equal(d(await regLink(2)).tk, undefined);
});

test("اللي جا من المتجر يرجع للمتجر بعد التسجيل", async () => {
  const shop: any = await act(3, "shop");
  assert.equal(new URL(shop.url).pathname, "/store/reg");
  const info: any = await act(3, "regInfo");
  const r: any = await act(3, "register", { rev: info.rev, form: { ...FORM, p1: "07701234568", p2: "07801234568" } });
  assert.equal(new URL(r.url).pathname, "/store");
});

test("المدير يسوي كلمة جديدة، والحذف يشيلها", async () => {
  const admin = initData(1);
  const old = (await get("SELECT hash FROM student_pass WHERE user_id=2"))!.hash;
  const { notice } = await studentAction({ initData: admin, action: "pass", id: 2 }) as any;
  const fresh = /: ([a-z2-9]{8})$/.exec(notice)![1];
  const stored = (await get("SELECT hash FROM student_pass WHERE user_id=2"))!.hash as string;
  assert.notEqual(stored, old);
  assert.ok(verifyPassword(fresh, stored));
  await studentAction({ initData: admin, action: "del", id: 2 });
  assert.equal(await get("SELECT user_id FROM student_pass WHERE user_id=2"), null);
});
