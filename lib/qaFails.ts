// الذكاء ما گدر يجاوب سؤال علمي (رصيد حساب Anthropic خلص، أو وصل الحد، أو خدمة الذكاء واقفة):
// الطالب ما يوصله شي عن هذا، وسؤاله يروح للأستاذ بالمجموعة مثل العادة.
// صاحب البوت (والمساعد اللي عنده صلاحية «qafail») يوصله تنبيه بأسماء هذول الطلاب: أول مرة خلال دقيقة، وبعدها
// يتجمعون، تنبيه واحد كل نص ساعة أكثر شي. والبوت يرجع يجرب أسئلتهم وحده كل 10 دقايق (يومين أكثر شي)، أو من تدوس
// «🔁 جربهم هسه»: إذا رجع الذكاء يشتغل، الطالب يوصله الحل، والأستاذ يتبلغ بموضوع السؤال إنه ما يحتاج يجاوب.
// السؤال اللي جاوبه الأستاذ قبل ما يرجع الذكاء ما ينعاد
import { kvGet, kvSet } from "./db.ts";
import { esc, stamp } from "./util.ts";

export const QA_FAIL_PERM = "qafail";
const KEY = "qa_fails";
const SENT = "qa_fails_sent";
export const ALERT_GAP = 30 * 60_000;
export const RETRY_GAP = 10 * 60_000;
export const KEEP_FOR = 48 * 3600_000;
const RETRY_MAX = 5;

/** سؤال ما جاوبه الذكاء: رقمه بالمجموعة، ومنو سأله، ونص السؤال وصورته (حتى ينعاد) */
export type QaFail = {
  qid: number; uid: number; name: string; where: string;
  t: number; l: number; en: boolean; text: string; photo: string;
  why: string; ts: number; at: string; told?: boolean; tried?: number;
};

/** سبب الفشل بكلام بسيط. خدمة الذكاء ما تگول «الرصيد خلص» بالضبط، فبالعادة يطلع «ردت بخطأ» */
export function failWhy(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  const name = (e as { name?: string })?.name ?? "";
  const status = Number((e as { status?: number })?.status) || Number(/ردت (\d{3})/.exec(m)?.[1]) || 0;
  if (/credit balance|billing|insufficient/i.test(m)) return "رصيد حساب Anthropic خلص";
  if (/spend limit|usage limit|rate limit/i.test(m) || status === 429) return "وصل حد الصرف أو حد الاستخدام بحساب Anthropic";
  if (/مو مربوط/.test(m)) return "نظام الذكاء مو مربوط بالبوت";
  if (name === "TimeoutError" || name === "AbortError" || /timeout|timed out/i.test(m)) return "الذكاء تأخر هواية وما رد";
  if (status === 401 || status === 403) return "مفتاح نظام الذكاء غلط";
  if (status) return `خدمة الذكاء ردت بخطأ (${status})`;
  if (/fetch failed|ECONN|ENOTFOUND|network/i.test(m)) return "البوت ما گدر يوصل لخدمة الذكاء";
  return "صار خطأ بنظام الذكاء";
}

