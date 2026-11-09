// ليبل الطالب بلغة طابعة الليبل (TSPL، 58×39 ملم، 203 نقطة بالإنج): الكود تطبعه الطابعة نفسها،
// والكتابة العربية صورة، لأن خطوط الطابعة ما بيها عربي
import fs from "node:fs";
import path from "node:path";

export type LabelInfo = { item: number; uid: number; name: string; exam: string; center: string; at: string };

const W = 280, H = 288;
const X = 176, Y = 12;
let fontReady = false;

/** dx وdy: تحريك الطباعة بالنقاط (8 نقاط بالملم) إذا الليبل طالع زاحف */
export async function labelTspl(c: LabelInfo, dx = 0, dy = 0): Promise<Buffer> {
  const { createCanvas, GlobalFonts } = await import("@napi-rs/canvas");
  if (!fontReady) {
    const p = path.join(process.cwd(), "assets", "fonts", "NotoSansArabic-Bold.ttf");
    if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, "QArabic");
    fontReady = true;
  }
  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#000"; g.textBaseline = "top"; g.textAlign = "right"; g.direction = "rtl";
  let y = 0;
  const lines = (text: string, size: number, max: number) => {
    g.font = `bold ${size}px QArabic`;
    const out: string[] = [];
    let cur = "";
    for (const word of String(text ?? "").split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && g.measureText(next).width > W - 4) { out.push(cur); cur = word; } else cur = next;
    }
    if (cur) out.push(cur);
    for (const l of out.slice(0, max)) { g.fillText(l, W - 2, y); y += Math.round(size * 1.45); }
  };
  lines(c.name, 30, 2);
  g.direction = "ltr";
  lines(`#${c.uid}`, 26, 1);
  g.direction = "rtl";
  lines(c.exam, 23, 2);
  lines(c.center, 23, 1);
  g.direction = "ltr";
  lines(`${c.at.slice(0, 10)}  ${c.at.slice(11, 16)}`, 23, 1);

  const px = g.getImageData(0, 0, W, H).data;
  const rowBytes = Math.ceil(W / 8);
  // بالطابعة: البت 0 يطبع نقطة سودة، و1 يخليها بيضة
  const bits = Buffer.alloc(rowBytes * H, 0xff);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const i = (yy * W + xx) * 4;
    if (px[i] < 128) bits[yy * rowBytes + (xx >> 3)] &= ~(0x80 >> (xx & 7));
  }
  return Buffer.concat([
    Buffer.from(`SIZE 58 mm,39 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP ${Math.max(0, X + dx)},${Math.max(0, Y + dy)},${rowBytes},${H},0,`, "latin1"),
    bits,
    Buffer.from(`\r\nQRCODE ${Math.max(0, 14 + dx)},${Math.max(0, 80 + dy)},M,7,A,0,"QI:${c.item}"\r\nPRINT 1\r\n`, "latin1"),
  ]);
}
