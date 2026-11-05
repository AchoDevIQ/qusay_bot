// صفحتا الطلاب والمراكز
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-st-"));
const TOKEN = "123:secret-token";
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN, ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CHROME_PATH: path.join(tmp, "none"), SETTINGS_FILE: path.join(tmp, "none") });
const sent: any[] = [];
globalThis.fetch = (async (url: string, o: any) => {
  if (typeof o?.body === "string") sent.push({ m: String(url).split("/").pop(), p: JSON.parse(o.body) }); else sent.push({ m: String(url).split("/").pop() });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
}) as typeof fetch;

const { studentAction } = await import("../lib/studentApi.ts");
const { centerAction } = await import("../lib/centerApi.ts");
const { ApiError } = await import("../lib/webApi.ts");
const { initDb, one, put, find } = await import("../lib/db.ts");
const { GOVS } = await import("../lib/config.ts");

const sign = (uid: number) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  p.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update(TOKEN).digest()).update(check).digest("hex"));
  return p.toString();
};
const initData = sign(1);
const st = (b: Record<string, unknown>) => studentAction({ initData, ...b });
const ce = (b: Record<string, unknown>) => centerAction({ initData, ...b });
await initDb();
const base = { username: "u", name: "علي حسن محمد كاظم", curr: "عربي", grade: "السادس العلمي", gov: "بغداد", side: "الكرخ", area: "المنصور قرب", phone1: "07701234567", phone2: "07801234567", exam: "إلكتروني", center_id: null, created: "2026-11-01 10:00:00", updated: "" };
await put("students", { user_id: 100, ...base });
await put("students", { user_id: 101, ...base, name: "زيد حسن محمد كاظم", phone1: "07701111111", grade: "الخامس العلمي", created: "2026-11-02 10:00:00" });
const form = (o: Record<string, unknown> = {}) => ({ n: base.name, cu: "عربي", gr: "السادس العلمي", g: "بغداد", s: "الكرخ", a: "المنصور قرب", p1: "07701234567", p2: "07801234567", e: "إلكتروني", c: 0, ...o });

test("الصلاحية: الطلاب والمراكز بس لصاحب صلاحية الطلاب", async () => {
  await put("staff", { user_id: 5, name: "م", perms: "orders" });
  await put("staff", { user_id: 6, name: "م", perms: "students,centers" });
  for (const fn of [studentAction, centerAction]) {
    await assert.rejects(fn({ action: "list" }), (e: any) => e.status === 401);
    await assert.rejects(fn({ action: "list", initData: sign(2) }), (e: any) => e.status === 403);
    await assert.rejects(fn({ action: "list", initData: sign(5) }), (e: any) => e.status === 403);
    assert.ok(await fn({ action: "list", initData: sign(6) }));
  }
});

test("الأرقام والبحث", async () => {
  const r = await st({ action: "list" });
  assert.deepEqual([r.stats.all, r.stats.g6, r.stats.g5, r.stats.on], [2, 1, 1, 2]);
  assert.equal(r.results[0].id, 101);                                                 // الأحدث أول
  assert.deepEqual((await st({ action: "list", q: "زيد" })).results.map((x: any) => x.id), [101]);
  assert.deepEqual((await st({ action: "list", q: "٠٧٧٠١٢٣٤٥٦٧" })).results.map((x: any) => x.id), [100]);
  assert.equal((await st({ action: "list", q: "ماكو" })).results.length, 0);
});

