// مكتبة الـ PDF بالسيرفر. ملف العامل مالها (pdf.worker) ينحدد بمكانه بالضبط،
// حتى ما يضيع إذا الموقع انبنى وانحزم (هذا اللي جان يطلع «صار خطأ» برفع الملزمة)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let ready: Promise<Pdfjs> | null = null;
export function pdfjsLib(): Promise<Pdfjs> {
  ready ??= (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // إذا الملف مو بهذا المكان يبقى على مكانه الأصلي جنب المكتبة
    const worker = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
    if (fs.existsSync(worker)) pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
    return pdfjs;
  })();
  return ready;
}
