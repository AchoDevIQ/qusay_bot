// 📲 رابط قصير لتنزيل تطبيق «قصي العميري» على جهاز البيع بالمكتبة أو المركز (طلبه 2026-11-26: الرابط الطويل ما ينكتب بالجهاز)
export const metadata = { title: "تطبيق قصي العميري" };

const box: React.CSSProperties = { maxWidth: 460, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif", color: "#fff", textAlign: "center" };
const btn: React.CSSProperties = { display: "block", margin: "18px 0", padding: "18px 12px", borderRadius: 16, background: "#F6C94A", color: "#141F33", fontSize: 22, fontWeight: 900, textDecoration: "none" };
const step: React.CSSProperties = { textAlign: "right", background: "rgba(255,255,255,.07)", borderRadius: 12, padding: "10px 12px", margin: "8px 0", lineHeight: 1.8, fontSize: 16 };

export default function ApkPage() {
  return (
    <main dir="rtl" style={{ minHeight: "100vh", background: "#0B1424" }}>
      <div style={box}>
        <img src="/logo.png" alt="" style={{ width: 90 }} />
        <h1 style={{ fontSize: 24, margin: "10px 0" }}>تطبيق قصي العميري</h1>
        <div style={{ color: "#B8C2D6" }}>للمكتبات والمراكز: البيع وطباعة الوصل وليبل الامتحانات</div>
        <a href="/device-app.apk" download="qusay-alomairi.apk" style={btn}>⬇️ نزّل التطبيق</a>
        <div style={step}>1. دوس «⬇️ نزّل التطبيق». ينزل ملف صغير (أقل من 1 ميگا).</div>
        <div style={step}>2. من يخلص، دوس على الملف (فوگ بالإشعارات أو بالتنزيلات) ← «تثبيت». إذا گال «غير مسموح»، اختار «الإعدادات» ← فعّل «السماح من هذا المصدر» وارجع.</div>
        <div style={step}>3. إذا عندك تطبيق قديم اسمه «جهاز البيع»، شيله أول (دوس عليه مطولاً ← إلغاء التثبيت).</div>
        <div style={step}>4. افتح «قصي العميري» ← صوّر الرمز المربع اللي يطلع لقصي العميري، أو الصق الرابط اللي دزه إلك ← «🔐 اعطيني رمزي السري» ← احفظ الرمز.</div>
      </div>
    </main>
  );
}
