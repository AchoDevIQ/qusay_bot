import GradeClient from "./GradeClient";
import BrowserDoor from "./BrowserDoor";

export const metadata = { title: "التصحيح - QMath" };
export default function Page() { return <BrowserDoor><GradeClient /></BrowserDoor>; }
