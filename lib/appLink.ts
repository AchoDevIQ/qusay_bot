// باب التطبيق: طالب تطبيق قصي (مشروع qmath-iq) يفتح صفحات البوت جوه التطبيق.
// التطبيق يدز رمز دخول الطالب (Firebase ID token). نتحقق منه بمفاتيح كوكل، وبنفس الرمز نقرا من التطبيق
// معلومات الطالب والفصول اللي شاريها، فما نحتاج أي سر مشترك ويا سيرفر التطبيق.
// الطالب اللي مربوط بتلگرام بالتطبيق ياخذ نفس حسابه بالبوت (رقم تلگرامه). غيره ياخذ رقم جديد من 10^13 وفوك
import { createPublicKey, createVerify } from "node:crypto";
import { find, insertIgnore, kvGet, kvSet, one, put, tx, type Row } from "./db.ts";
import { student } from "./data.ts";
import { stamp } from "./util.ts";
import { appKey, homeToken } from "./webAuth.ts";
import { forgetMode } from "./appChat.ts";
import { storeLink } from "./keyboards.ts";

export const PROJECT = "qmath-iq";
const REGION = "europe-west4";
export type AppEnv = "staging" | "prod";
const SERVICE: Record<AppEnv, string> = { staging: "qmath-iq-staging-service", prod: "qmath-iq-service" };
const FIRESTORE_DB: Record<AppEnv, string> = { staging: "staging", prod: "(default)" };
const APP_UID_BASE = 10_000_000_000_000;
const ONLINE = "إلكتروني";
const ORD = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"];
export const chapterOf = (n: number) => (ORD[n] ? `الفصل ${ORD[n]}` : "");
export const isAppUid = (uid: number) => uid >= APP_UID_BASE;

// ---------- التحقق من رمز الدخول (RS256، مفاتيح securetoken من كوكل، تتجدد حسب Cache-Control)
const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certs: { keys: Record<string, string>; until: number } | null = null;
async function googleCerts(): Promise<Record<string, string>> {
  if (certs && certs.until > Date.now()) return certs.keys;
  const r = await fetch(CERTS_URL);
  if (!r.ok) throw new Error(`certs ${r.status}`);
  const age = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  certs = { keys: (await r.json()) as Record<string, string>, until: Date.now() + age * 1000 };
  return certs.keys;
}
const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Row;

/** يرجع رقم حساب الطالب بالتطبيق (firebase uid)، أو null إذا الرمز مو صالح */
export async function verifyAppIdToken(tok: unknown, now = Date.now() / 1000, keys?: Record<string, string>): Promise<string | null> {
  if (typeof tok !== "string") return null;
  const parts = tok.split(".");
  if (parts.length !== 3) return null;
  try {
    const head = b64json(parts[0]), body = b64json(parts[1]);
    if (head.alg !== "RS256" || typeof head.kid !== "string") return null;
    const pem = (keys ?? (await googleCerts()))[head.kid];
    if (!pem) return null;
    const ok = createVerify("RSA-SHA256").update(`${parts[0]}.${parts[1]}`).verify(createPublicKey(pem), Buffer.from(parts[2], "base64url"));
    if (!ok) return null;
    if (body.aud !== PROJECT || body.iss !== `https://securetoken.google.com/${PROJECT}`) return null;
    if (!(Number(body.exp) > now) || !(Number(body.iat) <= now + 300) || typeof body.sub !== "string" || !body.sub) return null;
    return body.sub;
  } catch {
    return null;
  }
}

