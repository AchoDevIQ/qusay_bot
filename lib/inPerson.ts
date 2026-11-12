// الحضوري: المساعد يقرا كيو ار الطالب فينسجل حضوره، ويطبع إله ليبل أو ورقة امتحان كاملة باسمه حسب المركز.
// بعد الامتحان أوراق الكل تنحط بالسكانر، والصور تنرفع مرة وحدة، والأكواد المطبوعة توديها لكل طالب وسؤال،
// وتروح للمصححين مثل أوراق الإلكتروني
import { FONT_STACK, pageFonts } from "./imgFonts.ts";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import QRCode from "qrcode";
import { find, insert, kvGet, kvSet, one, update, type Row } from "./db.ts";
import { logActivity } from "./access.ts";
import { TOKEN } from "./config.ts";
import { can, centerName, isAdmin, student } from "./data.ts";
import { labelPng, labelTspl, type LabelInfo } from "./labelTspl.ts";
import { versionOf } from "./examRoom.ts";
import { addMinutes } from "./scheduleRules.ts";
import { files } from "./files.ts";
import { notifyGraders } from "./graderPay.ts";
import { recordUploader, rescanDone, rescanFor, rescanItemOf } from "./rescan.ts";
import { esc, stamp, todayStr } from "./util.ts";
import { authed, ensure, need } from "./webApi.ts";

export const ATTEND_PERM = "attend";
export const CAM_PERM = "camup";
const EXC_PERM = "exception";
const STATION_PERM = "station";
/** انطبع ليبل لهذا الامتحان؟ */
const labelKey = (item: number) => `label_done_${item}`;
/** المساعد اللي عنده الحضور أو تصوير الأوراق. يرجع رقمه وإذا عنده الحضور كامل */
async function staffIn(initData: unknown) {
  try { return { uid: await authed(initData, ATTEND_PERM), full: true }; } catch (e) {
    if ((e as { status?: number }).status !== 403) throw e;
    try { return { uid: await authed(initData, CAM_PERM), full: false }; } catch (x) {
      if ((x as { status?: number }).status !== 403) throw x;
      return { uid: await authed(initData, STATION_PERM), full: false };
    }
  }
}
const KEY = "inperson_cfg";
const MAX_PAGE = 8 * 1024 * 1024;
export type CenterCfg = { print: "label" | "paper"; photos: boolean };
const DEFAULT_CFG: CenterCfg = { print: "label", photos: false };

const hmac = (key: string, data: string) => createHmac("sha256", createHmac("sha256", key).update(TOKEN).digest()).update(data).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---------- كود الطالب: رقمه وتوقيع قصير، حتى محد يسوي كود لطالب غيره
export const studentCode = (uid: number) => `QS:${uid}.${hmac("QMathAttend", String(uid)).slice(0, 12)}`;
export function verifyStudentCode(raw: unknown): number | null {
  const t = String(raw ?? "").trim();
  const m = /^QS:(-?\d+)\.([0-9a-f]{12})$/.exec(t);
  if (!m) return null;
  const uid = Number(m[1]);
  return Number.isSafeInteger(uid) && same(m[2], hmac("QMathAttend", String(uid)).slice(0, 12)) ? uid : null;
}

// ---------- رابط الطباعة: ينفتح برا تليجرام، فيحمل رمز موقع عمره يومين. i = ورقة طالب، l = ليبل، v = ورقة نسخة للاستنساخ
const PRINT_TTL_S = 2 * 24 * 3600;
export function printToken(kind: "i" | "l" | "v", id: number, now = Date.now() / 1000) {
  const exp = Math.floor(now) + PRINT_TTL_S;
  return `${kind}${id}.${exp}.${hmac("QMathPrint", `${kind}${id}.${exp}`).slice(0, 32)}`;
}
export function verifyPrintToken(raw: unknown, now = Date.now() / 1000): { kind: "i" | "l" | "v"; id: number } | null {
  const m = /^([ilv])(\d+)\.(\d+)\.([0-9a-f]{32})$/.exec(String(raw ?? ""));
  if (!m || Number(m[3]) < now) return null;
  if (!same(m[4], hmac("QMathPrint", `${m[1]}${m[2]}.${m[3]}`).slice(0, 32))) return null;
  return { kind: m[1] as "i" | "l" | "v", id: Number(m[2]) };
}

