// الجدول التعويضي المكثف: الفايت بترتيبه، حد الامتحانات باليوم، الثاني ورا ساعتين، والعطل تنعبر
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-catch-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
const { catchupPlan } = await import("../lib/schedApi.ts");
const { DEFAULT_SETTINGS } = await import("../lib/scheduleRules.ts");

test("امتحانين باليوم من باچر، بترتيب مواعيدهم، والثاني ورا ساعتين", () => {
  const s = { ...DEFAULT_SETTINGS, perDay: 2, offDays: [], toHour: 22 };
  const plan = catchupPlan([{ id: 3, at: "2026-11-10 17:00" }, { id: 1, at: "2026-11-03 17:00" }, { id: 2, at: "2026-11-06 17:00" }], s, 17, "2026-11-18");
  assert.deepEqual(plan, [
    { examId: 1, at: "2026-11-18 17:00" },
    { examId: 2, at: "2026-11-18 19:00" },
    { examId: 3, at: "2026-11-19 17:00" },
  ]);
});

test("العطلة الأسبوعية تنعبر، واللي يطلع برا الساعات يروح لليوم الجاي", () => {
  // 2026-11-20 جمعة (4)
  const s = { ...DEFAULT_SETTINGS, perDay: 3, offDays: [4], toHour: 20 };
  const plan = catchupPlan([{ id: 1, at: "a" }, { id: 2, at: "b" }, { id: 3, at: "c" }], s, 18, "2026-11-20");
  assert.deepEqual(plan, [
    { examId: 1, at: "2026-11-21 18:00" },
    { examId: 2, at: "2026-11-21 20:00" },
    { examId: 3, at: "2026-11-22 18:00" },
  ]);
});
