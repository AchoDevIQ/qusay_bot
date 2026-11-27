// الأرقام دائماً إنگليزي (طلبه 2026-11-27: «بمنهجنا نكتبها إنگليزي»، سواء حچى عربي لو إنگليزي): ٦ ← 6،
// والرقم بالكلام يصير رقم: «ستة» ← 6، «خمسة وعشرين» ← 25، «مية وخمسين» ← 150، «ثلاث الاف» ← 3000، «six» ← 6
const AR_ONE: Record<string, number> = { صفر: 0, واحد: 1, واحده: 1, اثنين: 2, اثنان: 2, ثنين: 2, اثنتين: 2, ثلاثه: 3, ثلاث: 3, تلاته: 3, تلاث: 3, اربعه: 4, اربع: 4, خمسه: 5, خمس: 5, سته: 6, ست: 6, سبعه: 7, سبع: 7, ثمانيه: 8, ثمان: 8, ثماني: 8, تمانيه: 8, تسعه: 9, تسع: 9, عشره: 10, عشر: 10,
  احدعش: 11, احداعش: 11, اطعش: 11, اثنعش: 12, اثناعش: 12, ثنعش: 12, ثلطعش: 13, ثلثطعش: 13, تلطعش: 13, اربعطعش: 14, اربطعش: 14, خمسطعش: 15, خمستعش: 15, ستطعش: 16, سطعش: 16, سبعطعش: 17, سبعتعش: 17, ثمنطعش: 18, ثمانطعش: 18, تمنطعش: 18, تسعطعش: 19, تسعتعش: 19,
  عشرين: 20, ثلاثين: 30, تلاتين: 30, اربعين: 40, خمسين: 50, ستين: 60, سبعين: 70, ثمانين: 80, تمانين: 80, تسعين: 90,
  ميه: 100, مئه: 100, ميتين: 200, مئتين: 200, ميتان: 200, الف: 1000, الفين: 2000 };
const HUND: Record<string, number> = { ثلاث: 3, تلاث: 3, اربع: 4, خمس: 5, ست: 6, سبع: 7, ثمان: 8, تمن: 8, تسع: 9 };
const EN_NUM: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };
const arKey = (w: string) => w.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ًٌٍَُِّْ]/g, "");
function arVal(w: string): number | null {
  const k = arKey(w);
  if (k in AR_ONE) return AR_ONE[k];
  const h = /^(.+?)(ميه|مئه)$/.exec(k);
  if (h && HUND[h[1]]) return HUND[h[1]] * 100;
  return null;
}
export function enDigits(t: string) {
  const s = t.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  const w = s.split(/\s+/).filter(Boolean), out: string[] = [];
  for (let i = 0; i < w.length; i++) {
    const first = arVal(w[i]);
    if (first === null) { out.push(EN_NUM[w[i].toLowerCase()] ?? w[i]); continue; }
    // سلسلة الرقم: «خمسة وعشرين»، «مية و خمسة»، و«ثلاث الاف»
    let total = 0, cur = first, j = i + 1;
    if (/^(الاف|آلاف|ألاف)$/.test(w[j] ?? "")) { cur *= 1000; j++; }
    total += cur;
    while (j < w.length) {
      const nx = /^و./.test(w[j]) ? arVal(w[j].slice(1)) : w[j] === "و" ? arVal(w[j + 1] ?? "") : null;
      if (nx === null) break;
      j += w[j] === "و" ? 2 : 1;
      let v = nx;
      if (/^(الاف|آلاف|ألاف)$/.test(w[j] ?? "")) { v *= 1000; j++; }
      total += v;
    }
    out.push(String(total));
    i = j - 1;
  }
  return out.join(" ");
}