// ---------- محطة طباعة البلوتوث: صفحة مفتوحة بمتصفح Bluefy تطبع الليبلات اللي تنرسلها من صفحة الحضوري.
// رمزها يفتح المحطة بس، مو لوحة التحكم، وينتهي بنهاية اليوم (توقيت العراق)، وكل يوم امتحان إله رابط جديد
const DAY_S = 24 * 3600, IRAQ_S = 3 * 3600;
const ACTIVE_MS = 12 * 3600 * 1000;
const queueKey = (uid: number) => `print_q_${uid}`;
const seenKey = (uid: number) => `print_seen_${uid}`;
export function stationToken(uid: number, now = Date.now() / 1000) {
  const exp = (Math.floor((now + IRAQ_S) / DAY_S) + 1) * DAY_S - IRAQ_S;
  return `${uid}.${exp}.${hmac("QMathStation", `${uid}.${exp}`).slice(0, 32)}`;
}
function verifyStationToken(raw: unknown, now = Date.now() / 1000): number | null {
  const m = /^(\d+)\.(\d+)\.([0-9a-f]{32})$/.exec(String(raw ?? ""));
  if (!m || Number(m[2]) < now) return null;
  return same(m[3], hmac("QMathStation", `${m[1]}.${m[2]}`).slice(0, 32)) ? Number(m[1]) : null;
}
async function readQueue(uid: number): Promise<number[]> {
  try { const j = JSON.parse(await kvGet(queueKey(uid)) ?? "[]"); return Array.isArray(j) ? j.map(Number) : []; } catch { return []; }
}
const stationActive = async (uid: number) => Date.now() - (Number(await kvGet(seenKey(uid))) || 0) < ACTIVE_MS;
async function enqueue(uid: number, item: number) {
  const q = await readQueue(uid);
  if (!q.includes(item)) await kvSet(queueKey(uid), JSON.stringify([...q, item]));
}
export async function stationAction(body: Row) {
  const uid = verifyStationToken(body.station);
  need(uid !== null, "الرابط انتهى. انسخ رابط المحطة من صفحة الحضوري مرة ثانية", 401);
  need(await can(uid!, STATION_PERM), "ما عندك صلاحية طباعة الليبل", 403);
  // الوقت ينكتب كل 5 دقايق بس، مو كل طلب
  if (Date.now() - (Number(await kvGet(seenKey(uid!))) || 0) > 300_000) await kvSet(seenKey(uid!), String(Date.now()));
  const q = await readQueue(uid!);
  if (body.action === "done") {
    await kvSet(queueKey(uid!), JSON.stringify(q.filter((x) => x !== Number(body.id))));
    await kvSet(labelKey(Number(body.id)), stamp());
    return { ok: true };
  }
  // الطابعة خلصت الليبل: المرة الجاية يگول «مطبوع له ليبل» بدل ما يطبع
  if (body.action === "printed") { await kvSet(labelKey(Number(body.id)), stamp()); return { ok: true }; }
  const shift = (v: unknown) => Math.max(-80, Math.min(80, Math.round(Number(v) || 0)));
  // ضبط مكان الطباعة ينحفظ بالسيرفر لكل مساعد: يبقى لكل الطلاب والأيام لحد ما يتغير
  const posKey = `print_pos_${uid}`;
  const savedPos = async () => { try { const j = JSON.parse(await kvGet(posKey) ?? "{}"); return { dx: shift(j.dx), dy: shift(j.dy) }; } catch { return { dx: 0, dy: 0 }; } };
  if (body.action === "pos") {
    if (body.dx !== undefined) await kvSet(posKey, JSON.stringify({ dx: shift(body.dx), dy: shift(body.dy) }));
    return { pos: await savedPos() };
  }
  const jobOf = async (c: LabelInfo) => {
    // تطبيق جهاز SUNMI ياخذ الليبل صورة، والطابعة نفسها تلگه مكانه
    if (body.format === "png") return { id: c.item, name: c.name, png: (await labelPng(c, Number(body.h) || 39, Number(body.w) || 48, Number(body.dx) || 0)).toString("base64") };
    const p =body.dx !== undefined ? { dx: shift(body.dx), dy: shift(body.dy) } : await savedPos();
    return { id: c.item, name: c.name, b64: (await labelTspl(c, p.dx, p.dy)).toString("base64") };
  };
  if (body.action === "scan") {
    const raw = String(body.code ?? "").trim();
    let sid = /^\d+$/.test(raw) ? Number(raw) : verifyStudentCode(raw);
    if (sid && sid > 0 && await isAdmin(uid!) && !await student(sid) && await student(-sid)) sid = -sid;
    need(sid, "هذا مو كود طالب");
    const card = await markAttendance(sid!, uid!);
    return { card, job: card.print === "label" && !card.late && !card.printed ? await jobOf(card) : null };
  }
  if (body.action === "except") {
    const card = (await decideLate(uid!, body.item, true))!;
    return { card, job: card.print === "label" ? await jobOf(card) : null };
  }
  if (body.action === "rejectLate") { await decideLate(uid!, body.item, false); return { ok: true }; }
  if (body.action === "reprint") {
    const it = await one("sched_items", { id: Number(body.item) });
    need(it, "الامتحان غير موجود", 404);
    return { job: await jobOf(await itemCard(it!)) };
  }
  if (body.action === "test") return { job: await jobOf({ item: 0, uid: 0, name: "محمد علي حسين عمر", exam: "فقط مسائل التقريب والمعدلات الزمنية والتطبيقات على النهايات", center: "معهد قصي العميري", at: stamp() }) };
  need(body.action === "next", "أمر غير معروف");
  for (const id of q) {
    const it = await one("sched_items", { id });
    if (!it) { await kvSet(queueKey(uid!), JSON.stringify(q.filter((x) => x !== id))); continue; }
    const c = await itemCard(it);
    return { job: await jobOf(c) };
  }
  return { job: null };
}

