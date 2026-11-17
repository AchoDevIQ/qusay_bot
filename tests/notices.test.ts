// إشعارات الطلاب: مؤقت يختفي بعد القراءة، دائمي يبقى لحد ما ينمسح، المسح يشيله من الكل، والفئة. وطلباتي ومعلوماتي
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-notices-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) as typeof fetch;

const { insert, put, one, kvSet } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { announceAction, inboxAction, unreadNotices } = await import("../lib/notices.ts");
const { myAction } = await import("../lib/myPages.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { saveOut, unreadChat, markChatSeen } = await import("../lib/appChat.ts") as any;
await ensure();
const admin = `tk:${homeToken(1)}`;
const dev = "d0123456789abcdef0123456789abcdef";
await put("students", { user_id: 60, name: "علي حسن", curr: "عربي", gender: "بنين", exam: "إلكتروني", created: "x" });
await put("students", { user_id: 61, name: "زينب علي", curr: "إنجليزي", gender: "بنات", exam: "إلكتروني", created: "x" });
await kvSet("app_pilot", JSON.stringify([60]));
const box = (uid: number, action = "list", more = {}) => inboxAction({ token: homeToken(uid), device: dev + uid, action, ...more }) as Promise<any>;

test("مؤقت: يطلع، وبعد ما يقراه يختفي. دائمي: يبقى لحد ما ينمسح من عند الكل", async () => {
  await announceAction({ initData: admin, action: "send", text: "بكرة عطلة", kind: "temp", aud: "all" });
  const keep: any = await announceAction({ initData: admin, action: "send", text: "رقم الإدارة", kind: "keep", aud: "all" });
  assert.equal(keep.list.length, 2);
  assert.equal(await unreadNotices(61), 2);
  const l = (await box(61)).list;
  await box(61, "read", { id: l[0].id }); await box(61, "read", { id: l[1].id });
  assert.equal(await unreadNotices(61), 0);
  assert.deepEqual((await box(61)).list.map((n: any) => n.text), ["رقم الإدارة"]);
  const keepId = keep.list.find((n: any) => n.kind === "keep").id;
  await announceAction({ initData: admin, action: "del", id: keepId });
  assert.equal((await box(61)).list.length, 0);
  assert.equal((await box(60)).list.length, 1);
});
test("طلاب التجربة بس، والفئة (المنهج وطلاب بأسمائهم)", async () => {
  await announceAction({ initData: admin, action: "send", text: "للتجربة", kind: "keep", aud: "pilot" });
  await announceAction({ initData: admin, action: "send", text: "للإنجليزي", kind: "keep", aud: "some", rule: JSON.stringify({ curr: "إنجليزي" }) });
  await assert.rejects(announceAction({ initData: admin, action: "send", text: "لا أحد", kind: "keep", aud: "some", rule: "{}" }), /الفئة/);
  const t60 = (await box(60)).list.map((n: any) => n.text), t61 = (await box(61)).list.map((n: any) => n.text);
  assert.ok(t60.includes("للتجربة") && !t60.includes("للإنجليزي"));
  assert.ok(t61.includes("للإنجليزي") && !t61.includes("للتجربة"));
  await assert.rejects(announceAction({ initData: `tk:${homeToken(61)}`, action: "list" }), /صلاحية/);
});
test("علامة المحادثة: رسائل البوت اللي ما شافها، وتنشال لما يفتح", async () => {
  const n0 = await unreadChat(60);
  const id = Number(await insert("app_msgs", { uid: 60, dir: "out", text: "درجتك", html: 0, created: "x", del: 0 }));
  await insert("app_msgs", { uid: 60, dir: "in", text: "شكراً", html: 0, created: "x", del: 0 });
  assert.equal(await unreadChat(60), n0 + 1);
  await markChatSeen(60, id);
  assert.equal(await unreadChat(60), 0);
  void saveOut;
});
test("طلباتي: الطلب وحالته، والإلغاء قبل ما يتجهز بس. ومعلوماتي", async () => {
  const a = Number(await insert("orders", { user_id: 60, name: "علي حسن", items: JSON.stringify([{ name: "ملزمة", qty: 2 }]), total: 20000, created: "2026-11-17 10:00", printed: 0 }));
  const b = Number(await insert("orders", { user_id: 60, name: "علي حسن", items: "[]", total: 5000, created: "2026-11-17 11:00", printed: 1 }));
  const my = (action: string, more = {}) => myAction({ token: homeToken(60), device: dev + 60, action, ...more }) as Promise<any>;
  const l = (await my("orders")).list;
  assert.deepEqual(l.map((o: any) => [o.id, o.cancel]), [[b, false], [a, true]]);
  assert.equal(l[1].items[0].qty, 2);
  await assert.rejects(my("cancel", { id: b }), /تجهز/);
  const r = await my("cancel", { id: a });
  assert.match(r.notice, /انلغى/);
  assert.equal(Number((await one("orders", { id: a }))!.printed), 2);
  await assert.rejects(myAction({ token: homeToken(61), device: dev + 61, action: "cancel", id: a }), /غير موجود/);
  assert.match((await my("me")).html, /علي حسن/);
});
test("طوارئ لطالب بالاسم: يشوف البوت كله والباقين لا. ورابط المتصفح يوديه لقائمته", async () => {
  const { visibleTiles, setSos } = await import("../lib/studentVis.ts");
  const { makeDoor, verifyDoor, doorTargets, revokeDoor } = await import("../lib/doorLink.ts");
  await kvSet("student_vis", JSON.stringify({}));
  assert.equal((await visibleTiles(61)).size, 0);
  await setSos(61, true);
  assert.ok((await visibleTiles(61)).has("exams"));
  assert.equal((await visibleTiles(60)).size, 0);
  const link = await makeDoor(61, "زينب علي");
  const d = new URL(link).searchParams.get("d");
  assert.equal(await verifyDoor(d), 61);
  assert.deepEqual(await doorTargets(61), { admin: false, office: false, student: true });
  await revokeDoor(61);
  assert.equal(await verifyDoor(d), null, "الرابط الموقوف ما يشتغل");
  await setSos(61, false);
  assert.equal((await visibleTiles(61)).size, 0);
});
test("طالب يستعمل التطبيق: رسائل البوت بالتطبيق بس، وبالطوارئ بالاثنين", async () => {
  const { chatMode, forgetMode } = await import("../lib/appChat.ts");
  const { setSos } = await import("../lib/studentVis.ts");
  await put("app_links", { fu: "fu-tg", uid: 555, env: "staging", chapters: "[]", created: "x", updated: "x" });
  forgetMode(555);
  assert.equal(await chatMode(555), "app");
  await setSos(555, true);
  assert.equal(await chatMode(555), "both");
  await setSos(555, false);
  assert.equal(await chatMode(555), "app");
  assert.equal(await chatMode(556), "tg", "طالب تليگرام بس يبقى مثل ما هو");
});
