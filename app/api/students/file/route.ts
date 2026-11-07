// صور أوراق الطالب بصفحة الطلاب: بس اللي عنده صلاحية الطلاب
import { ApiError, examFile } from "../../../../lib/examApi.ts";
import { STUDENTS_PERM } from "../../../../lib/studentApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const ref = q.get("ref") ?? "";
    // بس أوراق الطلاب، مو باقي ملفات الامتحانات
    if (!/^(graded|student_answers)\//.test(ref)) throw new ApiError(403, "ملف غير معروف");
    const { body, type } = await examFile(q.get("t"), ref, STUDENTS_PERM);
    return new Response(new Uint8Array(body), {
      headers: { "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return new Response(e instanceof ApiError ? e.message : "error", { status: e instanceof ApiError ? e.status : 500 });
  }
}