// ---------- إعدادات كل مركز: ليبل لو ورقة كاملة، والتصوير من التلفون
async function allCfg(): Promise<Record<string, Partial<CenterCfg>>> {
  try { return JSON.parse(await kvGet(KEY) ?? "{}"); } catch { return {}; }
}
export async function centerCfg(cid: number | null | undefined): Promise<CenterCfg> {
  return { ...DEFAULT_CFG, ...(await allCfg())[String(cid ?? "")] };
}
/** الطالب الحضوري اختار يمتحن بالآيباد: ما تنطبعله ورقة، وأسئلته تنفتح بالآيباد من يسجلون حضوره بالمركز */
const ipadKey = (uid: number) => `ipad_exam_${uid}`;
export async function ipadExam(uid: number) {
  const st = await student(uid);
  return st?.exam === "حضوري" && !(await centerCfg(st.center_id)).photos && await kvGet(ipadKey(uid)) === "1";
}
export async function setIpadExam(uid: number, on: boolean) {
  await kvSet(ipadKey(uid), on ? "1" : "");
  await logActivity(uid, on ? "📱 اختار يمتحن الحضوري بالآيباد" : "📄 رجع يمتحن الحضوري بالورقة");
}
/** الطالب الحضوري يگدر يصور أجوبته بنفسه؟ بس إذا صاحب البوت فتحها لمركزه */
export async function photosAllowed(uid: number) {
  const st = await student(uid);
  return st?.exam === "حضوري" && (await centerCfg(st.center_id)).photos;
}