// ---------- القراءة من التطبيق بصلاحية الطالب نفسه
export async function dcQuery(env: AppEnv, idToken: string, operationName: string, variables: Row): Promise<Row> {
  const name = `projects/${PROJECT}/locations/${REGION}/services/${SERVICE[env]}/connectors/main`;
  const r = await fetch(`https://firebasedataconnect.googleapis.com/v1/${name}:executeQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Firebase-Auth-Token": idToken },
    body: JSON.stringify({ name, operationName, variables }),
  });
  const j = (await r.json().catch(() => ({}))) as Row;
  if (!r.ok || j.errors?.length) throw new Error(`${operationName} ${r.status}`);
  return j.data ?? {};
}
async function accessDoc(env: AppEnv, idToken: string, fu: string): Promise<Row> {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${encodeURIComponent(FIRESTORE_DB[env])}/documents/student_access/${encodeURIComponent(fu)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (r.status === 404) return {};
  if (!r.ok) throw new Error(`student_access ${r.status}`);
  return ((await r.json()) as Row).fields ?? {};
}
const strings = (f: Row | undefined): string[] => ((f?.arrayValue?.values ?? []) as Row[]).map((v) => String(v.stringValue ?? "")).filter(Boolean);

export type AppStudent = { fu: string; telegramId: string; name: string; phone: string; parentPhone: string; province: string; grade: string; lang: "ar" | "en"; gender: string; birth: string; chapters: string[]; examChapters: string[] };

/** معلومات الطالب من التطبيق وفصوله المشتراة: chapters محاضرات أو امتحانات (للملازم)، examChapters امتحانات بس. الفصول التجريبية ما تنحسب */
export async function readAppStudent(env: AppEnv, idToken: string, fu: string): Promise<AppStudent | null> {
  const st = ((await dcQuery(env, idToken, "GetStudent", { firebaseUid: fu })).students as Row[] | undefined)?.[0];
  if (!st) return null;
  const doc = await accessDoc(env, idToken, fu);
  const lower = (a: string[]) => new Set(a.map((x) => x.toLowerCase()));
  const exams = lower(strings(doc.examChapterIds)), owned = lower([...strings(doc.lessonChapterIds), ...exams]);
  const chapters: string[] = [], examChapters: string[] = [];
  if (owned.size && st.curriculum?.id) {
    const list = ((await dcQuery(env, idToken, "GetChaptersByCurriculum", { curriculumId: st.curriculum.id })).chapters ?? []) as Row[];
    for (const c of list) {
      const label = chapterOf(Number(c.orderPosition)), id = String(c.id).toLowerCase();
      if (!label || c.isTestChapter) continue;
      if (owned.has(id) && !chapters.includes(label)) chapters.push(label);
      if (exams.has(id) && !examChapters.includes(label)) examChapters.push(label);
    }
  }
  return {
    fu, telegramId: String(st.telegramId ?? "").trim(), name: String(st.fullName ?? ""), phone: String(st.phone ?? ""), parentPhone: String(st.parentPhone ?? ""),
    province: String(st.province ?? ""), grade: String(st.gradeLevel ?? ""), lang: st.curriculumLanguage === "en" ? "en" : "ar",
    gender: String(st.gender ?? ""), birth: String(st.birthDate ?? ""), chapters, examChapters,
  };
}

// ---------- ربط حساب التطبيق بحساب البوت
/** رقم الطالب بالبوت: نفس رقم تلگرامه إذا مربوط، وإلا رقم جديد ينحفظ بأول دخول.
 *  طلاب التطبيق امتحانهم إلكتروني (قرار الأستاذ)، إلا اللي عنده نوع امتحان بالبوت من قبل.
 *  امتحانات الفصول اللي شاريها بالتطبيق تنفتحله هنا، ولا تنسحب منه */
export async function linkAppStudent(env: AppEnv, s: AppStudent): Promise<number> {
  return await tx(async () => {
    const old = await one("app_links", { fu: s.fu });
    const tg = /^\d{5,15}$/.test(s.telegramId) ? Number(s.telegramId) : 0;
    let uid = Number(old?.uid ?? 0);
    if (!uid) uid = tg || await nextAppUid();
    await put("app_links", { fu: s.fu, uid, env, chapters: JSON.stringify(s.chapters), created: old?.created ?? stamp(), updated: stamp() });
    const st = await student(uid);
    if (!st) {
      await put("students", {
        user_id: uid, username: "", name: s.name, curr: s.lang === "en" ? "إنجليزي" : "عربي", grade: s.grade, gov: s.province, side: "", area: "",
        phone1: s.phone, phone2: s.parentPhone, exam: ONLINE, center_id: null, gender: s.gender || null, birth: s.birth || null, created: stamp(), updated: stamp(),
      });
    } else if (!st.exam) await put("students", { ...st, exam: ONLINE, center_id: null, updated: stamp() });
    for (const ch of s.examChapters) await insertIgnore("exam_access", { user_id: uid, chapter: ch }, { order_id: null, created: stamp() });
    return uid;
  });
}
export async function nextAppUid() {
  const n = Number((await kvGet("app_uid_seq")) ?? 0) + 1;
  await kvSet("app_uid_seq", String(n));
  return APP_UID_BASE + n;
}

/** الفصول اللي الطالب شاريها بالتطبيق، حسب آخر دخول إله منه */
export async function appChapters(uid: number): Promise<string[]> {
  const rows = await find("app_links", { uid });
  const out = new Set<string>();
  for (const r of rows) for (const c of JSON.parse(String(r.chapters || "[]")) as string[]) out.add(c);
  return [...out];
}

// ---------- الدخول: التطبيق يفتح /api/app/enter بطلب POST فيه رمز الطالب، ويرجع له تحويل لصفحة البوت
const PAGES = new Set(["notes", "myexams", "home", "chat", "store", "guardian", "inbox", "myorders", "myinfo"]);
export const APP_ERR = "ما گدرنا نفتح الصفحة. سد التطبيق وافتحه من جديد. إذا تكررت، تواصل ويا الإدارة.";

/** يرجع رابط الصفحة (نسبي) لطالب التطبيق، أو null إذا الرمز أو الحساب مو صالح */
export async function enterFromApp(form: { id?: unknown; env?: unknown; page?: unknown }): Promise<string | null> {
  const env: AppEnv = form.env === "staging" ? "staging" : "prod";
  const page = PAGES.has(String(form.page)) ? String(form.page) : "notes";
  const fu = await verifyAppIdToken(form.id);
  if (!fu) return null;
  const s = await readAppStudent(env, String(form.id), fu);
  if (!s) return null;
  const uid = await linkAppStudent(env, s);
  forgetMode(uid);
  const auth = `t=${encodeURIComponent(homeToken(uid))}&app=${appKey(uid)}`;
  // المتجر رابطه بيه المنتجات والأسعار، فيطلع من storeLink
  if (page === "store") { const u = new URL(await storeLink(uid)); return `${u.pathname}${u.search}&${auth}`; }
  return `/store/${page}?v=${Math.floor(Date.now() / 1000)}&${auth}`;
}

// ---------- تجربة التطبيق الجديد على طلاب يختارهم صاحب البوت (من صفحة الطلاب). الباقين يبقى عدهم التطبيق القديم
const PILOT = "app_pilot";
export async function pilotIds(): Promise<number[]> { try { const j = JSON.parse((await kvGet(PILOT)) ?? "[]"); return Array.isArray(j) ? j.map(Number) : []; } catch { return []; } }
export const isPilot = async (uid: number) => (await pilotIds()).includes(uid);
export async function setPilot(uid: number, on: boolean) {
  const set = new Set(await pilotIds());
  if (on) set.add(uid); else set.delete(uid);
  await kvSet(PILOT, JSON.stringify([...set]));
  return set.size;
}

/** حالة الطالب للتطبيق نفسه (أول ما ينفتح): يجرب الجديد؟ ولازم يختار أوقاته أول؟
 *  أول مرة ينربط حسابه هنا، حتى يطلع بصفحة الطلاب وصاحب البوت يگدر يختاره */
export async function appState(form: { id?: unknown; env?: unknown; push?: unknown }) {
  const fu = await verifyAppIdToken(form.id);
  if (!fu) return null;
  let link = await one("app_links", { fu });
  if (!link) {
    const env: AppEnv = form.env === "staging" ? "staging" : "prod";
    const s = await readAppStudent(env, String(form.id), fu).catch(() => null);
    if (!s) return { needSchedule: false, pilot: false };
    await linkAppStudent(env, s);
    link = await one("app_links", { fu });
  }
  const uid = Number(link?.uid);
  const pilot = await isPilot(uid);
  const { needsSchedule } = await import("./schedApi.ts");
  if (!pilot) return { pilot, needSchedule: false };
  // رمز تلفونه حتى يوصله إشعار على الشاشة (رسالة بالمحادثة أو إشعار جديد)
  if (form.push) await import("./appPush.ts").then((m) => m.savePushToken(uid, form.push)).catch((e) => console.error("push token", e));
  // علامات العدد فوك: إشعارات ما قراها، ورسائل بالمحادثة ما شافها
  const { unreadNotices } = await import("./notices.ts");
  const { unreadChat } = await import("./appChat.ts");
  // «يهمك هسه»: بطاقات الرئيسية
  const { nowCards } = await import("./appNow.ts");
  const now = await nowCards(uid).catch((e) => { console.error("now cards", e); return []; });
  return { pilot, needSchedule: await needsSchedule(uid), notices: await unreadNotices(uid), chat: await unreadChat(uid), now };
}

// ---------- مشاهدات المحاضرات (طلب الأستاذ 2026-11-17): التطبيق يبلغ البوت لما الطالب يفتح محاضرة ولوين وصل منها.
// open: فتحها مرة جديدة (العدد يزيد). prog: وصل لهذي النسبة (تبقى أعلى نسبة)
export async function lectureView(form: { id?: unknown; lecture?: unknown; title?: unknown; subject?: unknown; ev?: unknown; percent?: unknown }) {
  const fu = await verifyAppIdToken(form.id);
  if (!fu) return false;
  const link = await one("app_links", { fu });
  const lecture = String(form.lecture ?? "").trim().slice(0, 100);
  if (!link || !lecture) return false;
  const uid = Number(link.uid);
  const old = await one("lecture_views", { user_id: uid, lecture });
  const pct = Math.max(0, Math.min(100, Math.round(Number(form.percent) || 0)));
  const title = String(form.title ?? "").trim().slice(0, 200) || String(old?.title ?? "");
  await put("lecture_views", {
    user_id: uid, lecture, title, subject: String(form.subject ?? old?.subject ?? "").slice(0, 100),
    times: Number(old?.times ?? 0) + (form.ev === "open" ? 1 : 0), percent: Math.max(pct, Number(old?.percent ?? 0)),
    first_at: old?.first_at ?? stamp(), last_at: stamp(),
  });
  return true;
}
