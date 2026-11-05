// لوحة التحكم: المنتجات، الطلبات، الطلاب، المراكز، الأسئلة، المساعدين
import { catIdFor, count, find, getSession, insert, kvGet, kvSet, modeFromName, one, put, remove, saveCurriculum, setSession, sumOf, tx, update, type Row } from "./db.ts";
import { BULK_HELP, DAYS, DAY_ORDER, DEFAULT_FEE, GOVS, GRADES, MODE_ICON, MODE_NEXT, PERMS, STORE_URL, orderReady, toLatinDigits } from "./config.ts";
import {
  allCats, can, cat, centerName, chapters, govMode, groupId, hoursText, isAdmin, newOrdersCount, orderItems, ordersByIds, placeOf, product, products, profileText, qHours, qWhere,
  searchStudents, setStudentView, staffAccount, staffName, staffRow, student, topics,
} from "./data.ts";
import { adminPageLink, chapterLabel, flowKb, mainKb, onlineOnly, posKb, regKb } from "./keyboards.ts";
import { listPdf, sendColorReceipt, sendOrdersPdf, sendPaperReceipt } from "./documents.ts";
import { EXAM_PERM, examBankCb } from "./examBank.ts";
import { readyExtras } from "./exams.ts";
import { officeDays, officeKb, officeView, libCb, libText, parseAmount } from "./office.ts";
import { sendCenterPdf } from "./centerApi.ts";
import { bulkAdd, parsePrice } from "./productApi.ts";
import { sendStudentsPdf, studentsStats } from "./studentApi.ts";
import { orderKb, orderText } from "./student.ts";
import { api, edit, send, type Kb } from "./telegram.ts";
import { btn, chunk, esc, money, num, stamp, todayStr, words } from "./util.ts";

type View = [string, Kb];

// ---------- القوائم
/** الطلبات المحددة تصير مطبوعة، والطالب يوصله إن طلبه تجهز. اللي الطالب ألغاها ترجع بـ gone */
export async function markPrinted(ids: number[]) {
  const rows = new Map((await ordersByIds(ids)).map((r) => [r.id as number, r] as const));
  const gone = ids.filter((i) => rows.get(i)?.printed === 2);
  const ready = ids.filter((i) => { const p = rows.get(i)?.printed; return rows.has(i) && (p === 0 || p === null); });
  await tx(async () => { for (const i of ready) await update("orders", { id: i }, { printed: 1 }); });
  for (const i of ready) {
    const student_id = rows.get(i)!.user_id;
    const cm = await kvGet(`ocmsg_${i}`);
    if (cm) {                       // نشيل رسالة زر الإلغاء من عند الطالب
      if (!await api("deleteMessage", { chat_id: student_id, message_id: Number(cm) })) {
        await api("editMessageReplyMarkup", { chat_id: student_id, message_id: Number(cm), reply_markup: { inline_keyboard: [] } });
      }
    }
    const extra = await readyExtras(i);
    await send(student_id, orderReady(i) + extra.text, extra.kb ? { kb: extra.kb } : {});
  }
  return { ready, gone };
}