// ---------- الحضور
const LIVE = new Set(["waiting", "missed", "attended"]);
/** كم دقيقة قبل الموعد يعتبر الطالب جاي بوقته (بعد الموعد: وقت الدخول من إعدادات الجدول) */
const EARLY_KEY = "attend_early";
export async function attendEarly() {
  const v = await kvGet(EARLY_KEY);
  return v === null || v === undefined || v === "" ? 30 : Number(v) || 0;
}
async function onTime(it: Row) {
  const { schedSettings } = await import("./schedApi.ts");
  const s = await schedSettings(), now = stamp();
  return now >= addMinutes(it.at, -await attendEarly()) && now <= addMinutes(it.at, s.window);
}
/** امتحان الطالب: الأقرب لهسه من امتحانات اليوم. وإذا ماكو اليوم، الأقرب من باقي امتحاناته (جاي بغير يومه) */
async function todayItem(uid: number) {
  const today = todayStr(), now = stamp();
  const all = (await find("sched_items", { user_id: uid })).filter((i) => i.kind !== "optional" && LIVE.has(i.status));
  const todays = all.filter((i) => String(i.at).startsWith(today));
  const list = todays.length ? todays : all.filter((i) => i.status !== "attended");
  const gap = (at: string) => Math.abs(new Date(at.replace(" ", "T")).getTime() - new Date(now.replace(" ", "T")).getTime());
  return list.sort((a, b) => gap(a.at) - gap(b.at))[0] ?? null;
}
async function itemCard(it: Row) {
  const st = await student(it.user_id);
  const e = await one("bank_exams", { id: it.exam_id });
  const cfg = await centerCfg(st?.center_id);
  return {
    item: it.id as number, uid: it.user_id as number, name: st?.name ?? "طالب", exam: e?.title ?? "امتحان", at: it.at as string,
    // طالب الآيباد ما ينطبعله شي: لا ليبل ولا ورقة
    center: await centerName(st?.center_id) || "", print: await ipadExam(it.user_id) ? "ipad" as const : cfg.print, attendedAt: it.attended_at ?? "", printed: !!await kvGet(labelKey(it.id)),
    label: printToken("l", it.id), paper: printToken("i", it.id),
  };
}
/** يسجل الحضور فعلاً، وتنحدد نسخته حتى تنطبع */
async function enterItem(it: Row, by: number) {
  const already = it.status === "attended";
  if (!already) {
    const e = await one("bank_exams", { id: it.exam_id });
    const version = it.version_id || (e ? await versionOf(it, e) : null);
    need(version, "أسئلة هذا الامتحان لسه ما جاهزة");
    await update("sched_items", { id: it.id }, { status: "attended", version_id: version, attended_at: stamp(), attended_by: by });
    await logActivity(it.user_id, `🎫 حضر امتحان ${e?.title ?? ""}`);
  }
  return { ...await itemCard((await one("sched_items", { id: it.id }))!), already, late: false };
}
/** امتحان الجلسة: المساعد يختار المركز والامتحان قبل ما يقرا الأكواد، وكل كود ما يطابقه ينرفض بسببه. ينتهي بنهاية اليوم */
const lockKey = (by: number) => `attend_lock_${by}`;
export async function attendLock(by: number): Promise<{ center: number; exam: number } | null> {
  try {
    const j = JSON.parse(await kvGet(lockKey(by)) ?? "null");
    return j && j.day === todayStr() && (j.center || j.exam) ? { center: Number(j.center) || 0, exam: Number(j.exam) || 0 } : null;
  } catch { return null; }
}
/** امتحان الطالب بامتحان الجلسة، أو سبب رفضه */
async function lockedItem(st: Row, uid: number, lock: { center: number; exam: number }) {
  if (lock.center && st.center_id !== lock.center) need(false, `⛔ ${st.name} مو من هذا المركز. مركزه: ${await centerName(st.center_id) || "ماكو"}`);
  if (!lock.exam) return await todayItem(uid);
  const e = await one("bank_exams", { id: lock.exam });
  const { boughtExams } = await import("./schedApi.ts");
  if (!(await boughtExams(uid)).some((x) => x.id === lock.exam)) need(false, `⛔ ${st.name} غير مشترك في ${e?.chapter ?? "فصل هذا الامتحان"}`);
  const mine = (await find("sched_items", { user_id: uid, exam_id: lock.exam })).filter((i) => i.kind !== "optional");
  const live = mine.find((i) => LIVE.has(i.status));
  if (!live) need(false, mine.some((i) => i.status === "done") ? `⛔ ${st.name} امتحن ${e?.title ?? "هذا الامتحان"} قبل` : `⛔ ${st.name} ما إله موعد بامتحان ${e?.title ?? ""}`);
  return live!;
}
/** حضور الطالب. الجاي بغير وقته ما ينسجل: يرجع late حتى المساعد يختار استثناء لو رفض. force: بدون سؤال */
export async function markAttendance(uid: number, by: number, force = false) {
  const st = await student(uid);
  need(st, "هذا مو طالب مسجل");
  need(st!.exam === "حضوري", `${st!.name} طالب إلكتروني، مو حضوري`);
  const lock = force ? null : await attendLock(by);
  const it = lock ? await lockedItem(st!, uid, lock) : await todayItem(uid);
  need(it, `${st!.name} ما عنده امتحان`);
  if (!force && it!.status !== "attended" && !await onTime(it!)) return { ...await itemCard(it!), already: false, late: true };
  return await enterItem(it!, by);
}
/** قرار المساعد على طالب جاي بغير وقته: استثناء يدخله، ورفض ما يغير شي وينسجل بسجله */
async function decideLate(uid: number, item: unknown, allow: boolean) {
  const it = await one("sched_items", { id: Number(item) });
  need(it && LIVE.has(it.status), "الامتحان غير موجود", 404);
  const e = await one("bank_exams", { id: it!.exam_id });
  if (!allow) { await logActivity(it!.user_id, `⛔ جا لامتحان ${e?.title ?? ""} بغير وقته وانرفض`); return null; }
  need(await can(uid, EXC_PERM), "ما عندك صلاحية الاستثناء", 403);
  await logActivity(it!.user_id, `🔓 دخل امتحان ${e?.title ?? ""} باستثناء، جا بغير وقته`);
  return await enterItem(it!, uid);
}

