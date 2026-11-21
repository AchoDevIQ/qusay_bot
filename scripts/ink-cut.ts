// يقص قطعة من صورة ورقة الأستاذ (كاتب بالقلم الأحمر) ويخليها صورة خلفيتها شفافة: يبقى بس الحبر الأحمر.
// الصور تنحط بـ public/ink/ وتنكتب أسماؤها بـ INK بـ app/store/myexams/AiCompare.tsx
// الاستعمال: node scripts/ink-cut.ts صورة.jpg x1 y1 x2 y2 public/ink/tick-1.png
import sharp from "sharp";

const [src, a, b, c, d, out] = process.argv.slice(2);
if (!out) { console.log("node scripts/ink-cut.ts photo.jpg x1 y1 x2 y2 out.png"); process.exit(1); }
const [x1, y1, x2, y2] = [a, b, c, d].map(Number);
const { data, info } = await sharp(src).rotate()
  .extract({ left: x1, top: y1, width: x2 - x1, height: y2 - y1 })
  .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
// الحبر: الأحمر أعلى من الأخضر والأزرق بوضوح. كل شي ثاني (الورقة، الخطوط الزرقة، الظل) يصير شفاف
const px = info.width * info.height;
for (let i = 0; i < px; i++) {
  const o = i * 4, r = data[o], g = data[o + 1], bl = data[o + 2];
  const red = r - Math.max(g, bl);
  const al = Math.max(0, Math.min(255, (red - 35) * 4));
  // لون الحبر نفسه بس أغمق شوية حتى يبين على الورقة البيضة مثل القلم
  data[o] = Math.min(255, Math.round(r * 0.92)); data[o + 1] = Math.round(g * 0.5); data[o + 2] = Math.round(bl * 0.5); data[o + 3] = al;
}
await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim({ threshold: 1 }).png().toFile(out);
console.log("✓", out);