export async function adminMenuFor(uid: number): Promise<View> {
  // اللوحة كلها صفحة وحدة. بدون رابط https ترجع شاشات الأزرار
  if (STORE_URL) return ["<b>⚙️ لوحة التحكم</b>", [[{ text: "⚙️ فتح لوحة التحكم", web_app: { url: adminPageLink("admin") } }]]];
  const kb: Kb = [];
  // صفحات كاملة داخل تليجرام. بدون رابط https ترجع شاشات الأزرار
  if (await can(uid, "products")) {
    if (STORE_URL) kb.push([{ text: "🛒 المنتجات والأقسام", web_app: { url: adminPageLink("products") } }], [{ text: "🚚 أسعار التوصيل", web_app: { url: adminPageLink("fees") } }]);
    else kb.push([btn("📥 إضافة منتجات دفعة وحدة", "a:bulk")], [btn("➕ إضافة منتج واحد", "a:add")], [btn("📋 المنتجات والأقسام", "a:list")], [btn("🚚 أسعار التوصيل", "a:fees")]);
    kb.push([btn("💻 فصول امتحانها إلكتروني فقط", "a:oo")]);
  }
  if (await can(uid, EXAM_PERM)) kb.push([STORE_URL ? { text: "📝 الامتحانات", web_app: { url: adminPageLink("exams") } } : btn("📝 الامتحانات", "a:ex")]);
  if (await can(uid, "orders")) {
    const n = await newOrdersCount();
    kb.push([btn("🖨 الطلبات الجديدة (للطباعة)" + (n ? `  🔴 ${n}` : ""), "a:pend")], [btn("🗂 الطلبات المطبوعة", "a:printed")],
      [btn("🏪 بيع بالمكتب", "a:pos")], [btn("📊 مبيعات المكتب", "a:of")]);
  }
  if (await can(uid, "students")) kb.push([btn("🎓 الطلاب", "a:st")], [btn("🏫 المراكز الامتحانية", "a:ce")]);
  if (await can(uid, "q")) {
    const n = await count("questions", { status: "open" });
    kb.push([btn(`❓ الأسئلة اللي تنتظر جواب (${n})`, "a:oq")]);
  }
  if (await isAdmin(uid)) {
    const sold = await find("orders", { printed: 3 }, { where: (o) => o.office_id !== null && String(o.created).startsWith(todayStr()) });
    const r = { n: sold.length, t: sumOf(sold, "total") };
    kb.push([btn(`🏬 المكتبات — اليوم: ${r.n} بيعة · ${money(r.t)}`, "a:lib")], [btn("⏰ أوقات استقبال الأسئلة", "a:hr")], [btn("📚 الفصول والمواضيع", "a:cur")],
      [btn("👥 المساعدين والصلاحيات", "a:sf")], [btn("🔗 ربط مجموعة الأسئلة", "a:grp")]);
  }
  kb.push([btn("👁 شوف كطالب", "a:asstudent")]);
  return ["<b>⚙️ لوحة التحكم</b>", kb];
}
async function adminCats(): Promise<View> {
  const cs = await allCats();
  const kb: Kb = cs.map((c) => [btn(`📂 ${c.name}  (${c.n})`, `a:lc:${c.id}`), btn("🗑", `a:dc:${c.id}`)]);
  kb.push([btn("⬅️ رجوع", "a:menu")]);
  return [cs.length ? "<b>📋 الأقسام</b>\nاضغط على القسم حتى تشوف منتجاته وتعدلها.\n🗑 يحذف القسم مع منتجاته." : "لا توجد أقسام بعد.", kb];
}
async function adminCat(cid: number): Promise<View> {
  const c = await cat(cid);
  if (!c) return await adminCats();
  const kb: Kb = (await products(cid)).map((p) => [btn(`✏️ ${p.name} — ${money(p.price)}`, `a:ep:${p.id}`),
    btn((MODE_ICON[p.mode || "both"] ?? "🔄").split(" ")[0], `a:pm:${p.id}`), btn("🗑", `a:del:${p.id}`)]);
  kb.push([btn("⬅️ رجوع للأقسام", "a:list")]);
  return [`<b>📂 ${esc(c.name)}</b>\n✏️ تعديل السعر   🗑 حذف\n🏫 حضوري / 💻 إلكتروني / 🔄 كليهما: اضغط الأيقونة حتى تغير نوع المنتج ` +
    "(طالب الحضوري يشوف 🏫 و 🔄، وطالب الإلكتروني يشوف 💻 و 🔄)", kb];
}
async function adminFees(): Promise<View> {
  const fees = Object.fromEntries((await find("fees")).map((r) => [r.gov, r.fee]));
  const kb = chunk(GOVS.map((g, i) => btn(`${g}: ${num(fees[g] ?? DEFAULT_FEE)}`, `a:fee:${i}`)), 2);
  kb.push([btn("💲 نفس السعر لكل المحافظات", "a:feeall")], [btn("⬅️ رجوع", "a:menu")]);
  return ["<b>🚚 أسعار التوصيل</b>\nاضغط على المحافظة حتى تغير سعرها:", kb];
}
const pendingOrders = async () => await find("orders", {}, { where: (o) => !o.printed, order: ["id"], limit: 60 });
function pendView(pend: Row[], sel: Set<number>): View {
  if (!pend.length) return ["✅ لا توجد طلبات جديدة. كل الطلبات مطبوعة.", [[btn("⬅️ رجوع", "a:menu")]]];
  const kb: Kb = pend.map((o) => [btn(`${sel.has(o.id) ? "☑️" : "⬜️"}  #${o.id}  ${words(o.name).slice(0, 2).join(" ")}  —  ${o.gov}  —  ${num(o.total)}`, `a:t:${o.id}`)]);
  kb.push([btn("☑️ تحديد الكل", "a:all"), btn("⬜️ إلغاء التحديد", "a:none")]);
  if (sel.size) kb.push([btn(`🖨 إنشاء PDF للمحدد (${sel.size})`, "a:pdf")]);
  kb.push([btn("⬅️ رجوع", "a:menu")]);
  return [`<b>🖨 الطلبات الجديدة (غير مطبوعة): ${pend.length}</b>\nاضغط على الطلبات حتى تحددها ☑️، بعدين اضغط «إنشاء PDF».`, kb];
}
const studentCardKb = (sid: number): Kb => [[btn("🏫 تغيير المركز الامتحاني", `a:sc:${sid}`)], [btn("🔄 تغيير نوع الامتحان", `a:se:${sid}`)],
  [btn("🎓 تغيير صفه بالمدرسة", `a:sg:${sid}`)], [btn("✏️ تعديل كل معلوماته (فورمة)", `a:sw:${sid}`)], [btn("🗑 حذف تسجيله (يسجل من جديد)", `a:sx:${sid}`)]];