// ---------- الطباعة: صفحات HTML تنفتح بالمتصفح وتطبع وحدها
const qrSvg = (text: string) => QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
const PRINT_JS = `<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),400))</script>`;
const fmtAt = (at: string) => `${at.slice(0, 10)} · ${at.slice(11, 16)}`;

/** ليبل 58×39 ملم بنفس ترتيب ليبل البلوتوث: الاسم فوك، الكود والرقم والمركز والوقت بالنص، والامتحان جوة.
 *  بالأندرويد (جهاز الـ POS) يملأ عرض الورقة، لأن طابعته تعتبر الصفحة أعرض وتصغر الليبل. الصفحة نفسها تعرف الجهاز،
 *  لأن السيرفر ما يوصله نوعه. fit يجبرها، للفحص */
export async function labelPage(c: LabelInfo, fit = false) {
  const mm = (n: number) => `calc(var(--u)*${n})`;
  const pt = (n: number) => mm(+(n * 0.3528).toFixed(2));
  const size = (t: string, big: number, mid: number, small: number) => pt(t.length <= 22 ? big : t.length <= 34 ? mid : small);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ليبل ${esc(c.name)}</title>
<style id="ps">@page{size:58mm 39mm;margin:0}</style>
<script>if(${fit ? "true" : "/Android/i.test(navigator.userAgent)"}){document.documentElement.style.setProperty("--u","calc(100vw/58)");document.getElementById("ps").textContent="@page{margin:0}"}</script>
<style>${await pageFonts()}:root{--u:1mm}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#000;font-family:${FONT_STACK}}
.l{width:${mm(58)};height:${mm(39)};padding:${mm(1.5)} ${mm(2)};display:flex;flex-direction:column;gap:${mm(1)};overflow:hidden}
.nm{font-weight:700;font-size:${size(c.name, 13, 10.5, 8.5)};line-height:1.2;white-space:nowrap;overflow:hidden}
.mid{flex:1;min-height:0;display:flex;gap:${mm(2)};align-items:center}.q{width:${mm(19)};height:${mm(19)};flex:none}.q svg{width:100%;height:100%}
.t{flex:1;min-width:0;font-size:${pt(8.5)};line-height:1.35;font-weight:700}.n{font-size:${pt(10)};direction:ltr;text-align:right}.d{direction:ltr;text-align:right}
.ex{font-weight:700;font-size:${size(c.exam, 11, 9.5, 8)};line-height:1.2;max-height:2.5em;overflow:hidden}
</style></head>
<body><div class="l"><div class="nm">${esc(c.name)}</div><div class="mid"><div class="q">${await qrSvg(`QI:${c.item}`)}</div><div class="t"><div class="n">#${c.uid}</div><div>${esc(c.center)}</div><div class="d">${fmtAt(c.at)}</div></div></div><div class="ex">${esc(c.exam)}</div></div>${PRINT_JS}</body></html>`;
}
export async function labelHtml(itemId: number, fit = false) {
  const it = await one("sched_items", { id: itemId });
  need(it, "الامتحان غير موجود", 404);
  return await labelPage(await itemCard(it!), fit);
}

