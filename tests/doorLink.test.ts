// باب الكادر بدون تليگرام: رابط خاص + رمز ← جلسة 12 ساعة لصفحاته، والرابط يبطل، ورسائله تنحفظ بمحادثته
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-door-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { headers: { "Content-Type": "application/json" } })) as typeof fetch;

const { put } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { makeDoor, revokeDoor, newStaffId, STAFF_BASE } = await import("../lib/doorLink.ts");
const { doorAction } = await import("../lib/doorApi.ts");
const { verifyHomeToken } = await import("../lib/webAuth.ts");
const { send } = await import("../lib/telegram.ts");
const { chatAction } = await import("../lib/appChatApi.ts");
const { verifyInitData } = await import("../lib/webAuth.ts");
await ensure();

test("مساعد بدون تليگرام: رابط، رمز، جلسة أسبوع تفتح صفحات الإدارة، ورسائله برسائلي", async () => {
  const uid = await newStaffId();
  assert.ok(uid > STAFF_BASE);
  await put("staff", { user_id: uid, name: "مصحح", perms: "grade" });
  const d = new URL(await makeDoor(uid, "مصحح")).searchParams.get("d")!;
  assert.equal((await doorAction({ d, action: "state" })).hasPin, false);
  await assert.rejects(doorAction({ d, action: "setPin", pin: "1111", pin2: "1111" }), /سهل/);
  const r: any = await doorAction({ d, action: "setPin", pin: "4826", pin2: "4826" });
  assert.equal(r.admin, true);
  assert.equal(verifyHomeToken(r.t), uid);
  assert.equal(verifyInitData(`tk:${r.t}`), uid, "صفحات الإدارة تقبله");
  assert.equal(verifyInitData(`tk:${r.t}`, Date.now() / 1000 + 8 * 86400), null, "اللوحة ترفضه ورا أسبوع");
  await assert.rejects(doorAction({ d, action: "open", pin: "0000" }), /غلط/);
  await send(uid, "📝 أكو ورقة تنتظرك");
  const l: any = await chatAction({ token: r.t, app: "", action: "list" });
  assert.equal(l.msgs.at(-1).text, "📝 أكو ورقة تنتظرك");
});

test("رابط جديد يبطل القديم، والإبطال يسد الباب", async () => {
  const uid = 7_001_234;
  await put("staff", { user_id: uid, name: "مساعد بتليگرام", perms: "q" });
  const d1 = new URL(await makeDoor(uid, "أ")).searchParams.get("d")!;
  const d2 = new URL(await makeDoor(uid, "أ")).searchParams.get("d")!;
  await assert.rejects(doorAction({ d: d1, action: "state" }), /انتهى/);
  assert.equal((await doorAction({ d: d2, action: "state" })).hasPin, false);
  await revokeDoor(uid);
  await assert.rejects(doorAction({ d: d2, action: "state" }), /انتهى/);
});

test("صاحب المكتبة من رابطه: الوصل ينفتح صفحة وتنطبع بطابعة الجهاز، وبس بيعات مكتبته", async () => {
  const { insert } = await import("../lib/db.ts");
  const { homeToken } = await import("../lib/webAuth.ts");
  const { GET } = await import("../app/api/receipt/route.ts");
  const off = Number(await insert("offices", { name: "مكتبة النور", lim: 0, active: 1 }));
  const other = Number(await insert("offices", { name: "مكتبة ثانية", lim: 0, active: 1 }));
  const seller = 7_005_000;
  await put("office_users", { user_id: seller, office_id: off, name: "أبو علي" });
  const mine = Number(await insert("orders", { user_id: 50, name: "طالب", items: JSON.stringify([{ name: "دفتر", qty: 1, price: 5000 }]), subtotal: 5000, fee: 0, total: 5000, created: "2026-11-17 10:00", printed: 3, office_id: off }));
  const theirs = Number(await insert("orders", { user_id: 50, name: "طالب", items: "[]", subtotal: 0, fee: 0, total: 0, created: "2026-11-17 10:00", printed: 3, office_id: other }));
  const t = homeToken(seller);
  const ok = await GET(new Request(`https://x.test/api/receipt?t=${encodeURIComponent(t)}&id=${mine}`));
  assert.equal(ok.status, 200);
  const html = await ok.text();
  assert.ok(html.includes("window.print()") && html.includes("اطبع الوصل"));
  assert.equal((await GET(new Request(`https://x.test/api/receipt?t=${encodeURIComponent(t)}&id=${theirs}`))).status, 404, "بيعة مكتبة ثانية");
  assert.equal((await GET(new Request(`https://x.test/api/receipt?t=bad&id=${mine}`))).status, 401);
});
