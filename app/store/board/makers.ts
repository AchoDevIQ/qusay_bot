// 📦 صناديق جاهزة من دفتره، وأختام بدوسة، وصفحة غلاف (طلبه 2026-11-25: «سوي كل الأفكار»).
// كلها تنرسم صورة PNG شفافة وتنحط بالسبورة مثل «إدراج صورة»: تتحرك وتكبر وتنحذف بأداة التحريك، والكتابة فوكها بالقلم.
import { FONT, logoIn } from "./boardDraw.ts";
import { SLOGAN } from "../../../lib/board/engine.ts";

export type BoxKind = "title" | "rule" | "example" | "note" | "table";
export const BOXES: { id: BoxKind; t: string }[] = [
  { id: "title", t: "▬ شريط عنوان المحاضرة" },
  { id: "rule", t: "📐 صندوق قاعدة" },
  { id: "example", t: "✏️ صندوق مثال" },
  { id: "note", t: "💡 ملاحظة" },
  { id: "table", t: "▦ جدول 3 خانات" },
];
export const STAMPS: { id: string; t: string; c: string; bg: string }[] = [
  { id: "imp", t: "مهم جداً", c: "#FF5A5F", bg: "rgba(255,90,95,.12)" },
  { id: "save", t: "احفظها", c: "#F6C94A", bg: "rgba(246,201,74,.12)" },
  { id: "star", t: "⭐ ممتاز", c: "#F6C94A", bg: "rgba(246,201,74,.12)" },
  { id: "ok", t: "✔ صح", c: "#3DDC84", bg: "rgba(61,220,132,.12)" },
  { id: "no", t: "✘ خطأ", c: "#FF5A5F", bg: "rgba(255,90,95,.12)" },
  { id: "warn", t: "انتبه!", c: "#FF9F43", bg: "rgba(255,159,67,.12)" },
  { id: "min", t: "سؤال وزاري", c: "#7FB2FF", bg: "rgba(127,178,255,.12)" },
  { id: "trick", t: "فكرة قصي", c: "#F6C94A", bg: "rgba(246,201,74,.12)" },
];

const gold = (x: CanvasRenderingContext2D, x0: number, x1: number) => {
  const g = x.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, "#F6C94A"); g.addColorStop(0.5, "#D9A62E"); g.addColorStop(1, "#F3D27A"); return g;
};
const canvas = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")!] as const; };
/** label: عنوان صغير بزاوية الصندوق فوك يمين */
function tab(x: CanvasRenderingContext2D, right: number, top: number, text: string, color: string | CanvasGradient) {
  x.font = `700 30px ${FONT}`; x.direction = "rtl";
  const w = x.measureText(text).width + 40;
  x.fillStyle = "#141F33"; x.beginPath(); x.roundRect(right - w, top - 22, w, 46, 12); x.fill();
  x.strokeStyle = color; x.lineWidth = 2.5; x.stroke();
  x.fillStyle = color; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, right - w / 2, top + 1);
}

