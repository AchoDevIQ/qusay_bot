// المشترك بين صفحات لوحة التحكم: الأخطاء، والتحقق من صاحب الطلب وصلاحيته
import { initDb, type Row } from "./db.ts";
import { can } from "./data.ts";
import { verifyInitData } from "./webAuth.ts";

let ready = false;
export const ensure = async () => { if (!ready) { await initDb(); ready = true; } };

export class ApiError extends Error {
  status: number;
  extra?: Row;
  constructor(status: number, message: string, extra?: Row) { super(message); this.status = status; this.extra = extra; }
}
export const need = (cond: unknown, message: string, status = 400) => { if (!cond) throw new ApiError(status, message); };
export const intOf = (v: unknown, min: number, max: number, label: string) => {
  const n = Number(v);
  need(Number.isInteger(n) && n >= min && n <= max, label);
  return n;
};
export async function authed(initData: unknown, perm: string) {
  await ensure();
  const uid = verifyInitData(initData);
  need(uid !== null, "افتح الصفحة من داخل البوت", 401);
  need(await can(uid!, perm), "ما عندك صلاحية", 403);
  return uid!;
}

/** طلب صفحة إدارة: يرجع جواب الأمر، أو رسالة الخطأ */
export async function apiResponse(run: () => Promise<Row>) {
  try {
    return Response.json(await run(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ ...e.extra, error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "صار خطأ، حاول مرة ثانية" }, { status: 500 });
  }
}
