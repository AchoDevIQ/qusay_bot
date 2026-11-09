// ليبل تجربة بأسماء وهمية، حتى ينجرب قياس الطباعة على جهاز الـ POS. ما بيه أي معلومة طالب
import { labelPage } from "../../../lib/inPerson.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  const html = await labelPage({ item: 0, uid: 123456789, name: "محمد علي حسين عمر", exam: "فقط مسائل التقريب والمعدلات الزمنية والتطبيقات على النهايات", center: "معهد قصي العميري", at: "2026-11-09 11:30" });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
