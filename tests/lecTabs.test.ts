// 🎬 تبويبات المحاضرة: شروحات السبورة اللي نزلت بيها، وأسئلة الطالب بموضوعها ومحاضرتها
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-lectabs-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
const { initDb, insert, kvSet, put } = await import("../lib/db.ts");
await initDb();
const { lecTabsFor, ensureLecInfo } = await import("../lib/lecTabs.ts");

test("🎬 تبويبات المحاضرة: سبورة الشرح بس لمحاضرتها، وأسئلتي بموضوعها ومحاضرتها", async () => {
  const L1 = "11111111-1111-1111-1111-111111111111", L2 = "22222222-2222-2222-2222-222222222222", EN1 = "33333333-3333-3333-3333-333333333333";
  await kvSet("path_lec_staging", JSON.stringify([{ ch: 3, name: "تطبيقات", topics: [{ name: "المعدلات الزمنيه", lectures: [{ id: L1, title: "المحاضره 1", track: "arabic" }, { id: L2, title: "المحاضره 2", track: "arabic" }, { id: EN1, title: "Lecture 1", track: "english" }] }] }]));
  const info = await ensureLecInfo(L2);
  assert.equal(info!.lec, 2); assert.equal(info!.ch, 3); assert.equal(info!.topic, "المعدلات الزمنيه");
  await kvSet("board_sent", JSON.stringify([{ id: "s1", title: "شرح 1", pages: 3, at: "x", app: { env: "staging", lecture: L1, att: "a", more: [{ lecture: EN1, att: "b" }] } }, { id: "s2", title: "بلا محاضرة", pages: 1, at: "y" }]));
  // مواضيع الأسئلة العلمية جاهزة بالقاعدة: «المعدلات الزمنية» بالفصل الثالث
  const { find } = await import("../lib/db.ts");
  const ch3 = (await find("chapters")).find((c) => Number(c.ord) === 3)!;
  const tid = Number((await find("topics", { chapter_id: ch3.id })).find((t) => t.ar === "المعدلات الزمنية")!.id);
  await put("students", { user_id: 5, name: "س", created: "x" });
  await kvSet("qa_mine_5", JSON.stringify([{ id: "aaaaaaaaaaaaaaaa", at: "2026-11-26 10:00", q: "سؤال المحاضرة 1", tid, lecture: 1 }, { id: "bbbbbbbbbbbbbbbb", at: "2026-11-26 11:00", q: "سؤال المحاضرة 2", tid, lecture: 2 }]));
  await insert("questions", { user_id: 5, topic_id: tid, lecture: 1, status: "open", created: "2026-11-26 09:00" });
  const t1 = await lecTabsFor(5, L1);
  assert.deepEqual(t1.board.map((b) => b.id), ["s1"]);
  assert.deepEqual(t1.myq.map((m) => m.kind === "ai" ? m.q : `#${m.id}`), ["سؤال المحاضرة 1", "#1"]);
  assert.deepEqual((await lecTabsFor(5, EN1)).board.map((b) => b.id), ["s1"], "الانگليزي هم");
  const t2 = await lecTabsFor(5, L2);
  assert.equal(t2.board.length, 0, "ماكو شرح للمحاضرة 2: التبويب ما يطلع");
  assert.deepEqual(t2.myq.map((m) => m.kind === "ai" ? m.q : ""), ["سؤال المحاضرة 2"]);
  assert.equal((await lecTabsFor(5, "bad")).qs, false);
});
