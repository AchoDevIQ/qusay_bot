// بنك الامتحانات: كل امتحان بنسخه وأسئلته وأجوبته المقصوصة، وتعديلها من الإدارة
// الملفات داخل data/content (ما تنرفع على GitHub)، وتنضاف بـ npm run load-exams
import path from "node:path";
import { all, get, run, setSession, tx, type Row } from "./db.ts";
import { can } from "./data.ts";
import { files } from "./files.ts";
import { flowKb } from "./keyboards.ts";
import { api, edit, send, upload, type Kb } from "./telegram.ts";
import { btn, cut, esc, stamp } from "./util.ts";

export const EXAM_PERM = "exams";
const KIND_LABEL: Record<string, string> = { mandatory: "📌 إجباري", optional: "🎯 اختياري" };
const KIND_NEXT: Record<string, string> = { mandatory: "optional", optional: "mandatory" };

export function deleteVersion(id: number) {
  run("DELETE FROM bank_questions WHERE version_id=?", id);
  run("DELETE FROM bank_versions WHERE id=?", id);
}

// ---------- الإدخال من catalog.json
/** يضيف فصل كامل. الأسئلة المعدلة من الإدارة ما تتغير إذا انعاد الإدخال */
export function loadCatalog(catalog: Row) {
  return tx(() => {
    let versions = 0, questions = 0, needReview = 0;
    // الامتحانات والنسخ اللي انشالت من الملفات تنشال من البوت هم
    const keepOrds = catalog.exams.map((e: Row) => e.ord as number);
    // (اللي انضاف من لوحة التحكم يبقى)
    for (const old of all("SELECT id, ord, manual FROM bank_exams WHERE slug=?", catalog.slug)) {
      const ex = catalog.exams.find((e: Row) => e.ord === old.ord);
      const keepModels: string[] = ex ? ex.versions.map((v: Row) => v.model) : [];
      for (const v of all("SELECT id, model, manual FROM bank_versions WHERE exam_id=?", old.id)) {
        if (v.manual || keepModels.includes(v.model)) continue;
        deleteVersion(v.id);
      }
      if (!old.manual && !keepOrds.includes(old.ord) && !get("SELECT 1 FROM bank_versions WHERE exam_id=?", old.id)) run("DELETE FROM bank_exams WHERE id=?", old.id);
    }
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
const versionDir = (e: Row, v: Row) => path.posix.join(e.slug, `e${e.ord}`, v.model);
/** صورة أو ملف من المحتوى: رقم تليجرام إذا انبدلت من الإدارة، أو ملف من القرص */
async function sendImage(chat: number, ref: string | null, caption: string) {
  if (!ref) { await send(chat, `⚠️ ${caption}: ماكو ملف.`); return; }
  if (ref.startsWith("tg:")) { await api("sendPhoto", { chat_id: chat, photo: ref.slice(3), caption }); return; }
  const body = await files().read(ref);
  if (!body) { await send(chat, `⚠️ ${caption}: الملف مفقود من السيرفر.`); return; }
  await upload("sendPhoto", { chat_id: String(chat), caption }, "photo", body, path.posix.basename(ref), "image/png");
}
export function logEdit(uid: number, what: string) {
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
  kb.push([btn("➕ امتحان جديد", `a:exna:${i}`)], [btn("⬅️ رجوع", "a:ex")]);
  return [`<b>📚 ${esc(c.chapter)}</b>\n⚠️ يعني بيها نسخة ناقصة، وما تنعطى للطلاب لحد ما تتصلح.`, kb];
}
const lectureOf = (info: string) => /\(([\d\s&]+)\)/.exec(info ?? "")?.[0] ?? "";
function examView(id: number): [string, Kb] {
  const e = get("SELECT * FROM bank_exams WHERE id=?", id);
  if (!e) return homeView();
  const vs = all("SELECT * FROM bank_versions WHERE exam_id=? ORDER BY model", id);
  const count = (k: string) => vs.filter((v) => v.ok && v.kind === k).length;
  const kb: Kb = vs.map((v) => [btn(`${v.ok ? "" : "⚠️ "}${v.model} · ${KIND_LABEL[v.kind]}`, `a:exv:${v.id}`)]);
  kb.push([btn("➕ نسخة جديدة", `a:exnv:${id}`)]);
  kb.push([btn("🕓 تغيير وقت الامتحان", `a:exm:${id}`)]);
  kb.push([btn("🗑 حذف الامتحان كله", `a:exde:${id}`)]);
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
  kb.push([btn("➕ إضافة سؤال", `a:exnq:${id}`)]);
  kb.push([btn(`🔄 خليها ${KIND_LABEL[KIND_NEXT[v.kind]]}`, `a:exk:${id}`)]);
  kb.push([btn("📄 نسخة الطالب عربي", `a:exp:${id}:ar`), ...(v.has_en || v.pdf_en ? [btn("📄 إنجليزي", `a:exp:${id}:en`)] : [])]);
  kb.push([btn("⬆️ رفع نسخة الطالب عربي", `a:exu:${id}:ar`), btn("⬆️ إنجليزي", `a:exu:${id}:en`)]);
  kb.push([btn(v.ok ? "⚠️ أوقف هاي النسخة" : "✅ النسخة جاهزة", `a:exo:${id}`)]);
  kb.push([btn("🗑 حذف النسخة", `a:exvd:${id}`)]);
  kb.push([btn("⬅️ رجوع", `a:exe:${e.id}`)]);
  return [lines.join("\n"), kb];
}
const questionKb = (q: Row): Kb => [[btn("🔢 تغيير الدرجة", `a:exqm:${q.id}`)], [btn("🖼 تبديل صورة السؤال", `a:exqi:${q.id}`)],
  [btn("📘 تبديل الجواب", `a:exqa:${q.id}`)], [btn("🗑 حذف السؤال", `a:exqd:${q.id}`)], [btn("⬅️ رجوع للنسخة", `a:exv:${q.version_id}`)]];
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
    if (!v.ok && !get("SELECT 1 FROM bank_questions WHERE version_id=?", id)) return "ضيف سؤال واحد على الأقل";
    run("UPDATE bank_versions SET ok=?, issues=? WHERE id=?", v.ok ? 0 : 1, v.ok ? JSON.stringify(["موقوفة من الإدارة"]) : "[]", id);
    logEdit(uid, `نسخة ${id}: ${v.ok ? "إيقاف" : "جاهزة"}`);
    await show(versionView(id));
  } else if (d.startsWith("a:exp:")) {
    const [id, lang] = d.slice(6).split(":");
    const v = get("SELECT * FROM bank_versions WHERE id=?", Number(id));
    const e = v && get("SELECT * FROM bank_exams WHERE id=?", v.exam_id);
    if (!v || !e || (lang !== "ar" && lang !== "en")) return "النسخة غير موجودة";
    const uploaded: string | null = v["pdf_" + lang];
    if (uploaded && !uploaded.startsWith("uploads/")) { await api("sendDocument", { chat_id: chat, document: uploaded, caption: `${e.title} · نسخة ${v.model}`, protect_content: true }); return null; }
    const body = await files().read(uploaded ?? path.posix.join(versionDir(e, v), `student_${lang}.pdf`));
    if (!body) return "الملف مفقود من السيرفر";
    await upload("sendDocument", { chat_id: String(chat), caption: `${e.title} · نسخة ${v.model}`, protect_content: "true" }, "document", body, `${v.model}_${lang}.pdf`, "application/pdf");
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
  else if (d.startsWith("a:exna:")) {
    const c = chaptersList()[Number(d.slice(7))];
    if (!c) return "الفصل غير موجود";
    setSession(uid, "a:exna", { slug: c.slug, chapter: c.chapter });
    await send(chat, "✍️ اكتب عنوان الامتحان، مثل: <code>ديموافر المحاضرة (6)</code>", { replyKb: flowKb() });
  } else if (d.startsWith("a:exnv:")) {
    const examId = Number(d.slice(7));
    const models = all("SELECT model FROM bank_versions WHERE exam_id=?", examId).map((v) => v.model as string);
    const model = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").find((x) => !models.includes(x));
    if (!model) return "ماكو حرف باقي";
    const vid = run("INSERT INTO bank_versions(exam_id, model, ok, issues, manual) VALUES(?,?,0,?,1)", examId, model, JSON.stringify(["لسه تنضاف أسئلتها"]));
    logEdit(uid, `امتحان ${examId}: نسخة جديدة ${model}`);
    await sendV(versionView(vid));
  } else if (d.startsWith("a:exnq:")) {
    setSession(uid, "a:exnq", { vid: Number(d.slice(7)), step: "q", answers: [] });
    await send(chat, "🖼 أرسل <b>صورة السؤال</b> بالعربي، لأنها اللي تطلع للمصحح:", { replyKb: flowKb() });
  } else if (d.startsWith("a:exu:")) {
    const [id, lang] = d.slice(6).split(":");
    setSession(uid, "a:exu", { id: Number(id), lang });
    await send(chat, `⬆️ أرسل ملف PDF لنسخة الطالب ${lang === "ar" ? "العربية" : "الإنجليزية"}:`, { replyKb: flowKb() });
  } else if (d.startsWith("a:exqdy:")) {
    const q = get("SELECT * FROM bank_questions WHERE id=?", Number(d.slice(8)));
    if (!q) return "السؤال غير موجود";
    tx(() => {
      run("DELETE FROM bank_questions WHERE id=?", q.id);
      run("UPDATE bank_questions SET n=n-1 WHERE version_id=? AND n>?", q.version_id, q.n);   // الأرقام تبقى متسلسلة
    });
    logEdit(uid, `نسخة ${q.version_id}: حذف س ${q.n}`);
    await show(versionView(q.version_id));
  } else if (d.startsWith("a:exqd:")) {
    const id = Number(d.slice(7));
    await show([`⚠️ متأكد تحذف هذا السؤال؟`, [[btn("🗑 نعم، احذف", `a:exqdy:${id}`)], [btn("↩️ لا", `a:exq:${id}`)]]]);
  } else if (d.startsWith("a:exvdy:")) {
    const v = get("SELECT * FROM bank_versions WHERE id=?", Number(d.slice(8)));
    if (!v) return "النسخة غير موجودة";
    tx(() => deleteVersion(v.id));
    logEdit(uid, `امتحان ${v.exam_id}: حذف نسخة ${v.model}`);
    await show(examView(v.exam_id));
  } else if (d.startsWith("a:exvd:")) {
    const id = Number(d.slice(7));
    await show(["⚠️ متأكد تحذف هاي النسخة بكل أسئلتها؟", [[btn("🗑 نعم، احذف", `a:exvdy:${id}`)], [btn("↩️ لا", `a:exv:${id}`)]]]);
  } else if (d.startsWith("a:exdey:")) {
    const id = Number(d.slice(8));
    const e = get("SELECT * FROM bank_exams WHERE id=?", id);
    if (!e) return "الامتحان غير موجود";
    const ci = chaptersList().findIndex((c) => c.slug === e.slug);
    tx(() => {
      for (const v of all("SELECT id FROM bank_versions WHERE exam_id=?", id)) deleteVersion(v.id);
      run("DELETE FROM bank_exams WHERE id=?", id);
    });
    logEdit(uid, `حذف امتحان ${e.title}`);
    await show(chapterView(ci));
  } else if (d.startsWith("a:exde:")) {
    const id = Number(d.slice(7));
    await show(["⚠️ متأكد تحذف هذا الامتحان بكل نسخه؟", [[btn("🗑 نعم، احذف", `a:exdey:${id}`)], [btn("↩️ لا", `a:exe:${id}`)]]]);
  }
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
  if (st === "a:exna") {
    if (!data.title) {
      if (!text) { await send(chat, "⚠️ اكتب عنوان الامتحان."); return true; }
      setSession(uid, st, { ...data, title: cut(text, 80) });
      await send(chat, "🕓 اكتب وقت الامتحان بالدقائق، مثل <code>75</code> لساعة وربع:");
      return true;
    }
    const n = Number(text);
    if (!Number.isInteger(n) || n < 5 || n > 600) { await send(chat, "⚠️ اكتب عدد الدقائق، مثل 75"); return true; }
    const ord = (get("SELECT IFNULL(MAX(ord),0) m FROM bank_exams WHERE slug=?", data.slug)!.m as number) + 1;
    const id = run("INSERT INTO bank_exams(slug, chapter, ord, title, info, minutes, manual) VALUES(?,?,?,?,?,?,1)", data.slug, data.chapter, ord, data.title, "", n);
    logEdit(uid, `امتحان جديد: ${data.title}`);
    setSession(uid, "", {});
    const [t, kb] = examView(id);
    await send(chat, "✅ انضاف الامتحان. هسه ضيف نسخة.\n\n" + t, { kb });
    return true;
  }
  if (st === "a:exnq") {
    if (data.step === "q") {
      if (!photo) { await send(chat, "⚠️ أرسل صورة السؤال."); return true; }
      setSession(uid, st, { ...data, step: "mark", file: "tg:" + photo });
      await send(chat, "🔢 كم درجة هذا السؤال؟ (رقم كامل)");
      return true;
    }
    if (data.step === "mark") {
      const n = Number(text);
      if (!text || !Number.isInteger(n) || n < 1 || n > 100) { await send(chat, "⚠️ اكتب رقم كامل من 1 إلى 100"); return true; }
      setSession(uid, st, { ...data, step: "answer", mark: n });
      await send(chat, "📘 أرسل صور الجواب النموذجي، وحدة أو أكثر، ولمن تخلص اكتب <code>تم</code>:");
      return true;
    }
    if (photo) {
      data.answers.push("tg:" + photo);
      setSession(uid, st, data);
      await send(chat, `✅ وصلت (${data.answers.length}). أرسل غيرها، أو اكتب <code>تم</code>.`);
      return true;
    }
    if (text !== "تم" || !data.answers.length) { await send(chat, "⚠️ أرسل صورة الجواب، أو اكتب تم بعد ما ترسلها."); return true; }
    const n = (get("SELECT IFNULL(MAX(n),0) m FROM bank_questions WHERE version_id=?", data.vid)!.m as number) + 1;
    run("INSERT INTO bank_questions(version_id, n, max_mark, q_file, a_files, edited) VALUES(?,?,?,?,?,1)", data.vid, n, data.mark, data.file, JSON.stringify(data.answers));
    logEdit(uid, `نسخة ${data.vid}: سؤال جديد ${n}`);
    setSession(uid, "", {});
    const [t, kb] = versionView(data.vid);
    await send(chat, `✅ انضاف س ${n}.\n\n` + t, { kb });
    return true;
  }
  if (st === "a:exu") {
    const doc = m.document;
    if (!doc?.file_id || !/\.pdf$/i.test(String(doc.file_name ?? ""))) { await send(chat, "⚠️ أرسل ملف PDF."); return true; }
    run(`UPDATE bank_versions SET ${data.lang === "ar" ? "pdf_ar" : "pdf_en"}=? WHERE id=?`, doc.file_id, data.id);
    logEdit(uid, `نسخة ${data.id}: رفع نسخة الطالب ${data.lang}`);
    setSession(uid, "", {});
    const [t, kb] = versionView(data.id);
    await send(chat, "✅ انحفظت نسخة الطالب.\n\n" + t, { kb });
    return true;
  }
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