test("المراكز: إضافة وتغيير اسم وحذف، والاسم ما يتكرر", async () => {
  const before = (await ce({ action: "list" })).areas.length;
  await assert.rejects(ce({ action: "addArea", gov: "لندن", name: "س", center: "ص" }), ApiError);
  await assert.rejects(ce({ action: "addArea", gov: "بغداد", name: "جديدة", center: "" }), /مركز/);
  const r = await ce({ action: "addArea", gov: "بغداد", name: "جديدة", center: "مركز 1" });
  assert.equal(r.areas.length, before + 1);
  await assert.rejects(ce({ action: "addArea", gov: "بغداد", name: "جديدة", center: "ص" }), /منطقة/);
  const a = r.areas.find((x: any) => x.name === "جديدة");
  await ce({ action: "addCenter", id: a.id, name: "مركز 2" });
  await assert.rejects(ce({ action: "addCenter", id: a.id, name: "مركز 2" }), /مركز/);
  const a2 = (await ce({ action: "list" })).areas.find((x: any) => x.id === a.id);
  await ce({ action: "renameCenter", id: a2.centers[1].id, name: "مركز ب" });
  await assert.rejects(ce({ action: "renameCenter", id: a2.centers[1].id, name: "مركز 1" }), /مركز/);
  await ce({ action: "renameArea", id: a.id, name: "جديدة 2" });
  assert.equal((await one("areas", { id: a.id }))!.name, "جديدة 2");
  await ce({ action: "delCenter", id: a2.centers[1].id });
  assert.equal((await ce({ action: "list" })).areas.find((x: any) => x.id === a.id).centers.length, 1);
  await ce({ action: "delArea", id: a.id });
  assert.equal((await ce({ action: "list" })).areas.some((x: any) => x.id === a.id), false);
  assert.equal((await find("centers", { area_id: a.id, active: 1 })).length, 0);
  await assert.rejects(ce({ action: "delArea", id: a.id }), ApiError);
});

test("نوع الامتحان لكل محافظة", async () => {
  const r = await ce({ action: "mode", gov: "البصرة", mode: "both" });
  assert.equal(r.modes.find((m: any) => m.gov === "البصرة").mode, "both");
  assert.equal(r.modes.length, GOVS.length);
  await assert.rejects(ce({ action: "mode", gov: "البصرة", mode: "x" }), ApiError);
});

test("تعديل الطالب: الأخطاء ما تحفظ، وتغيير المركز يبلغ الطالب ويحدث العدد", async () => {
  await assert.rejects(st({ action: "save", id: 999, form: form() }), /غير موجود/);
  await assert.rejects(st({ action: "save", id: 100, form: form({ n: "علي" }) }), /رباعي/);
  await assert.rejects(st({ action: "save", id: 100, form: form({ p2: "07701234567" }) }), /مختلفة/);
  await assert.rejects(st({ action: "save", id: 100, form: form({ e: "حضوري", c: 0 }) }), /المركز/);

  const list = await ce({ action: "addArea", gov: "بغداد", name: "الكرادة", center: "مركز الكرادة" });
  const center = list.areas.find((x: any) => x.name === "الكرادة").centers[0];
  sent.length = 0;
  await st({ action: "save", id: 100, form: form({ e: "حضوري", c: center.id, gr: "الخامس العلمي" }) });
  const s = (await one("students", { user_id: 100 }))!;
  assert.deepEqual([s.exam, s.center_id, s.grade, s.username, s.created], ["حضوري", center.id, "الخامس العلمي", "u", base.created]);
  assert.ok(sent.some((x) => x.p?.chat_id === 100 && /مركزك الامتحاني/.test(x.p.text)));
  assert.equal((await ce({ action: "list" })).areas.find((x: any) => x.name === "الكرادة").centers[0].n, 1);

  sent.length = 0;
  await st({ action: "save", id: 100, form: form({ e: "حضوري", c: center.id, gr: "الخامس العلمي" }) });  // نفس المركز، ماكو رسالة
  assert.equal(sent.some((x) => x.p?.chat_id === 100), false);
  await st({ action: "save", id: 100, form: form() });
  assert.equal((await one("students", { user_id: 100 }))!.center_id, null);           // إلكتروني بدون مركز
});

test("حذف التسجيل", async () => {
  const r = await st({ action: "del", id: 101 });
  assert.equal(r.stats.all, 1);
  assert.equal(await one("students", { user_id: 101 }), null);
  await assert.rejects(st({ action: "del", id: 101 }), /غير موجود/);
});

test("قوائم PDF توصل لمحادثة صاحب الطلب", async () => {
  sent.length = 0;
  const r = await st({ action: "pdf", kind: "all" });
  assert.match(r.notice, /وصلك/);
  assert.ok(sent.some((x) => x.m === "sendDocument"));
});
