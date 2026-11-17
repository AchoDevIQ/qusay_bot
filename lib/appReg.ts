// تسجيل الطالب الجديد بالتطبيق بطريقة البوت (قرار الأستاذ 2026-11-17): الشروط وترتيب كلماتها، والمعلومات، والرمز السري.
// زر بيد صاحب البوت: مطفي = التسجيل القديم مال التطبيق، مشغّل = تسجيل البوت.
// البوت يسوي الحساب بالمكانين سوه: بنظام التطبيق (نفس الخطوات اللي يسويها التطبيق: حساب الدخول، معلوماته، منهجه ومركزه)
// حتى يدخل ويشوف المحاضرات، وبالبوت (رقم تطبيق جديد مربوط بحسابه). الرمز السري نفسه مال التطبيق، يطلع للطالب مرة وحدة.
// إذا وقف بالنص (نت أو خطأ بنظام التطبيق)، يكمل من نفس الخطوة لما يدوس مرة ثانية
import { ADMIN_IDS, CURRS } from "./config.ts";
import { kvGet, kvSet, one, put, type Row } from "./db.ts";
import { dcQuery, nextAppUid, type AppEnv } from "./appLink.ts";
import { hashPassword } from "./password.ts";
import { seal, unseal } from "./secretBox.ts";
import { student } from "./data.ts";
import { stamp } from "./util.ts";
import { ensure, need } from "./webApi.ts";

const KV = "app_reg_bot";
export const appRegOn = async () => (await kvGet(KV)) === "1";
export const setAppReg = async (on: boolean) => kvSet(KV, on ? "1" : "0");

/** مناطق بغداد بنظام التطبيق (نفس قائمته الأصلية) */
export const BAGHDAD_DISTRICTS = ["الكرادة", "المنصور", "الزيونة", "الأعظمية", "الكاظمية", "الشعلة", "الشعب", "الحرية", "الغزالية", "الدورة", "الوزيرية", "الجادرية", "بغداد الجديدة", "الأمين", "الزعفرانية", "السيدية", "العامرية", "البتاوين", "الصالحية", "القاهرة", "الرشيد", "المشتل", "الطالبية", "النهروان", "المدائن", "أبو غريب", "التاجي", "الصدر", "العطيفية", "الحيدرخانة"];
const GRADE: Record<string, string> = { "السادس العلمي": "sixth_preparatory", "الخامس العلمي": "fifth_preparatory" };
const GENDER: Record<string, string> = { "بنين": "ذكر", "بنات": "أنثى" };
const FN: Record<AppEnv, string> = { prod: "https://europe-west4-qmath-iq.cloudfunctions.net", staging: "https://api-staging.qusay-system.com" };

/** خطأ من نظام التطبيق: رسالته العربية تطلع للطالب كما هي */
class AppSysError extends Error {}
async function callFn(env: AppEnv, name: string, data: Row, idToken?: string): Promise<Row> {
  const r = await fetch(`${FN[env]}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const j = (await r.json().catch(() => ({}))) as Row;
  if (!r.ok || j.error) throw new AppSysError(String(j.error?.message || `ما گدرنا نكمل التسجيل (${name})`));
  return (j.result ?? {}) as Row;
}
async function signIn(phone: string, password: string) {
  const key = process.env.APP_WEB_API_KEY;
  need(key, "التسجيل مو جاهز هسه، تواصل ويا الإدارة", 503);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${phone}@qusay-system.com`, password, returnSecureToken: true }),
  });
  const j = (await r.json().catch(() => ({}))) as Row;
  need(r.ok && j.idToken, "ما گدرنا نكمل التسجيل، حاول مرة ثانية", 502);
  return String(j.idToken);
}

/** منهج التطبيق المناسب لصفه: المنشور، واللي عنوانه بيه «السادس» أو «الخامس» */
async function pickCurriculum(env: AppEnv, tok: string, grade: string) {
  const list = ((await dcQuery(env, tok, "GetCurriculums", {})).curricula as Row[] ?? []).filter((c) => c.status === "published");
  need(list.length, "ماكو منهج منشور بالتطبيق، تواصل ويا الإدارة", 503);
  const word = grade.includes("الخامس") ? "الخامس" : "السادس";
  return String((list.find((c) => String(c.arabicTitle ?? "").includes(word)) ?? list[0]).id);
}
/** مركز التطبيق: نفس اسم مركزه بالبوت، أو الإلكتروني، أو أول مركز بمحافظته */
async function pickCenter(env: AppEnv, tok: string, r: Row) {
  const list = (await dcQuery(env, tok, "GetExamCenters", { signupVisible: true })).examCenters as Row[] ?? [];
  need(list.length, "ماكو مراكز امتحانية بالتطبيق، تواصل ويا الإدارة", 503);
  const mine = r.exam === "حضوري" && r.center_id ? String((await one("centers", { id: r.center_id }))?.name ?? "") : "";
  const online = /إلكتروني|الكتروني|اونلاين|أونلاين/;
  const hit = (mine && list.find((c) => String(c.name) === mine))
    || (r.exam !== "حضوري" && list.find((c) => online.test(String(c.name))))
    || list.find((c) => (c.provinces as string[] | undefined)?.includes(String(r.gov)))
    || list[0];
  return String(hit.id);
}

// طلبين ورا بعض لنفس الرقم ما يمشون سوه
const busy = new Set<string>();

