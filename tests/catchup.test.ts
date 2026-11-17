// جدول التعويض (اتفاق الأستاذ 2026-11-17): الفايت بترتيبه، بالأيام اللي اختارها الطالب، ولحد ما يبدي الفصل الجاي
// بأيام المرحلة المكثفة وبعدها بأيام المرحلة الخفيفة. يوم امتحانه ويا جماعته والعطل تنعبر. و«يوم بين يوم»
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qmath-catch-"));
Object.assign(process.env, { DB_PATH: ":memory:", TOKEN: "1:test", ADMIN: "1", STORE_URL: "https://x.test", PDF_DIR: tmp, CONTENT_DIR: tmp, SETTINGS_FILE: path.join(tmp, "none") });
const { catchupPlan, catchDaysError } = await import("../lib/schedApi.ts");

// 0 الاثنين، 2 الأربعاء، 3 الخميس، 5 السبت. 2026-11-18 أربعاء
const SAT = 5, MON = 0, WED = 2, THU = 3, FRI = 4, SUN = 6, TUE = 1;
const five = [5, 1, 3, 2, 4].map((id) => ({ id, at: `2026-10-0${id} 17:00` }));

test("مكثف بأيامه لحد بداية الفصل الجاي، وبعدها خفيف، ويوم امتحانه ويا جماعته ينعبر", () => {
  const plan = catchupPlan(five, { days1: [SAT, MON, WED], days2: [THU], timeOf: () => "17:00" }, "2026-11-18", "2026-11-23", (d) => d !== "2026-11-21");
  assert.deepEqual(plan, [
    { examId: 1, at: "2026-11-18 17:00" },   // أربعاء: مكثف
    // السبت 21 بيه امتحانه ويا جماعته، والاثنين 23 بدا الفصل الجاي: بس الخميس
    { examId: 2, at: "2026-11-26 17:00" },
    { examId: 3, at: "2026-12-03 17:00" },
    { examId: 4, at: "2026-12-10 17:00" },
    { examId: 5, at: "2026-12-17 17:00" },
  ]);
});

test("بدون تاريخ الفصل الجاي: كله بأيام المكثف، والوقت لكل يوم (الحضوري بأوقات مركزه)", () => {
  const plan = catchupPlan(five.slice(0, 3), { days1: [SAT, WED], days2: [], timeOf: (wd) => (wd === SAT ? "10:00" : "16:30") }, "2026-11-18", null, () => true);
  assert.deepEqual(plan.map((x) => x.at), ["2026-11-18 16:30", "2026-11-21 10:00", "2026-11-25 16:30"]);
});

test("يوم بين يوم: 3 بدون يومين ورا بعض، و4 يصير بيهن يومين ورا بعض مرة وحدة بس", () => {
  const all = [0, 1, 2, 3, 4, 5, 6];
  assert.equal(catchDaysError([SAT, MON, WED], 3, all, ""), "");
  assert.match(catchDaysError([SAT, SUN, TUE], 3, all, ""), /يوم بين يوم/);
  assert.equal(catchDaysError([SAT, MON, WED, FRI], 4, all, ""), "");
  assert.match(catchDaysError([SAT, SUN, MON, WED], 4, all, ""), /مرة وحدة/);
  assert.match(catchDaysError([SAT, MON], 3, all, ""), /3 أيام/);
  assert.match(catchDaysError([FRI], 1, [SAT, MON], ""), /مو من أيام/);
});
