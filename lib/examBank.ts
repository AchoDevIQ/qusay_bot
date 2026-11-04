// بنك الامتحانات: كل امتحان بنسخه وأسئلته وأجوبته المقصوصة، وتعديلها من الإدارة
// الملفات داخل data/content (ما تنرفع على GitHub)، وتنضاف بـ npm run load-exams
import fs from "node:fs";
import path from "node:path";
import { all, get, run, setSession, tx, type Row } from "./db.ts";
import { CONTENT_DIR } from "./config.ts";
import { can } from "./data.ts";
import { flowKb } from "./keyboards.ts";
import { api, edit, send, upload, type Kb } from "./telegram.ts";
import { btn, cut, esc, stamp } from "./util.ts";

export const EXAM_PERM = "exams";
const KIND_LABEL: Record<string, string> = { mandatory: "📌 إجباري", optional: "🎯 اختياري" };
const KIND_NEXT: Record<string, string> = { mandatory: "optional", optional: "mandatory" };

// ---------- الإدخال من catalog.json
/** يضيف فصل كامل. الأسئلة المعدلة من الإدارة ما تتغير إذا انعاد الإدخال */
export function loadCatalog(catalog: Row) {
  return tx(() => {
    let versions = 0, questions = 0, needReview = 0;
    for (const ex of catalog.exams) {
      run(`INSERT INTO bank_exams(slug, chapter, ord, title, info, minutes) VALUES(?,?,?,?,?,?)
        ON CONFLICT(slug, ord) DO UPDATE SET chapter=excluded.chapter, title=excluded.title, info=excluded.info`,
      catalog.slug, catalog.chapter, ex.ord, ex.title, ex.info ?? "", ex.minutes);
      const examId = get("SELECT id FROM bank_exams WHERE slug=? AND ord=?", catalog.slug, ex.ord)!.id as number;
      for (const v of ex.versions) {
        run(`INSERT INTO bank_versions(exam_id, model, ok, issues, has_en) VALUES(?,?,?,?,?)
          ON CONFLICT(exam_id, model) DO UPDATE SET ok=excluded.ok, issues=excluded.issues, has_en=excluded.has_en`,
        examId, v.model, v.ok ? 1 : 0, JSON.stringify(v.issues ?? []), v.has_en ? 1 : 0);
        const vid = get("SELECT id FROM bank_versions WHERE exam_id=? AND model=?", examId, v.model)!.id as number;
        const dir = path.posix.join(catalog.slug, `e${ex.ord}`, v.model);
        for (const q of v.questions) {
          run(`INSERT INTO bank_questions(version_id, n, max_mark, q_file, a_files) VALUES(?,?,?,?,?)
            ON CONFLICT(version_id, n) DO UPDATE SET
              max_mark=CASE WHEN edited THEN max_mark ELSE excluded.max_mark END,
              q_file=CASE WHEN edited THEN q_file ELSE excluded.q_file END,
              a_files=CASE WHEN edited THEN a_files ELSE excluded.a_files END`,
          vid, q.n, q.max, q.q ? path.posix.join(dir, q.q) : null, JSON.stringify((q.a ?? []).map((f: string) => path.posix.join(dir, f))));
          questions++;
        }
        versions++;
        if (!v.ok) needReview++;
      }
    }
    return { exams: catalog.exams.length, versions, questions, needReview };
  });
}