const centersOf = async (aid: number): Promise<Row[]> => {
  const cs = await find("centers", { area_id: aid, active: 1 }, { order: ["id"] });
  return Promise.all(cs.map(async (c) => ({ ...c, n: await count("students", { center_id: c.id }) })));
};
async function centersOverview(): Promise<View> {
  const lines = ["<b>🏫 المراكز الامتحانية</b>", ""];
  const kb: Kb = [];
  for (const a of await find("areas", { active: 1 }, { order: ["gov", "id"] })) {
    const cs = await centersOf(a.id);
    lines.push(`📍 <b>${esc(a.name)}</b> (${esc(a.gov)}) — ${cs.reduce((s, x) => s + x.n, 0)} طالب`);
    for (const x of cs) lines.push(`    🏫 ${esc(x.name)}: <b>${x.n}</b> طالب`);
    kb.push([btn(`📍 ${a.name} (${a.gov})`, `a:ca:${a.id}`)]);
  }
  kb.push([btn("➕ منطقة جديدة", "a:na")], [btn("🗺 نوع الامتحان لكل محافظة", "a:gm")], [btn("⬅️ رجوع", "a:menu")]);
  return [lines.join("\n"), kb];
}
async function areaView(aid: number): Promise<View> {
  const a = (await one("areas", { id: aid }))!;
  const kb: Kb = (await centersOf(aid)).map((x) => [btn(`🏫 ${x.name} (${x.n} طالب)`, `a:cc:${x.id}`), btn("🗑", `a:cd:${x.id}`)]);
  kb.push([btn("➕ مركز جديد بهاي المنطقة", `a:nc2:${aid}`)], [btn("🗑 حذف المنطقة كلها", `a:cad:${aid}`)], [btn("⬅️ رجوع للمراكز", "a:ce")]);
  return [`<b>📍 ${esc(a.name)}</b> (${esc(a.gov)})\nاضغط على المركز حتى تطلع قائمة طلابه PDF.`, kb];
}
async function govmodeView(): Promise<View> {
  const modes = Object.fromEntries((await find("govmode")).map((r) => [r.gov, r.mode]));
  const kb = chunk(GOVS.map((g, i) => btn(`${g}: ${MODE_ICON[modes[g] ?? "online"]}`, `a:gm:${i}`)), 2);
  kb.push([btn("⬅️ رجوع", "a:ce")]);
  return ["<b>🗺 نوع الامتحان لكل محافظة</b>\nاضغط على المحافظة حتى تغيرها:\n🏫 حضوري بس — 💻 إلكتروني بس — 🔄 الطالب يختار", kb];
}
async function hoursView(): Promise<View> {
  const h = await qHours();
  const on = h.on !== false;
  const kb = chunk(DAY_ORDER.map((i) => btn((h.days.includes(i) ? "☑️ " : "⬜️ ") + DAYS[i], `a:hrd:${i}`)), 3);
  kb.push([btn("🕓 تغيير الوقت", "a:hrt")], [btn(on ? "🔴 إيقاف الاستقبال مؤقتاً" : "🟢 تشغيل الاستقبال", "a:hro")], [btn("⬅️ رجوع", "a:menu")]);
  return [`<b>⏰ أوقات استقبال الأسئلة</b> (${on ? "🟢 شغال" : "🔴 متوقف"})\n\n${hoursText(h)}\n\nاضغط الأيام حتى تأشرها.`, kb];
}
const curriculumText = async () => (await Promise.all((await chapters()).map(async (ch) => [`# ${ch.ar} | ${ch.en ?? ""}`, ...(await topics(ch.id)).map((t) => `${t.ar} | ${t.en ?? ""} = ${t.lectures}`)]))).flat().join("\n");
async function staffView(): Promise<View> {
  const rows = await find("staff", {}, { order: ["name"] });
  const kb: Kb = rows.map((s) => [btn("👤 " + s.name, `a:sfv:${s.user_id}`), btn("🗑", `a:sfd:${s.user_id}`)]);
  kb.push([btn("➕ إضافة مساعد", "a:sfa")], [btn("⬅️ رجوع", "a:menu")]);
  return [rows.length ? "<b>👥 المساعدين</b>\nاضغط على المساعد حتى تحدد صلاحياته." : "<b>👥 المساعدين</b>\nلا يوجد مساعدين بعد.", kb];
}
async function staffOne(sid: number): Promise<View> {
  const s = await staffRow(sid);
  if (!s) return await staffView();
  const ps = String(s.perms ?? "").split(",");
  const kb: Kb = Object.entries(PERMS).map(([k, v]) => [btn((ps.includes(k) ? "☑️ " : "⬜️ ") + v, `a:sfp:${sid}:${k}`)]);
  kb.push([btn("💰 حساب المبيعات والرصيد", `a:sfm:${sid}`)], [btn("⬅️ رجوع", "a:sf")]);
  return [`<b>👤 ${esc(s.name)}</b>\nاضغط حتى تنطيه الصلاحية أو تسحبها:`, kb];
}
async function staffAccountView(sid: number): Promise<View> {
  const a = await staffAccount(sid);
  const pays = await find("staff_pay", { staff_id: sid }, { order: ["-id"], limit: 8 });
  const s = await staffRow(sid) ?? { name: "مساعد" };
  const lines = [`<b>💰 حساب ${esc(s.name)}</b>`, "", `🎯 الرصيد المسموح: <b>${a.limit ? money(a.limit) : "بدون حد"}</b>`,
    `🛒 كل مبيعاته بالمكتب: <b>${money(a.sold)}</b>`, `✅ سلّمك: <b>${money(a.paid)}</b>`, `🔴 <b>باقي بذمته (لازم يسلمك): ${money(a.owed)}</b>`];
  if (a.limit) lines.push(`🟢 يگدر يبيع بعد بـ: <b>${money(Math.max(a.left, 0))}</b>`);
  if (pays.length) lines.push("", "<b>آخر الدفعات:</b>", ...pays.map((p) => `• ${p.created} — ${money(p.amount)}`));
  return [lines.join("\n"), [[btn("✅ سلّمني مبلغ (تسجيل دفعة)", `a:sfy:${sid}`)], [btn("🎯 تحديد الرصيد المسموح", `a:sfl:${sid}`)], [btn("⬅️ رجوع", `a:sfv:${sid}`)]]];
}
async function onlineOnlyView(): Promise<[string, Kb, string[]]> {
  const labels: string[] = [];
  for (const p of await products()) {
    const l = chapterLabel(p.name);
    if (l && !labels.includes(l)) labels.push(l);
  }
  const oo = await onlineOnly();
  const kb: Kb = labels.map((l, i) => [btn((oo.includes(l) ? "☑️ " : "⬜️ ") + l, `a:oo:${i}`)]);
  kb.push([btn("⬅️ رجوع", "a:menu")]);
  return ["<b>💻 فصول امتحانها إلكتروني فقط</b>\n\nأشّر ☑️ على الفصل اللي خلص امتحانه الحضوري.\n" +
    "طالب الحضوري راح يشوف منتجات <b>الإلكتروني</b> لهذا الفصل بدل الحضوري، ويطلعله تنبيه: «امتحانات هذا الفصل إلكترونية فقط».\n" +
    "(الفصل يتعرف من اسم المنتج، مثل «الفصل الأول»)", kb, labels];
}

