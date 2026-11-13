/** @type {import('next').NextConfig} */
const nextConfig = {
  // مكتبة الـ PDF تبقى بملفاتها: إذا انحزمت، ملف العامل مالها (pdf.worker) يضيع وصفحات الملازم ما ترتسم
  serverExternalPackages: ["firebase-admin", "@sparticuz/chromium", "puppeteer-core", "@napi-rs/canvas", "pdfjs-dist"],
  // ملفات يقراها البوت من القرص، ولازم توصل وية التطبيق للسيرفر
  outputFileTracingIncludes: { "/api/**": ["./assets/*.jpg", "./assets/fonts/*", "./public/logo.png", "./public/boahmed.ttf", "./node_modules/@sparticuz/chromium/bin/**", "./node_modules/katex/dist/**",
    // ملف بيانات اللغة مال مكتبة الرسم: بدونه الكتابة العربية بالليبل تطلع حروف مفككة ومقلوبة
    "./node_modules/@napi-rs/canvas-linux-*/**", "./node_modules/pdfjs-dist/legacy/build/**", "./node_modules/pdfjs-dist/standard_fonts/**", "./node_modules/pdfjs-dist/cmaps/**"] },
  // صفحات المتجر ما تتخزن، حتى التليجرام ما يفتح نسخة قديمة
  async headers() {
    // كل الصفحات: المتصفح ما يخمن نوع الملف، والرابط (بيه رمز الدخول) ما يطلع لمواقع ثانية
    const safe = [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "no-referrer" }];
    return [
      { source: "/:path*", headers: safe },
      { source: "/store/:path*", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      // الملازم: يوتيوب ما يشغل فيديو الحل إذا ما عرف اسم الموقع (خطأ 153). نطيه اسم الموقع بس، بلا الرابط اللي بيه رمز الدخول
      { source: "/store/notes", headers: [{ key: "Referrer-Policy", value: "strict-origin" }] },
    ];
  },
};
export default nextConfig;