export async function appRegAction(body: Row) {
  await ensure();
  need(await appRegOn(), "التسجيل الجديد من هنا مسدود هسه. ارجع وسجل من التطبيق", 403);
  const env: AppEnv = body.env === "staging" ? "staging" : "prod";
  const phone = String(body.phone ?? "").replace(/[\s-]/g, "");
  need(/^07\d{9}$/.test(phone), "رقم الهاتف غير صالح، ارجع واكتبه من جديد");
  const { loadTerms, termsRev } = await import("./terms.ts");
  const a = String(body.action ?? "info");
  if (a === "info") {
    const terms = await loadTerms();
    const { regFormData } = await import("./keyboards.ts");
    return { terms, rev: termsRev(terms), registered: false, ...await regFormData(), districts: BAGHDAD_DISTRICTS };
  }
  need(a === "register", "أمر غير معروف");
  need(body.rev === termsRev(await loadTerms()), "الشروط تغيرت. ارجع وافتح التسجيل من جديد.", 409);
  const { studentFromForm } = await import("./student.ts");
  const form = (body.form ?? {}) as Row;
  const { errs, r } = await studentFromForm(form, false);
  need(!errs.length, errs.join("، "));
  need(r.gender, "اختار بنين لو بنات");
  need(r.birth, "اختار تاريخ ميلادك: اليوم والشهر والسنة");
  need(r.phone1 === phone, "رقم هاتفك لازم نفس الرقم اللي دخلت بيه");
  need(CURRS.includes(String(r.curr)) && GRADE[String(r.grade)], "اختار المنهج وصفك");
  const district = String(form.dz ?? "").trim();
  if (r.gov === "بغداد") need(BAGHDAD_DISTRICTS.includes(district), "اختار منطقتك ببغداد");
  need(!busy.has(phone), "طلبك قيد التنفيذ، انتظر شوية");
  busy.add(phone);
  try { return await register(env, phone, r, district); } finally { busy.delete(phone); }
}

async function register(env: AppEnv, phone: string, r: Row, district: string) {
  // التقدم ينحفظ مشفر، حتى إذا وقف بالنص يكمل من نفس الخطوة
  const key = `appreg_${env}_${phone}`;
  const saved = await kvGet(key);
  let st: { fu: string; password: string; stage: number } | null = null;
  try { const plain = saved ? unseal(saved) : null; st = plain ? JSON.parse(plain.toString("utf8")) : null; } catch { st = null; }
  const keep = async () => kvSet(key, seal(JSON.stringify(st)));
  try {
    if (!st) {
      // ١. حساب الدخول بالتطبيق (يرجع الرمز السري)
      const made = await callFn(env, "createStudentAuthAccount", { phone });
      st = { fu: String(made.uid), password: String(made.password), stage: 1 };
      await keep();
    }
    const tok = await signIn(phone, st.password);
    if (st.stage < 2) {
      // ٢. معلوماته بالتطبيق
      await callFn(env, "signupCreateAccount", {
        fullName: r.name, parentPhone: r.phone2, province: r.gov, gender: GENDER[String(r.gender)] ?? r.gender, birthDate: r.birth,
        profilePhotoUrl: "", acceptedTermIds: [], gradeLevel: GRADE[String(r.grade)],
        ...(r.gov === "بغداد" ? { district } : {}), ...(String(r.area ?? "").trim() ? { addressDetails: String(r.area).trim() } : {}),
      }, tok);
      st.stage = 2;
      await keep();
    }
    if (st.stage < 3) {
      // ٣. منهجه ومركزه بالتطبيق (يصير حسابه فعال)
      const tok2 = await signIn(phone, st.password);
      await callFn(env, "completeStudentProfile", { curriculumId: await pickCurriculum(env, tok2, String(r.grade)), track: r.curr === "إنجليزي" ? "english" : "arabic", examCenterId: await pickCenter(env, tok2, r) }, tok2);
      st.stage = 3;
      await keep();
    }
    // ٤. بالبوت: رقم تطبيق جديد مربوط بحسابه، ومعلوماته، ورمزه (مشفر)
    const link = await one("app_links", { fu: st.fu });
    const uid = link ? Number(link.uid) : await nextAppUid();
    if (!await student(uid)) {
      const { saveStudent } = await import("./student.ts");
      await saveStudent(uid, "", r, null);
    }
    await put("app_links", { fu: st.fu, uid, env, chapters: "[]", created: link?.created ?? stamp(), updated: stamp() });
    await put("student_pass", { user_id: uid, hash: hashPassword(st.password), created: stamp() });
    const { logActivity } = await import("./access.ts");
    await logActivity(uid, "📝 سجل من التطبيق بطريقة البوت");
    await kvSet(key, "");
    try {
      const { send } = await import("./telegram.ts");
      for (const a of ADMIN_IDS) await send(a, `📝 <b>طالب جديد سجل من التطبيق</b>\n${r.name}\n${r.curr} · ${r.grade} · ${r.gov}`);
    } catch (e) { console.error(e); }
    return { password: st.password, phone };
  } catch (e) {
    if (e instanceof AppSysError) {
      const msg = e.message;
      // نظام التطبيق يطلب ربط تليگرام (محظور): الإدارة لازم تطفي هذا الشرط
      if (/تيليغرام|تليگرام|تلغرام/.test(msg)) need(false, "التسجيل وقف لأن نظام التطبيق يطلب ربط تليگرام. تواصل ويا الإدارة، وبعدها دوس «إنشاء الحساب» مرة ثانية", 409);
      need(false, msg, 400);
    }
    throw e;
  }
}
