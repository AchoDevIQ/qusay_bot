// 🔔 إشعارات الطلاب (طلب الأستاذ 2026-11-17): صاحب البوت (أو المساعد بصلاحية) يدز إشعار بكتابة وصورة اختيارية:
// - مؤقت: الطالب يفتحه ويقراه، وبعدها يختفي من عنده.
// - دائمي: يبقى عند الطالب لحد ما صاحب البوت يمسحه.
// المسح يشيله من عند كل الطلاب فوراً. اللي ما قراه ينحسب بعلامة العدد فوك (بالتطبيق).
// لمن: كل الطلاب، أو طلاب التجربة، أو فئة (نفس فئات صفحة «شنو يشوف الطالب») وطلاب بأسمائهم
import { randomUUID } from "node:crypto";
import { find, insert, one, put, update, type Row } from "./db.ts";
import { checkDevice } from "./deviceLock.ts";
import { student } from "./data.ts";
import { files } from "./files.ts";
import { clean, inRule, type Rule } from "./studentVis.ts";
import { stamp } from "./util.ts";
import { authed, ensure, need } from "./webApi.ts";
import { verifyHomeToken } from "./webAuth.ts";

export const NOTICE_PERM = "notices";
export type Aud = "all" | "pilot" | "some";
const MAX_IMG = 5_000_000;

const parse = (s: unknown) => { try { return JSON.parse(String(s ?? "")); } catch { return null; } };

async function forMe(n: Row, uid: number, s: Row | null, pilot: boolean) {
  const aud = String(n.aud ?? "all");
  if (aud === "all") return true;
  if (aud === "pilot") return pilot;
  return await inRule(clean(parse(n.rule) ?? {}, "off"), uid, s);
}

/** إشعارات الطالب: الدائمي كله، والمؤقت اللي بعده ما قراه. الجديد فوك */
export async function myNotices(uid: number) {
  const s = await student(uid);
  const { isPilot } = await import("./appLink.ts");
  const pilot = await isPilot(uid);
  const reads = new Set((await find("notice_reads", { user_id: uid })).map((r) => Number(r.notice_id)));
  const out: { id: number; kind: string; text: string; img: boolean; at: string; read: boolean }[] = [];
  const all = (await find("notices")).filter((n) => !Number(n.del)).sort((a, b) => Number(b.id) - Number(a.id));
  for (const n of all) {
    const read = reads.has(Number(n.id));
    if (n.kind === "temp" && read) continue;
    if (!await forMe(n, uid, s, pilot)) continue;
    out.push({ id: Number(n.id), kind: String(n.kind), text: String(n.text ?? ""), img: !!n.image, at: String(n.created ?? ""), read });
  }
  return out;
}
export const unreadNotices = async (uid: number) => (await myNotices(uid)).filter((n) => !n.read).length;

// ---------- صفحة الطالب
function studentId(t: unknown) {
  const uid = verifyHomeToken(t);
  need(uid !== null, "هذا الرابط قديم. سد الصفحة وافتحها من جديد", 401);
  return uid!;
}
export async function inboxAction(body: Row) {
  await ensure();
  const uid = studentId(body?.token);
  await checkDevice(uid, body.device);
  const a = String(body.action ?? "list");
  if (a === "read") {
    const id = Number(body.id);
    const n = await one("notices", { id });
    need(n && !Number(n.del), "هذا الإشعار انمسح");
    if (!await one("notice_reads", { notice_id: id, user_id: uid })) await put("notice_reads", { notice_id: id, user_id: uid, read_at: stamp() });
    return { ok: true };
  }
  need(a === "list", "أمر غير معروف");
  return { list: await myNotices(uid) };
}
/** صورة الإشعار: للطالب اللي يوصله، أو للإدارة */
export async function noticeImage(url: URL): Promise<Response> {
  await ensure();
  const id = Number(url.searchParams.get("id"));
  const n = await one("notices", { id });
  if (!n?.image || Number(n.del)) return new Response("gone", { status: 404 });
  const t = url.searchParams.get("t") ?? "";
  if (url.searchParams.get("a")) { try { await authed(t, NOTICE_PERM); } catch { return new Response("no", { status: 403 }); } }
  else {
    const uid = verifyHomeToken(t);
    if (uid === null || !(await myNotices(uid)).some((x) => x.id === id)) return new Response("no", { status: 403 });
  }
  const b = await files().read(String(n.image));
  return b ? new Response(new Uint8Array(b), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } }) : new Response("gone", { status: 404 });
}