// ---------- الملفات
const contentPath = (rel: string) => path.join(CONTENT_DIR, rel);
const versionDir = (e: Row, v: Row) => path.posix.join(e.slug, `e${e.ord}`, v.model);
/** صورة أو ملف من المحتوى: رقم تليجرام إذا انبدلت من الإدارة، أو ملف من القرص */
async function sendImage(chat: number, ref: string | null, caption: string) {
  if (!ref) { await send(chat, `⚠️ ${caption}: ماكو ملف.`); return; }
  if (ref.startsWith("tg:")) { await api("sendPhoto", { chat_id: chat, photo: ref.slice(3), caption }); return; }
  const f = contentPath(ref);
  if (!fs.existsSync(f)) { await send(chat, `⚠️ ${caption}: الملف مفقود من السيرفر.`); return; }
  await upload("sendPhoto", { chat_id: String(chat), caption }, "photo", f, path.basename(f), "image/png");
}
function logEdit(uid: number, what: string) {
  run("INSERT INTO bank_edits(user_id, what, created) VALUES(?,?,?)", uid, what, stamp());
}
const fmtMinutes = (m: number) => {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}:${String(r).padStart(2, "0")} ساعة` : `${m} دقيقة`;
};

// ---------- الشاشات
const chaptersList = () => all("SELECT DISTINCT slug, chapter FROM bank_exams ORDER BY slug");
function homeView(): [string, Kb] {
  const chs = chaptersList();
  if (!chs.length) return ["<b>📝 الامتحانات</b>\nماكو امتحانات مدخلة بعد.", [[btn("⬅️ رجوع", "a:menu")]]];
  return ["<b>📝 الامتحانات</b>\nاختر الفصل:", [...chs.map((c, i) => {
    const n = get("SELECT COUNT(*) n FROM bank_exams WHERE slug=?", c.slug)!.n;
    return [btn(`📚 ${c.chapter} (${n} امتحان)`, `a:exh:${i}`)];
  }), [btn("⬅️ رجوع", "a:menu")]]];
}
function chapterView(i: number): [string, Kb] {
  const c = chaptersList()[i];
  if (!c) return homeView();
  const exams = all(`SELECT e.*, COUNT(v.id) vn, SUM(CASE WHEN v.ok THEN 0 ELSE 1 END) bad FROM bank_exams e
    LEFT JOIN bank_versions v ON v.exam_id=e.id WHERE e.slug=? GROUP BY e.id ORDER BY e.ord`, c.slug);
  const kb: Kb = exams.map((e) => [btn(`${e.bad ? "⚠️ " : ""}${e.ord}) ${cut(`${e.title} ${lectureOf(e.info)}`, 40)} · ${e.vn} نسخ`, `a:exe:${e.id}`)]);
  kb.push([btn("⬅️ رجوع", "a:ex")]);
  return [`<b>📚 ${esc(c.chapter)}</b>\n⚠️ يعني بيها نسخة ناقصة، وما تنعطى للطلاب لحد ما تتصلح.`, kb];
}
const lectureOf = (info: string) => /\(([\d\s&]+)\)/.exec(info ?? "")?.[0] ?? "";
function examView(id: number): [string, Kb] {
  const e = get("SELECT * FROM bank_exams WHERE id=?", id);
  if (!e) return homeView();
  const vs = all("SELECT * FROM bank_versions WHERE exam_id=? ORDER BY model", id);
  const count = (k: string) => vs.filter((v) => v.ok && v.kind === k).length;
  const kb: Kb = vs.map((v) => [btn(`${v.ok ? "" : "⚠️ "}${v.model} · ${KIND_LABEL[v.kind]}`, `a:exv:${v.id}`)]);
  kb.push([btn("🕓 تغيير وقت الامتحان", `a:exm:${id}`)]);
  const ci = chaptersList().findIndex((c) => c.slug === e.slug);
  kb.push([btn("⬅️ رجوع", `a:exh:${ci}`)]);
  return [`<b>${esc(e.title)} ${esc(lectureOf(e.info))}</b>\n🕓 وقت الحل: <b>${fmtMinutes(e.minutes)}</b>\n📌 إجباري: ${count("mandatory")} · 🎯 اختياري: ${count("optional")}\n\nاضغط النسخة حتى تشوفها أو تعدلها.`, kb];
}
function versionView(id: number): [string, Kb] {
  const v = get("SELECT * FROM bank_versions WHERE id=?", id);
  if (!v) return homeView();
  const e = get("SELECT * FROM bank_exams WHERE id=?", v.exam_id)!;
  const qs = all("SELECT * FROM bank_questions WHERE version_id=? ORDER BY n", id);
  const total = qs.reduce((s, q) => s + q.max_mark, 0);
  const issues: string[] = JSON.parse(v.issues || "[]");
  const lines = [`<b>${esc(e.title)} ${esc(lectureOf(e.info))} · نسخة ${esc(v.model)}</b>`, `النوع: ${KIND_LABEL[v.kind]}`, `مجموع الدرجات: <b>${total}</b>`];
  if (issues.length) lines.push("", "⚠️ <b>نواقص:</b>", ...issues.map((x) => "• " + esc(x.replace(/^.*?نسخة \S+:\s*/, ""))));
  const kb: Kb = qs.map((q) => [btn(`س ${q.n} · ${q.max_mark} درجة${q.edited ? " ✏️" : ""}`, `a:exq:${q.id}`)]);
  kb.push([btn(`🔄 خليها ${KIND_LABEL[KIND_NEXT[v.kind]]}`, `a:exk:${id}`)]);
  kb.push([btn("📄 نسخة الطالب عربي", `a:exp:${id}:ar`), ...(v.has_en ? [btn("📄 إنجليزي", `a:exp:${id}:en`)] : [])]);
  kb.push([btn(v.ok ? "⚠️ أوقف هاي النسخة" : "✅ النسخة جاهزة", `a:exo:${id}`)]);
  kb.push([btn("⬅️ رجوع", `a:exe:${e.id}`)]);
  return [lines.join("\n"), kb];
}
const questionKb = (q: Row): Kb => [[btn("🔢 تغيير الدرجة", `a:exqm:${q.id}`)], [btn("🖼 تبديل صورة السؤال", `a:exqi:${q.id}`)],
  [btn("📘 تبديل الجواب", `a:exqa:${q.id}`)], [btn("⬅️ رجوع للنسخة", `a:exv:${q.version_id}`)]];
async function questionView(chat: number, id: number) {
  const q = get("SELECT * FROM bank_questions WHERE id=?", id);
  if (!q) return;
  await sendImage(chat, q.q_file, `س ${q.n} (من ${q.max_mark})`);
  const answers: string[] = JSON.parse(q.a_files || "[]");
  if (!answers.length) await send(chat, "⚠️ هذا السؤال ماكو إله جواب نموذجي.");
  for (let i = 0; i < answers.length; i++) await sendImage(chat, answers[i], `جواب س ${q.n}` + (answers.length > 1 ? ` (${i + 1}/${answers.length})` : ""));
  await send(chat, `<b>س ${q.n}</b> · الدرجة: <b>${q.max_mark}</b>`, { kb: questionKb(q) });
}

// ---------- الأزرار
export async function examBankCb(chat: number, uid: number, mid: number, d: string): Promise<string | null> {
  const show = ([t, kb]: [string, Kb]) => edit(chat, mid, t, kb);
  const sendV = ([t, kb]: [string, Kb]) => send(chat, t, { kb });
  if (d === "a:ex") await show(homeView());
  else if (d.startsWith("a:exh:")) await show(chapterView(Number(d.slice(6))));
  else if (d.startsWith("a:exe:")) await show(examView(Number(d.slice(6))));
  else if (d.startsWith("a:exv:")) await sendV(versionView(Number(d.slice(6))));
  else if (d.startsWith("a:exk:")) {
    const id = Number(d.slice(6));
    const v = get("SELECT * FROM bank_versions WHERE id=?", id);
    if (!v) return "النسخة غير موجودة";
    run("UPDATE bank_versions SET kind=? WHERE id=?", KIND_NEXT[v.kind], id);
    logEdit(uid, `نسخة ${id}: ${KIND_LABEL[KIND_NEXT[v.kind]]}`);
    await show(versionView(id));
  } else if (d.startsWith("a:exo:")) {
    const id = Number(d.slice(6));
    const v = get("SELECT * FROM bank_versions WHERE id=?", id);
    if (!v) return "النسخة غير موجودة";
    run("UPDATE bank_versions SET ok=?, issues=? WHERE id=?", v.ok ? 0 : 1, v.ok ? JSON.stringify(["موقوفة من الإدارة"]) : "[]", id);
    logEdit(uid, `نسخة ${id}: ${v.ok ? "إيقاف" : "جاهزة"}`);
    await show(versionView(id));
  } else if (d.startsWith("a:exp:")) {
    const [id, lang] = d.slice(6).split(":");
    const v = get("SELECT * FROM bank_versions WHERE id=?", Number(id));
    const e = v && get("SELECT * FROM bank_exams WHERE id=?", v.exam_id);
    if (!v || !e || (lang !== "ar" && lang !== "en")) return "النسخة غير موجودة";
    const f = contentPath(path.posix.join(versionDir(e, v), `student_${lang}.pdf`));
    if (!fs.existsSync(f)) return "الملف مفقود من السيرفر";
    await upload("sendDocument", { chat_id: String(chat), caption: `${e.title} · نسخة ${v.model}`, protect_content: "true" }, "document", f, `${v.model}_${lang}.pdf`, "application/pdf");
  } else if (d.startsWith("a:exm:")) {
    setSession(uid, "a:exm", { id: Number(d.slice(6)) });
    await send(chat, "🕓 اكتب وقت هذا الامتحان بالدقائق، مثل <code>75</code> لساعة وربع:", { replyKb: flowKb() });
  } else if (d.startsWith("a:exqm:")) {
    setSession(uid, "a:exqm", { id: Number(d.slice(7)) });
    await send(chat, "🔢 اكتب درجة هذا السؤال (رقم كامل):", { replyKb: flowKb() });
  } else if (d.startsWith("a:exqi:")) {
    setSession(uid, "a:exqi", { id: Number(d.slice(7)) });
    await send(chat, "🖼 أرسل الصورة الجديدة للسؤال:", { replyKb: flowKb() });
  } else if (d.startsWith("a:exqa:")) {
    setSession(uid, "a:exqa", { id: Number(d.slice(7)), files: [] });
    await send(chat, "📘 أرسل صور الجواب الجديد، وحدة أو أكثر، ولمن تخلص اكتب <code>تم</code>:", { replyKb: flowKb() });
  } else if (d.startsWith("a:exq:")) await questionView(chat, Number(d.slice(6)));
  return null;
}

// ---------- الكتابة والصور أثناء التعديل
/** يرجع true إذا عالج الرسالة */
export async function examBankMessage(chat: number, uid: number, m: Row, st: string, data: Row) {
  if (!can(uid, EXAM_PERM)) return false;
  const text = String(m.text ?? "").trim();
  const photo: string | undefined = m.photo?.at?.(-1)?.file_id;
  const done = async (id: number) => {
    setSession(uid, "", {});
    await send(chat, "✅ انحفظ التعديل. يشمل بس اللي بعد ما امتحن هذا الامتحان.");
    await questionView(chat, id);
  };
  if (st === "a:exm") {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 5 || n > 600) { await send(chat, "⚠️ اكتب عدد الدقائق، مثل 75"); return true; }
    run("UPDATE bank_exams SET minutes=? WHERE id=?", n, data.id);
    logEdit(uid, `امتحان ${data.id}: الوقت ${n} دقيقة`);
    setSession(uid, "", {});
    const [t, kb] = examView(data.id);
    await send(chat, t, { kb });
    return true;
  }
  if (st === "a:exqm") {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 0 || n > 100) { await send(chat, "⚠️ اكتب رقم كامل من 0 إلى 100"); return true; }
    run("UPDATE bank_questions SET max_mark=?, edited=1 WHERE id=?", n, data.id);
    logEdit(uid, `سؤال ${data.id}: الدرجة ${n}`);
    await done(data.id);
    return true;
  }
  if (st === "a:exqi") {
    if (!photo) { await send(chat, "⚠️ أرسل صورة."); return true; }
    run("UPDATE bank_questions SET q_file=?, edited=1 WHERE id=?", "tg:" + photo, data.id);
    logEdit(uid, `سؤال ${data.id}: صورة جديدة`);
    await done(data.id);
    return true;
  }
  if (st === "a:exqa") {
    if (photo) {
      data.files.push("tg:" + photo);
      setSession(uid, st, data);
      await send(chat, `✅ وصلت (${data.files.length}). أرسل غيرها، أو اكتب <code>تم</code>.`);
      return true;
    }
    if (text !== "تم" || !data.files.length) { await send(chat, "⚠️ أرسل صورة الجواب، أو اكتب تم بعد ما ترسلها."); return true; }
    run("UPDATE bank_questions SET a_files=?, edited=1 WHERE id=?", JSON.stringify(data.files), data.id);
    logEdit(uid, `سؤال ${data.id}: جواب جديد`);
    await done(data.id);
    return true;
  }
  return false;
}
