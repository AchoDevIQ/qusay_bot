// رقم نسخة الخادم: الصفحات المفتوحة من مدة (مثل نافذة السبورة) تعرف إن أكو تحديث جديد وتنبه (طلبه 2026-11-27)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = () => Response.json({ v: process.env.K_REVISION ?? "dev" }, { headers: { "Cache-Control": "no-store" } });
