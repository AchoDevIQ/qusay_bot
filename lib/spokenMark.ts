// الدرجة بالصوت: المصحح يحچي الدرجة («عشرين»، «20»، «خمسة وعشرين»، «twenty five») ونطلع منها رقم.
// كلشي هنا بالجهاز نفسه، بدون أي اتصال. الكلام المو واضح يرجع سبب، وما ينحفظ

export type SpokenMark = { mark: number; heard: string } | { error: string; heard: string; kind: "unclear" | "fraction" | "over" };

const DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };

/** نفس الكلمة بكل كتاباتها: بدون تشكيل، والهمزات والتاء المربوطة والياء وحدة */
export function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d])
    .replace(/(\d)\s*[٫,،]\s*(\d)/g, "$1.$2")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/(\d)\s*\/\s*\d+/g, "$1 من")
    .replace(/[-_]/g, " ")
    .replace(/[^\p{L}\p{N}. ]/gu, " ")
    .replace(/\s+/g, " ").trim();
}

type Kind = "unit" | "teen" | "ten" | "hundred" | "zero";
const W: Record<string, [number, Kind]> = {};
const add = (v: number, k: Kind, words: string) => { for (const w of words.split(" ")) W[w] = [v, k]; };
add(0, "zero", "صفر زيرو zero nought nil nothing");
add(1, "unit", "واحد واحده وحده one won ون وان");
add(2, "unit", "اثنين اثنان اثنتين اتنين ثنين ثنتين two تو");
add(3, "unit", "ثلاث ثلاثه تلاث تلاثه ثلثه تلته three ثري");
add(4, "unit", "اربع اربعه four for فور");
add(5, "unit", "خمس خمسه five فايف");
add(6, "unit", "ست سته six سكس سيكس");
add(7, "unit", "سبع سبعه seven سفن سيفن");
add(8, "unit", "ثمان ثماني ثمانيه ثمنيه تمانيه تمنيه eight ate ايت");
add(9, "unit", "تسع تسعه nine ناين");
add(10, "teen", "عشر عشره ten تن");
add(11, "teen", "احدعش حداعش احداعش حدعش eleven اليفن");
add(12, "teen", "اثنعش اثناعش ثنعش ثنطعش اطنعش twelve تولف");
add(13, "teen", "thirteen ثيرتين");
add(14, "teen", "fourteen فورتين");
add(15, "teen", "fifteen فيفتين");
add(16, "teen", "sixteen سكستين");
add(17, "teen", "seventeen سفنتين");
add(18, "teen", "eighteen ايتين");
add(19, "teen", "nineteen ناينتين");
add(20, "ten", "عشرين عشرون twenty تونتي توينتي");
add(30, "ten", "ثلاثين ثلاثون تلاثين ثلثين تلتين thirty ثيرتي");
add(40, "ten", "اربعين اربعون forty fourty فورتي");
add(50, "ten", "خمسين خمسون fifty فيفتي");
add(60, "ten", "ستين ستون sixty سكستي");
add(70, "ten", "سبعين سبعون seventy سفنتي");
add(80, "ten", "ثمانين ثمانون ثمنين تمانين eighty ايتي");
add(90, "ten", "تسعين تسعون ninety ناينتي");
add(100, "hundred", "ميه مايه ميت hundred هندرد");

// اللهجة: «خمسطعش»، «ثلطعش»، «سبعتعش»… أول الكلمة رقم، وآخرها «طعش»
const TEEN_STEM: Record<string, number> = { احد: 1, حد: 1, حدا: 1, احدا: 1, اثن: 2, اثنا: 2, ثن: 2, ثنا: 2, اطن: 2, ثلث: 3, ثلاث: 3, ثل: 3, تلث: 3, تلت: 3, تل: 3, اربع: 4, اربا: 4, خمس: 5, خمسه: 5, ست: 6, س: 6, سبع: 7, سبعه: 7, ثمن: 8, ثمان: 8, تمن: 8, ثمنه: 8, تسع: 9, تسعه: 9 };
function teen(w: string): number | null {
  const m = /^(.+?)(?:طعش|طاعش|تعش|تاعش|ط?عشر|عش)$/.exec(w);
  return m && TEEN_STEM[m[1]] !== undefined ? 10 + TEEN_STEM[m[1]] : null;
}

// كلمات تنقال ويا الدرجة وما تغير شي
const FILLER = new Set("درجه الدرجه درجات علامه العلامه علامات نمره نطيه انطيه اعطيه اعطي حط حطله اكتب سجل له اله الها هي هو يا خلي خليها خليه السؤال mark marks point points score give it is the a an please".split(" "));
const HALF = new Set("نص نصف half هاف".split(" "));
const QUARTER = new Set("ربع quarter".split(" "));
const FULL = new Set("كامله الكامله كامل فل full".split(" "));
const AND = new Set(["و", "and"]);

