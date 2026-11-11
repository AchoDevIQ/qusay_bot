// تسجيلات الفصول: كل طالب ينفتحله فصل (من المكتب، أو كود التوصيل) ينحسب بيومه.
// آخر كل يوم يوصل تقرير بعدد اللي سجلوا بكل فصل لصاحب البوت وللمساعدين اللي عندهم الصلاحية،
// وبالصفحة يشوفون الطلاب ويدزولهم رسالة جماعية أو لأفراد، بالكتابة أو بالصوت
import { ADMIN_IDS } from "./config.ts";
import { find, kvGet, kvSet, one, type Row } from "./db.ts";
import { adminPageLink } from "./keyboards.ts";
import { addDays } from "./scheduleRules.ts";
import { api, send, sendMany, upload } from "./telegram.ts";
import { esc, stamp, todayStr } from "./util.ts";
import { authed, need } from "./webApi.ts";
import { lateBuyers, makeupChapters, setMakeup } from "./makeup.ts";

export const SIGNUP_PERM = "signups";
const REPORT_AT = "23:50";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VOICE_MAX = 20 * 1024 * 1024;

/** منو يوصله التقرير: صاحب البوت والمساعدين اللي عندهم الصلاحية */
async function readers() {
  const staff = (await find("staff")).filter((s) => String(s.perms ?? "").split(",").includes(SIGNUP_PERM)).map((s) => Number(s.user_id));
  return [...new Set([...ADMIN_IDS, ...staff])];
}
/** منين اجه: المكتب لو التوصيل (كود الوصل) */
async function sourceOf(oid: unknown) {
  if (!oid) return "يدوي";
  const o = await one("orders", { id: Number(oid) });
  return o?.office_id || o?.seller ? "🏪 المكتب" : "🚚 توصيل";
}
/** طلاب كل فصل: اللي سجلوا بهذا اليوم، وعدد الفصل كله */
async function chaptersOn(date: string) {
  const rows = await find("exam_access", {}, { order: ["created"] });
  const names = new Map((await find("students")).map((s) => [s.user_id, s.name as string]));
  const out = new Map<string, { chapter: string; total: number; students: { id: number; name: string; at: string; source: string }[] }>();
  for (const r of rows) {
    const c = out.get(r.chapter) ?? { chapter: r.chapter as string, total: 0, students: [] };
    c.total++;
    if (String(r.created ?? "").startsWith(date)) c.students.push({ id: r.user_id, name: names.get(r.user_id) ?? `#${r.user_id}`, at: String(r.created).slice(11, 16), source: await sourceOf(r.order_id) });
    out.set(r.chapter, c);
  }
  return [...out.values()].sort((a, b) => a.chapter.localeCompare(b.chapter, "ar"));
}

/** للمؤقت: آخر اليوم يوصل التقرير مرة وحدة */
export async function sweepSignups(force = false) {
  const today = todayStr();
  if (!force && (stamp().slice(11, 16) < REPORT_AT || await kvGet(`signup_report_${today}`))) return 0;
  await kvSet(`signup_report_${today}`, stamp());
  const chs = await chaptersOn(today);
  const n = chs.reduce((s, c) => s + c.students.length, 0);
  const lines = chs.filter((c) => c.students.length).map((c) => `📘 ${esc(c.chapter)}: <b>${c.students.length}</b>`);
  const text = [`📊 <b>تسجيلات اليوم ${today}</b>`, "", ...(lines.length ? lines : ["ماكو تسجيل جديد اليوم"]), "", `المجموع: <b>${n}</b> طالب`].join("\n");
  const kb = [[{ text: "📋 افتح التسجيلات", web_app: { url: adminPageLink("signups") } }]];
  let sent = 0;
  for (const to of await readers()) { try { if (await send(to, text, { kb })) sent++; } catch (e) { console.error(e); } }
  return sent;
}

