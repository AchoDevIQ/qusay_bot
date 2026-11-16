// مراحل الفصل: ورا أيام التعويض يصير تعويضي، وورا أيام الإلكتروني فقط يصير إلكتروني فقط، ويا المفاتيح اليدوية
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-stage-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });

const { kvSet } = await import("../lib/db.ts");
const { ensure } = await import("../lib/webApi.ts");
const { setChapterStage, autoMakeup, autoOnline, stageNow, cleanStage } = await import("../lib/chapterStages.ts");
const { onlineOnly } = await import("../lib/keyboards.ts");
const { makeupChapters, setMakeup } = await import("../lib/makeup.ts");
await ensure();

test("الأيام تنحسب من بداية الفصل", async () => {
  await setChapterStage("الفصل الأول", { start: "2026-11-01", makeup: 5, online: 10 });
  assert.deepEqual(await autoMakeup("2026-11-05"), {});
  assert.deepEqual(await autoMakeup("2026-11-06"), { "الفصل الأول": "2026-11-06 00:00" });
  assert.deepEqual(await autoOnline("2026-11-10"), []);
  assert.deepEqual(await autoOnline("2026-11-11"), ["الفصل الأول"]);
  const s = { start: "2026-11-01", makeup: 5, online: 10 };
  assert.equal(stageNow(s, "2026-11-03"), "normal");
  assert.equal(stageNow(s, "2026-11-07"), "makeup");
  assert.equal(stageNow(s, "2026-11-20"), "online");
});

test("إدخال غلط: بلا تاريخ ما ينحفظ، والإلكتروني ما يصير قبل التعويض", () => {
  assert.equal(cleanStage({ start: "", makeup: 5 }), null);
  assert.deepEqual(cleanStage({ start: "2026-11-01", makeup: "7", online: "3" }), { start: "2026-11-01", makeup: 7, online: 7 });
  assert.deepEqual(cleanStage({ start: "2026-11-01", makeup: "", online: "9" }), { start: "2026-11-01", makeup: null, online: 9 });
});

test("المفاتيح اليدوية تبقى ويا الحساب بالأيام", async () => {
  await kvSet("online_only", JSON.stringify(["الفصل الثالث"]));
  await setChapterStage("الفصل الأول", { start: "2020-01-01", makeup: 1, online: 2 });
  assert.deepEqual(await onlineOnly(), ["الفصل الأول", "الفصل الثالث"]);
  await setMakeup("الفصل الثاني", true);
  const m = await makeupChapters();
  assert.ok(m["الفصل الأول"] && m["الفصل الثاني"]);
  await setMakeup("الفصل الثاني", false);
  assert.ok(!(await makeupChapters())["الفصل الثاني"]);
  assert.ok((await makeupChapters())["الفصل الأول"], "الإطفاء اليدوي ما يمس المحسوب بالأيام");
});
