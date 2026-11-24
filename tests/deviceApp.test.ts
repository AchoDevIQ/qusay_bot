// 🖨 تطبيق جهاز البيع (طلب الأستاذ 2026-11-24): الوصل صورة بعرض الطابعة بالضبط، بلا فراغ أبيض تحته
import { test } from "node:test";
import assert from "node:assert/strict";

const { trimReceipt } = await import("../lib/documents.ts");

test("🖨 صورة الوصل: عرضها 384 (عرض طابعة الجهاز)، والفراغ الأبيض اللي تحت ينگص", async () => {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const c = createCanvas(384, 1200), g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 384, 1200);
  g.fillStyle = "#000"; g.fillRect(20, 20, 300, 400);
  const out = await loadImage(await trimReceipt(c.toBuffer("image/png")));
  assert.equal(out.width, 384);
  assert.ok(out.height >= 420 && out.height <= 450, `الطول ${out.height}`);
});