export async function qaFails(): Promise<QaFail[]> {
  try { const j = JSON.parse((await kvGet(KEY)) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; }
}
const save = (l: QaFail[]) => kvSet(KEY, JSON.stringify(l.slice(-300)));

export async function noteQaFail(f: Omit<QaFail, "ts" | "at"> & { ts?: number }) {
  const ts = f.ts ?? Date.now();
  const l = (await qaFails()).filter((x) => x.qid !== f.qid);
  await save([...l, { ...f, ts, at: stamp() }]);
}

const hhmm = (at: string) => at.slice(11, 16);
const MAX_LINES = 30;
const lines = (l: QaFail[], why = false) => [
  ...l.slice(0, MAX_LINES).map((f) => `• <b>${esc(f.name)}</b> — ${esc(f.where)} — #${f.qid} (${hhmm(f.at)})${why ? `\n   السبب: ${esc(f.why)}` : ""}`),
  ...(l.length > MAX_LINES ? [`… و${l.length - MAX_LINES} غيرهم`] : []),
];

/** تنبيه «الذكاء ما جاوب هذول الطلاب». ما يوصل للطالب */
export function failAlert(l: QaFail[]): string {
  const whys = [...new Set(l.map((f) => f.why))];
  return [
    "👤 <b>تنبيه إداري، ما يوصل للطالب</b>",
    `🤖 <b>الذكاء ما جاوب هذول الطلاب على أسئلتهم العلمية (${l.length})</b>`,
    ...lines(l, whys.length > 1),
    whys.length === 1 ? `\nالسبب: ${esc(whys[0])}` : "",
    "\nأسئلتهم ما ضاعت: راحت للأستاذ بالمجموعة مثل العادة.",
    "إذا رجع الذكاء يشتغل (مثلاً عبّيت الرصيد)، البوت يجاوبهم وحده خلال 10 دقايق، أو دوس «🔁 جربهم هسه». اللي جاوبته إنت بالمجموعة ما ينعاد.",
    "إذا تكرر هذا التنبيه: افتح حساب Anthropic وشوف الرصيد والحد الشهري للصرف.",
  ].filter(Boolean).join("\n");
}
export const RETRY_BTN = { text: "🔁 جربهم هسه", callback_data: "qr:go" };

/** للمؤقت: التنبيه بالأسئلة الجديدة اللي ما جاوبها الذكاء. يرجع نص التنبيه، أو فارغ إذا ماكو شي أو بعد ما صار نص ساعة */
export async function failAlertDue(now = Date.now()): Promise<string> {
  const l = await qaFails();
  const fresh = l.filter((f) => !f.told);
  if (!fresh.length) return "";
  if (now - (Number(await kvGet(SENT)) || 0) < ALERT_GAP) return "";
  await kvSet(SENT, String(now));
  const ids = new Set(fresh.map((f) => f.qid));
  await save((await qaFails()).map((f) => (ids.has(f.qid) ? { ...f, told: true } : f)));
  return failAlert(fresh);
}

/** يرجع يجرب الأسئلة اللي ما جاوبها الذكاء.
 *  open: السؤال بعده ما جاوبه الأستاذ؟ answer: يجاوب الطالب، يرجع true إذا وصله الحل، false إذا الذكاء ما لگاله حل
 *  (يبقى للأستاذ)، ويرمي خطأ إذا الذكاء بعده واقف. force: من الزر، ما ينتظر 10 دقايق */
export async function retryFails(
  open: (f: QaFail) => Promise<boolean>, answer: (f: QaFail) => Promise<boolean>, opts: { force?: boolean; now?: number } = {},
): Promise<{ answered: QaFail[]; left: number; why: string }> {
  const now = opts.now ?? Date.now();
  const gone = new Set<number>(), changed = new Map<number, QaFail>();
  const answered: QaFail[] = [];
  let why = "", tries = 0;
  for (const f of await qaFails()) {
    if (now - f.ts > KEEP_FOR || !await open(f)) { gone.add(f.qid); continue; }
    if (why || tries >= RETRY_MAX || (!opts.force && now - (f.tried ?? f.ts) < RETRY_GAP)) continue;
    tries++;
    try {
      if (await answer(f)) answered.push(f);
      gone.add(f.qid);
    } catch (e) {
      // بعده واقف: الباقين ما نجربهم هسه
      why = failWhy(e);
      changed.set(f.qid, { ...f, tried: now, why });
    }
  }
  // خلال التجربة ممكن انضاف سؤال جديد فشل: نقرا القائمة مرة ثانية حتى ما يضيع
  const rest = (await qaFails()).filter((f) => !gone.has(f.qid)).map((f) => changed.get(f.qid) ?? f);
  await save(rest);
  return { answered, left: rest.length, why };
}

/** «✅ رجع الذكاء يشتغل»: منو انجاوب */
export function backAlert(l: QaFail[], left: number): string {
  return [
    "👤 <b>تنبيه إداري، ما يوصل للطالب</b>",
    `✅ <b>رجع الذكاء يشتغل، وجاوب هذول الطلاب (${l.length})</b>`,
    ...lines(l),
    "\nكل واحد وصله الحل، وبموضوع سؤاله بالمجموعة انكتب إنه انجاوب. ما تحتاج تجاوبهم.",
    left ? `بعد ${left} سؤال، يتجربون بالدكة الجاية.` : "",
  ].filter(Boolean).join("\n");
}
