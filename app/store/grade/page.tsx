import GradeClient from "./GradeClient";
import BrowserDoor from "./BrowserDoor";

// ما تتكبر بالأصابع (طلبه 2026-11-27): بكروم دوستين سريعتين أو قرصة تكبّر الصفحة فتتحرك يمين ويسار وهو يصحح.
// بتليگرام هذا مسدود أصلاً، فهسه نفس الشي بكروم وبالتطبيق
export const viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };
export const metadata = { title: "التصحيح - QMath" };
export default function Page() { return <BrowserDoor><GradeClient /></BrowserDoor>; }
