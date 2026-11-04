/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["firebase-admin", "@sparticuz/chromium", "puppeteer-core"],
  // ملفات يقراها البوت من القرص، ولازم توصل وية التطبيق للسيرفر
  outputFileTracingIncludes: { "/api/**": ["./assets/*.jpg", "./public/logo.png", "./public/boahmed.ttf", "./node_modules/@sparticuz/chromium/bin/**"] },
  // صفحات المتجر ما تتخزن، حتى التليجرام ما يفتح نسخة قديمة
  async headers() {
    return [{ source: "/store/:path*", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }];
  },
};
export default nextConfig;
