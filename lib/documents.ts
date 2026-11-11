// الملفات اللي يرسلها البوت: PDF الطلبات والقوائم، الوصولات، وبطاقة معلومات الطالب.
// تترسم من HTML بمتصفح Edge/Chrome/Chromium بدون واجهة.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import QRCode from "qrcode";
import { kvSet, one, type Row } from "./db.ts";
import type { RenderJob } from "./browserRender.ts";
import { LOGO, PDF_DIR, WORD_CHECK } from "./config.ts";
import { DEFAULT_FONTS, FONT_STACK, fontsCss, pageFonts, type FontChoice } from "./imgFonts.ts";
import { btn, esc, fileStamp, money, num, stamp } from "./util.ts";
import { upload, send, type Kb } from "./telegram.ts";
import { centerName, examLabel, orderItems, ordersByIds, placeOf, profileText, sellerLabel } from "./data.ts";

const run = promisify(execFile);
const ensureDir = () => fs.mkdirSync(PDF_DIR, { recursive: true });
const b64 = (p: string) => fs.readFileSync(p).toString("base64");
const logoTag = () => (fs.existsSync(LOGO) ? `<img src="data:image/png;base64,${b64(LOGO)}">` : "");
/** الإنجليزي والأرقام بخط واضح، والعربي يبقى بخط قصي العميري */

export function findBrowser(): string | null {
  if (process.env.CHROME_PATH) return fs.existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const cands: string[] = [];
  for (const k of ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"]) {
    const base = process.env[k];
    if (base) cands.push(path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"), path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
  }
  cands.push("/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/snap/bin/chromium");
  const pw = path.join(os.homedir(), ".cache", "ms-playwright");
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter((x) => x.startsWith("chromium-")).sort().reverse()) {
      cands.push(path.join(pw, d, "chrome-linux", "chrome"), path.join(pw, d, "chrome-linux64", "chrome"));
    }
  }
  return cands.find((p) => fs.existsSync(p)) ?? null;
}

/** على السيرفر ماكو متصفح منصب، فنستخدم النسخة اللي وية التطبيق */
async function packagedBrowser() {
  if (process.platform !== "linux" || process.env.CHROME_PATH) return null;
  try {
    const browser = await (await import("@sparticuz/chromium")).default.executablePath();
    // خطوط الوصولات (Segoe وTahoma) ما موجودة على السيرفر، وبدون خط عربي يطلع الكلام فارغ
    fs.cpSync(path.join(process.cwd(), "assets", "fonts"), path.join(os.tmpdir(), "fonts", "arabic"), { recursive: true });
    return browser;
  } catch (e) { console.error("Browser problem:", e); return null; }
}
async function renderPackaged(b: string, out: string, htmlPath: string, job: RenderJob) {
  const flags = ["--no-sandbox", "--no-zygote", "--single-process", "--in-process-gpu", "--disable-gpu", "--disable-dev-shm-usage", "--font-render-hinting=none"];
  fs.rmSync(out, { force: true });
  try {
    await (await import("./browserRender.ts")).browserRender(b, flags, htmlPath, out, job);
  } catch (e) { console.error("Render problem:", e); }
  return fs.existsSync(out) && fs.statSync(out).size > 1000;
}
async function render(out: string, profile: string, args: string[], htmlPath: string, job: RenderJob) {
  const installed = findBrowser();
  const b = installed ?? await packagedBrowser();
  if (!b) return false;
  if (!installed) return renderPackaged(b, out, htmlPath, job);
  const url = "file:///" + path.resolve(htmlPath).replace(/\\/g, "/").replace(/^\/+/, "");
  // نجرب بحماية المتصفح أول. بدونها بس إذا السيرفر ما يدعمها، حتى تبقى الوصولات تطلع
  const sandbox: string[][] = process.platform === "win32" ? [[]] : [[], ["--no-sandbox"]];
  for (const extra of sandbox) {
    for (const flag of ["--headless=new", "--headless"]) {
      try {
        fs.rmSync(out, { force: true });
        await run(b, [flag, ...extra, "--disable-gpu", ...args, "--user-data-dir=" + path.join(os.tmpdir(), profile), url], { timeout: 90_000 });
      } catch (e) { console.error("Render problem:", e); }
      if (fs.existsSync(out) && fs.statSync(out).size > 1000) return true;
    }
  }
  return false;
}
const htmlToPdf = (htmlPath: string, pdfPath: string) =>
  render(pdfPath, "qstore_pdf", ["--no-pdf-header-footer", "--print-to-pdf-no-header", "--print-to-pdf=" + pdfPath], htmlPath, { pdf: true });
const htmlToPng = (htmlPath: string, pngPath: string, w = 760, h = 1000) =>
  render(pngPath, "qstore_png", ["--hide-scrollbars", "--force-device-scale-factor=2", `--window-size=${w},${h}`, "--screenshot=" + path.resolve(pngPath)], htmlPath, { png: { w, h } });

