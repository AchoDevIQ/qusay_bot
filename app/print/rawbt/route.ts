// تجربة طابعة جهاز SUNMI بلغة TSPL (نفس ليبل طابعة Vision) عن طريق تطبيق RawBT. أسماء وهمية، ما بيها أي معلومة طالب.
// بالجهاز: إعدادات SunmiPrinter ← Select virtual Bluetooth command ← TSPL، وRawBT متصل بـ InnerPrinter
import { labelTspl } from "../../../lib/labelTspl.ts";

export const dynamic = "force-dynamic";

const rawbt = (b: Buffer) => `intent:base64,${b.toString("base64")}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
const num = (v: string | null) => Math.max(-80, Math.min(80, Math.round(Number(v) || 0)));

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const dx = num(q.get("dx")), dy = num(q.get("dy"));
  const label = await labelTspl({ item: 0, uid: 123456789, name: "محمد علي حسين عمر", exam: "قبل x & y (تجربة)", center: "قمة النجاح للبنات (المنصور)", at: "2026-11-10 17:16" }, dx, dy);
  // كتابة إنجليزي بس، بخط الطابعة نفسها: إذا هذي انطبعت والثانية لا، المشكلة بالصور مو بالاتصال
  const simple = Buffer.from(`SIZE 58 mm,39 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nTEXT ${20 + dx},${20 + dy},"3",0,1,1,"QMATH TSPL TEST"\r\nQRCODE ${20 + dx},${70 + dy},M,6,A,0,"QI:0"\r\nPRINT 1\r\n`, "latin1");
  const move = (x: number, y: number, t: string) => `<a class="m" href="?dx=${dx + x}&dy=${dy + y}">${t}</a>`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تجربة RawBT</title>
<style>body{font-family:Tahoma,Arial,sans-serif;margin:16px;background:#0f1a2e;color:#f4f1e8}a{display:block;text-align:center;text-decoration:none;border-radius:12px;padding:16px;margin:12px 0;font-weight:700}
.b{background:#d4a63a;color:#0f1a2e;font-size:20px}.s{background:#1d2c4a;color:#f4f1e8;border:1px solid #d4a63a}.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.m{background:#1d2c4a;color:#f4f1e8;margin:0;padding:12px}p{line-height:1.7}</style></head>
<body><h2>🧪 تجربة ليبل SUNMI بلغة TSPL</h2>
<p>قبلها: إعدادات SunmiPrinter ← Select virtual Bluetooth command ← <b>TSPL</b>. وRawBT متصل بـ InnerPrinter.</p>
<a class="b" href="${rawbt(label)}">🖨 اطبع ليبل تجربة</a>
<a class="s" href="${rawbt(simple)}">🔤 تجربة بسيطة (إنجليزي بس)</a>
<p>إذا الليبل زاحف، حركه وعيد الطباعة. هسه: يمين/يسار ${dx}، فوك/جوة ${dy} نقطة (8 نقاط = 1 ملم).</p>
<div class="row">${move(-16, 0, "⬅️ يسار")}${move(16, 0, "➡️ يمين")}${move(0, -16, "⬆️ فوك")}${move(0, 16, "⬇️ جوة")}</div>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