type Tok = { v: number; k: Kind | "digits" | "half" | "quarter" | "and" | "full" | "bad" };
function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  for (let w of text.split(" ")) {
    if (!w || FILLER.has(w)) continue;
    // «وعشرين»، «ونص»: الواو لازگة بالكلمة
    if (w.length > 1 && w.startsWith("و") && !W[w] && !FILLER.has(w)) {
      const rest = w.slice(1);
      if (W[rest] || teen(rest) !== null || HALF.has(rest) || QUARTER.has(rest) || /^\d/.test(rest)) { out.push({ v: 0, k: "and" }); w = rest; }
    }
    if (/^\d+(\.\d+)?$/.test(w)) out.push({ v: Number(w), k: "digits" });
    else if (W[w]) out.push({ v: W[w][0], k: W[w][1] });
    else if (teen(w) !== null) out.push({ v: teen(w)!, k: "teen" });
    else if (HALF.has(w)) out.push({ v: 0.5, k: "half" });
    else if (QUARTER.has(w)) out.push({ v: 0.25, k: "quarter" });
    else if (AND.has(w)) out.push({ v: 0, k: "and" });
    else if (FULL.has(w)) out.push({ v: 0, k: "full" });
    else out.push({ v: 0, k: "bad" });
  }
  return out;
}

/** الرقم اللي انحچى، أو null إذا الكلام مو رقم واحد واضح */
export function spokenNumber(raw: string, max = 100): number | null {
  // «عشرين من خمسة وعشرين»: الدرجة هي اللي قبل «من»
  const text = normalize(raw).split(/ (?:من|out of|over|على)(?: |$)/)[0];
  const ts = tokens(text);
  if (!ts.length || ts.some((t) => t.k === "bad")) return null;
  if (ts.some((t) => t.k === "full")) return ts.every((t) => t.k === "full" || t.k === "and") ? max : null;
  let frac = 0;
  const nums: Tok[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.k === "and") continue;
    if (t.k === "half" || t.k === "quarter") {
      // «نص» تجي بآخر الكلام بس، ومرة وحدة
      if (frac || i !== ts.length - 1) return null;
      frac = t.v; continue;
    }
    // «ثلاثة عشر»: الرقم وبعده «عشر» يصير ثلطعش
    if (t.k === "teen" && t.v === 10 && nums.length && nums[nums.length - 1].k === "unit" && ts[i - 1]?.k !== "and") { nums[nums.length - 1] = { v: nums[nums.length - 1].v + 10, k: "teen" }; continue; }
    nums.push(t);
  }
  if (!nums.length) return frac || null;
  let v: number;
  if (nums.length === 1) v = nums[0].v;
  else if (nums.length === 2) {
    const [a, b] = nums;
    // «خمسة وعشرين» و«عشرين وخمسة» و«twenty five»
    if (a.k === "unit" && b.k === "ten") v = a.v + b.v;
    else if (a.k === "ten" && b.k === "unit") v = a.v + b.v;
    // «one hundred»، «مية وحدة»
    else if (a.k === "unit" && a.v === 1 && b.k === "hundred") v = 100;
    else return null;
  } else return null;
  return v + frac;
}

/** الدرجة من الكلام: لازم رقم كامل، وما تزيد على درجة السؤال */
export function spokenMark(raw: string, max: number): SpokenMark {
  const heard = raw.trim();
  const n = spokenNumber(raw, max);
  if (n === null) return { error: "ما فهمت الدرجة، عيدها", heard, kind: "unclear" };
  if (!Number.isInteger(n)) return { error: `الدرجة لازم رقم كامل (سمعت ${n})`, heard, kind: "fraction" };
  if (n > max) return { error: `${n} أكبر من درجة السؤال (${max})`, heard, kind: "over" };
  return { mark: n, heard };
}

/** الجهاز يرجع كم احتمال لنفس الكلام: ناخذ أول واحد يطلع درجة صحيحة.
 *  إذا ولا واحد، نرجع السبب الأوضح (رقم أكبر أو كسر أوضح من «ما فهمت») */
export function pickMark(alternatives: string[], max: number): SpokenMark {
  const tries = alternatives.filter((a) => a && a.trim()).map((a) => spokenMark(a, max));
  if (!tries.length) return { error: "ما سمعت شي، عيدها", heard: "", kind: "unclear" };
  return tries.find((t) => "mark" in t) ?? tries.find((t) => "kind" in t && t.kind !== "unclear") ?? tries[0];
}
