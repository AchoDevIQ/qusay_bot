// «🌐 افتحها بمتصفح التلفون»: رابط التصحيح يشتغل مرة وحدة ولمدة دقيقتين، وبعده جلسة 12 ساعة لنفس الحساب
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-bl-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });

const { ensure } = await import("../lib/webApi.ts");
const { makeBrowserCode, useBrowserCode, LINK_TTL_MS } = await import("../lib/browserLink.ts");
const { browserToken, homeToken, verifyInitData, BROWSER_TTL_S } = await import("../lib/webAuth.ts");
const { gradeAction, gradeBrowserOpen } = await import("../lib/gradeApi.ts");
await ensure();

test("الرمز يشتغل مرة وحدة بس", async () => {
  const code = await makeBrowserCode(5);
  assert.equal(await useBrowserCode(code), 5);
  assert.equal(await useBrowserCode(code), null);
});

test("الرمز ينتهي بعد دقيقتين", async () => {
  const now = Date.now();
  const code = await makeBrowserCode(5, now);
  assert.equal(await useBrowserCode(code, now + LINK_TTL_MS + 1000), null);
  // وانمسح، فحتى بوقته ما يرجع يشتغل
  assert.equal(await useBrowserCode(code, now), null);
});

test("رمز مزوّر أو غلط ما يشتغل", async () => {
  for (const c of ["", "abc", null, 5, "x".repeat(24), "../../etc"]) assert.equal(await useBrowserCode(c), null);
});

test("جلسة المتصفح: 12 ساعة لنفس الحساب، وما تنزور", () => {
  const now = Date.now() / 1000;
  const t = browserToken(7, now);
  assert.equal(verifyInitData(`tk:${t}`, now), 7);
  assert.equal(verifyInitData(`tk:${t}`, now + BROWSER_TTL_S + 5), null);
  const [u, e, sig] = t.slice(1).split(".");
  assert.equal(verifyInitData(`tk:b8.${e}.${sig}`, now), null);
  assert.equal(verifyInitData(`tk:b${u}.${Number(e) + 3600}.${sig}`, now), null);
  // رابط اللوحة القديم يبقى يشتغل مثل قبل
  assert.equal(verifyInitData(`tk:${homeToken(7, now)}`, now), 7);
});

test("من التصحيح: صاحب البوت ياخذ رابط، والمتصفح يبدله بجلسة مرة وحدة", async () => {
  const r = await gradeAction({ initData: `tk:${homeToken(1)}`, action: "browserLink" }) as { code: string };
  assert.match(r.code, /^[\w-]{24}$/);
  const s = await gradeBrowserOpen({ action: "browserOpen", code: r.code }) as { t: string };
  assert.equal(verifyInitData(`tk:${s.t}`), 1);
  await assert.rejects(() => gradeBrowserOpen({ action: "browserOpen", code: r.code }), (e: Error & { status?: number }) => e.status === 401);
});

test("واحد ما عنده صلاحية التصحيح ما ياخذ رابط ولا جلسة", async () => {
  await assert.rejects(() => gradeAction({ initData: `tk:${homeToken(99)}`, action: "browserLink" }), (e: Error & { status?: number }) => e.status === 403);
  const code = await makeBrowserCode(99);
  await assert.rejects(() => gradeBrowserOpen({ code }), (e: Error & { status?: number }) => e.status === 403);
});
