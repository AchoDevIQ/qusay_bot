import DoorClient from "./DoorClient";

// الكادر يگدر يضيفها للشاشة الرئيسية (الآيفون والآيباد يحتاجونها حتى تشتغل الإشعارات)
export const metadata = { title: "الدخول - QMath", manifest: "/door.webmanifest", appleWebApp: { capable: true, title: "QMath", statusBarStyle: "default" as const } };
export default function Page() { return <DoorClient />; }