async function pageData(date: string) {
  const today = todayStr();
  // الفصول التعويضية: كل فصل بيه امتحانات، بترتيب الكتاب، ومربع «تعويضي»
  const m = await makeupChapters();
  const exams = (await find("bank_exams")).sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  const makeup = { chapters: [...new Set(exams.map((e) => String(e.chapter)))].map((c) => ({ chapter: c, since: m[c] ?? "" })), buyers: await lateBuyers() };
  return { date, days: [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(today, -k)), chapters: await chaptersOn(date), makeup, notice: "" };
}

/** منو توصله الرسالة: اللي سجلوا باليوم، لو كل طلاب الفصل، لو المحددين */
async function targets(chapter: string, scope: string, date: string, picked: number[]) {
  const rows = await find("exam_access", { chapter });
  need(rows.length, "ماكو طلاب بهذا الفصل");
  if (scope === "picked") {
    const have = new Set(rows.map((r) => r.user_id as number));
    const l = picked.filter((x) => have.has(x));
    need(l.length, "حدد طالب واحد على الأقل");
    return [...new Set(l)];
  }
  if (scope === "day") {
    const l = rows.filter((r) => String(r.created ?? "").startsWith(date)).map((r) => r.user_id as number);
    need(l.length, "ماكو طلاب سجلوا بهذا اليوم");
    return [...new Set(l)];
  }
  need(scope === "all", "اختار منو توصله الرسالة");
  return [...new Set(rows.map((r) => r.user_id as number))];
}

/** الصفحة: JSON للعرض والرسالة الكتابية، وFormData للرسالة الصوتية */
export async function signupsAction(body: Row | FormData) {
  const get = (k: string) => (body instanceof FormData ? body.get(k) : (body as Row)?.[k]);
  await authed(get("initData"), SIGNUP_PERM);
  const a = String(get("action") ?? "");
  const date = DATE.test(String(get("date") ?? "")) ? String(get("date")) : todayStr();
  if (a === "list") return await pageData(date);
  if (a === "makeup") {
    const chapter = String(get("chapter") ?? "");
    need(chapter, "اختار الفصل");
    const on = String(get("on")) === "true";
    await setMakeup(chapter, on);
    return { ...await pageData(date), notice: on ? `🔁 صار ${chapter} تعويضي: كل طالب يشتري امتحاناته من هسه يطلعلك بالقائمة ويوصلك تنبيه` : `انشال ${chapter} من التعويضي` };
  }
  need(a === "send", "أمر غير معروف");
  const chapter = String(get("chapter") ?? "");
  const raw = get("ids");
  const picked = (Array.isArray(raw) ? raw : String(raw ?? "").split(",")).map(Number).filter((x) => Number.isSafeInteger(x) && x > 0);
  const to = await targets(chapter, String(get("scope") ?? ""), date, picked);
  const text = String(get("text") ?? "").trim().slice(0, 1000);
  const voice = get("voice");
  const hasVoice = voice instanceof Blob && voice.size > 0;
  need(text || hasVoice, "اكتب الرسالة أو سجل صوت");
  let ok = 0;
  if (hasVoice) {
    const v = voice as Blob;
    need(v.size <= VOICE_MAX, "الصوت لازم أصغر من 20 ميگا");
    const buf = Buffer.from(await v.arrayBuffer());
    const ogg = /ogg/.test(v.type);
    const method = ogg ? "sendVoice" : "sendAudio", field = ogg ? "voice" : "audio";
    const caption: Record<string, string> = text ? { caption: text } : {};
    // أول واحد يترفعله الملف، والباقين ياخذون نفس الملف بدون رفع ثاني
    let fileId = "";
    const rest = [...to];
    while (!fileId && rest.length) {
      const first = rest.shift()!;
      const r = await upload(method, { chat_id: String(first), ...caption }, field, buf, ogg ? "voice.ogg" : "voice.m4a", v.type || "audio/mp4");
      if (r) { ok++; fileId = r.voice?.file_id ?? r.audio?.file_id ?? ""; }
    }
    if (fileId) ok += await sendMany(rest, (chat) => api(method, { chat_id: chat, [field]: fileId, ...caption }));
  } else {
    ok = await sendMany(to, (chat) => send(chat, esc(text)));
  }
  return { ...await pageData(date), notice: `✅ وصلت الرسالة لـ ${ok} من ${to.length} طالب` };
}
