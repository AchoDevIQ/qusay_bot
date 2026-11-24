// شنو يشوف الطالب بالبوت: كل مربع مخفي، أو للكل، أو لفئة أو طلاب بأسمائهم. الكادر وطلاب التجربة يشوفون كلشي
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-vis-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });

const { kvSet, put, insert } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { homeToken } = await import("../lib/webAuth.ts");
const { visibleTiles, inRule } = await import("../lib/studentVis.ts");
const { homeAction } = await import("../lib/homeApi.ts");
await ensure();

const created = "2026-01-01 10:00:00";
await put("students", { user_id: 21, name: "علي", curr: "عربي", gender: "بنين", exam: "إلكتروني", created });
await put("students", { user_id: 22, name: "زهراء", curr: "إنجليزي", gender: "بنات", exam: "حضوري", center_id: 5, created });
await put("students", { user_id: 23, name: "حسن", curr: "عربي", gender: "بنين", exam: "حضوري", center_id: 6, created });
await insert("exam_access", { user_id: 23, chapter: "الفصل الثالث", order_id: null, created });
const rule = (mode: string, o: object = {}) => ({ mode, centers: [], gender: "", curr: "", chapters: [], students: [], ...o });
const save = (r: object) => kvSet("student_vis", JSON.stringify(r));

test("قبل أي اختيار (بالفحص) كلشي ظاهر، ومن تخفي يختفي", async () => {
  assert.equal((await visibleTiles(21)).size, 8, "الثمانية مع 📝 السبورة");
  await save({ shop: rule("off"), notes: rule("all") });
  const v = await visibleTiles(21);
  assert.ok(!v.has("shop"));
  assert.ok(v.has("notes"));
  assert.ok(!v.has("me"), "اللي محفوظ بدون اختيار ينحسب مخفي");
});

test("الفئة: كل شرط لازم ينطبق، والطلاب بأسمائهم دايماً", async () => {
  const r = rule("some", { gender: "بنين", curr: "عربي" }) as never;
  assert.equal(await inRule(r, 21, { gender: "بنين", curr: "عربي" }), true);
  assert.equal(await inRule(r, 22, { gender: "بنات", curr: "إنجليزي" }), false);
  const c = rule("some", { centers: [5] }) as never;
  assert.equal(await inRule(c, 22, { exam: "حضوري", center_id: 5 }), true);
  assert.equal(await inRule(c, 23, { exam: "حضوري", center_id: 6 }), false);
  const online = rule("some", { centers: [-1] }) as never;
  assert.equal(await inRule(online, 21, { exam: "إلكتروني", center_id: null }), true, "الإلكتروني مركزه «بدون مركز»");
  const ch = rule("some", { chapters: ["الفصل الثالث"] }) as never;
  assert.equal(await inRule(ch, 23, { exam: "حضوري", center_id: 6 }), true);
  assert.equal(await inRule(ch, 21, { exam: "إلكتروني" }), false);
  const named = rule("some", { students: [22] }) as never;
  assert.equal(await inRule(named, 22, null), true);
  assert.equal(await inRule(rule("some") as never, 21, { gender: "بنين" }), false, "فئة فارغة ما تفتح لأحد");
});

test("القائمة تطلع بس المفتوح، والمخفي ما يشتغل حتى لو انطلب", async () => {
  await save({ notes: rule("all"), me: rule("some", { students: [22] }) });
  const list = await homeAction({ token: homeToken(21), device: "dev-00000000000021", action: "list" });
  assert.deepEqual(list.show, ["notes"]);
  await assert.rejects(homeAction({ token: homeToken(21), device: "dev-00000000000021", action: "shop" }), /مو مفتوح/);
  await assert.rejects(homeAction({ token: homeToken(21), device: "dev-00000000000021", action: "order", order: {} }), /مو مفتوح/);
  const z = await homeAction({ token: homeToken(22), device: "dev-00000000000022", action: "list" });
  assert.deepEqual(z.show.sort(), ["me", "notes"]);
});

test("صاحب البوت وطلاب التجربة يشوفون كلشي", async () => {
  await save({});
  assert.equal((await visibleTiles(1)).size, 8);
  assert.equal((await visibleTiles(-3)).size, 8);
  assert.equal((await visibleTiles(21)).size, 0);
});
