import GuardianClient from "./GuardianClient";

// تلفون ولي الأمر يگدر يضيفها للشاشة الرئيسية (الآيفون يحتاجها حتى تشتغل الإشعارات)
export const metadata = { title: "ولي الأمر - QMath", manifest: "/guardian.webmanifest", appleWebApp: { capable: true, title: "ولي الأمر", statusBarStyle: "default" as const } };
export default function Page() { return <GuardianClient />; }
