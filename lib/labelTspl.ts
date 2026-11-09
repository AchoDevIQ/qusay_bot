// ليبل الطالب بلغة طابعة الليبل (TSPL، 58×39 ملم، 203 نقطة بالإنج = 464×312 نقطة):
// فوك اسم الطالب الرباعي بعرض الليبل، بالنص الكود (تطبعه الطابعة نفسها) ورقمه ومركزه ووقته، وجوة اسم الامتحان بعرض الليبل.
// الكتابة العربية صور، لأن خطوط الطابعة ما بيها عربي
import fs from "node:fs";
import path from "node:path";

export type LabelInfo = { item: number; uid: number; name: string; exam: string; center: string; at: string };

let fontReady = false;
type Ctx = { font: string; measureText(t: string): { width: number }; fillText(t: string, x: number, y: number): void };

/** يقسم النص على سطور بأكبر حجم يخليه يوسع */
function fit(g: Ctx, text: string, width: number, sizes: number[], maxLines: number) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  let result = { size: sizes[sizes.length - 1], lines: [] as string[] };
  for (const size of sizes) {
    g.font = `bold ${size}px QArabic`;
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && g.measureText(next).width > width) { lines.push(cur); cur = word; } else cur = next;
    }
    if (cur) lines.push(cur);
    result = { size, lines };
    if (lines.length <= maxLines && lines.every((l) => g.measureText(l).width <= width)) return result;
  }
  return { ...result, lines: result.lines.slice(0, maxLines) };
}

type Piece = { x: number; y: number; w: number; h: number; draw: (g: Ctx & Record<string, unknown>, w: number) => void };

async function bitmap(p: Piece, dx: number, dy: number) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(p.w, p.h);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, p.w, p.h);
  g.fillStyle = "#000"; g.textBaseline = "top"; g.textAlign = "right"; g.direction = "rtl";
  p.draw(g as unknown as Ctx & Record<string, unknown>, p.w);
  const px = g.getImageData(0, 0, p.w, p.h).data;
  const rowBytes = Math.ceil(p.w / 8);
  // بالطابعة: البت 0 يطبع نقطة سودة، و1 يخليها بيضة
  const bits = Buffer.alloc(rowBytes * p.h, 0xff);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (px[(y * p.w + x) * 4] < 128) bits[y * rowBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
  }
  return Buffer.concat([
    Buffer.from(`BITMAP ${Math.max(0, p.x + dx)},${Math.max(0, p.y + dy)},${rowBytes},${p.h},0,`, "latin1"),
    bits,
    Buffer.from("\r\n", "latin1"),
  ]);
}

/** dx وdy: تحريك الطباعة بالنقاط (8 نقاط بالملم) إذا الليبل طالع زاحف */
export async function labelTspl(c: LabelInfo, dx = 0, dy = 0): Promise<Buffer> {
  const { GlobalFonts } = await import("@napi-rs/canvas");
  if (!fontReady) {
    const p = path.join(process.cwd(), "assets", "fonts", "NotoSansArabic-Bold.ttf");
    if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, "QArabic");
    fontReady = true;
  }
  const lines = (g: Ctx, list: string[], size: number, w: number, top: number) => {
    list.forEach((l, i) => g.fillText(l, w - 2, top + i * Math.round(size * 1.4)));
  };
  const parts = await Promise.all(([
    // اسم الطالب الرباعي: أول شي، بعرض الليبل، وسطر واحد
    { x: 8, y: 4, w: 448, h: 52, draw: (g, w) => { const f = fit(g, c.name, w - 4, [36, 32, 28, 24, 20], 1); lines(g, f.lines, f.size, w, 0); } },
    // جنب الكود: الرقم والمركز والوقت
    { x: 170, y: 60, w: 286, h: 142, draw: (g, w) => {
      g.direction = "ltr"; g.font = "bold 26px QArabic"; g.fillText(`#${c.uid}`, w - 2, 0);
      g.direction = "rtl"; const f = fit(g, c.center, w - 4, [24, 21, 18], 2); lines(g, f.lines, f.size, w, 38);
      g.direction = "ltr"; g.font = "bold 22px QArabic"; g.fillText(`${c.at.slice(0, 10)}  ${c.at.slice(11, 16)}`, w - 2, 108);
    } },
    // اسم الامتحان: جوة، بعرض الليبل، ويوسع سطرين إذا طويل
    { x: 8, y: 208, w: 448, h: 92, draw: (g, w) => { const f = fit(g, c.exam, w - 4, [32, 28, 24, 21, 18], 2); lines(g, f.lines, f.size, w, 0); } },
  ] as Piece[]).map((p) => bitmap(p, dx, dy)));
  return Buffer.concat([
    Buffer.from("SIZE 58 mm,39 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n", "latin1"),
    ...parts,
    Buffer.from(`QRCODE ${Math.max(0, 14 + dx)},${Math.max(0, 58 + dy)},M,7,A,0,"QI:${c.item}"\r\nPRINT 1\r\n`, "latin1"),
  ]);
}
