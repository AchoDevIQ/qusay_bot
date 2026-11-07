/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["firebase-admin", "@sparticuz/chromium", "puppeteer-core", "@napi-rs/canvas"],
  // ملفات يقراها البوت من القرص، ولازم توصل وية التطبيق للسيرفر
  outputFileTracingIncludes: { "/api/**": ["./assets/*.jpg", "./assets/fonts/*", "./public/logo.png", "./public/boahmed.ttf", "./node_modules/@sparticuz/chromium/bin/**"] },
  // صفحات المتجر ما تتخزن، حتى التليجرام ما يفتح نسخة قديمة
  async headers() {
    // كل الصفحات: المتصفح ما يخمن نوع الملف، والرابط (بيه رمز الدخول) ما يطلع لمواقع ثانية
    const safe = [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "no-referrer" }];
    return [
      { source: "/:path*", headers: safe },
      { source: "/store/:path*", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};
export default nextConfig;
