// ورقة «✏️ اكتب بالقلم» بدون الكتابة: الهدر بسطر واحد، السؤال، السطور، والإطار. بلا React، حتى تنرسم وتنفحص وحدها
import { EN_NUM, fitText, themeOf, W, type HeaderInfo } from "../grade/compose";

export const H = 1527;          // نسبة ورقة A4
const HEAD = 92;                // الهدر بسطر واحد، حتى يبقى أكبر مكان للكتابة
const FONT = "QAppEn, QAppAr, Cairo, Tahoma, Arial, sans-serif";

/** الهدر: سطر واحد بلون الفصل. بالعربي الفصل والموضوع يمين، الاسم بالنص، النسخة ورقمه يسار (وبالإنجليزي بالعكس) */
function drawHead(ctx: CanvasRenderingContext2D, x: HeaderInfo) {
  const t = themeOf(x.slug), en = x.lang === "en";
  const no = Number(/(\d+)/.exec(x.slug)?.[1] ?? 0);
  const g = ctx.createLinearGradient(W, 0, 0, HEAD); g.addColorStop(0, t.from); g.addColorStop(1, t.to);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, HEAD);
  ctx.fillStyle = t.accent; ctx.fillRect(0, HEAD - 6, W, 6);
  const topic = en ? `Chapter ${EN_NUM[no] ?? no} · ${x.info || x.title}` : `${x.chapter} · ${x.title}`;
  const model = (en ? `Model ${x.model}` : `النسخة ${x.model}`) + `  ·  ID ${x.sid}`;
  const pad = 40, cy = (HEAD - 6) / 2, side = 330, mid = W - 2 * pad - 2 * side - 40;
  ctx.textBaseline = "middle";
  // يمين
  ctx.direction = en ? "ltr" : "rtl"; ctx.textAlign = "right"; ctx.fillStyle = "#ffffff";
  const right = en ? model : topic;
  fitText(ctx, right, side, 30); ctx.fillText(right, W - pad, cy);
  // يسار
  ctx.textAlign = "left"; ctx.direction = en ? "ltr" : "rtl";
  const left = en ? topic : model;
  ctx.fillStyle = "rgba(255,255,255,.9)"; fitText(ctx, left, side, 28, 700);
  if (!en) { ctx.direction = "ltr"; }
  ctx.fillText(left, pad, cy);
  // الاسم بالنص
  ctx.direction = "rtl"; ctx.textAlign = "center"; ctx.fillStyle = t.accent;
  fitText(ctx, x.name, mid, 32); ctx.fillText(x.name, W / 2, cy);
}

/**
 * الورقة بدون الكتابة: الإطار، الهدر، السؤال، السطور.
 * السؤال صورة من السيرفر: مكتوب من الوورد بنفس شكل الورقة (العربي والمعادلات بترتيبهم الصحيح)، أو صورته من الامتحان إذا بعد ما انرفع وورده
 */
export function drawPaper(ctx: CanvasRenderingContext2D, head: HeaderInfo, n: number, img: HTMLImageElement | null) {
  const t = themeOf(head.slug), en = head.lang === "en";
  ctx.fillStyle = "#fffdf7"; ctx.fillRect(0, 0, W, H);
  drawHead(ctx, head);
  const bx = 34, bw = W - 68;
  let y = HEAD + 14;
  // السؤال: مربع أبيض بطرفه خط بلون الفصل، ورقم السؤال بدائرة بنفس الطرف
  const chip = 70, inner = bw - chip - 40;
  let bh = 86;
  let iw = 0, ih = 0;
  if (img) {
    iw = Math.min(inner, img.naturalWidth * (inner / 1000));
    ih = (iw * img.naturalHeight) / img.naturalWidth;
    if (ih > 430) { ih = 430; iw = (ih * img.naturalWidth) / img.naturalHeight; }
    bh = Math.max(bh, ih + 16);
  }
  ctx.fillStyle = "#ffffff"; ctx.fillRect(bx, y, bw, bh);
  ctx.strokeStyle = "#e3e8f2"; ctx.lineWidth = 2; ctx.strokeRect(bx, y, bw, bh);
  ctx.fillStyle = t.accent; ctx.fillRect(en ? bx : bx + bw - 8, y, 8, bh);
  const cx = en ? bx + 18 + chip / 2 : bx + bw - 18 - chip / 2, ccy = y + Math.min(bh / 2, 50);
  ctx.fillStyle = t.from; ctx.beginPath(); ctx.arc(cx, ccy, chip / 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.direction = "ltr";
  ctx.font = `900 ${chip * 0.36}px ${FONT}`; ctx.fillText(en ? `Q${n}` : `س${n}`, cx, ccy + 1);
  if (img) {
    // صورة السؤال مكتوبة على اليمين بالعربي (وعلى اليسار بالإنجليزي): تنرسم لصق رقم السؤال
    const ix = en ? bx + chip + 30 : bx + bw - chip - 30 - iw;
    ctx.drawImage(img, ix, y + (bh - ih) / 2, iw, ih);
  } else {
    ctx.font = `700 26px ${FONT}`; ctx.fillStyle = "#8a95ab"; ctx.direction = en ? "ltr" : "rtl";
    ctx.textAlign = en ? "left" : "right"; ctx.fillText(en ? "Question in the exam paper" : "السؤال بورقة الأسئلة", en ? bx + chip + 34 : bx + bw - chip - 34, y + bh / 2);
  }
  y += bh;
  // السطور: تبدي لصق السؤال
  ctx.fillStyle = "#d9e2f1";
  for (let ly = y + 58; ly < H - 60; ly += 62) ctx.fillRect(bx, ly, bw, 2);
  // تحت: اسم الأستاذ ورقم الطالب
  ctx.font = `700 18px ${FONT}`; ctx.fillStyle = "#9aa6bd"; ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right"; ctx.direction = "rtl"; ctx.fillText("QMath · قصي العميري", W - bx, H - 28);
  ctx.textAlign = "left"; ctx.direction = "ltr"; ctx.fillText(`ID ${head.sid}`, bx, H - 28);
  // الإطار بلون الفصل
  ctx.lineWidth = 10; ctx.strokeStyle = t.from; ctx.strokeRect(5, 5, W - 10, H - 10);
}

