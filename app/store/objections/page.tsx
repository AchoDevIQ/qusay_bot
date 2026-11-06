import GradeClient from "../grade/GradeClient";

export const metadata = { title: "الاعتراضات - QMath" };
// صاحب البوت: كل الاعتراضات بمكان واحد، سواء المصحح يتابع اعتراضاته أو لا
export default function Page() { return <GradeClient only="obj" />; }