// ---------- إدخال المنتجات
// ---------- الكتابة أثناء حالات a:*
export async function onAdminText(chat: number, uid: number, text: string, st: string, data: Row): Promise<boolean> {
  const view = ([t, kb]: View, prefix = "") => send(chat, prefix + t, { kb });
  if (st.startsWith("a:lib") && await isAdmin(uid)) return await libText(chat, uid, text, st, data);
  if ((st === "a:sfy" || st === "a:sfl") && await isAdmin(uid)) {
    const amt = parseAmount(text);
    if (amt === null || amt < 0) { await send(chat, "⚠️ اكتب رقم صحيح، مثال: <code>10000000</code> أو <code>10 مليون</code>"); return true; }
    const sid: number = data.sid;
    await setSession(uid, "", {});
    if (st === "a:sfy") {
      await insert("staff_pay", { staff_id: sid, amount: amt, created: stamp() });
      await send(sid, `✅ قصي العميري سجّل استلام <b>${money(amt)}</b> منك.\n🔴 باقي بذمتك: <b>${money((await staffAccount(sid)).owed)}</b>`);
      await send(chat, "✅ انسجلت الدفعة.", { replyKb: await mainKb(uid) });
    } else {
      await kvSet(`limit_${sid}`, String(amt));
      await send(chat, "✅ انحفظ الرصيد المسموح.", { replyKb: await mainKb(uid) });
    }
    await view(await staffAccountView(sid));
    return true;
  }
  if (st === "a:pos") {
    const res = await searchStudents(text);
    if (!res.length) { await send(chat, "ما لگيت طالب بهذا الاسم أو الرقم. اكتب مرة ثانية، أو الطالب لازم يسجل بالبوت أول."); return true; }
    await send(chat, "اختار الطالب 👇", { kb: res.map((x) => [btn(`👤 ${x.name} — ${x.phone1}`, `a:pss:${x.user_id}`)]) });
    return true;
  }
  if (st === "a:sts") {
    await setSession(uid, "", {});
    const res = await searchStudents(text);
    if (!res.length) { await send(chat, "ما لگيت طالب بهذا الاسم أو الرقم."); return true; }
    await send(chat, `نتائج البحث (${res.length}):\n👤 اضغط الاسم حتى تشوف معلوماته وتعدلها\n🗑 اضغط السلة حتى تحذف تسجيله`,
      { kb: res.map((s) => [btn(`👤 ${s.name} — ${s.phone1}`, `a:sv:${s.user_id}`), btn("🗑", `a:sx:${s.user_id}`)]) });
    return true;
  }
  if (st === "a:na2") {
    const aid = await insert("areas", { gov: data.gov, name: text.trim() });
    await setSession(uid, "a:nc3", { aid });
    await send(chat, "✅ انضافت المنطقة. هسه اكتب اسم أول مركز امتحاني بيها:");
    return true;
  }
  if (st === "a:nc3") {
    await insert("centers", { area_id: data.aid, name: text.trim() });
    await setSession(uid, "", {});
    await view(await areaView(data.aid), "✅ انضاف المركز.\n\n");
    return true;
  }
  if (st === "a:hrt") {
    const m = toLatinDigits(text).match(/^\s*(\d{1,2})(?::(\d{2}))?\s*[-–—إلى ]+\s*(\d{1,2})(?::(\d{2}))?\s*$/);
    if (!m) { await send(chat, "⚠️ اكتب الوقت هيچ: <code>16-22</code> أو <code>16:30-22:00</code>"); return true; }
    const p = (x: string | undefined) => String(Number(x ?? 0)).padStart(2, "0");
    const h = await qHours();
    h.from = `${p(m[1])}:${p(m[2])}`;
    h.to = `${p(m[3])}:${p(m[4])}`;
    await kvSet("q_hours", JSON.stringify(h));
    await setSession(uid, "", {});
    await view(await hoursView(), "✅ تم.\n\n");
    return true;
  }
  if (st === "a:cur") {
    const [n1, n2] = await saveCurriculum(text);
    await setSession(uid, "", {});
    await send(chat, n1 ? `✅ تم الحفظ: ${n1} فصول و ${n2} موضوع.` : "⚠️ ما فهمت النص، تأكد من الشكل.");
    return true;
  }
  if (st === "a:sfa") {
    const ids = toLatinDigits(text).match(/\d{5,}/g);
    if (!ids) { await send(chat, "⚠️ اكتب رقم حساب المساعد (أرقام فقط)."); return true; }
    await setSession(uid, "a:sfa2", { sid: Number(ids[0]) });
    await send(chat, "✍️ اكتب اسم المساعد:");
    return true;
  }
  if (st === "a:sfa2") {
    await put("staff", { user_id: data.sid, name: text.trim(), perms: "q" });
    await setSession(uid, "", {});
    await view(await staffOne(data.sid), "✅ انضاف المساعد، وصلاحيته هسه الأسئلة العلمية بس.\nلازم تضيفه هم لمجموعة الأسئلة حتى يگدر يجاوب.\n\n");
    await api("sendMessage", { chat_id: data.sid, text: "✅ تمت إضافتك مساعد بالبوت. اكتب /start" });
    return true;
  }
  if (st === "a:bulk") {
    const { added, bad } = await bulkAdd(text);
    await setSession(uid, "", {});
    let msg = `✅ تمت إضافة ${added.length} منتج.`;
    if (bad.length) msg += "\n\n⚠️ هاي السطور ما فهمتها، ما انضافت:\n" + bad.slice(0, 20).map((b) => "• " + esc(b)).join("\n");
    await send(chat, msg);
    await view(await adminCats());
    return true;
  }
  if (st === "a:newcat") {
    await setSession(uid, "a:add_name", { cat: await catIdFor(text) });
    await send(chat, "✍️ اكتب اسم المنتج:");
    return true;
  }
  if (st === "a:add_name") {
    data.new_name = text.trim();
    await setSession(uid, "a:add_price", data);
    await send(chat, `💰 اكتب سعر «${esc(text.trim())}» بالدينار (أرقام فقط):`);
    return true;
  }
  if (st === "a:add_price") {
    const pr = parsePrice(text);
    if (pr === null) { await send(chat, "⚠️ اكتب السعر أرقام فقط، مثل 15000"); return true; }
    await insert("products", { name: data.new_name, price: pr, cat_id: data.cat, mode: modeFromName(data.new_name) });
    await setSession(uid, "", {});
    await send(chat, `✅ تمت إضافة «${esc(data.new_name)}» بسعر ${money(pr)}`);
    await view(await adminCat(data.cat));
    return true;
  }
  if (st === "a:edit_price") {
    const pr = parsePrice(text);
    if (pr === null) { await send(chat, "⚠️ اكتب السعر أرقام فقط"); return true; }
    await update("products", { id: data.pid }, { price: pr });
    const cid = (await one("products", { id: data.pid }))!.cat_id;
    await setSession(uid, "", {});
    await send(chat, `✅ تم تعديل السعر إلى ${money(pr)}`);
    await view(await adminCat(cid));
    return true;
  }
  if (st === "a:fee") {
    const pr = parsePrice(text);
    if (pr === null) { await send(chat, "⚠️ اكتب السعر أرقام فقط"); return true; }
    await update("fees", data.gov === "*" ? {} : { gov: data.gov }, { fee: pr });
    await setSession(uid, "", {});
    await send(chat, "✅ تم تعديل سعر التوصيل.");
    await view(await adminFees());
    return true;
  }
  return false;
}