// ---------- صفحة الإدارة
/** خيارات الفئة: نفس صفحة «شنو يشوف الطالب» */
async function groupsData() {
  const { GENDERS, ORD_AR } = await import("./config.ts");
  const { centerNames } = await import("./polls.ts");
  const chapters = (await find("chapters")).filter((c) => c.active !== 0).sort((a, b) => Number(a.ord) - Number(b.ord)).map((_, i) => `الفصل ${ORD_AR[i]}`);
  return { centers: [...(await centerNames()).entries()].map(([id, name]) => ({ id, name })), genders: GENDERS, currs: ["عربي", "إنجليزي"], chapters };
}
async function adminList() {
  const rows = (await find("notices")).filter((n) => !Number(n.del)).sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 100);
  const reads = await find("notice_reads");
  const count = new Map<number, number>();
  for (const r of reads) count.set(Number(r.notice_id), (count.get(Number(r.notice_id)) ?? 0) + 1);
  return rows.map((n) => ({ id: Number(n.id), kind: String(n.kind), text: String(n.text ?? ""), img: !!n.image, aud: String(n.aud), at: String(n.created ?? ""), reads: count.get(Number(n.id)) ?? 0 }));
}
export async function announceAction(input: Row | FormData) {
  const get = (k: string) => (input instanceof FormData ? input.get(k) : (input as Row)[k]);
  const uid = await authed(get("initData"), NOTICE_PERM);
  const a = String(get("action") ?? "list");
  let notice = "";
  if (a === "send") {
    const text = String(get("text") ?? "").trim();
    need(text.length >= 2 && text.length <= 3000, "اكتب الإشعار");
    const kind = get("kind") === "keep" ? "keep" : "temp";
    const aud: Aud = get("aud") === "pilot" ? "pilot" : get("aud") === "some" ? "some" : "all";
    let rule: Rule | null = null;
    if (aud === "some") {
      rule = clean({ ...(parse(get("rule")) ?? {}), mode: "some" }, "off");
      need(rule.centers.length || rule.gender || rule.curr || rule.chapters.length || rule.students.length, "اختار الفئة أو ضيف طلاب بأسمائهم");
    }
    let image: string | null = null;
    const f = get("image");
    if (f instanceof Blob && f.size) {
      need(f.size <= MAX_IMG, "الصورة كبيرة، أكثر شي 5 ميگا");
      const b = Buffer.from(await f.arrayBuffer());
      need(b[0] === 0xff && b[1] === 0xd8, "لازم صورة JPG");
      image = `notices/${randomUUID()}.jpg`;
      await files().write(image, b, "image/jpeg");
    }
    await insert("notices", { kind, text, image, aud, rule: rule ? JSON.stringify(rule) : null, by_id: uid, created: stamp(), del: 0 });
    notice = kind === "temp" ? "✅ انرسل إشعار مؤقت: يختفي من عند الطالب بعد ما يقراه" : "✅ انرسل إشعار دائمي: يبقى لحد ما تمسحه";
  } else if (a === "del") {
    const id = Number(get("id"));
    need(await one("notices", { id }), "الإشعار غير موجود", 404);
    await update("notices", { id }, { del: 1 });
    notice = "🗑 انمسح من عند كل الطلاب";
  } else if (a === "find") {
    const q = String(get("q") ?? "").trim();
    need(q.length >= 2, "اكتب حرفين أو أكثر");
    const hits = (await find("students")).filter((s) => Number(s.user_id) > 0 && (String(s.name ?? "").includes(q) || String(s.phone1 ?? "").includes(q) || String(s.user_id) === q)).slice(0, 20);
    return { found: hits.map((s) => ({ id: Number(s.user_id), name: String(s.name ?? "") })) };
  } else need(a === "list", "أمر غير معروف");
  return { list: await adminList(), notice, ...await groupsData() };
}