/** الصناديق: شريط العنوان يكتب النص، والباقي فاضية للكتابة بالقلم */
export function makeBox(kind: BoxKind, text: string, light: boolean): HTMLCanvasElement {
  const edge = light ? "#B8862B" : "#F6C94A";
  if (kind === "title") {
    const [c, x] = canvas(1500, 120);
    x.fillStyle = "#1E2230"; x.beginPath(); x.roundRect(4, 4, 1492, 112, 14); x.fill();
    x.fillStyle = gold(x, 0, 1500); x.fillRect(4, 108, 1492, 5);
    x.font = `700 52px ${FONT}`; x.fillStyle = "#FFFFFF"; x.textAlign = "center"; x.textBaseline = "middle";
    x.direction = /[؀-ۿ]/.test(text) ? "rtl" : "ltr";
    x.fillText(text || "المحاضرة", 750, 58, 1420);
    return c;
  }
  if (kind === "table") {
    const [c, x] = canvas(1500, 260);
    x.strokeStyle = edge; x.lineWidth = 4; x.strokeRect(6, 6, 1488, 248);
    x.lineWidth = 2.5; x.beginPath(); x.moveTo(506, 6); x.lineTo(506, 254); x.moveTo(1002, 6); x.lineTo(1002, 254); x.stroke();
    return c;
  }
  const [c, x] = canvas(1500, kind === "note" ? 220 : 300);
  const h = c.height;
  if (kind === "rule") {
    // مثل «قواعد المشتقة» بدفتره: صندوق خفيف وشريط ذهبي على اليمين
    x.fillStyle = light ? "rgba(20,31,51,.05)" : "rgba(255,255,255,.06)"; x.fillRect(30, 30, 1440, h - 40);
    x.fillStyle = gold(x, 1440, 1480); x.fillRect(1452, 30, 14, h - 40);
    x.strokeStyle = light ? "rgba(20,31,51,.25)" : "rgba(255,255,255,.22)"; x.lineWidth = 2; x.strokeRect(30, 30, 1440, h - 40);
    tab(x, 1440, 30, "قاعدة", gold(x, 1200, 1440));
  } else if (kind === "example") {
    x.strokeStyle = edge; x.lineWidth = 4; x.beginPath(); x.roundRect(10, 30, 1480, h - 40, 16); x.stroke();
    x.fillStyle = light ? "rgba(184,134,43,.06)" : "rgba(246,201,74,.07)"; x.fill();
    tab(x, 1460, 30, "مثال", edge);
  } else {
    x.strokeStyle = edge; x.lineWidth = 3.5; x.setLineDash([16, 10]); x.beginPath(); x.roundRect(10, 30, 1480, h - 40, 16); x.stroke(); x.setLineDash([]);
    tab(x, 1460, 30, "💡 ملاحظة", edge);
  }
  return c;
}

/** ختم مايل شوية، إطار مزدوج */
export function makeStamp(id: string): HTMLCanvasElement {
  const s = STAMPS.find((x) => x.id === id) ?? STAMPS[0];
  const [, mx] = canvas(10, 10);
  mx.font = `800 64px ${FONT}`;
  const tw = mx.measureText(s.t).width, w = tw + 110, h = 130;
  const [c, x] = canvas(Math.ceil(w + 40), h + 60);
  x.translate(c.width / 2, c.height / 2); x.rotate(-0.08);
  x.fillStyle = s.bg; x.strokeStyle = s.c;
  x.lineWidth = 6; x.beginPath(); x.roundRect(-w / 2, -h / 2, w, h, 22); x.fill(); x.stroke();
  x.lineWidth = 2; x.beginPath(); x.roundRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 16); x.stroke();
  x.fillStyle = s.c; x.font = `800 64px ${FONT}`; x.direction = "rtl"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(s.t, 0, 4);
  return c;
}

/** صفحة غلاف: لوگوه كبير، اسمه، عنوان الشرح، وشعاره */
export function makeCover(title: string, sub: string, logo: HTMLImageElement | null, light: boolean): HTMLCanvasElement {
  const [c, x] = canvas(1600, 860);
  const main = light ? "#141F33" : "#FFFFFF";
  x.textAlign = "center"; x.textBaseline = "middle"; x.direction = "rtl";
  // دائرة ذهبية واللوگو
  x.strokeStyle = gold(x, 620, 980); x.lineWidth = 5; x.beginPath(); x.arc(800, 200, 150, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 1.5; x.beginPath(); x.arc(800, 200, 136, 0, Math.PI * 2); x.stroke();
  logoIn(x, logo, 800, 200, 200);
  x.fillStyle = gold(x, 500, 1100); x.font = `800 84px ${FONT}`; x.fillText("قصي العميري", 800, 430);
  x.fillStyle = main; x.font = `700 76px ${FONT}`;
  x.direction = /[؀-ۿ]/.test(title) ? "rtl" : "ltr";
  x.fillText(title || "شرح", 800, 560, 1500);
  x.direction = "rtl";
  if (sub) { x.fillStyle = light ? "rgba(20,31,51,.7)" : "rgba(255,255,255,.75)"; x.font = `500 40px ${FONT}`; x.fillText(sub, 800, 650, 1500); }
  x.fillStyle = gold(x, 300, 1300); x.fillRect(400, 720, 800, 3);
  x.font = `700 40px ${FONT}`; x.fillText(SLOGAN, 800, 790, 1500);
  return c;
}
