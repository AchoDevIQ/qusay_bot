/** @type {import('next').NextConfig} */
const nextConfig = {
  // صفحات المتجر ما تتخزن، حتى التليجرام ما يفتح نسخة قديمة
  async headers() {
    return [{ source: "/store/:path*", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }];
  },
};
export default nextConfig;