// ---------- طلبات التوصيل: كل طلب بورقة A5 مستقلة
/** كود QR بوصل الطلب اللي بيه امتحانات: الطالب يقراه لمن يوصله الطلب */
async function examQr(oid: number) {
  const code = (await one("order_codes", { order_id: oid }))?.code as string | undefined;
  if (!code) return "";
  const svg = await QRCode.toString(code, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return `<div style="display:flex;align-items:center;gap:12px;margin-top:10px;padding:8px 10px;border:1.5px solid #101929;border-radius:10px;break-inside:avoid">
<div style="width:92px;height:92px;flex:none">${svg}</div>
<div style="font-size:11.5px;line-height:1.7"><b style="font-size:13px">🔓 افتح طلبك بالبوت</b><br>اضغط زر «وصلني الطلب» بالبوت، ووجه الكاميرا على هذا الكود.<br>أو اكتب الرقم: <b dir="ltr" style="font-size:20px;letter-spacing:2px">${code}</b></div>
</div>`;
}

async function ordersHtml(orders: Row[]) {
  const logo = logoTag();
  const pages = await Promise.all(await Promise.all(orders.map(async (o) => {
    const rows = orderItems(o).map((it) => `<tr><td>${esc(it.name)}</td><td class=n>${it.qty}</td><td class=n>${num(it.qty * it.price)}</td></tr>`).join("");
    const en = o.curr === "إنجليزي";
    return `<section class="page ${en ? "en" : "ar"}">
<div class=currbar>${en ? "ENGLISH — منهج إنجليزي" : "منهج عربي"}</div>
<div class=head>${logo}<div class=ht><h1>متجر قصي العميري</h1><p>الرياضيات · السادس الإعدادي</p></div>
<div class=no><b>#${o.id}</b><span>${esc(o.created)}</span></div></div>
<table class=info>
<tr><th>الاسم</th><td colspan=3 class=big>${esc(o.name)}</td></tr>
<tr><th>المنهج</th><td>${esc(o.curr ?? "")}</td><th>المحافظة</th><td>${esc(placeOf(o))}</td></tr>
<tr><th>المنطقة</th><td colspan=3>${esc(o.area)}</td></tr>
<tr><th>الهاتف 1</th><td class=ph>${esc(o.phone1)}</td><th>الهاتف 2</th><td class=ph>${esc(o.phone2)}</td></tr></table>
<table class=items><tr><th>المنتج</th><th class=n>العدد</th><th class=n>السعر</th></tr>${rows}
<tr class=s><td colspan=2>مجموع المنتجات</td><td class=n>${num(o.subtotal)}</td></tr>
<tr class=s><td colspan=2>التوصيل</td><td class=n>${num(o.fee)}</td></tr>
<tr class=t><td colspan=2>المبلغ الكلي</td><td class=n>${num(o.total)} د.ع</td></tr></table>
${await examQr(o.id)}<div class=foot>⚠️ جميع المشتريات غير قابلة للإرجاع إطلاقاً ولأي سبب كان</div>
</section>`;
  })));
  return `<!doctype html><html lang=ar dir=rtl><head><meta charset=utf-8><style>${await pageFonts()}
@page{size:A5;margin:9mm}
html,body{margin:0}
body{font-family:${FONT_STACK};color:#101929}
.page{page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
.head{display:flex;align-items:center;gap:10px;background:#101929;color:#fff;border-radius:10px;padding:8px 12px;border-bottom:4px solid #CEA239}
.head img{height:46px}
.ht{flex:1}.ht h1{margin:0;font-size:16px;color:#F9C445}.ht p{margin:1px 0 0;font-size:10px;color:#cfd7e6}
.no{text-align:center}.no b{display:block;font-size:22px;color:#F9C445;line-height:1.1}.no span{font-size:9px;color:#cfd7e6}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:9px}
td,th{padding:6px 8px;border:1px solid #d9dde5;text-align:right}
.info th{background:#FFF3CF;width:62px;font-weight:700;white-space:nowrap}
.big{font-size:15px;font-weight:700}
.ph{direction:ltr;text-align:left;font-weight:800;font-size:14px;letter-spacing:.5px}
.items th{background:#101929;color:#fff;font-weight:600;border-color:#101929}
.n{text-align:center;white-space:nowrap}
.s td{background:#f5f6f8}.t td{background:#F9C445;font-weight:800;font-size:15px;border-color:#CEA239}
.foot{margin-top:10px;font-size:10.5px;text-align:center;color:#8a2a20;border:1px dashed #d98b80;border-radius:8px;padding:5px}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{box-sizing:border-box}
.currbar{text-align:center;font-weight:800;font-size:13px;border-radius:8px;padding:3px;margin-bottom:6px;background:#FFF3CF;color:#101929;border:1px solid #CEA239}
/* المنهج الإنجليزي شكله كله غير، حتى المجهز ما يغلط، وحتى إذا انطبع أبيض وأسود */
.page.en{min-height:188mm;padding:4mm;border:5px double #0b5d3b;border-radius:6px;background:#e4f5ea}
.en .currbar{background:repeating-linear-gradient(45deg,#0b5d3b,#0b5d3b 10px,#127a4f 10px,#127a4f 20px);color:#fff;font-size:18px;padding:7px;letter-spacing:1px;border:0}
.en .head{background:#0b5d3b;border-bottom-color:#7fd1a4}
.en .ht h1,.en .no b{color:#fff}
.en td,.en th{border-color:#9ecdb1;background-color:#f3fbf6}
.en .info th{background:#c9ecd6}
.en .items th{background:#0b5d3b;border-color:#0b5d3b;color:#fff}
.en .s td{background:#dcf1e4}.en .t td{background:#0b5d3b;color:#fff;border-color:#0b5d3b}
</style></head><body>${pages.join("")}</body></html>`;
}

export async function sendOrdersPdf(chat: number, ids: number[], reprint = false) {
  const orders = await ordersByIds(ids);
  ensureDir();
  const name = "orders_" + fileStamp();
  const hp = path.join(PDF_DIR, name + ".html"), pp = path.join(PDF_DIR, name + ".pdf");
  fs.writeFileSync(hp, await ordersHtml(orders), "utf8");
  const bid = String(Math.floor(Date.now() / 1000));
  await kvSet("batch_" + bid, orders.map((o) => o.id).join(","));
  const kb: Kb = reprint ? [] : [[btn("✅ تم الطباعة (إخفاؤها)", "a:done:" + bid)], [btn("↩️ لا، خليها", "a:keep")]];
  const markup = JSON.stringify({ inline_keyboard: kb });
  const cap = `🖨 ${reprint ? "إعادة طباعة" : "ملف"} ${orders.length} طلب: ${orders.map((o) => "#" + o.id).join("، ")}` + (reprint ? "" : "\n\nاطبعه، وبعد الطباعة اضغط «تم الطباعة» حتى تختفي من الطلبات الجديدة.");
  const r = await htmlToPdf(hp, pp)
    ? await upload("sendDocument", { chat_id: String(chat), caption: cap, reply_markup: markup }, "document", pp, name + ".pdf", "application/pdf")
    : await upload("sendDocument", { chat_id: String(chat), caption: cap + "\n\n(افتح الملف بالمتصفح واضغط Ctrl + P حتى تطبعه أو تحفظه PDF)", reply_markup: markup },
      "document", hp, name + ".html", "text/html");
  if (!r) await send(chat, "⚠️ ما گدرت أرسل الملف. تلگاه بمجلد البوت داخل مجلد data/pdf.", { kb });
  return !!r;
}

// ---------- قائمة عامة PDF
export async function listPdf(chat: number, title: string, headers: string[], rows: unknown[][], fname: string) {
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const tr = rows.map((r, i) => `<tr><td class=n>${i + 1}</td>${r.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("");
  const htm = `<!doctype html><html lang=ar dir=rtl><head><meta charset=utf-8><style>${await pageFonts()}@page{size:A4;margin:12mm}
body{font-family:${FONT_STACK};color:#101929}
.h{display:flex;align-items:center;gap:12px;background:#101929;color:#F9C445;padding:8px 14px;border-radius:10px;border-bottom:4px solid #CEA239}
.h img{height:44px}.h b{font-size:18px}.h span{color:#cfd7e6;font-size:11px;display:block}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}th{background:#101929;color:#fff;padding:6px}
td{border:1px solid #d9dde5;padding:5px 7px}tr:nth-child(even) td{background:#f6f7fa}.n{text-align:center;width:28px}
</style></head><body><div class=h>${logoTag()}<div><b>${esc(title)}</b><span>العدد: ${rows.length} — ${stamp()}</span></div></div>
<table><tr><th>#</th>${th}</tr>${tr}</table></body></html>`;
  ensureDir();
  const base = path.join(PDF_DIR, `${fname}_${fileStamp()}`);
  fs.writeFileSync(base + ".html", htm, "utf8");
  const fields = { chat_id: String(chat), caption: title };
  if (await htmlToPdf(base + ".html", base + ".pdf")) return !!await upload("sendDocument", fields, "document", base + ".pdf", fname + ".pdf", "application/pdf");
  return !!await upload("sendDocument", fields, "document", base + ".html", fname + ".html", "text/html");
}

// ---------- بطاقة معلومات الطالب (صورة)
async function profileCardHtml(s: Row, title: string) {
  const rows: [string, string, unknown][] = [["👤", "الاسم", s.name], ["📘", "المنهج", s.curr],
    ["🎓", "صفك بالمدرسة", s.grade], ["📍", "المحافظة", placeOf(s)], ["🏘", "العنوان", s.area],
    ["📞", "الهاتف الأول", s.phone1], ["📞", "الهاتف الثاني", s.phone2], ["📝", "نوع الامتحان", s.exam ?? ""]];
  if (s.exam === "حضوري") rows.push(["🏫", "المركز الامتحاني", await centerName(s.center_id) || "—"]);
  const tr = rows.map(([i, k, v]) => `<tr><td class="k"><span>${i}</span>${esc(k)}</td><td class="v${k.startsWith("الهاتف") ? " ltr" : ""}">${esc(v)}</td></tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${await pageFonts()}
*{box-sizing:border-box}html{background:#101929}html,body{margin:0;width:760px;overflow:hidden}
body{font-family:${FONT_STACK};color:#F4F1E8;
background:radial-gradient(ellipse at 50% 0%,rgba(249,196,69,.20),transparent 55%),linear-gradient(180deg,#14203a,#101929 40%);
display:flex;flex-direction:column;align-items:center;padding:24px 30px 40px;min-height:1200px}
.top{text-align:center}.top img{height:92px;filter:drop-shadow(0 8px 18px rgba(0,0,0,.5))}
.top h1{margin:0;font-size:38px;font-weight:800;letter-spacing:2px;color:#F9C445}
.top p{margin:2px 0 0;font-family:${FONT_STACK};font-size:23px;color:#cfd7e6}
.card{width:100%;margin-top:16px;background:#162238;border:1px solid #2a3b5c;border-radius:24px;overflow:hidden;box-shadow:0 14px 30px rgba(0,0,0,.35)}
.card h2{margin:0;padding:12px 22px;font-size:24px;font-weight:800;color:#101929;background:linear-gradient(90deg,#F9C445,#CEA239)}
table{width:100%;border-collapse:collapse}td{padding:11px 22px;border-top:1px solid #2a3b5c;font-size:21px;vertical-align:middle}
td.k{width:38%;color:#9fb0c9;font-weight:600;white-space:nowrap}td.k span{display:inline-block;width:38px}
td.v{font-weight:700}td.ltr{direction:ltr;text-align:right;letter-spacing:1px}td em{font-style:normal;font-size:17px;opacity:.75}
tr:nth-child(even) td{background:rgba(255,255,255,.025)}
.foot{margin:12px 16px 16px;padding:10px 16px;border-radius:14px;border:1px dashed #CEA239;background:rgba(249,196,69,.08);font-size:17px;line-height:1.6;color:#e9e3d2}
</style></head><body>
<div class="top">${logoTag()}<h1>QMath</h1><p>قصي العميري</p></div>
<div class="card"><h2>${esc(title)}</h2><table>${tr}</table>
<div class="foot">🔒 معلوماتك مقفولة، ولتغيير أي معلومة تواصل ويا قصي العميري.</div></div>
</body></html>`;
}

/** يرسل معلومات الطالب كبطاقة ملونة (صورة)، وإذا ما صار يرسلها نص */
export async function sendProfileCard(chat: number, s: Row, title: string, caption: string, replyKb: unknown) {
  try {
    ensureDir();
    const hp = path.join(PDF_DIR, `card_${chat}.html`), pp = path.join(PDF_DIR, `card_${chat}.png`);
    const html = await profileCardHtml(s, title);
    // نفس البطاقة ما تنرسم مرتين: الرسم يفتح متصفح، والضغط المتكرر لازم ما يكلف شي
    const cached = fs.existsSync(pp) && fs.existsSync(hp) && fs.readFileSync(hp, "utf8") === html;
    if (!cached) fs.writeFileSync(hp, html, "utf8");
    if (cached || await htmlToPng(hp, pp, 760, s.exam === "حضوري" ? 960 : 905)) {
      const r = await upload("sendPhoto", { chat_id: String(chat), caption, parse_mode: "HTML", reply_markup: JSON.stringify(replyKb) }, "photo", pp, "card.png", "image/png");
      if (r) return r;
    }
  } catch (e) { console.error(e); }
  return send(chat, "<b>📋 معلوماتك</b>\n\n" + await profileText(s) + "\n\n" + caption, { replyKb });
}

// ---------- بطاقة الدرجة: توصل للطالب وولي أمره بعد التصحيح (الأوراق نفسها بصفحة امتحاناتي)
export type GradeCard = { name: string; exam: string; center: string; total: number; at: string; sticker?: string; quote?: string };
export function gradeCardHtml(c: GradeCard, css = fontsCss()) {
  const color = c.total >= 90 ? "#4ade80" : c.total >= 50 ? "#F9C445" : "#ff7a6b";
  const row = (icon: string, k: string, v: string) => `<tr><td class="k"><span>${icon}</span>${k}</td><td class="v">${esc(v)}</td></tr>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
${css}
*{box-sizing:border-box}html,body{margin:0;width:760px;background:#101929;color:#F4F1E8;font-family:${FONT_STACK}}
.top{padding:30px 20px 26px;text-align:center;background:radial-gradient(ellipse at 50% -10%,#3b82f6 0%,transparent 65%),linear-gradient(180deg,#1e3a8a,#0f1d40)}
.top img{height:120px;filter:drop-shadow(0 8px 18px rgba(0,0,0,.5))}
.top h1{margin:8px 0 0;font-size:52px;font-weight:400;color:#fff;text-shadow:0 2px 14px rgba(59,130,246,.75)}
.top p{margin:4px 0 0;font-size:24px;color:#bfdbfe}
.grade{margin:-34px auto 0;width:300px;height:300px;border-radius:50%;background:#162238;border:10px solid ${color};display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 18px 40px rgba(0,0,0,.45);position:relative}
.gradew{position:relative}.stk{position:absolute;left:16px;top:44px;width:205px;height:205px;object-fit:contain;filter:drop-shadow(0 8px 16px rgba(0,0,0,.5))}
.grade b{font-family:${FONT_STACK};font-size:130px;line-height:1;color:${color};font-weight:800}
.grade span{font-family:${FONT_STACK};font-size:34px;color:#9fb0c9;font-weight:700}
table{width:calc(100% - 56px);margin:30px 28px 34px;border-collapse:collapse;background:#162238;border:1px solid #2a3b5c;border-radius:22px;overflow:hidden}
td{padding:16px 22px;border-top:1px solid #2a3b5c;font-size:27px;vertical-align:middle}tr:first-child td{border-top:0}
td.k{width:36%;color:#9fb0c9;white-space:nowrap}td.k span{display:inline-block;width:46px}td.v{color:#fff}
.q{margin:-8px 44px 32px;text-align:center;font-size:26px;line-height:1.6;color:#cbd5e1}
</style></head><body>
<div class="top">${logoTag()}<h1>قصي العميري</h1><p>نتيجة الامتحان</p></div>
<div class="gradew">${c.sticker ? `<img class="stk" src="${c.sticker}">` : ""}<div class="grade"><b>${c.total}</b><span>من 100</span></div></div>
<table>${row("👤", "الطالب", c.name)}${row("📝", "الامتحان", c.exam)}${row("🏫", "المركز", c.center)}${row("🕐", "وقت الامتحان", c.at)}</table>
${c.quote ? `<p class="q">${esc(c.quote)}</p>` : ""}
</body></html>`;
}
/** يرسم بطاقة الدرجة صورة. إذا ما صار الرسم يرجع null، والمرسل يدز نص بدالها */
export async function gradeCardPng(item: number, c: GradeCard, tag = ""): Promise<Buffer | null> {
  try {
    ensureDir();
    const hp = path.join(PDF_DIR, `grade_${item}${tag}.html`), pp = path.join(PDF_DIR, `grade_${item}${tag}.png`);
    fs.writeFileSync(hp, gradeCardHtml(c, await pageFonts()), "utf8");
    // المقولة جوة البطاقة: الصورة تطول بقدر سطورها
    const quoteH = cardQuoteH(c.quote);
    if (await htmlToPng(hp, pp, 760, 940 + quoteH)) return fs.readFileSync(pp);
  } catch (e) { console.error(e); }
  return null;
}

/** طول المقولة جوة البطاقة: بعض الخطوط أعرض، فنحسب 36 حرف بالسطر حتى ما تنقص */
const cardQuoteH = (q?: string) => (q ? 34 + Math.ceil(q.length / 36) * 44 : 0);
/** بطاقة درجة تجريبية بخط معين، لصفحة اختيار الخط */
export async function gradeCardSample(f: Partial<FontChoice>): Promise<Buffer | null> {
  try {
    ensureDir();
    const hp = path.join(PDF_DIR, "grade_sample.html"), pp = path.join(PDF_DIR, "grade_sample.png");
    const c: GradeCard = { name: "زينب علي حسين جاسم", exam: "قبل x & y المحاضرة (1 & 2) · Mid-Year Exam", center: "الإلكتروني", total: 84, at: "السبت 3/1/2027 · 5:00 PM", quote: "گلي شنو صعب عليك؟ چان أحسن لو تدرس أكثر، بس إنت للأحلى." };
    fs.writeFileSync(hp, gradeCardHtml(c, fontsCss({ ar: f.ar || DEFAULT_FONTS.ar, en: f.en || DEFAULT_FONTS.en })), "utf8");
    if (await htmlToPng(hp, pp, 760, 940 + cardQuoteH(c.quote))) return fs.readFileSync(pp);
  } catch (e) { console.error(e); }
  return null;
}

// ---------- صورة الشخصية ويا كتابة صاحب البوت بفقاعة كلام فوكها
/** عرض وارتفاع الصورة من بدايتها (PNG أو JPG). غيرها: نسبة 3:4 */
export function imageSize(b: Buffer): { w: number; h: number } {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return { w: 900, h: 1200 };
}
export function bubbleHtml(src: string, text: string, w: number, h: number, css = fontsCss()) {
  const n = text.length, size = Math.round((n <= 40 ? 0.052 : n <= 90 ? 0.042 : 0.033) * w);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
${css}
*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#111}
img{display:block;width:${w}px;height:${h}px}
.b{position:absolute;top:${Math.round(w * 0.02)}px;right:${Math.round(w * 0.02)}px;width:${Math.round(w * 0.46)}px;padding:${Math.round(w * 0.04)}px ${Math.round(w * 0.035)}px;background:#fff;border:${Math.max(3, Math.round(w * 0.005))}px solid #000;border-radius:50%;color:#000;text-align:center;white-space:pre-wrap;font-family:${FONT_STACK};font-size:${size}px;line-height:1.35}
.b:after{content:"";position:absolute;left:12%;bottom:-${Math.round(w * 0.045)}px;border-top:${Math.round(w * 0.06)}px solid #000;border-right:${Math.round(w * 0.05)}px solid transparent}
</style></head><body><img src="${src}"><div class="b">${esc(text)}</div></body></html>`;
}
/** يرسم الكتابة بفقاعة على الصورة. إذا ما صار الرسم يرجع null، والمرسل يدز الصورة والكتابة كل وحدة لحالها */
export async function bubblePng(img: Buffer, type: string, text: string, tag: string): Promise<Buffer | null> {
  try {
    ensureDir();
    const s = imageSize(img);
    const w = 900, h = Math.min(1600, Math.round((s.h / s.w) * w));
    const hp = path.join(PDF_DIR, `bubble_${tag}.html`), pp = path.join(PDF_DIR, `bubble_${tag}.png`);
    fs.writeFileSync(hp, bubbleHtml(`data:${type};base64,${img.toString("base64")}`, text, w, h, await pageFonts()), "utf8");
    if (await htmlToPng(hp, pp, w, h)) return fs.readFileSync(pp);
  } catch (e) { console.error(e); }
  return null;
}

// ---------- الوصولات
/** وصل ورقي لطابعة الوصولات (عرض 58 ملم) */
async function receiptPaperHtml(o: Row, items: Row[]) {
  const rows = items.map((it) => `<tr><td>${esc(it.name)}</td><td class="n">${it.qty}</td><td class="n">${num(it.qty * it.price)}</td></tr>`).join("");
  const logo = fs.existsSync(LOGO) ? `<img class="logo" src="data:image/png;base64,${b64(LOGO)}">` : "";
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${await pageFonts()}
@page{size:58mm ${130 + 17 * items.length}mm;margin:0}
*{box-sizing:border-box}body{margin:0;width:58mm;padding:3mm 2.5mm;font-family:${FONT_STACK};color:#000;font-size:10.5pt}
.c{text-align:center}.logo{height:15mm;filter:grayscale(1) contrast(1.6)}
h1{margin:1mm 0 0;font-size:15pt;letter-spacing:.5px;font-family:${FONT_STACK}}
.sub{font-size:9.5pt}.hr{border-top:1.4px dashed #000;margin:2mm 0}
.kv{display:flex;justify-content:space-between;font-size:9.5pt;line-height:1.55}
table{width:100%;border-collapse:collapse;font-size:9.5pt}th{border-bottom:1.2px solid #000;padding:1mm 0;text-align:right}
td{padding:1.1mm 0;vertical-align:top;border-bottom:.6px dotted #000}.n{text-align:left;white-space:nowrap;padding-right:1.5mm;direction:ltr}
.tot{display:flex;justify-content:space-between;font-size:13pt;font-weight:bold;margin-top:2mm}
.note{font-size:8.5pt;text-align:center;margin-top:2mm;line-height:1.5}
</style></head><body>
<div class="c">${logo}<h1>QMath</h1><div class="sub">قصي العميري — رياضيات السادس العلمي</div></div>
<div class="hr"></div>
<div class="c" style="font-weight:bold">وصل بيع رقم #${o.id}</div>
<div class="kv"><span>التاريخ</span><span dir="ltr">${esc(o.created)}</span></div>
<div class="kv"><span>الطالب</span><span>${esc(o.name)}</span></div>
<div class="kv"><span>الهاتف</span><span dir="ltr">${esc(o.phone1)}</span></div>
<div class="kv"><span>الامتحان</span><span style="text-align:left">${esc(await examLabel(o.user_id))}</span></div>
<div class="kv"><span>البائع</span><span>${esc(await sellerLabel(o))}</span></div>
<div class="hr"></div>
<table><tr><th>المنتج</th><th class="n">العدد</th><th class="n">المبلغ</th></tr>${rows}</table>
<div class="tot"><span>المجموع</span><span dir="ltr">${num(o.total)} د.ع</span></div>
<div class="hr"></div>
<div class="note">جميع المشتريات غير قابلة للإرجاع<br>شكراً لك 🌷</div>
</body></html>`;
}

/** وصل إلكتروني ملون يوصل للطالب بالبوت */
async function receiptCardHtml(o: Row, items: Row[]) {
  const rows = items.map((it) => `<tr><td>${esc(it.name)}</td><td class="n">× ${it.qty}</td><td class="m">${money(it.qty * it.price)}</td></tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${await pageFonts()}
*{box-sizing:border-box}html{background:#101929}html,body{margin:0;width:760px;overflow:hidden}
body{font-family:${FONT_STACK};color:#F4F1E8;min-height:1600px;padding:24px 30px 40px;
background:radial-gradient(ellipse at 50% 0%,rgba(249,196,69,.20),transparent 55%),linear-gradient(180deg,#14203a,#101929 40%)}
.top{text-align:center}.top img{height:86px;filter:drop-shadow(0 8px 18px rgba(0,0,0,.5))}
.top h1{margin:0;font-size:36px;font-weight:800;letter-spacing:2px;color:#F9C445}
.top p{margin:0;font-family:${FONT_STACK};font-size:22px;color:#cfd7e6}
.card{margin-top:16px;background:#162238;border:1px solid #2a3b5c;border-radius:24px;overflow:hidden;box-shadow:0 14px 30px rgba(0,0,0,.35)}
.card h2{margin:0;padding:12px 22px;font-size:24px;font-weight:800;color:#101929;background:linear-gradient(90deg,#F9C445,#CEA239);display:flex;justify-content:space-between}
.info{display:flex;flex-wrap:wrap;gap:6px 24px;padding:14px 22px;font-size:19px;color:#cfd7e6;border-bottom:1px solid #2a3b5c}.info b{color:#F4F1E8}
table{width:100%;border-collapse:collapse}td{padding:12px 22px;border-top:1px solid #2a3b5c;font-size:20px;font-weight:600}
td.n{color:#9fb0c9;white-space:nowrap;direction:ltr;text-align:center}td.m{color:#F9C445;white-space:nowrap;text-align:left;direction:ltr}
tr:nth-child(even) td{background:rgba(255,255,255,.025)}
.tot{display:flex;justify-content:space-between;align-items:center;padding:14px 22px;background:#1d2c47;font-size:26px;font-weight:800;color:#F9C445}
.ok{margin:14px 16px 16px;padding:10px 16px;border-radius:14px;border:1px dashed #CEA239;background:rgba(249,196,69,.08);font-size:17px;line-height:1.6;text-align:center}
</style></head><body>
<div class="top">${logoTag()}<h1>QMath</h1><p>قصي العميري</p></div>
<div class="card"><h2><span>🧾 وصل الشراء</span><span dir="ltr">#${o.id}</span></h2>
<div class="info"><span>👤 <b>${esc(o.name)}</b></span><span>📅 <b dir="ltr">${esc(o.created)}</b></span><span>🏪 البائع: <b>${esc(await sellerLabel(o))}</b></span><span>📝 الامتحان: <b>${esc(await examLabel(o.user_id))}</b></span></div>
<table>${rows}</table>
<div class="tot"><span>💰 المجموع</span><span dir="ltr">${money(o.total)}</span></div>
<div class="ok">✅ تم الدفع والاستلام · شكراً لك 🌷<br>جميع المشتريات غير قابلة للإرجاع</div></div>
</body></html>`;
}

/** يرسم الوصل الملون ويرسله كصورة. يرجع false إذا ما صار */
export async function sendReceiptImage(chat: number, o: Row, items: Row[], caption: string) {
  ensureDir();
  const ch = path.join(PDF_DIR, `rc_${o.id}.html`), cp = path.join(PDF_DIR, `rc_${o.id}.png`);
  fs.writeFileSync(ch, await receiptCardHtml(o, items), "utf8");
  if (!await htmlToPng(ch, cp, 760, 640 + 100 * items.length)) return false;
  return !!await upload("sendPhoto", { chat_id: String(chat), caption, parse_mode: "HTML" }, "photo", cp, "receipt.png", "image/png");
}

/** نفس الوصل الملون مال الطالب، يوصل للبائع حتى يدزه لأي أحد */
export async function sendColorReceipt(chat: number, oid: number) {
  const o = await one("orders", { id: oid, printed: 3 });
  if (!o) return false;
  if (await sendReceiptImage(chat, o, orderItems(o), `🖼 وصل بيع #${oid} — ${esc(o.name)}`)) return true;
  await send(chat, "⚠️ ما گدرت أسوي الصورة.");
  return false;
}

/** وصل A5 بإطار، للطابعة الكبيرة */
async function receiptFramedHtml(o: Row, items: Row[]) {
  const rows = items.map((it) => `<tr><td>${esc(it.name)}</td><td class=n>${it.qty}</td><td class=n>${num(it.qty * it.price)}</td></tr>`).join("");
  return `<!doctype html><html lang=ar dir=rtl><head><meta charset=utf-8><style>${await pageFonts()}
@page{size:A5;margin:8mm}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:${FONT_STACK};color:#101929}
.fr{box-sizing:border-box;min-height:190mm;padding:5mm;border:4px double #CEA239;border-radius:10px}
.head{display:flex;align-items:center;gap:10px;background:#101929;border-radius:10px;padding:8px 12px;border-bottom:4px solid #CEA239}
.head img{height:48px}.head h1{flex:1;margin:0;font-size:20px;color:#F9C445}.head b{color:#F9C445;font-size:20px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}td,th{padding:7px 9px;border:1px solid #d9dde5;text-align:right}
.info th{background:#FFF3CF;width:80px}.items th{background:#101929;color:#fff;border-color:#101929}.n{text-align:center;white-space:nowrap}
.t td{background:#F9C445;font-weight:800;font-size:16px;border-color:#CEA239}
.foot{margin-top:12px;text-align:center;font-size:11px;color:#8a2a20;border:1px dashed #d98b80;border-radius:8px;padding:6px}
</style></head><body><div class=fr>
<div class=head>${logoTag()}<h1>وصل بيع QMath</h1><b>#${o.id}</b></div>
<table class=info><tr><th>الطالب</th><td>${esc(o.name)}</td></tr><tr><th>الهاتف</th><td dir=ltr style="text-align:right">${esc(o.phone1)}</td></tr>
<tr><th>التاريخ</th><td dir=ltr style="text-align:right">${esc(o.created)}</td></tr><tr><th>الامتحان</th><td>${esc(await examLabel(o.user_id))}</td></tr><tr><th>البائع</th><td><b>${esc(await sellerLabel(o))}</b></td></tr></table>
<table class=items><tr><th>المنتج</th><th class=n>العدد</th><th class=n>المبلغ</th></tr>${rows}<tr class=t><td colspan=2>المجموع</td><td class=n>${num(o.total)} د.ع</td></tr></table>
<div class=foot>جميع المشتريات غير قابلة للإرجاع — شكراً لك 🌷</div>
</div></body></html>`;
}

/** وصل للطباعة (بس إذا طلبه البائع): 58 ملم لطابعة الوصولات، أو A5 بإطار */
export async function sendPaperReceipt(chat: number, oid: number, framed = false) {
  const o = await one("orders", { id: oid, printed: 3 });
  if (!o) { await send(chat, "⚠️ البيعة غير موجودة."); return false; }
  ensureDir();
  const base = framed ? `receipt_framed_${oid}` : `receipt_${oid}`;
  const hp = path.join(PDF_DIR, base + ".html"), pp = path.join(PDF_DIR, base + ".pdf");
  fs.writeFileSync(hp, framed ? await receiptFramedHtml(o, orderItems(o)) : await receiptPaperHtml(o, orderItems(o)), "utf8");
  const caption = framed ? `📄 وصل بيع #${oid} بإطار` : `🧾 وصل بيع #${oid} (عرض 58)\n🖨 افتح الملف ← ⋮ ← Print ← طابعة SUNMI`;
  if (await htmlToPdf(hp, pp)) return !!await upload("sendDocument", { chat_id: String(chat), caption }, "document", pp, `receipt_${oid}.pdf`, "application/pdf");
  if (!WORD_CHECK) return false;   // فحوصات البوت القديم
  // إذا الرسم ما صار، يبقى الملف يوصل ويفتح بالمتصفح
  return !!await upload("sendDocument", { chat_id: String(chat), caption: caption + "\n\n(افتح الملف بالمتصفح واطبعه من هناك)" }, "document", hp, `receipt_${oid}.html`, "text/html");
}

// ---------- سؤال مكتوب من الوورد كصورة: لورقة «✏️ اكتب بالقلم»
/**
 * المعادلات ($…$) ترتسم بـ KaTeX، والكلام العربي يبقى RTL، وكل قطعة إنجليزية/رياضية بالنص العادي تنعزل LTR،
 * حتى «(2 + 3i)(1 − i)» ما تنگلب، و«9 سنتيمتر» يبقى الرقم قبل الكلمة. ^{…} المكتوبة بالنص تصير أس صغير
 */
export function questionHtml(text: string, lang: "ar" | "en", css: string, katexCss: string, katexHtml: (tex: string) => string) {
  // القطع الإنجليزية تنعزل، وكل قطعة تتنظف (esc) وحدها حتى «&amp;» ما ينقسم
  const ISO = /[A-Za-z0-9(\[|√−-][A-Za-z0-9 +\-−×÷=()\[\]^{}²³√.\/|<>≤≥πθ∫′',`]*[A-Za-z0-9)\]|²³′'`}]/g;
  const iso = (t: string) => { let out = "", at = 0; for (const m of t.matchAll(ISO)) { out += esc(t.slice(at, m.index)) + `<span class=lt>${esc(m[0])}</span>`; at = m.index! + m[0].length; } return out + esc(t.slice(at)); };
  const sup = (t: string) => t.replace(/\^\{([^{}]*)\}/g, "<sup>$1</sup>").replace(/_\{([^{}]*)\}/g, "<sub>$1</sub>");
  const line = (l: string) => l.split(/(\$[^$]+\$)/).map((p) => (p.startsWith("$") && p.endsWith("$") && p.length > 2 ? `<span class=k>${katexHtml(p.slice(1, -1))}</span>` : sup(lang === "ar" ? iso(p) : esc(p)))).join("");
  // بالعربي: السطر اللي يبدي بمعادلة أو بحرف إنجليزي («∫…dx = 16 a جد»، «y= …») ينقرا من اليسار لليمين مثل الوورد، ويبقى على اليمين
  const ltr = (l: string) => lang === "ar" && /^[$A-Za-z]/.test(l);
  const body = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => `<div class="ln${ltr(l.trim()) ? " lr" : ""}">${line(l.trim())}</div>`).join("");
  return `<!doctype html><html lang=${lang} dir=${lang === "ar" ? "rtl" : "ltr"}><head><meta charset=utf-8><style>${css}${katexCss}
html,body{margin:0;background:#fff}body{font-family:${FONT_STACK};font-size:34px;color:#14213d;line-height:1.9;padding:16px 24px 26px;width:952px;box-sizing:border-box}
.ln{margin:2px 0}.ln.lr{direction:ltr;text-align:right}.lt{direction:ltr;unicode-bidi:isolate;white-space:nowrap}.k{direction:ltr;unicode-bidi:isolate;display:inline-block;margin:0 4px}.k .katex{font-size:1.05em}
sup,sub{font-size:.62em;line-height:0}</style></head><body>${body}</body></html>`;
}
/** صورة السؤال المكتوب، والبياض اللي تحته ينقص. null إذا المتصفح ما اشتغل */
export async function questionPng(text: string, lang: "ar" | "en"): Promise<Buffer | null> {
  try {
    ensureDir();
    const katex = (await import("katex")).default;
    const kdir = path.join(process.cwd(), "node_modules", "katex", "dist");
    const fontsUrl = "file:///" + path.join(kdir, "fonts").replace(/\\/g, "/").replace(/^\/+/, "") + "/";
    const katexCss = fs.readFileSync(path.join(kdir, "katex.min.css"), "utf8").replace(/url\(fonts\//g, `url(${fontsUrl}`);
    const tag = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const hp = path.join(PDF_DIR, `${tag}.html`), pp = path.join(PDF_DIR, `${tag}.png`);
    fs.writeFileSync(hp, questionHtml(text, lang, await pageFonts(), katexCss, (tex) => katex.renderToString(tex, { throwOnError: false, output: "html" })), "utf8");
    // طول كافي لأطول سؤال، وبعدين البياض ينقص
    const h = Math.min(2400, 200 + text.split(/\r?\n/).length * 110 + Math.ceil(text.length / 40) * 70);
    const ok = await htmlToPng(hp, pp, 1000, h);
    fs.rmSync(hp, { force: true });
    if (!ok) return null;
    const png = fs.readFileSync(pp);
    fs.rmSync(pp, { force: true });
    return await trimBottom(png);
  } catch (e) { console.error(e); return null; }
}
/** يقص البياض اللي تحت الصورة (يخلي شوية فراغ) */
async function trimBottom(png: Buffer): Promise<Buffer> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const im = await loadImage(png);
  const c = createCanvas(im.width, im.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(im, 0, 0);
  const d = ctx.getImageData(0, 0, im.width, im.height).data;
  let last = 0;
  for (let y = im.height - 1; y >= 0 && !last; y -= 2) for (let x = 0; x < im.width; x += 3) { const i = (y * im.width + x) * 4; if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) { last = y; break; } }
  const h = Math.min(im.height, last + 40);
  const out = createCanvas(im.width, h);
  out.getContext("2d").drawImage(im, 0, 0, im.width, h, 0, 0, im.width, h);
  return Buffer.from(await out.encode("png"));
}
