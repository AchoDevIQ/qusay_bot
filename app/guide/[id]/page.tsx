// قسم من دليل البوت: رابط ينرسل للمساعد وينفتح بدون تسجيل دخول
import { notFound } from "next/navigation";
import { SHARED_GUIDE, type GuideSection } from "../../../lib/guide.ts";

export const metadata = { title: "دليل البوت", robots: { index: false, follow: false } };

const box = { background: "#fff", color: "#16202f", borderRadius: 14, padding: 16, margin: "12px 0" };
function Section({ s }: { s: GuideSection }) {
  return (
    <section style={box}>
      <h2 style={{ margin: 0 }}>{s.icon} {s.title}</h2>
      <p style={{ color: "#5b6677", margin: "6px 0" }}>{s.who}</p>
      <p>{s.intro}</p>
      <p style={{ background: "#fff6dd", padding: 10, borderRadius: 8, margin: "8px 0" }}><b>🔑 الصلاحية:</b> {s.perm}</p>
      {s.blocks.map((b, i) => (
        <div key={i}>
          {b.h && <h3 style={{ marginBottom: 6 }}>{b.h}</h3>}
          {b.steps && <ol style={{ paddingInlineStart: 22, margin: 0 }}>{b.steps.map((t, j) => <li key={j} style={{ margin: "5px 0" }}>{t}</li>)}</ol>}
          {b.notes?.map((t, j) => <p key={j} style={{ background: "#fff6dd", padding: 10, borderRadius: 8, margin: "8px 0" }}>{t}</p>)}
        </div>
      ))}
    </section>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const list = id === "all" ? SHARED_GUIDE : SHARED_GUIDE.filter((s) => s.id === id);
  if (!list.length) notFound();
  return (
    <main dir="rtl" lang="ar" style={{ background: "#0f1a2e", minHeight: "100vh", padding: 16, fontFamily: "Tahoma, Arial, sans-serif", fontSize: 17, lineHeight: 1.7 }}>
      <h1 style={{ color: "#f7c548", margin: "4px 0" }}>📖 دليل البوت</h1>
      {list.map((s) => <Section key={s.id} s={s} />)}
    </main>
  );
}