// ---------- الأزرار a:*
export async function onAdminCb(chat: number, uid: number, mid: number, d: string): Promise<string | null> {
  const sendV = ([t, kb]: View, prefix = "") => send(chat, prefix + t, { kb });
  const editV = ([t, kb]: View, prefix = "") => edit(chat, mid, prefix + t, kb);

  if (d.startsWith("a:ex")) return await examBankCb(chat, uid, mid, d);
  if (d === "a:asstudent") {
    await setStudentView(uid, true);
    await setSession(uid, "", {});
    await send(chat, "👁 <b>صرت تشوف البوت مثل الطالب.</b>\nكل الأزرار والرسائل مثله بالضبط. ولمن تخلص، اضغط زر الرجوع جوة.", { replyKb: await mainKb(uid) });
    return null;
  }
  if (d === "a:oo" || d.startsWith("a:oo:")) {
    const v = await onlineOnlyView();
    if (d.startsWith("a:oo:")) {
      const l = v[2][Number(d.slice(5))];
      const oo = new Set(await onlineOnly());
      if (oo.has(l)) oo.delete(l); else oo.add(l);
      await kvSet("online_only", JSON.stringify([...oo].sort()));
      const nv = await onlineOnlyView();
      await edit(chat, mid, nv[0], nv[1]);
    } else await send(chat, v[0], { kb: v[1] });
  } else if (d.startsWith("a:pm:")) {
    const pid = Number(d.slice(5));
    const p = await product(pid);
    if (p) {
      await update("products", { id: pid }, { mode: MODE_NEXT[p.mode || "both"] });
      await editV(await adminCat(p.cat_id));
    }
  } else if (d.startsWith("a:lc:")) await editV(await adminCat(Number(d.slice(5))));
  else if (d === "a:st") {
    const s = await studentsStats();
    await send(chat, `<b>🎓 الطلاب المسجلين: ${s.all}</b>\n\nالسادس العلمي: ${s.g6}\nالخامس العلمي: ${s.g5}\n\nحضوري: ${s.in}\nإلكتروني: ${s.on}\n\nالمنهج العربي: ${s.ar}\nالمنهج الإنجليزي: ${s.en}`,
      { kb: [[btn("🔍 بحث عن طالب (بالاسم أو الرقم)", "a:sts")], [btn("📄 قائمة طلاب الخامس العلمي PDF", "a:5th")], [btn("📄 قائمة كل الطلاب PDF", "a:stall")], [btn("⬅️ رجوع", "a:menu")]] });
  } else if (d === "a:sts") {
    await setSession(uid, "a:sts", {});
    await send(chat, "🔍 اكتب اسم الطالب (أو جزء منه) أو رقم هاتفه:");
  } else if (d === "a:5th" || d === "a:stall") {
    await sendStudentsPdf(chat, d === "a:5th");
  } else if (d.startsWith("a:sv:")) {
    const s = await student(Number(d.slice(5)));
    if (s) await send(chat, "<b>🎓 بطاقة الطالب</b>\n\n" + await profileText(s) + `\nمسجل من: ${s.created}`, { kb: studentCardKb(s.user_id) });
  } else if (d.startsWith("a:lib")) return await libCb(chat, uid, mid, d);
  else if (d === "a:pos") {
    await setSession(uid, "a:pos", {});
    await send(chat, "🏪 <b>بيع بالمكتب</b>\n🔍 اكتب اسم الطالب (أو جزء منه) أو رقم هاتفه:", { replyKb: flowKb() });
  } else if (d.startsWith("a:pss:")) {
    const sid = Number(d.slice(6));
    const s = await student(sid);
    if (s) {
      await setSession(uid, "a:posw", { sid });
      await send(chat, `👤 <b>${esc(s.name)}</b>\n👇 اضغط «🏪 افتح صفحة البيع» واختار المنتجات، وبعدين «✅ تم البيع».`, { replyKb: await posKb(sid) });
    }
  } else if (d === "a:of" || d.startsWith("a:of:")) {
    const day = d.startsWith("a:of:") ? d.slice(5) : todayStr();
    if (d.startsWith("a:of:") && mid) await edit(chat, mid, await officeView(day), officeKb(day));
    else await send(chat, await officeView(day), { kb: officeKb(day) });
  } else if (d === "a:ofd") await sendV(await officeDays());
  else if (d.startsWith("a:ofrc:")) { await sendColorReceipt(chat, Number(d.slice(7))); return "⏳"; }
  else if (d.startsWith("a:ofr:")) { await sendPaperReceipt(chat, Number(d.slice(6))); return "⏳"; }
  else if (d.startsWith("a:ofp:")) {
    const day = d.slice(6);
    const rows = await find("orders", { printed: 3 }, { where: (o) => String(o.created).startsWith(day), order: ["id"] });
    if (!rows.length) return "ما أكو مبيعات بهذا اليوم";
    const rowsOut = await Promise.all(rows.map(async (r) => [`#${r.id}`, r.created.slice(11), r.name, orderItems(r).map((i) => `${i.name} ×${i.qty}`).join("، "), num(r.total), await staffName(r.seller)]));
    await listPdf(chat, `مبيعات المكتب — ${day} — المجموع ${money(rows.reduce((s, r) => s + r.total, 0))}`, ["رقم", "الوقت", "الطالب", "المنتجات", "المبلغ", "البائع"], rowsOut, "office_" + day);
  } else if (d.startsWith("a:sw:")) {
    const sid = Number(d.slice(5));
    const s = await student(sid);
    if (s) {
      await setSession(uid, "a:sw", {});
      await send(chat, `✏️ تعديل معلومات <b>${esc(s.name)}</b>\n👇 اضغط «✏️ افتح فورمة الطالب»، عدّل اللي تريده، واضغط حفظ.`, { replyKb: await regKb(uid, sid) });
    }
  } else if (d.startsWith("a:sg:")) {
    const sid = Number(d.slice(5));
    const s = await student(sid);
    if (s) {
      const next = s.grade === GRADES[0] ? GRADES[1] : GRADES[0];
      await update("students", { user_id: sid }, { grade: next });
      await send(chat, `✅ صار صفه بالمدرسة: <b>${next}</b>`);
    }
  } else if (d.startsWith("a:sxy:")) {
    const sid = Number(d.slice(6));
    const s = await student(sid);
    await remove("students", { user_id: sid });
    await setSession(sid, "", {});
    await edit(chat, mid, `🗑 تم حذف تسجيل <b>${esc(s ? s.name : sid)}</b>.\nلمن يفتح البوت ويضغط /start يسجل من جديد.\n(طلباته وأسئلته القديمة باقية)`);
  } else if (d.startsWith("a:sx:")) {
    const sid = Number(d.slice(5));
    const s = await student(sid);
    if (s) {
      await send(chat, `⚠️ متأكد تريد تحذف تسجيل <b>${esc(s.name)}</b>؟\nراح يسجل من جديد ويختار كل شي من البداية (الصف ونوع الامتحان والمركز).`,
        { kb: [[btn("🗑 نعم، احذف", `a:sxy:${sid}`)], [btn("↩️ لا", `a:sv:${sid}`)]] });
    }
  } else if (d.startsWith("a:se:")) {
    const sid = Number(d.slice(5));
    const s = await student(sid);
    if (s) {
      const next = s.exam === "حضوري" ? "إلكتروني" : "حضوري";
      await update("students", { user_id: sid }, (r) => ({ exam: next, center_id: next === "إلكتروني" ? null : r.center_id }));
      if (next === "حضوري") {
        await send(chat, "تم تغييره إلى حضوري. هسه اختار مركزه 👇");
        return await onAdminCb(chat, uid, mid, `a:sc:${sid}`);
      }
      await send(chat, "✅ صار نوع امتحانه: إلكتروني.");
    }
  } else if (d.startsWith("a:scs:")) {
    const [, , sid, cid] = d.split(":");
    await update("students", { user_id: Number(sid) }, { center_id: Number(cid), exam: "حضوري" });
    await edit(chat, mid, `✅ تم تغيير المركز إلى: ${esc(await centerName(Number(cid)))}`);
    await api("sendMessage", { chat_id: Number(sid), parse_mode: "HTML", text: `ℹ️ تم تغيير مركزك الامتحاني إلى: <b>${esc(await centerName(Number(cid)))}</b>` });
  } else if (d.startsWith("a:sc:")) {
    const sid = Number(d.slice(5));
    const rows: Row[] = [];
    const cs = await find("centers", { active: 1 }, { order: ["id"] });
    for (const a of await find("areas", { active: 1 }, { order: ["gov", "id"] })) {
      for (const c of cs) if (c.area_id === a.id) rows.push({ id: c.id, cn: c.name, an: a.name });
    }
    await send(chat, "اختر المركز الجديد للطالب:", { kb: rows.map((r) => [btn(`🏫 ${r.cn} (${r.an})`, `a:scs:${sid}:${r.id}`)]) });
  } else if (d === "a:ce") await sendV(await centersOverview());
  else if (d.startsWith("a:cad:")) {
    const aid = Number(d.slice(6));
    await tx(async () => {
      await update("areas", { id: aid }, { active: 0 });
      await update("centers", { area_id: aid }, { active: 0 });
    });
    await editV(await centersOverview(), "🗑 انحذفت المنطقة.\n\n");
  } else if (d.startsWith("a:ca:")) await editV(await areaView(Number(d.slice(5))));
  else if (d.startsWith("a:cd:")) {
    const cid = Number(d.slice(5));
    const aid = (await one("centers", { id: cid }))!.area_id;
    await update("centers", { id: cid }, { active: 0 });
    await editV(await areaView(aid), "🗑 انحذف المركز (طلابه يبقون مسجلين عليه، غيّرهم من 🎓 الطلاب).\n\n");
  } else if (d.startsWith("a:cc:")) {
    await sendCenterPdf(chat, Number(d.slice(5)));
  } else if (d === "a:na") {
    await edit(chat, mid, "اختر محافظة المنطقة الجديدة:", chunk(GOVS.map((g, i) => btn(g, `a:nag:${i}`)), 3));
  } else if (d.startsWith("a:nag:")) {
    await setSession(uid, "a:na2", { gov: GOVS[Number(d.slice(6))] });
    await send(chat, "✍️ اكتب اسم المنطقة (مثل: المنصور):");
  } else if (d.startsWith("a:nc2:")) {
    await setSession(uid, "a:nc3", { aid: Number(d.slice(6)) });
    await send(chat, "✍️ اكتب اسم المركز الامتحاني:");
  } else if (d === "a:gm") await editV(await govmodeView());
  else if (d.startsWith("a:gm:")) {
    const g = GOVS[Number(d.slice(5))];
    await update("govmode", { gov: g }, { mode: MODE_NEXT[await govMode(g)] });
    await editV(await govmodeView());
  } else if (d === "a:oq") {
    const qs = await find("questions", { status: "open" }, { order: ["id"], limit: 30 });
    const g = await groupId();
    if (!qs.length) { await send(chat, "✅ ماكو أسئلة تنتظر جواب."); return null; }
    const base = g && String(g).startsWith("-100") ? `https://t.me/c/${String(g).slice(4)}/` : null;
    const lines = [`<b>❓ الأسئلة اللي تنتظر جواب: ${qs.length}</b>`, ""];
    for (const q of qs) {
      const s = await student(q.user_id) ?? { name: "—" };
      const link = base && q.thread_id ? `<a href="${base}${q.thread_id}">افتح</a>` : "";
      lines.push(`#${q.id} — ${esc(s.name)}\n${esc(await qWhere(q))}  ${link}`);
    }
    await send(chat, lines.join("\n\n"));
  } else if (d === "a:hr") await sendV(await hoursView());
  else if (d.startsWith("a:hrd:")) {
    const i = Number(d.slice(6));
    const h = await qHours();
    h.days = (h.days.includes(i) ? h.days.filter((x) => x !== i) : [...h.days, i]).sort((a, b) => a - b);
    await kvSet("q_hours", JSON.stringify(h));
    await editV(await hoursView());
  } else if (d === "a:hro") {
    const h = await qHours();
    h.on = h.on === false;
    await kvSet("q_hours", JSON.stringify(h));
    await editV(await hoursView());
  } else if (d === "a:hrt") {
    await setSession(uid, "a:hrt", {});
    await send(chat, "🕓 اكتب الوقت بنظام 24 ساعة، مثلاً:\n<code>16-22</code>  يعني من 4 العصر إلى 10 بالليل\n<code>9:30-23:00</code>");
  } else if (d === "a:cur") {
    await setSession(uid, "a:cur", {});
    await send(chat, "<b>📚 الفصول والمواضيع</b>\n\nهذا الموجود هسه. حتى تعدّل: انسخه، وعدّل عليه (أسماء، عدد محاضرات، ترتيب)، وأرسله برسالة وحدة.\n" +
      "• السطر اللي يبدي بـ # هو الفصل: الاسم العربي | الاسم الإنجليزي\n• تحته المواضيع: العربي | الإنجليزي = عدد المحاضرات");
    await send(chat, `<code>${esc(await curriculumText())}</code>`);
  } else if (d === "a:sf") await sendV(await staffView());
  else if (d.startsWith("a:sfm:")) await sendV(await staffAccountView(Number(d.slice(6))));
  else if (d.startsWith("a:sfy:")) {
    await setSession(uid, "a:sfy", { sid: Number(d.slice(6)) });
    await send(chat, "✅ اكتب المبلغ اللي سلمك إياه (أرقام بس)\nمثال: <code>10000000</code> أو <code>10 مليون</code>", { replyKb: flowKb() });
  } else if (d.startsWith("a:sfl:")) {
    await setSession(uid, "a:sfl", { sid: Number(d.slice(6)) });
    await send(chat, "🎯 اكتب الرصيد المسموح إله (أكثر مبلغ يگدر يبيع بيه قبل ما يسلمك)\nمثال: <code>20000000</code> أو <code>20 مليون</code>\nاكتب <code>0</code> إذا تريد بدون حد.", { replyKb: flowKb() });
  } else if (d.startsWith("a:sfv:")) await editV(await staffOne(Number(d.slice(6))));
  else if (d.startsWith("a:sfp:")) {
    const [, , sid, k] = d.split(":");
    const s = await staffRow(Number(sid));
    if (s) {
      const ps = new Set(String(s.perms ?? "").split(",").filter(Boolean));
      if (ps.has(k)) ps.delete(k); else ps.add(k);
      await update("staff", { user_id: Number(sid) }, { perms: [...ps].sort().join(",") });
    }
    await editV(await staffOne(Number(sid)));
  } else if (d.startsWith("a:sfd:")) {
    await remove("staff", { user_id: Number(d.slice(6)) });
    await editV(await staffView());
  } else if (d === "a:sfa") {
    await setSession(uid, "a:sfa", {});
    await send(chat, "➕ <b>إضافة مساعد</b>\n\n1) خلي المساعد يفتح البوت ويكتب <code>/myid</code>\n2) البوت ينطيه رقم حسابه، يرسلك ياه\n3) اكتب الرقم هنا 👇");
  } else if (d === "a:grp") {
    await send(chat, (await groupId() ? "✅ مجموعة الأسئلة مربوطة.\n\n" : "⚠️ مجموعة الأسئلة مو مربوطة بعد.\n\n") +
      "<b>طريقة الربط:</b>\n1) سوّي مجموعة تليجرام جديدة (مثلاً: أسئلة الطلاب).\n" +
      "2) من إعدادات المجموعة فعّل <b>Topics</b> (المواضيع).\n3) ضيف البوت للمجموعة وخليه <b>Admin</b> ويه صلاحية <b>Manage Topics</b>.\n" +
      "4) داخل المجموعة اكتب: <code>/setgroup</code>");
  } else if (d === "a:menu") await editV(await adminMenuFor(uid));
  else if (d === "a:bulk") {
    await setSession(uid, "a:bulk", {});
    await send(chat, BULK_HELP);
  } else if (d === "a:add") {
    await edit(chat, mid, "اختر قسم المنتج:", [...(await allCats()).map((c) => [btn("📂 " + c.name, `a:ac:${c.id}`)]), [btn("➕ قسم جديد", "a:nc")]]);
  } else if (d.startsWith("a:ac:")) {
    await setSession(uid, "a:add_name", { cat: Number(d.slice(5)) });
    await send(chat, "✍️ اكتب اسم المنتج:");
  } else if (d === "a:nc") {
    await setSession(uid, "a:newcat", {});
    await send(chat, "✍️ اكتب اسم القسم الجديد:");
  } else if (d === "a:list") await editV(await adminCats());
  else if (d.startsWith("a:dc2:")) {
    const cid = Number(d.slice(6));
    await tx(async () => {
      await update("cats", { id: cid }, { active: 0 });
      await update("products", { cat_id: cid }, { active: 0 });
    });
    await editV(await adminCats(), "🗑 تم حذف القسم.\n\n");
  } else if (d.startsWith("a:dc:")) {
    const c = await cat(Number(d.slice(5)));
    if (c) await edit(chat, mid, `هل تريد حذف قسم «${esc(c.name)}» مع كل منتجاته؟`, [[btn("نعم احذف", `a:dc2:${c.id}`), btn("لا", "a:list")]]);
  } else if (d.startsWith("a:ep:")) {
    const p = await product(Number(d.slice(5)));
    if (p) {
      await setSession(uid, "a:edit_price", { pid: p.id });
      await send(chat, `💰 اكتب السعر الجديد لـ «${esc(p.name)}» (الحالي ${money(p.price)}):`);
    }
  } else if (d.startsWith("a:del2:")) {
    const pid = Number(d.slice(7));
    await update("products", { id: pid }, { active: 0 });
    const cid = (await one("products", { id: pid }))!.cat_id;
    await editV(await adminCat(cid), "🗑 تم الحذف.\n\n");
  } else if (d.startsWith("a:del:")) {
    const p = await product(Number(d.slice(6)));
    if (p) await edit(chat, mid, `هل تريد حذف «${esc(p.name)}»؟`, [[btn("نعم احذف", `a:del2:${p.id}`), btn("لا", `a:lc:${p.cat_id}`)]]);
  } else if (d === "a:fees") await editV(await adminFees());
  else if (d.startsWith("a:fee:")) {
    const g = GOVS[Number(d.slice(6))];
    await setSession(uid, "a:fee", { gov: g });
    await send(chat, `🚚 اكتب سعر التوصيل لـ ${g}:`);
  } else if (d === "a:feeall") {
    await setSession(uid, "a:fee", { gov: "*" });
    await send(chat, "🚚 اكتب سعر التوصيل لكل المحافظات:");
  } else if (d === "a:pend" || d.startsWith("a:t:") || d === "a:all" || d === "a:none") {
    const { state: st, data } = await getSession(uid);
    let sel = new Set<number>(data.sel ?? []);
    const pend = await pendingOrders();
    const ids = pend.map((o) => o.id as number);
    if (d.startsWith("a:t:")) {
      const i = Number(d.slice(4));
      if (sel.has(i)) sel.delete(i); else sel.add(i);
    } else if (d === "a:all") sel = new Set(ids);
    else if (d === "a:none") sel = new Set();
    sel = new Set([...sel].filter((i) => ids.includes(i)));
    await setSession(uid, st.startsWith("a:") ? st : "", { ...data, sel: [...sel].sort((a, b) => a - b) });
    const [t, kb] = pendView(pend, sel);
    if (d === "a:pend") await send(chat, t, { kb });
    else await edit(chat, mid, t, kb);
  } else if (d === "a:pdf") {
    const { data } = await getSession(uid);
    const live = new Set((await pendingOrders()).map((o) => o.id));
    const sel: number[] = (data.sel ?? []).filter((i: number) => live.has(i));
    if (!sel.length) return "حدد طلب واحد على الأقل";
    await edit(chat, mid, `⏳ جاري تجهيز ملف PDF لـ ${sel.length} طلب...`);
    await sendOrdersPdf(chat, sel);
  } else if (d.startsWith("a:done:")) {
    const batch = await kvGet("batch_" + d.slice(7));
    const { ready, gone } = await markPrinted(batch ? batch.split(",").map(Number) : []);
    if (gone.length) await send(chat, `⚠️ <b>انتبه:</b> الطالب ألغى هالطلبات قبل التجهيز، <b>لا ترسلها</b>: ${gone.map((i) => "#" + i).join("، ")}`);
    const { data } = await getSession(uid);
    await setSession(uid, "", { ...data, sel: [] });
    await edit(chat, mid, `✅ تم. الطلبات (${ready.map((i) => "#" + i).join("، ")}) انتقلت للطلبات المطبوعة.`);
    const n = await newOrdersCount();
    await send(chat, n ? `🔔 باقي <b>${n}</b> طلبات جديدة.` : "✅ ما باقي طلبات جديدة.", { replyKb: await mainKb(uid) });
    await sendV(pendView(await pendingOrders(), new Set()));
  } else if (d === "a:keep") await edit(chat, mid, "تمام، الطلبات بقت بالطلبات الجديدة.");
  else if (d === "a:printed") {
    const os = await find("orders", { printed: 1 }, { order: ["-id"], limit: 20 });
    if (!os.length) { await send(chat, "لا توجد طلبات مطبوعة بعد."); return null; }
    await send(chat, "<b>🗂 آخر الطلبات المطبوعة</b>\nاضغط على الطلب حتى تشوفه، أو «إرجاع» حتى يرجع للطلبات الجديدة.",
      { kb: os.map((o) => [btn(`#${o.id}  ${words(o.name)[0]}  —  ${o.gov}`, `a:v:${o.id}`), btn("↩️ إرجاع", `a:un:${o.id}`)]) });
  } else if (d.startsWith("a:un:")) {
    await update("orders", { id: Number(d.slice(5)) }, { printed: 0 });
    return "رجع للطلبات الجديدة";
  } else if (d.startsWith("a:v:")) {
    const o = await one("orders", { id: Number(d.slice(4)) });
    if (o) await send(chat, orderText(o).replace("🆕 <b>طلب جديد", "<b>طلب"), { kb: orderKb(o) });
  }
  return null;
}
