// السؤال العلمي من «دفتر المحاضرات» بملازمي: أسطر صفحات الدفتر الحقيقي (الفصل الثالث عربي) مثل ما ينقرا بالسيرفر.
// سؤال الطالب يلگى بداية سؤاله (زر الفيديو أو «س :»)، وصفحاته، والواجب اللي بس بيه «Ans» ما ينحسب حل
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const R = await import("../lib/rasidQa.ts");
const F = JSON.parse(fs.readFileSync(new URL("./fixtures/notebook-ch3.json", import.meta.url), "utf8")) as { rows: { y: number; t: string }[][] };
const any = () => true;
const words = (s: string) => s.split(/\s+/).filter((w) => /[؀-ۿ]{3,}/.test(w));
const LADDER = "سلم طوله (10)m يستند طرفه الاسفل على أرض افقيه وطرفه العلوي على حائط رأسي فإذا انزلق الطرف الأسفل مبتعدا عن الحائط بمعدل (2) m/s جد معدل انزلاق الطرف العلوي عندما يكون الطرف الأسفل على بعد (8)m عن الحائط";

test("بدايات الأسئلة بالدفتر: «س :» بلا رقم و«س 1 /»، والزر اللي بقربها ينربط بيها", () => {
  const a = R.anchors(F.rows, [{ id: 7, page: 24, y: 0.07, label: "سلم طوله" }]);
  const p24 = a.filter((x) => x.page === 24);
  assert.equal(p24.length, 1);
  assert.equal(p24[0].mark, 7);
  // ص23: واجبات الوزاريات (س1، س2) وبعدها الاثرائيات (س1، س2، س3)
  assert.deepEqual(a.filter((x) => x.page === 23).map((x) => x.label.trim().slice(0, 3)), ["س 1", "س 2", "س 1", "س 2", "س 3"]);
});

test("سؤال الطالب بالدفتر: صفحة سؤاله ومكانه وزره. الواجب بلا حل، أو أرقام ثانية: ما يطابق", () => {
  const h = R.bookFind(LADDER, F.rows, [{ id: 7, page: 24, y: 0.07 }], any, words(LADDER));
  assert.deepEqual({ page: h?.page, pages: h?.pages, mark: h?.mark }, { page: 24, pages: [24], mark: 7 });
  assert.ok(h!.y > 0.05 && h!.y < 0.1);
  // نفس السلم بس الزاوية (ص25): سؤال ثاني
  assert.equal(R.bookFind(LADDER.replace("(8)m", "(6)m"), F.rows, [], any, words(LADDER)), null);
  // واجب الثنائية (ص23): بس «Ans»، مو حل
  const hw = "جد مجموعة النقاط التي تنتمي للدائرة (x-3)^{2}+y^{2}=32 عندما يكون معدل تغير x بالنسبة للزمن مساويا الى معدل تغير y";
  assert.equal(R.bookFind(hw, F.rows, [], any, words(hw)), null);
  // الموضوع اللي اختاره مو موضوع هاي الصفحات
  assert.equal(R.bookFind(LADDER, F.rows, [], (p) => p > 30, words(LADDER)), null);
});

test("صفحات موضوع بالدفتر من فهرسه", () => {
  const toc = [{ t: "المعدلات الزمنية", p: 3, items: [{ t: "المحاضرة الأولى", p: 3 }] }, { t: "رول والقيمة المتوسطة", p: 40, items: [] }];
  const f = R.topicPages(toc, 120, (t) => t.includes("المعدلات"))!;
  assert.ok(f(24) && f(39) && !f(40) && !f(2));
  assert.equal(R.topicPages(toc, 120, () => false), null);
});