/** ورقة الامتحان: كل سؤال بصفحة، وبزاوية كل صفحة كود. ورقة الطالب عليها اسمه، وورقة الاستنساخ فراغ للليبل */
export async function paperHtml(kind: "i" | "v", id: number) {
  let versionId = id, who = "", code = (q: number) => `QV:${id}:${q}`;
  if (kind === "i") {
    const it = await one("sched_items", { id });
    need(it?.version_id, "الامتحان غير موجود", 404);
    const c = await itemCard(it!);
    versionId = it!.version_id;
    who = `<div class="who"><b>${esc(c.name)}</b> <span dir="ltr">#${c.uid}</span> · ${esc(c.center)} · ${fmtAt(c.at)}</div>`;
    code = (q) => `QP:${id}:${q}`;
  }
  const v = await one("bank_versions", { id: versionId });
  need(v, "النسخة غير موجودة", 404);
  const e = await one("bank_exams", { id: v!.exam_id });
  const qs = await find("bank_questions", { version_id: versionId }, { order: ["n"] });
  need(qs.length, "هذي النسخة ما بيها أسئلة", 404);
  const pages = [];
  for (const q of qs) {
    const img = q.q_file ? await files().read(q.q_file) : null;
    const src = img ? `data:image/${/\.png$/i.test(q.q_file) ? "png" : "jpeg"};base64,${img.toString("base64")}` : "";
    pages.push(`<section class="p"><header><div class="qr">${await qrSvg(code(q.n))}</div><div class="h"><div class="ti">${esc(e?.title ?? "")} · سؤال ${q.n} من ${qs.length}</div>${who || (q.n === 1 ? `<div class="lb">الصق الليبل هنا</div>` : "")}</div></header>
${src ? `<img class="qi" src="${src}" alt="سؤال ${q.n}">` : `<div class="miss">صورة السؤال ${q.n} مو موجودة</div>`}<div class="ans">الحل</div></section>`);
  }
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e?.title ?? "امتحان")}</title>
<style>${await pageFonts()}@page{size:A4;margin:10mm}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#000;font-family:${FONT_STACK}}
.p{height:277mm;display:flex;flex-direction:column;page-break-after:always;break-after:page}.p:last-child{page-break-after:auto;break-after:auto}
header{display:flex;gap:4mm;align-items:center;border-bottom:.4mm solid #000;padding-bottom:3mm}.qr{width:22mm;height:22mm;flex:none}.qr svg{width:100%;height:100%}
.h{flex:1}.ti{font-size:12pt;font-weight:700}.who{font-size:11pt;margin-top:1.5mm}.lb{margin-top:1.5mm;width:62mm;height:42mm;border:.4mm dashed #888;display:flex;align-items:center;justify-content:center;color:#777;font-size:9pt}
.qi{display:block;max-width:100%;max-height:110mm;margin:4mm auto 0;object-fit:contain}.miss{padding:20mm;text-align:center;color:#a00}
.ans{flex:1;margin-top:4mm;border-top:.3mm dashed #999;padding-top:2mm;color:#888;font-size:9pt}
@media screen{body{background:#ddd}.p{background:#fff;width:190mm;margin:10px auto;padding:10mm;height:auto;min-height:277mm}}</style></head>
<body>${pages.join("")}${PRINT_JS}</body></html>`;
}

// ---------- رفع أوراق السكانر: الصفحة تقرا الأكواد وتدز كل صفحة لطالبها وسؤالها
/** توزيع صفحات الورقة على الأسئلة لكل نسخة (A وB تختلف)، أو null إذا كل سؤال بصفحة */
const PAGE_MAPS = "page_maps";
async function allPageMaps(): Promise<Record<string, number[][]>> {
  try { return JSON.parse(await kvGet(PAGE_MAPS) || "{}"); } catch { return {}; }
}
export const pageMapOf = async (version: number): Promise<number[][] | null> => (await allPageMaps())[`v${version}`] ?? null;
/** ورقة طالب حضوري: الامتحان ونسخته */
async function paperItem(raw: unknown) {
  const it = await one("sched_items", { id: Number(raw) });
  need(it && it.version_id, "ورقة غير معروفة");
  need((await student(it!.user_id))?.exam === "حضوري", "هذي مو ورقة طالب حضوري");
  need(!it!.graded_at, `ورقة ${(await student(it!.user_id))?.name ?? ""} انصححت قبل`);
  return it!;
}
export async function scanUpload(form: FormData) {
  const { uid: by } = await staffIn(form.get("initData"));
  const it = await paperItem(form.get("item"));
  const more = String(form.get("qs") ?? form.get("q") ?? "").split(",").map(Number);
  const q = more[0];
  for (const n of more) need(await one("bank_questions", { version_id: it.version_id, n }), `السؤال ${n} مو موجود بهذي النسخة`);
  const f = form.get("file");
  need(f instanceof Blob && f.size > 0 && f.size <= MAX_PAGE, "الصفحة لازم أصغر من 8 ميگا");
  const buf = Buffer.from(await (f as Blob).arrayBuffer());
  need(buf[0] === 0xff && buf[1] === 0xd8, "لازم صورة JPG");
  const ref = path.posix.join("student_answers", String(it.user_id), String(it.id), `q${q}_${randomUUID()}.jpg`);
  await files().write(ref, buf, "image/jpeg");
  // صفحة بيها أكثر من سؤال: ملف واحد ينحسب جواب لكل أسئلتها
  for (const n of more) await insert("exam_answers", { item_id: it.id, q: n, file: ref, created: stamp() });
  await recordUploader(it.id, by);
  if (it.status !== "attended" && it.status !== "done") await update("sched_items", { id: it.id }, { status: "attended", attended_at: it.attended_at ?? stamp(), attended_by: it.attended_by ?? by });
  return { ok: true };
}

async function pageData(uid: number, full = true) {
  const owner = await isAdmin(uid);
  const cfg = await allCfg();
  const centers = owner ? (await find("centers", { active: 1 })).map((c) => ({ id: c.id as number, name: c.name as string, ...DEFAULT_CFG, ...cfg[String(c.id)] })) : [];
  const versions = await find("bank_versions", { kind: "mandatory" });
  const allMaps = await allPageMaps();
  const exams = (await find("bank_exams", {}, { order: ["pos", "ord"] })).filter((e) => versions.some((v) => v.exam_id === e.id))
    .map((e) => ({ id: e.id as number, title: e.title as string, chapter: e.chapter as string, versions: versions.filter((v) => v.exam_id === e.id).map((v) => ({ id: v.id as number, pageMap: allMaps[`v${v.id}`] ?? null, model: v.model as string, token: printToken("v", v.id) })) }));
  const today = (await find("sched_items")).filter((i) => String(i.attended_at ?? "").startsWith(todayStr())).length;
  const lock = await attendLock(uid);
  const lockCenters = (await find("centers", { active: 1 })).map((c) => ({ id: c.id as number, name: c.name as string }));
  return { owner, full, centers, exams, today, lock, lockCenters, rescan: await rescanFor(uid), station: await can(uid, STATION_PERM) ? { active: await stationActive(uid), token: stationToken(uid) } : null, canCam: full || await can(uid, CAM_PERM), early: await attendEarly(), notice: "" };
}

export async function attendAction(body: Row) {
  if (body?.station !== undefined) { await ensure(); return await stationAction(body); }
  const { uid, full } = await staffIn(body?.initData);
  const a = String(body.action ?? "");
  // اللي عنده تصوير الأوراق بس: يلگى الطالب ويصور ورقته ويدزها للتصحيح
  need(full || ["cam", "items", "finish", "list"].includes(a), "ما عندك صلاحية", 403);
  if (a === "cam") {
    // تصوير ورقة طالب بالكاميرا: ينسجل حضوره (إذا بعده) وتطلع أسئلة نسخته
    const raw = String(body.code ?? "").trim();
    const sid = /^\d+$/.test(raw) ? Number(raw) : verifyStudentCode(raw);
    need(sid, "هذا مو كود طالب");
    // إذا ورقته انرسلت اليوم وبعدها ما انصححت: تنفتح حتى يضيف صفحة نساها
    const sent = (await find("sched_items", { user_id: sid! })).find((i) => i.status === "done" && !i.graded_at && i.version_id && String(i.at).startsWith(todayStr()));
    // ورقته انمسحت حتى تنرفع من جديد (حتى لو مو اليوم): تنفتح نفس الورقة
    const again = sent ? 0 : await rescanItemOf(sid!);
    const card = sent ? await itemCard(sent) : again ? await itemCard((await one("sched_items", { id: again }))!) : await markAttendance(sid!, uid, true);
    const it = (await one("sched_items", { id: card.item }))!;
    const qs = (await find("bank_questions", { version_id: it.version_id }, { order: ["n"] })).map((q) => q.n as number);
    const have = (await find("exam_answers", { item_id: it.id })).map((x) => x.q as number);
    return { ...await pageData(uid, full), cam: { item: it.id, name: card.name, uid: sid, exam: card.exam, qs, have, sent: it.status === "done" || !!it.graded_at } };
  }
  if (a === "scan") {
    const raw = String(body.code ?? "").trim();
    let sid = /^\d+$/.test(raw) ? Number(raw) : verifyStudentCode(raw);
    // طالب التجربة رقمه سالب، وصاحب البوت يكتبه بدون ناقص
    if (sid && sid > 0 && await isAdmin(uid) && !await student(sid) && await student(-sid)) sid = -sid;
    need(sid, "هذا مو كود طالب");
    const card = await markAttendance(sid!, uid);
    const queued = card.print === "label" && !card.late && !card.printed && await stationActive(uid);
    if (queued) await enqueue(uid, card.item);
    return { ...await pageData(uid), card: { ...card, queued } };
  }
  if (a === "except") {
    const card = (await decideLate(uid, body.item, true))!;
    const queued = card.print === "label" && await stationActive(uid);
    if (queued) await enqueue(uid, card.item);
    return { ...await pageData(uid), card: { ...card, queued } };
  }
  if (a === "lock") {
    // امتحان الجلسة: مركز وامتحان، ولا شي = تشيله
    const center = Number(body.center) || 0, exam = Number(body.exam) || 0;
    if (center) need(await one("centers", { id: center }), "المركز غير موجود");
    if (exam) need(await one("bank_exams", { id: exam }), "الامتحان غير موجود");
    await kvSet(lockKey(uid), JSON.stringify(center || exam ? { center, exam, day: todayStr() } : null));
    return { ...await pageData(uid), notice: center || exam ? "🔒 انحفظ امتحان الجلسة. الكود اللي ما يطابقه ينرفض" : "🔓 انشال امتحان الجلسة" };
  }
  if (a === "rejectLate") {
    await decideLate(uid, body.item, false);
    return { ...await pageData(uid), notice: "❌ انرفض دخوله" };
  }
  if (a === "saveEarly") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    const n = Number(body.minutes);
    need(Number.isInteger(n) && n >= 0 && n <= 600, "اكتب عدد الدقايق");
    await kvSet(EARLY_KEY, String(n));
    return { ...await pageData(uid), notice: "✅ انحفظ" };
  }
  if (a === "queue") {
    const it = await one("sched_items", { id: Number(body.item) });
    need(it, "الامتحان غير موجود", 404);
    await enqueue(uid, it!.id);
    return { ...await pageData(uid), card: { ...await itemCard(it!), already: true, queued: true }, notice: "🖨 انرسل للطابعة" };
  }
  if (a === "pageMap") {
    // توزيع صفحات الورقة على الأسئلة للنسخ المأشرة. فارغ: كل سؤال بصفحة وعليها كود
    const ids = (Array.isArray(body.versions) ? body.versions : []).map(Number);
    need(ids.length, "أشّر نسخة وحدة على الأقل");
    for (const id of ids) need(await one("bank_versions", { id }), "النسخة غير موجودة");
    const map = Array.isArray(body.map) ? (body.map as unknown[][]).map((p) => (Array.isArray(p) ? p.map(Number) : [])) : [];
    need(map.length <= 30 && map.every((p) => p.length && p.every((n) => Number.isInteger(n) && n >= 1 && n <= 50)), "اكتب أرقام الأسئلة لكل صفحة");
    const maps = await allPageMaps();
    for (const id of ids) { if (map.length) maps[`v${id}`] = map; else delete maps[`v${id}`]; }
    await kvSet(PAGE_MAPS, JSON.stringify(maps));
    return { ...await pageData(uid, full), notice: map.length ? "✅ انحفظ توزيع الصفحات" : "✅ رجع: كل سؤال بصفحة" };
  }
  if (a === "items") {
    // الصفحة تسأل عن أوراق قرتها: اسم كل طالب وأسئلة نسخته
    const ids = (Array.isArray(body.items) ? body.items : []).map(Number).slice(0, 2000);
    const out = [];
    for (const id of ids) {
      const it = await one("sched_items", { id });
      if (!it?.version_id) { out.push({ id, ok: false, name: "", qs: [] }); continue; }
      const st = await student(it.user_id);
      out.push({ id, ok: st?.exam === "حضوري" && !it.graded_at, name: st?.name ?? "", graded: !!it.graded_at, map: await pageMapOf(it.version_id), qs: (await find("bank_questions", { version_id: it.version_id })).map((q) => q.n as number) });
    }
    return { items: out };
  }
  if (a === "finish") {
    // بعد ما تنرفع صفحاتهم: الأوراق تصير جاهزة للتصحيح
    const ids = (Array.isArray(body.items) ? body.items : []).map(Number).slice(0, 2000);
    let n = 0;
    const sentNow: number[] = [];
    for (const id of ids) {
      const it = await one("sched_items", { id });
      if (!it || it.graded_at || it.status === "done" || !(await find("exam_answers", { item_id: id })).length) continue;
      await update("sched_items", { id }, { status: "done", submitted_at: stamp() });
      sentNow.push(id);
      n++;
    }
    await rescanDone(sentNow);
    try { await notifyGraders(); } catch (e) { console.error(e); }
    return { ...await pageData(uid, full), notice: `✅ ${n} ورقة راحت للتصحيح` };
  }
  if (a === "saveCenter") {
    need(await isAdmin(uid), "هذا لصاحب البوت بس", 403);
    const id = Number(body.center);
    need(await one("centers", { id }), "المركز غير موجود");
    const all = await allCfg();
    all[String(id)] = { print: body.print === "paper" ? "paper" : "label", photos: !!body.photos };
    await kvSet(KEY, JSON.stringify(all));
    return { ...await pageData(uid), notice: `✅ انحفظ ${await centerName(id)}` };
  }
  need(a === "list", "أمر غير معروف");
  return await pageData(uid, full);
}
