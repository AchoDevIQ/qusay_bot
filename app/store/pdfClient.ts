// مكتبة الـ PDF بالمتصفح. المكتبة وملف العامل مالها منسوخين بـ public من نفس النسخة (فحص يتأكد إنهم مطابقين)،
// والمتصفح يحملهم من هناك مباشرة: المكتبة خارج حزمة السيرفر (next.config)، فلو انطلبت من الصفحات
// جان البناء يفشل أو السيرفر يحملها وهو يجهز الصفحة
const V = "6.5.438";
type Pdfjs = typeof import("pdfjs-dist");
let lib: Promise<Pdfjs> | null = null;
export function pdfClient(): Promise<Pdfjs> {
  lib ??= (import(/* webpackIgnore: true */ `/pdf.min.mjs?v=${V}`) as Promise<Pdfjs>)
    .then((pdfjs) => { pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs?v=${V}`; return pdfjs; })
    .catch((e) => { lib = null; throw e; });
  return lib;
}
