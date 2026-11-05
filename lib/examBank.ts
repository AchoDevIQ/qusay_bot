// بنك الامتحانات: كل امتحان بنسخه وأسئلته وأجوبته المقصوصة، وتعديلها من الإدارة
// الملفات داخل data/content (ما تنرفع على GitHub)، وتنضاف بـ npm run load-exams
import path from "node:path";
import { count, find, insert, maxOf, one, remove, setSession, tx, update, type Row } from "./db.ts";
import { can } from "./data.ts";
import { files } from "./files.ts";
import { flowKb } from "./keyboards.ts";
import { api, edit, send, upload, type Kb } from "./telegram.ts";
import { btn, cut, esc, stamp } from "./util.ts";

export const EXAM_PERM = "exams";
const KIND_LABEL: Record<string, string> = { mandatory: "📌 إجباري", optional: "🎯 اختياري" };
const KIND_NEXT: Record<string, string> = { mandatory: "optional", optional: "mandatory" };

export async function deleteVersion(id: number) {
  await remove("bank_questions", { version_id: id });
  await remove("bank_versions", { id });
}

// ---------- الإدخال من catalog.json
/** يضيف فصل كامل. الأسئلة المعدلة من الإدارة ما تتغير إذا انعاد الإدخال */
export async function loadCatalog(catalog: Row) {
  return await tx(async () => {
    let versions = 0, questions = 0, needReview = 0;
    // الامتحانات والنسخ اللي انشالت من الملفات تنشال من البوت هم
    // جدول الكتاب انضاف بعناوينه قبل الملفات: إذا العناوين مميزة، كل امتحان ياخذ رقمه من الملفات حتى ما تتبدل ملفاته
    const titles = catalog.exams.map((e: Row) => e.title as string);
    if (new Set(titles).size === titles.length) {
      const rows = await find("bank_exams", { slug: catalog.slug });
      const moved = rows.filter((r) => { const ex = catalog.exams.find((e: Row) => e.title === r.title); return ex && ex.ord !== r.ord; });
      if (moved.length) {
        let spare = rows.reduce((m, r) => Math.max(m, r.ord), catalog.exams.length) + 1;
        // الزايد عن الملفات يتحرك من طريقها، مثل إعادة فاينل
        for (const r of rows) if (r.manual && !titles.includes(r.title) && r.ord <= catalog.exams.length) await update("bank_exams", { id: r.id }, { ord: spare++ });
        for (const r of moved) await update("bank_exams", { id: r.id }, { ord: spare++ });
        for (const r of moved) await update("bank_exams", { id: r.id }, { ord: catalog.exams.find((e: Row) => e.title === r.title).ord });
      }
    }
    const keepOrds = catalog.exams.map((e: Row) => e.ord as number);
    // (اللي انضاف من لوحة التحكم يبقى)
    for (const old of await find("bank_exams", { slug: catalog.slug })) {
      const ex = catalog.exams.find((e: Row) => e.ord === old.ord);
      const keepModels: string[] = ex ? ex.versions.map((v: Row) => v.model) : [];
      for (const v of await find("bank_versions", { exam_id: old.id })) {
        if (v.manual || keepModels.includes(v.model)) continue;
        await deleteVersion(v.id);
      }
      if (!old.manual && !keepOrds.includes(old.ord) && !await one("bank_versions", { exam_id: old.id })) await remove("bank_exams", { id: old.id });
    }
    for (const ex of catalog.exams) {
      const examFields = { chapter: catalog.chapter, title: ex.title, info: ex.info ?? "" };
      const oldExam = await one("bank_exams", { slug: catalog.slug, ord: ex.ord });
      if (oldExam) await update("bank_exams", { id: oldExam.id }, examFields);
      const examId: number = oldExam ? oldExam.id : await insert("bank_exams", { slug: catalog.slug, ord: ex.ord, minutes: ex.minutes, ...examFields });
      for (const v of ex.versions) {
        const versionFields = { ok: v.ok ? 1 : 0, issues: JSON.stringify(v.issues ?? []), has_en: v.has_en ? 1 : 0, ...(v.kind ? { kind: v.kind } : {}) };
        const oldVersion = await one("bank_versions", { exam_id: examId, model: v.model });
        if (oldVersion) await update("bank_versions", { id: oldVersion.id }, versionFields);
        const vid: number = oldVersion ? oldVersion.id : await insert("bank_versions", { exam_id: examId, model: v.model, ...versionFields });
        const oldQuestions = await find("bank_questions", { version_id: vid });
        const dir = path.posix.join(catalog.slug, `e${ex.ord}`, v.model);
        for (const q of v.questions) {
          const qFields = { max_mark: q.max, q_file: q.q ? path.posix.join(dir, q.q) : null, a_files: JSON.stringify((q.a ?? []).map((f: string) => path.posix.join(dir, f))) };
          const oldQ = oldQuestions.find((x) => x.n === q.n);
          if (!oldQ) await insert("bank_questions", { version_id: vid, n: q.n, ...qFields });
          else if (!oldQ.edited) await update("bank_questions", { id: oldQ.id }, qFields);
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
export async function logEdit(uid: number, what: string) {
  await insert("bank_edits", { user_id: uid, what, created: stamp() });
}
const fmtMinutes = (m: number) => {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}:${String(r).padStart(2, "0")} ساعة` : `${m} دقيقة`;
};

// ---------- الشاشات
async function chaptersList() {
  const seen = new Map<string, Row>();
  for (const e of await find("bank_exams", {}, { order: ["slug", "chapter"] })) seen.set(e.slug + "|" + e.chapter, { slug: e.slug, chapter: e.chapter });
  return [...seen.values()];
}
async function homeView(): Promise<[string, Kb]> {
  const chs = await chaptersList();
  if (!chs.length) return ["<b>📝 الامتحانات</b>\nماكو امتحانات مدخلة بعد.", [[btn("⬅️ رجوع", "a:menu")]]];
  return ["<b>📝 الامتحانات</b>\nاختر الفصل:", [...await Promise.all(chs.map(async (c, i) => {
    const n = await count("bank_exams", { slug: c.slug });
    return [btn(`📚 ${c.chapter} (${n} امتحان)`, `a:exh:${i}`)];
  })), [btn("⬅️ رجوع", "a:menu")]]];
}
async function chapterView(i: number): Promise<[string, Kb]> {
  const c = (await chaptersList())[i];
  if (!c) return await homeView();
  const versions = await find("bank_versions");
  const kb: Kb = (await find("bank_exams", { slug: c.slug })).sort((a, b) => (a.pos ?? a.ord) - (b.pos ?? b.ord)).map((e) => {
    const vs = versions.filter((v) => v.exam_id === e.id);
    return [btn(`${vs.some((v) => !v.ok) ? "⚠️ " : ""}${e.ord}) ${cut(`${e.title} ${lectureOf(e.info)}`, 40)} · ${vs.length} نسخ`, `a:exe:${e.id}`)];
  });
  kb.push([btn("➕ امتحان جديد", `a:exna:${i}`)], [btn("⬅️ رجوع", "a:ex")]);
  return [`<b>📚 ${esc(c.chapter)}</b>\n⚠️ يعني بيها نسخة ناقصة، وما تنعطى للطلاب لحد ما تتصلح.`, kb];
}
const lectureOf = (info: string) => /\(([\d\s&]+)\)/.exec(info ?? "")?.[0] ?? "";
async function examView(id: number): Promise<[string, Kb]> {
  const e = await one("bank_exams", { id });
  if (!e) return await homeView();
  const vs = await find("bank_versions", { exam_id: id }, { order: ["model"] });
  const count = (k: string) => vs.filter((v) => v.ok && v.kind === k).length;
  const kb: Kb = vs.map((v) => [btn(`${v.ok ? "" : "⚠️ "}${v.model} · ${KIND_LABEL[v.kind]}`, `a:exv:${v.id}`)]);
  kb.push([btn("➕ نسخة جديدة", `a:exnv:${id}`)]);
  kb.push([btn("🕓 تغيير وقت الامتحان", `a:exm:${id}`)]);
  kb.push([btn("🗑 حذف الامتحان كله", `a:exde:${id}`)]);
  const ci = (await chaptersList()).findIndex((c) => c.slug === e.slug);
  kb.push([btn("⬅️ رجوع", `a:exh:${ci}`)]);
  return [`<b>${esc(e.title)} ${esc(lectureOf(e.info))}</b>\n🕓 وقت الحل: <b>${fmtMinutes(e.minutes)}</b>\n📌 إجباري: ${count("mandatory")} · 🎯 اختياري: ${count("optional")}\n\nاضغط النسخة حتى تشوفها أو تعدلها.`, kb];
}
async function versionView(id: number): Promise<[string, Kb]> {
  const v = await one("bank_versions", { id });
  if (!v) return await homeView();
  const e = (await one("bank_exams", { id: v.exam_id }))!;
  const qs = await find("bank_questions", { version_id: id }, { order: ["n"] });
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
  const q = await one("bank_questions", { id });
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
  if (d === "a:ex") await show(await homeView());
  else if (d.startsWith("a:exh:")) await show(await chapterView(Number(d.slice(6))));
  else if (d.startsWith("a:exe:")) await show(await examView(Number(d.slice(6))));
  else if (d.startsWith("a:exv:")) await sendV(await versionView(Number(d.slice(6))));
  else if (d.startsWith("a:exk:")) {
    const id = Number(d.slice(6));
    const v = await one("bank_versions", { id });
    if (!v) return "النسخة غير موجودة";
    await update("bank_versions", { id }, { kind: KIND_NEXT[v.kind] });
    await logEdit(uid, `نسخة ${id}: ${KIND_LABEL[KIND_NEXT[v.kind]]}`);
    await show(await versionView(id));
  } else if (d.startsWith("a:exo:")) {
    const id = Number(d.slice(6));
    const v = await one("bank_versions", { id });
    if (!v) return "النسخة غير موجودة";
    if (!v.ok && !await one("bank_questions", { version_id: id })) return "ضيف سؤال واحد على الأقل";
    await update("bank_versions", { id }, { ok: v.ok ? 0 : 1, issues: v.ok ? JSON.stringify(["موقوفة من الإدارة"]) : "[]" });
    await logEdit(uid, `نسخة ${id}: ${v.ok ? "إيقاف" : "جاهزة"}`);
    await show(await versionView(id));
  } else if (d.startsWith("a:exp:")) {
    const [id, lang] = d.slice(6).split(":");
    const v = await one("bank_versions", { id: Number(id) });
    const e = v && await one("bank_exams", { id: v.exam_id });
    if (!v || !e || (lang !== "ar" && lang !== "en")) return "النسخة غير موجودة";
    const uploaded: string | null = v["pdf_" + lang];
    if (uploaded && !uploaded.startsWith("uploads/")) { await api("sendDocument", { chat_id: chat, document: uploaded, caption: `${e.title} · نسخة ${v.model}`, protect_content: true }); return null; }
    const body = await files().read(uploaded ?? path.posix.join(versionDir(e, v), `student_${lang}.pdf`));
    if (!body) return "الملف مفقود من السيرفر";
    await upload("sendDocument", { chat_id: String(chat), caption: `${e.title} · نسخة ${v.model}`, protect_content: "true" }, "document", body, `${v.model}_${lang}.pdf`, "application/pdf");
  } else if (d.startsWith("a:exm:")) {
    await setSession(uid, "a:exm", { id: Number(d.slice(6)) });
    await send(chat, "🕓 اكتب وقت هذا الامتحان بالدقائق، مثل <code>75</code> لساعة وربع:", { replyKb: flowKb() });
  } else if (d.startsWith("a:exqm:")) {
    await setSession(uid, "a:exqm", { id: Number(d.slice(7)) });
    await send(chat, "🔢 اكتب درجة هذا السؤال (رقم كامل):", { replyKb: flowKb() });
  } else if (d.startsWith("a:exqi:")) {
    await setSession(uid, "a:exqi", { id: Number(d.slice(7)) });
    await send(chat, "🖼 أرسل الصورة الجديدة للسؤال:", { replyKb: flowKb() });
  } else if (d.startsWith("a:exqa:")) {
    await setSession(uid, "a:exqa", { id: Number(d.slice(7)), files: [] });
    await send(chat, "📘 أرسل صور الجواب الجديد، وحدة أو أكثر، ولمن تخلص اكتب <code>تم</code>:", { replyKb: flowKb() });
  } else if (d.startsWith("a:exq:")) await questionView(chat, Number(d.slice(6)));
  else if (d.startsWith("a:exna:")) {
    const c = (await chaptersList())[Number(d.slice(7))];
    if (!c) return "الفصل غير موجود";
    await setSession(uid, "a:exna", { slug: c.slug, chapter: c.chapter });
    await send(chat, "✍️ اكتب عنوان الامتحان، مثل: <code>ديموافر المحاضرة (6)</code>", { replyKb: flowKb() });
  } else if (d.startsWith("a:exnv:")) {
    const examId = Number(d.slice(7));
    const models = (await find("bank_versions", { exam_id: examId })).map((v) => v.model as string);
    const model = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").find((x) => !models.includes(x));
    if (!model) return "ماكو حرف باقي";
    const vid = await insert("bank_versions", { exam_id: examId, model, ok: 0, issues: JSON.stringify(["لسه تنضاف أسئلتها"]), manual: 1 });
    await logEdit(uid, `امتحان ${examId}: نسخة جديدة ${model}`);
    await sendV(await versionView(vid));
  } else if (d.startsWith("a:exnq:")) {
    await setSession(uid, "a:exnq", { vid: Number(d.slice(7)), step: "q", answers: [] });
    await send(chat, "🖼 أرسل <b>صورة السؤال</b> بالعربي، لأنها اللي تطلع للمصحح:", { replyKb: flowKb() });
  } else if (d.startsWith("a:exu:")) {
    const [id, lang] = d.slice(6).split(":");
    await setSession(uid, "a:exu", { id: Number(id), lang });
    await send(chat, `⬆️ أرسل ملف PDF لنسخة الطالب ${lang === "ar" ? "العربية" : "الإنجليزية"}:`, { replyKb: flowKb() });
  } else if (d.startsWith("a:exqdy:")) {
    const q = await one("bank_questions", { id: Number(d.slice(8)) });
    if (!q) return "السؤال غير موجود";
    await tx(async () => {
      await remove("bank_questions", { id: q.id });
      await update("bank_questions", { version_id: q.version_id }, (r) => ({ n: r.n - 1 }), { where: (r) => r.n > q.n });   // الأرقام تبقى متسلسلة
    });
    await logEdit(uid, `نسخة ${q.version_id}: حذف س ${q.n}`);
    await show(await versionView(q.version_id));
  } else if (d.startsWith("a:exqd:")) {
    const id = Number(d.slice(7));
    await show([`⚠️ متأكد تحذف هذا السؤال؟`, [[btn("🗑 نعم، احذف", `a:exqdy:${id}`)], [btn("↩️ لا", `a:exq:${id}`)]]]);
  } else if (d.startsWith("a:exvdy:")) {
    const v = await one("bank_versions", { id: Number(d.slice(8)) });
    if (!v) return "النسخة غير موجودة";
    await tx(async () => await deleteVersion(v.id));
    await logEdit(uid, `امتحان ${v.exam_id}: حذف نسخة ${v.model}`);
    await show(await examView(v.exam_id));
  } else if (d.startsWith("a:exvd:")) {
    const id = Number(d.slice(7));
    await show(["⚠️ متأكد تحذف هاي النسخة بكل أسئلتها؟", [[btn("🗑 نعم، احذف", `a:exvdy:${id}`)], [btn("↩️ لا", `a:exv:${id}`)]]]);
  } else if (d.startsWith("a:exdey:")) {
    const id = Number(d.slice(8));
    const e = await one("bank_exams", { id });
    if (!e) return "الامتحان غير موجود";
    const ci = (await chaptersList()).findIndex((c) => c.slug === e.slug);
    await tx(async () => {
      for (const v of await find("bank_versions", { exam_id: id })) await deleteVersion(v.id);
      await remove("bank_exams", { id });
    });
    await logEdit(uid, `حذف امتحان ${e.title}`);
    await show(await chapterView(ci));
  } else if (d.startsWith("a:exde:")) {
    const id = Number(d.slice(7));
    await show(["⚠️ متأكد تحذف هذا الامتحان بكل نسخه؟", [[btn("🗑 نعم، احذف", `a:exdey:${id}`)], [btn("↩️ لا", `a:exe:${id}`)]]]);
  }
  return null;
}

// ---------- الكتابة والصور أثناء التعديل
/** يرجع true إذا عالج الرسالة */
export async function examBankMessage(chat: number, uid: number, m: Row, st: string, data: Row) {
  if (!await can(uid, EXAM_PERM)) return false;
  const text = String(m.text ?? "").trim();
  const photo: string | undefined = m.photo?.at?.(-1)?.file_id;
  const done = async (id: number) => {
    await setSession(uid, "", {});
    await send(chat, "✅ انحفظ التعديل. يشمل بس اللي بعد ما امتحن هذا الامتحان.");
    await questionView(chat, id);
  };
  if (st === "a:exna") {
    if (!data.title) {
      if (!text) { await send(chat, "⚠️ اكتب عنوان الامتحان."); return true; }
      await setSession(uid, st, { ...data, title: cut(text, 80) });
      await send(chat, "🕓 اكتب وقت الامتحان بالدقائق، مثل <code>75</code> لساعة وربع:");
      return true;
    }
    const n = Number(text);
    if (!Number.isInteger(n) || n < 5 || n > 600) { await send(chat, "⚠️ اكتب عدد الدقائق، مثل 75"); return true; }
    const ord = maxOf(await find("bank_exams", { slug: data.slug }), "ord") + 1;
    const id = await insert("bank_exams", { slug: data.slug, chapter: data.chapter, ord, title: data.title, info: "", minutes: n, manual: 1 });
    await logEdit(uid, `امتحان جديد: ${data.title}`);
    await setSession(uid, "", {});
    const [t, kb] = await examView(id);
    await send(chat, "✅ انضاف الامتحان. هسه ضيف نسخة.\n\n" + t, { kb });
    return true;
  }
  if (st === "a:exnq") {
    if (data.step === "q") {
      if (!photo) { await send(chat, "⚠️ أرسل صورة السؤال."); return true; }
      await setSession(uid, st, { ...data, step: "mark", file: "tg:" + photo });
      await send(chat, "🔢 كم درجة هذا السؤال؟ (رقم كامل)");
      return true;
    }
    if (data.step === "mark") {
      const n = Number(text);
      if (!text || !Number.isInteger(n) || n < 1 || n > 100) { await send(chat, "⚠️ اكتب رقم كامل من 1 إلى 100"); return true; }
      await setSession(uid, st, { ...data, step: "answer", mark: n });
      await send(chat, "📘 أرسل صور الجواب النموذجي، وحدة أو أكثر، ولمن تخلص اكتب <code>تم</code>:");
      return true;
    }
    if (photo) {
      data.answers.push("tg:" + photo);
      await setSession(uid, st, data);
      await send(chat, `✅ وصلت (${data.answers.length}). أرسل غيرها، أو اكتب <code>تم</code>.`);
      return true;
    }
    if (text !== "تم" || !data.answers.length) { await send(chat, "⚠️ أرسل صورة الجواب، أو اكتب تم بعد ما ترسلها."); return true; }
    const n = maxOf(await find("bank_questions", { version_id: data.vid }), "n") + 1;
    await insert("bank_questions", { version_id: data.vid, n, max_mark: data.mark, q_file: data.file, a_files: JSON.stringify(data.answers), edited: 1 });
    await logEdit(uid, `نسخة ${data.vid}: سؤال جديد ${n}`);
    await setSession(uid, "", {});
    const [t, kb] = await versionView(data.vid);
    await send(chat, `✅ انضاف س ${n}.\n\n` + t, { kb });
    return true;
  }
  if (st === "a:exu") {
    const doc = m.document;
    if (!doc?.file_id || !/\.pdf$/i.test(String(doc.file_name ?? ""))) { await send(chat, "⚠️ أرسل ملف PDF."); return true; }
    await update("bank_versions", { id: data.id }, { [data.lang === "ar" ? "pdf_ar" : "pdf_en"]: doc.file_id });
    await logEdit(uid, `نسخة ${data.id}: رفع نسخة الطالب ${data.lang}`);
    await setSession(uid, "", {});
    const [t, kb] = await versionView(data.id);
    await send(chat, "✅ انحفظت نسخة الطالب.\n\n" + t, { kb });
    return true;
  }
  if (st === "a:exm") {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 5 || n > 600) { await send(chat, "⚠️ اكتب عدد الدقائق، مثل 75"); return true; }
    await update("bank_exams", { id: data.id }, { minutes: n });
    await logEdit(uid, `امتحان ${data.id}: الوقت ${n} دقيقة`);
    await setSession(uid, "", {});
    const [t, kb] = await examView(data.id);
    await send(chat, t, { kb });
    return true;
  }
  if (st === "a:exqm") {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 0 || n > 100) { await send(chat, "⚠️ اكتب رقم كامل من 0 إلى 100"); return true; }
    await update("bank_questions", { id: data.id }, { max_mark: n, edited: 1 });
    await logEdit(uid, `سؤال ${data.id}: الدرجة ${n}`);
    await done(data.id);
    return true;
  }
  if (st === "a:exqi") {
    if (!photo) { await send(chat, "⚠️ أرسل صورة."); return true; }
    await update("bank_questions", { id: data.id }, { q_file: "tg:" + photo, edited: 1 });
    await logEdit(uid, `سؤال ${data.id}: صورة جديدة`);
    await done(data.id);
    return true;
  }
  if (st === "a:exqa") {
    if (photo) {
      data.files.push("tg:" + photo);
      await setSession(uid, st, data);
      await send(chat, `✅ وصلت (${data.files.length}). أرسل غيرها، أو اكتب <code>تم</code>.`);
      return true;
    }
    if (text !== "تم" || !data.files.length) { await send(chat, "⚠️ أرسل صورة الجواب، أو اكتب تم بعد ما ترسلها."); return true; }
    await update("bank_questions", { id: data.id }, { a_files: JSON.stringify(data.files), edited: 1 });
    await logEdit(uid, `سؤال ${data.id}: جواب جديد`);
    await done(data.id);
    return true;
  }
  return false;
}
