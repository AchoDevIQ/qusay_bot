// تجهيز صورة الجواب قبل الرفع: تدوير وتصغير، و«سكانر» اختياري يخلي الورقة بيضاء والكتابة سوداء وواضحة
// (يشيل الظل والإضاءة الصفرة مثل تطبيقات السكانر)
const KEY = "qm_scan";
export const scanDefault = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };
export const rememberScan = (on: boolean) => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* المتصفح مانع */ } };

/** فلتر السكانر: كل نقطة تنقسم على لون الورقة اللي حواليها، فالظل يروح، وبعدين يزيد التباين */
export function scanFilter(c: HTMLCanvasElement) {
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const { width: w, height: h } = c;
  // لون الورقة بكل منطقة: الصورة مصغرة هواية وراجعة تكبر = معدل اللي حواليها
  const sw = Math.max(1, Math.round(w / 28)), sh = Math.max(1, Math.round(h / 28));
  const small = document.createElement("canvas");
  small.width = sw; small.height = sh;
  const sg = small.getContext("2d")!;
  sg.imageSmoothingQuality = "high";
  sg.drawImage(c, 0, 0, sw, sh);
  const bgC = document.createElement("canvas");
  bgC.width = w; bgC.height = h;
  const bgG = bgC.getContext("2d", { willReadFrequently: true })!;
  bgG.imageSmoothingQuality = "high";
  bgG.drawImage(small, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), bg = bgG.getImageData(0, 0, w, h).data, d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const b = Math.max(40, 0.299 * bg[i] + 0.587 * bg[i + 1] + 0.114 * bg[i + 2]);
    // نسبة للورقة: 1 = ورقة. تحت 0.55 أسود، فوق 0.9 أبيض، وبيناتهن تدرج
    const r = v / b;
    const o = r >= 0.9 ? 255 : r <= 0.55 ? 0 : Math.round(((r - 0.55) / 0.35) ** 1.4 * 255);
    d[i] = d[i + 1] = d[i + 2] = o;
  }
  g.putImageData(img, 0, 0);
}

/** يدور الصورة ويصغرها، ويسوي سكانر إذا مفعّل */
export async function prepare(file: Blob, turns: number, scan: boolean) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas");
  [c.width, c.height] = turns % 2 ? [h, w] : [w, h];
  const g = c.getContext("2d", { willReadFrequently: scan })!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((turns * Math.PI) / 2);
  g.drawImage(bmp, -w / 2, -h / 2, w, h);
  if (scan) scanFilter(c);
  return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("صورة"))), "image/jpeg", scan ? 0.8 : 0.85));
}

/** معاينة: الصورة مثل ما راح تنرفع (بدون تدوير، التدوير يبين بالشاشة) */
export async function previewUrl(file: Blob, scan: boolean) {
  return URL.createObjectURL(scan ? await prepare(file, 0, true) : file);
}
