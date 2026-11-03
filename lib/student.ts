// واجهة الطالب: التسجيل، المتجر، الطلبات
import { all, get, getSession, kvSet, run, setSession, type Row } from "./db.ts";
import {
  AGREE_TIMES, AR_WORD, BANNER, BTN_ME, BTN_OPEN, BTN_REG, BTN_SHOP, CURRS, EXAMS, GOVS, GRADES, NO_REFUND, SIDES, STORE_URL, SUCCESS, successText,
} from "./config.ts";
import {
  can, cat, cats, centerAreas, centerName, checkPhone, feeOf, govMode, newOrdersCount, orderItems, placeOf, product, products, profileText, staffIds, student,
} from "./data.ts";
import { flowKb, govKb, mainKb, regKb, storeKb } from "./keyboards.ts";
import { sendProfileCard } from "./documents.ts";
import { edit, send, sendImage, type Kb } from "./telegram.ts";
import { btn, esc, money, num, stamp, toInt, cut, words } from "./util.ts";
import { askStart } from "./questions.ts";

export const sendBanner = (chat: number, caption: string, replyKb: unknown) => sendImage(chat, BANNER, "banner", caption, replyKb);

const validName = (name: string) => { const w = words(name); return w.length >= 4 && w.every((x) => AR_WORD.test(x)); };
const CONFIRM_KB = (edit = "✏️ تعديل المنتجات"): Kb => [[btn("✅ نعم، أوافق وأؤكد الطلب", "confirm")], [btn(edit, "editcart"), btn("❌ إلغاء", "cancel")]];

// ---------- السلة (إذا ماكو STORE_URL تشتغل بأزرار البوت)
function cleanCart(cart: Row = {}) {
  const ids = new Set(products().map((p) => String(p.id)));
  return Object.fromEntries(Object.entries(cart).filter(([k, v]) => ids.has(k) && Number(v) > 0)) as Record<string, number>;
}
function cartLines(cart: Record<string, number>) {
  const lines: string[] = [];
  let total = 0;
  for (const [pid, q] of Object.entries(cart)) {
    const p = product(Number(pid));
    if (p) { lines.push(`• ${esc(p.name)} × ${q} = ${money(q * p.price)}`); total += q * p.price; }
  }
  return lines.length ? ["", "<b>🛒 سلتك:</b>", ...lines, `<b>مجموع المنتجات: ${money(total)}</b>`] : [];
}
const cartButtons = (cart: Record<string, number>): Kb =>
  Object.keys(cart).length ? [[btn("✅ إكمال الطلب", "checkout"), btn("🗑 تفريغ السلة", "clear")]] : [];
function homeView(cart: Record<string, number>): [string, Kb] {
  const cs = cats();
  if (!cs.length) return ["لا توجد منتجات حاليا.", [[btn("🔄 تحديث", "home")]]];
  const text = ["<b>🛍 أقسام المتجر</b>", "", "اختر القسم:", ...cartLines(cart)].join("\n");
  return [text, [...cs.map((c) => [btn(`📂 ${c.name}  (${c.n})`, `cat:${c.id}`)]), ...cartButtons(cart)]];
}
function catView(cid: number, cart: Record<string, number>): [string, Kb] {
  const c = cat(cid);
  const ps = c ? products(cid) : [];
  if (!ps.length) return homeView(cart);
  const lines = [`<b>📂 ${esc(c!.name)}</b>`, "", ...ps.map((p, i) => `${i + 1}) ${esc(p.name)} — <b>${money(p.price)}</b>`), "", "اضغط على المنتج حتى تضيفه للسلة ➕"];
  const kb: Kb = ps.map((p) => {
    const q = cart[String(p.id)] ?? 0;
    return q ? [btn(`✅ ${p.name} × ${q}`, `add:${p.id}`), btn("➖", `sub:${p.id}`)] : [btn(`➕ ${p.name} — ${money(p.price)}`, `add:${p.id}`)];
  });
  kb.push([btn("⬅️ رجوع للأقسام", "home")]);
  return [[...lines, ...cartLines(cart)].join("\n"), [...kb, ...cartButtons(cart)]];
}

// ---------- فتح المتجر
const agreeKb = (): Kb => [[btn("✅ موافق", "agree")]];
/** بعد الموافقة الثالثة: يفتح المتجر */
async function afterAgree(chat: number, uid: number, data: Row) {
  if (STORE_URL) {
    setSession(uid, "store", data);
    await send(chat, `🛍 اضغط زر <b>«${BTN_OPEN}»</b> اللي جوه الشاشة 👇\nتنفتح لك صفحة المتجر: اختار المنتجات واملي معلوماتك.`, { replyKb: storeKb(uid) });
  } else {
    setSession(uid, "cart", data);
    const [t, kb] = homeView(cleanCart(data.cart));
    await send(chat, t, { kb });
  }
}
export async function openShop(chat: number, uid: number) {
  if (!student(uid)) {
    await send(chat, "حتى تطلب من المتجر، سجّل معلوماتك أول مرة 👇");
    await startReg(chat, uid, "shop");
    return;
  }
  const { data } = getSession(uid);
  data.cart = cleanCart(data.cart);
  if ((data.agreed ?? 0) < AGREE_TIMES) {
    data.agreed = 0;
    setSession(uid, "agree", data);
    await send(chat, NO_REFUND, { kb: agreeKb() });
    return;
  }
  await afterAgree(chat, uid, data);
}

function summary(data: Row) {
  const cart = cleanCart(data.cart);
  const lines = ["<b>🧾 ملخص طلبك</b>", "", "<b>المنتجات:</b>"];
  let sub = 0;
  const items: Row[] = [];
  for (const [pid, q] of Object.entries(cart)) {
    const p = product(Number(pid));
    if (!p) continue;
    lines.push(`• ${esc(p.name)} × ${q} — ${money(q * p.price)}`);
    sub += q * p.price;
    items.push({ name: p.name, qty: q, price: p.price });
  }
  const fee = feeOf(data.gov);
  const place = data.gov + (data.side ? " - " + data.side : "");
  lines.push("", `مجموع المنتجات: ${money(sub)}`, `سعر التوصيل (${esc(data.gov)}): ${money(fee)}`, `<b>💰 المبلغ الكلي المطلوب: ${money(sub + fee)}</b>`, "",
    "<b>معلوماتك:</b>", `الاسم: ${esc(data.name)}`, `المنهج: ${esc(data.curr ?? "")}`, `المحافظة: ${esc(place)}`, `المنطقة: ${esc(data.area)}`,
    `الهاتف 1: ${esc(data.phone1)}`, `الهاتف 2: ${esc(data.phone2)}`, "", "⚠️ جميع المشتريات غير قابلة للإرجاع إطلاقاً ولأي سبب كان.", "",
    `هل توافق على المبلغ الكلي <b>${money(sub + fee)}</b> وتأكيد الطلب؟`);
  return { text: lines.join("\n"), items, sub, fee };
}

export async function onStudentText(chat: number, uid: number, text: string, st: string, data: Row) {
  if (st === "name") {
    if (!validName(text)) { await send(chat, "⚠️ اكتب اسمك <b>الرباعي</b> (أربع كلمات على الأقل) <b>بالحروف العربية فقط</b>."); return; }
    data.name = words(text).join(" ");
    setSession(uid, "curr", data);
    await send(chat, "📘 اختر منهجك:", { kb: [CURRS.map((c, i) => btn("📗 " + c, `curr:${i}`))] });
  } else if (st === "store") {
    await send(chat, `اضغط زر «${BTN_OPEN}» اللي جوه الشاشة 👇`, { replyKb: storeKb(uid) });
  } else if (["gov", "side", "agree", "curr"].includes(st)) {
    await send(chat, "⚠️ اضغط على الأزرار فوق 👆");
  } else if (st === "area") {
    if (text.length < 2) { await send(chat, "⚠️ اكتب اسم المنطقة."); return; }
    data.area = text;
    setSession(uid, "phone1", data);
    await send(chat, "📞 اكتب رقم الهاتف الأول <b>بالإنجليزي</b>\nمثال: <code>07701234567</code>");
  } else if (st === "phone1") {
    const [ph, err] = checkPhone(text);
    if (err) { await send(chat, err); return; }
    data.phone1 = ph;
    setSession(uid, "phone2", data);
    await send(chat, "📞 اكتب رقم الهاتف الثاني <b>بالإنجليزي</b> (لازم يختلف عن الأول)");
  } else if (st === "phone2") {
    const [ph, err] = checkPhone(text);
    if (err) { await send(chat, err); return; }
    if (ph === data.phone1) { await send(chat, "⚠️ الرقم الثاني لازم يختلف عن الأول."); return; }
    data.phone2 = ph;
    setSession(uid, "confirm", data);
    const s = summary(data);
    if (!s.items.length) {
      setSession(uid, "", {});
      await send(chat, "سلتك فارغة، ارجع للمتجر واختر منتجات.", { replyKb: mainKb(uid) });
      return;
    }
    await send(chat, s.text, { kb: CONFIRM_KB() });
  } else if (st === "confirm") {
    await send(chat, "⚠️ اضغط على أحد الأزرار: تأكيد أو تعديل أو إلغاء 👆");
  } else if (st === "cart") {
    await send(chat, "اختر المنتجات من الأزرار فوق 👆 ثم اضغط «إكمال الطلب».");
  } else {
    await send(chat, `أهلا بك 🌷 اضغط «${BTN_SHOP}» حتى تشوف المنتجات.`, { replyKb: mainKb(uid) });
  }
}

/** الطالب يلغي طلبه قبل ما يتجهز (printed: 0 جديد، 1 تجهز/انطبع، 2 ملغي) */
export async function orderCancelCb(chat: number, uid: number, mid: number, d: string): Promise<string | null> {
  const oid = Number(d.split(":")[1]);
  const o = get("SELECT * FROM orders WHERE id=? AND user_id=?", oid, uid);
  if (!o) return "الطلب غير موجود";
  const p = o.printed ?? 0;
  if (p === 2) { await edit(chat, mid, `❌ الطلب #${oid} ملغي.`); return null; }
  if (p === 1) {
    await edit(chat, mid, `📦 الطلب #${oid} تجهز وانسلم لمندوب التوصيل، فما يمكن إلغاؤه.`);
    return "ما يمكن إلغاؤه، الطلب تجهز";
  }
  if (d.startsWith("oc:")) {
    await edit(chat, mid, `⚠️ متأكد تريد تلغي الطلب <b>#${oid}</b>؟`, [[btn("✅ نعم، ألغِ الطلب", `ocy:${oid}`)], [btn("↩️ لا، خليه", `ocn:${oid}`)]]);
  } else if (d.startsWith("ocn:")) {
    await edit(chat, mid, `تمام، طلبك #${oid} باقي ✅\n↩️ تگدر تلغيه <b>لحد ما توصلك رسالة «تم تجهيز طلبك»</b>.`, [[btn(`❌ إلغاء الطلب #${oid}`, `oc:${oid}`)]]);
  } else if (d.startsWith("ocy:")) {
    run("UPDATE orders SET printed=2 WHERE id=? AND IFNULL(printed,0)=0", oid);
    await edit(chat, mid, `❌ تم إلغاء طلبك <b>#${oid}</b>.\nتگدر تطلب من جديد بأي وقت من 🛒 المتجر.`);
    const n = newOrdersCount();
    for (const a of staffIds("orders")) {
      await send(a, `❌ <b>الطالب ${esc(o.name)} ألغى الطلب #${oid}</b>\nلا تجهزه. 🔔 الطلبات الجديدة: <b>${n}</b>`, { replyKb: mainKb(a) });
    }
  }
  return null;
}

export async function onStudentCb(chat: number, uid: number, mid: number, d: string, st: string, data: Row, user: Row): Promise<string | null> {
  let cart: Record<string, number> = data.cart ?? {};
  if (d === "agree") {
    if (st !== "agree") return "انتهت صلاحية هذا الزر";
    data.agreed = (data.agreed ?? 0) + 1;
    await edit(chat, mid, NO_REFUND + "\n\n✅ <b>تمت الموافقة</b>");
    if (data.agreed < AGREE_TIMES) {
      setSession(uid, "agree", data);
      await send(chat, NO_REFUND, { kb: agreeKb() });
    } else await afterAgree(chat, uid, data);
    return null;
  }
  if (st === "agree") return "اضغط موافق أولا";
  if (d === "home" || d.startsWith("cat:") || d.startsWith("add:") || d.startsWith("sub:") || d === "clear") {
    if ((data.agreed ?? 0) < AGREE_TIMES) return "اضغط «المتجر» من جديد";
    let viewCat: number | null = null;
    if (d.startsWith("cat:")) viewCat = Number(d.slice(4));
    else if (d.startsWith("add:") || d.startsWith("sub:")) {
      const pid = d.slice(4);
      const p = product(Number(pid));
      if (p) {
        viewCat = p.cat_id;
        cart[pid] = (cart[pid] ?? 0) + (d.startsWith("add:") ? 1 : -1);
      }
    } else if (d === "clear") {
      cart = {};
      viewCat = data.view ?? null;
    }
    cart = cleanCart(cart);
    data.cart = cart; data.view = viewCat;
    setSession(uid, "cart", data);
    const [t, kb] = viewCat ? catView(viewCat, cart) : homeView(cart);
    await edit(chat, mid, t, kb);
  } else if (d === "checkout") {
    cart = cleanCart(cart);
    if (!Object.keys(cart).length) return "السلة فارغة";
    data.cart = cart;
    const sp = student(uid) ?? {};
    Object.assign(data, { name: sp.name ?? "", curr: sp.curr ?? "", gov: sp.gov ?? "بغداد", side: sp.side ?? "", area: sp.area ?? "", phone1: sp.phone1 ?? "", phone2: sp.phone2 ?? "" });
    setSession(uid, "confirm", data);
    await edit(chat, mid, ["<b>🛒 طلبك</b>", ...cartLines(cart).slice(2)].join("\n"));
    await send(chat, summary(data).text, { kb: CONFIRM_KB() });
  } else if (d.startsWith("curr:") && st === "curr") {
    data.curr = CURRS[Number(d.slice(5))];
    setSession(uid, "gov", data);
    await edit(chat, mid, `📘 المنهج: <b>${data.curr}</b>`);
    await send(chat, "📍 اختر محافظتك:", { kb: govKb() });
  } else if (d.startsWith("gov:") && st === "gov") {
    const g = GOVS[Number(d.slice(4))];
    data.gov = g;
    delete data.side;
    if (g === "بغداد") {
      setSession(uid, "side", data);
      await edit(chat, mid, "📍 المحافظة: <b>بغداد</b>\nاختر الجانب:", [SIDES.map((s, i) => btn(s, `side:${i}`))]);
    } else {
      setSession(uid, "area", data);
      await edit(chat, mid, `📍 المحافظة: <b>${esc(g)}</b>`);
      await send(chat, "🏘 اكتب اسم المنطقة:");
    }
  } else if (d.startsWith("side:") && st === "side") {
    data.side = SIDES[Number(d.slice(5))];
    setSession(uid, "area", data);
    await edit(chat, mid, `📍 المحافظة: <b>بغداد - ${data.side}</b>`);
    await send(chat, "🏘 اكتب اسم المنطقة:");
  } else if (d === "confirm" && st === "confirm") {
    const s = summary(data);
    if (!s.items.length) return "سلتك فارغة";
    await edit(chat, mid, s.text.slice(0, s.text.lastIndexOf("\n\n")) + "\n\n✅ <b>تم التأكيد</b>");
    await finalize(chat, uid, data, s.items, s.sub, s.fee, user);
  } else if (d === "editcart" && st === "confirm") {
    data.cart = cleanCart(cart);
    if (STORE_URL) {
      setSession(uid, "store", data);
      await send(chat, `اضغط «${BTN_OPEN}» حتى تعدل طلبك 👇`, { replyKb: storeKb(uid) });
    } else {
      setSession(uid, "cart", data);
      const [t, kb] = homeView(data.cart);
      await edit(chat, mid, t, kb);
    }
  } else if (d === "cancel") {
    setSession(uid, "", {});
    await edit(chat, mid, "❌ تم إلغاء الطلب.");
    await send(chat, "تقدر تطلب من جديد بأي وقت.", { replyKb: mainKb(uid) });
  } else return "انتهت صلاحية هذا الزر";
  return null;
}

async function finalize(chat: number, uid: number, data: Row, items: Row[], sub: number, fee: number, user: Row) {
  const oid = run(`INSERT INTO orders(user_id, username, name, curr, gov, side, area, phone1, phone2, items, subtotal, fee, total, created)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, uid, user.username ?? "", data.name, data.curr ?? "", data.gov, data.side ?? "", data.area,
  data.phone1, data.phone2, JSON.stringify(items), sub, fee, sub + fee, stamp());
  setSession(uid, "", {});
  await sendImage(chat, SUCCESS, "success", successText(oid), mainKb(uid));
  const r: any = await send(chat, "↩️ إذا غيرت رأيك، تگدر تلغي الطلب من هذا الزر <b>لحد ما توصلك رسالة «تم تجهيز طلبك»</b>.\n" +
    "بعد ما تتجهز، ما يمكن إلغاؤه.", { kb: [[btn(`❌ إلغاء الطلب #${oid}`, `oc:${oid}`)]] });
  if (r) kvSet(`ocmsg_${oid}`, String(r.message_id ?? ""));
  await notifyAdmins(oid);
}

/** الطلب اللي يجي من صفحة المتجر */
export async function onStoreOrder(chat: number, uid: number, raw: string, user: Row) {
  const { data } = getSession(uid);
  if ((data.agreed ?? 0) < AGREE_TIMES) { await openShop(chat, uid); return; }
  let o: any;
  try { o = JSON.parse(raw); if (typeof o !== "object" || !o) throw new Error("bad"); }
  catch { await send(chat, "⚠️ صار خطأ، افتح المتجر من جديد.", { replyKb: storeKb(uid) }); return; }
  const reg = student(uid);
  // المسجل: معلوماته المحفوظة هي اللي تنحسب (مقفولة). أرقام الهاتف يگدر يغيرها لهذا الطلب بس
  if (reg) Object.assign(o, { n: reg.name, cu: reg.curr, g: reg.gov, s: reg.side || "", a: reg.area });
  const errs: string[] = [];
  const name = words(o.n).join(" ");
  if (!validName(name)) errs.push("الاسم لازم يكون رباعي وبالحروف العربية فقط");
  const cu = CURRS.includes(o.cu) ? o.cu : null;
  if (!cu) errs.push("اختر المنهج");
  const g = GOVS.includes(o.g) ? o.g : null;
  if (!g) errs.push("اختر المحافظة");
  const sd = SIDES.includes(o.s) ? o.s : "";
  if (g === "بغداد" && !sd) errs.push("اختر الرصافة أو الكرخ");
  const area = String(o.a ?? "").trim();
  if (area.length < 2) errs.push("اكتب المنطقة");
  const [p1, e1] = checkPhone(String(o.p1 ?? ""));
  const [p2, e2] = checkPhone(String(o.p2 ?? ""));
  if (e1 || e2 || p1 === p2) errs.push("أرقام الهاتف لازم تكون بالإنجليزي، 11 رقم، ومختلفة");
  const cart: Record<string, number> = {};
  let missing = false;
  for (const it of Array.isArray(o.i) ? o.i : []) {
    const pid = toInt(it?.[0]), q = toInt(it?.[1]);
    if (pid === null || q === null || q <= 0) continue;
    if (product(pid)) cart[String(pid)] = Math.min(q, 50);
    else missing = true;
  }
  if (!Object.keys(cart).length) errs.push("اختر منتج واحد على الأقل");
  if (missing) errs.push("بعض المنتجات تغيرت أو انحذفت");
  if (errs.length) {
    setSession(uid, "store", data);
    await send(chat, "⚠️ ما اكتمل الطلب:\n" + errs.map((e) => "• " + e).join("\n") + `\n\nاضغط «${BTN_OPEN}» وصحح المعلومات 👇`, { replyKb: storeKb(uid) });
    return;
  }
  Object.assign(data, { cart, name, curr: cu, gov: g, area, phone1: p1, phone2: p2 });
  if (sd) data.side = sd; else delete data.side;
  const s = summary(data);
  if (s.sub + s.fee !== o.t) {
    // الأسعار تغيرت بعد ما فتح الصفحة: نعرض الملخص الجديد حتى يوافق
    setSession(uid, "confirm", data);
    await send(chat, "ℹ️ تحدثت بعض الأسعار، هذا طلبك بالأسعار الجديدة:\n\n" + s.text, { kb: CONFIRM_KB("✏️ تعديل") });
    return;
  }
  await finalize(chat, uid, data, s.items, s.sub, s.fee, user);
}

// ---------- إشعار الإدارة بالطلب
export function orderText(o: Row) {
  const user = o.username ? "@" + o.username : `<a href="tg://user?id=${o.user_id}">حساب الطالب</a>`;
  return [`🆕 <b>طلب جديد #${o.id}</b>  (${o.created})`, "",
    `الاسم: ${esc(o.name)}`, `المنهج: ${esc(o.curr ?? "")}`, `المحافظة: ${esc(placeOf(o))}`, `المنطقة: ${esc(o.area)}`,
    `الهاتف 1: <code>${o.phone1}</code>`, `الهاتف 2: <code>${o.phone2}</code>`, `التليجرام: ${user}`, "", "<b>المنتجات:</b>",
    ...orderItems(o).map((it) => `• ${esc(it.name)} × ${it.qty} — ${money(it.qty * it.price)}`),
    "", `مجموع المنتجات: ${money(o.subtotal)}`, `التوصيل: ${money(o.fee)}`, `<b>المبلغ الكلي: ${money(o.total)}</b>`].join("\n");
}
/** زر نسخ: يضغطه وينسخ القيمة */
const cbtn = (label: string, value: unknown) => ({ text: "📋 " + label, copy_text: { text: cut(String(value), 256) } });
export function orderKb(o: Row): Kb {
  const items = orderItems(o).map((it) => `${it.name} × ${it.qty}`).join("، ");
  return [[cbtn("الاسم", o.name), cbtn("المنهج", o.curr ?? "")], [cbtn("المحافظة", placeOf(o)), cbtn("المنطقة", o.area)],
    [cbtn("الهاتف 1", o.phone1), cbtn("الهاتف 2", o.phone2)], [cbtn("المنتجات", items), cbtn("المبلغ الكلي", num(o.total))]];
}
async function notifyAdmins(oid: number) {
  const o = get("SELECT * FROM orders WHERE id=?", oid)!;
  const n = newOrdersCount();
  for (const a of staffIds("orders")) {
    await send(a, orderText(o), { kb: orderKb(o) });
    await send(a, `🔔 الطلبات الجديدة اللي تنتظر الطباعة: <b>${n}</b>`, { replyKb: mainKb(a) });
  }
}

// ---------- التسجيل
async function afterReg(chat: number, uid: number, nxt: unknown) {
  if (nxt === "shop") await openShop(chat, uid);
  else if (nxt === "ask") await askStart(chat, uid);
}
export async function startReg(chat: number, uid: number, nxt: string | null, editMode = false) {
  const old = editMode ? student(uid) : null;
  if (!STORE_URL) return startRegChat(chat, uid, nxt, editMode);
  setSession(uid, "r:form", { next: nxt, edit: !!old });
  await send(chat, "📝 <b>التسجيل</b> (مرة وحدة بس، وبعدها معلوماتك تطلع تلقائياً بالمتجر والأسئلة)" +
    "\n⚠️ بعد الحفظ ما تگدر تغير معلوماتك إلا عن طريق الإدارة، فاكتبها صح." +
    `\n\n👇 اضغط زر «${BTN_REG}» اللي جوة، واملأ الفورمة، وبعدين اضغط «حفظ معلوماتي».`, { replyKb: regKb(uid) });
}

/** المعلومات اللي تجي من فورمة التسجيل */
export async function onRegForm(chat: number, uid: number, o: any, user: Row) {
  const { state: st, data } = getSession(uid);
  let target = uid, byAdmin = false;
  if (o.adm) {
    const t = toInt(o.adm);
    if (t === null) return;
    target = t;
    if (!can(uid, "students") || !student(target)) { await send(chat, "⚠️ ما عندك صلاحية.", { replyKb: mainKb(uid) }); return; }
    byAdmin = true;
  }
  const old = student(target);
  if (old && !byAdmin) {
    setSession(uid, "", {});
    await send(chat, "🔒 معلوماتك محفوظة ومقفولة. لتغيير أي معلومة تواصل ويا قصي العميري.", { replyKb: mainKb(uid) });
    return;
  }
  const errs: string[] = [];
  const name = words(o.n).join(" ");
  if (!validName(name)) errs.push("الاسم لازم يكون رباعي وبالحروف العربية فقط");
  const cu = CURRS.includes(o.cu) ? o.cu : null;
  const gr = GRADES.includes(o.gr) ? o.gr : null;
  const g = GOVS.includes(o.g) ? o.g : null;
  if (!cu) errs.push("اختر المنهج");
  if (!gr) errs.push("اختر الصف");
  if (!g) errs.push("اختر المحافظة");
  let sd = SIDES.includes(o.s) ? o.s : "";
  if (g === "بغداد" && !sd) errs.push("اختر الرصافة أو الكرخ");
  if (g !== "بغداد") sd = "";
  const area = String(o.a ?? "").trim();
  if (area.length < 3) errs.push("اكتب العنوان بالتفصيل");
  const [p1, e1] = checkPhone(String(o.p1 ?? ""));
  const [p2, e2] = checkPhone(String(o.p2 ?? ""));
  if (e1 || e2 || p1 === p2) errs.push("أرقام الهاتف لازم تكون بالإنجليزي، 11 رقم، ومختلفة");
  const mode = g ? govMode(g) : "online";
  const picked = EXAMS.includes(o.e) ? o.e : null;
  const exam = byAdmin ? picked : mode === "online" ? "إلكتروني" : mode === "in" ? "حضوري" : picked; // الإدارة تختار بحرية
  let cid: number | null = null;
  if (!exam) errs.push("اختر نوع الامتحان");
  else if (exam === "حضوري" && g && centerAreas(g).length) {
    cid = toInt(o.c || 0) ?? 0;
    if (!cid || !centerName(cid)) { errs.push("اختر المركز الامتحاني"); cid = null; }
  }
  if (errs.length) {
    await send(chat, "⚠️ ما انحفظت المعلومات:\n" + errs.map((e) => "• " + e).join("\n") + "\n\nافتح الفورمة مرة ثانية وصحح 👇",
      { replyKb: regKb(uid, byAdmin ? target : null) });
    return;
  }
  const r: Row = { name, curr: cu, grade: gr, gov: g, side: sd, area, phone1: p1, phone2: p2, exam, center_id: cid };
  saveStudent(target, byAdmin ? old!.username : user.username ?? "", r, old);
  if (byAdmin) {
    setSession(uid, "", {});
    await send(chat, "✅ <b>تم تعديل معلومات الطالب</b>\n\n" + profileText(r), { replyKb: mainKb(uid) });
    return;
  }
  const nxt = st.startsWith("r:") ? data.next : null;
  setSession(uid, "", {});
  await sendProfileCard(chat, r, "✅ تم حفظ معلوماتك", `✅ <b>تم الحفظ بنجاح</b>\nتگدر تشوف معلوماتك بأي وقت من زر «${BTN_ME}».`, mainKb(uid));
  await afterReg(chat, uid, nxt);
}
function saveStudent(uid: number, username: string, r: Row, old: Row | null) {
  run(`INSERT OR REPLACE INTO students(user_id, username, name, curr, grade, gov, side, area, phone1, phone2, exam,
    center_id, created, updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, uid, username, r.name, r.curr, r.grade, r.gov, r.side ?? "", r.area,
  r.phone1, r.phone2, r.exam, r.center_id ?? null, old ? old.created : stamp(), stamp());
}

// التسجيل بالمحادثة (إذا ماكو STORE_URL)
async function startRegChat(chat: number, uid: number, nxt: string | null, editMode = false) {
  const old = editMode ? student(uid) : null;
  setSession(uid, "r:name", { next: nxt, reg: {}, edit: !!old });
  const head = old ? "✏️ <b>تعديل معلوماتك</b>" : "📝 <b>التسجيل</b> (مرة وحدة بس، وبعدها معلوماتك تطلع تلقائياً بالمتجر والأسئلة)";
  await send(chat, head + "\n\n✍️ اكتب اسمك <b>الرباعي بالعربي</b>:", { replyKb: flowKb() });
}
async function regAskExam(chat: number, uid: number, data: Row) {
  const r = data.reg;
  if (data.edit) {
    const old = student(uid);
    if (old?.exam) { r.exam = old.exam; r.center_id = old.center_id; return regConfirm(chat, uid, data); }
  }
  const mode = govMode(r.gov);
  if (mode === "online") { r.exam = "إلكتروني"; r.center_id = null; return regConfirm(chat, uid, data); }
  if (mode === "in") { r.exam = "حضوري"; return regAskArea(chat, uid, data); }
  setSession(uid, "r:exam", data);
  await send(chat, "📝 نوع الامتحان:", { kb: [[btn("🏫 حضوري", "rx:0"), btn("💻 إلكتروني", "rx:1")]] });
}
async function regAskArea(chat: number, uid: number, data: Row) {
  const areas = centerAreas(data.reg.gov);
  if (!areas.length) { data.reg.center_id = null; return regConfirm(chat, uid, data); }
  setSession(uid, "r:carea", data);
  await send(chat, "🏫 اختر <b>منطقة</b> المركز الامتحاني:", {
    kb: areas.map((a) => [btn("📍 " + a.name + (a.gov === data.reg.gov ? "" : ` (${a.gov})`), `ra:${a.id}`)]),
  });
}
async function regConfirm(chat: number, uid: number, data: Row) {
  setSession(uid, "r:confirm", data);
  await send(chat, "<b>📋 راجع معلوماتك</b>\n\n" + profileText(data.reg) + "\n\n⚠️ المركز الامتحاني ونوع الامتحان ما تگدر تغيرهم بعدين إلا عن طريق الإدارة.",
    { kb: [[btn("✅ حفظ", "rs:ok")], [btn("✏️ إعادة من البداية", "rs:again")]] });
}
export async function regText(chat: number, uid: number, text: string, st: string, data: Row) {
  const r = (data.reg ??= {});
  if (st === "r:name") {
    if (!validName(text)) { await send(chat, "⚠️ اكتب اسمك <b>الرباعي</b> (أربع كلمات على الأقل) <b>بالحروف العربية فقط</b>."); return; }
    r.name = words(text).join(" ");
    setSession(uid, "r:curr", data);
    await send(chat, "📘 اختر منهجك:", { kb: [CURRS.map((c, i) => btn("📗 " + c, `rc:${i}`))] });
  } else if (st === "r:area") {
    if (text.length < 3) { await send(chat, "⚠️ اكتب العنوان بالتفصيل (المنطقة، المحلة، أقرب نقطة دالة)."); return; }
    r.area = text;
    setSession(uid, "r:p1", data);
    await send(chat, "📞 اكتب رقم الهاتف الأول <b>بالإنجليزي</b>\nمثال: <code>07701234567</code>");
  } else if (st === "r:p1") {
    const [ph, err] = checkPhone(text);
    if (err) { await send(chat, err); return; }
    r.phone1 = ph;
    setSession(uid, "r:p2", data);
    await send(chat, "📞 اكتب رقم الهاتف الثاني <b>بالإنجليزي</b> (لازم يختلف عن الأول)");
  } else if (st === "r:p2") {
    const [ph, err] = checkPhone(text);
    if (err) { await send(chat, err); return; }
    if (ph === r.phone1) { await send(chat, "⚠️ الرقم الثاني لازم يختلف عن الأول."); return; }
    r.phone2 = ph;
    await regAskExam(chat, uid, data);
  } else await send(chat, "⚠️ اضغط على الأزرار فوق 👆");
}
export async function regCb(chat: number, uid: number, mid: number, d: string, st: string, data: Row, user: Row): Promise<string | null> {
  const r = (data.reg ??= {});
  const askAddress = () => send(chat, "🏘 اكتب عنوانك بالتفصيل (المنطقة، المحلة، أقرب نقطة دالة):");
  if (d.startsWith("rc:") && st === "r:curr") {
    r.curr = CURRS[Number(d.slice(3))];
    setSession(uid, "r:grade", data);
    await edit(chat, mid, `📘 المنهج: <b>${r.curr}</b>`);
    await send(chat, "🎓 إنت هذه السنة طالب بالمدرسة بأي صف؟\n(حتى لو تدرس ويانا مادة السادس)", { kb: GRADES.map((g, i) => [btn(g, `rg:${i}`)]) });
  } else if (d.startsWith("rg:") && st === "r:grade") {
    r.grade = GRADES[Number(d.slice(3))];
    setSession(uid, "r:gov", data);
    await edit(chat, mid, `🎓 صفك بالمدرسة: <b>${r.grade}</b>`);
    await send(chat, "📍 اختر محافظتك:", { kb: govKb("rv:") });
  } else if (d.startsWith("rv:") && st === "r:gov") {
    r.gov = GOVS[Number(d.slice(3))];
    delete r.side;
    if (r.gov === "بغداد") {
      setSession(uid, "r:side", data);
      await edit(chat, mid, "📍 المحافظة: <b>بغداد</b>\nاختر الجانب:", [SIDES.map((s, i) => btn(s, `rd:${i}`))]);
    } else {
      setSession(uid, "r:area", data);
      await edit(chat, mid, `📍 المحافظة: <b>${esc(r.gov)}</b>`);
      await askAddress();
    }
  } else if (d.startsWith("rd:") && st === "r:side") {
    r.side = SIDES[Number(d.slice(3))];
    setSession(uid, "r:area", data);
    await edit(chat, mid, `📍 المحافظة: <b>بغداد - ${r.side}</b>`);
    await askAddress();
  } else if (d.startsWith("rx:") && st === "r:exam") {
    r.exam = EXAMS[Number(d.slice(3))];
    await edit(chat, mid, `📝 الامتحان: <b>${r.exam}</b>`);
    if (r.exam === "حضوري") await regAskArea(chat, uid, data);
    else { r.center_id = null; await regConfirm(chat, uid, data); }
  } else if (d.startsWith("ra:") && st === "r:carea") {
    const aid = Number(d.slice(3));
    const a = get("SELECT * FROM areas WHERE id=?", aid);
    const cs = all("SELECT * FROM centers WHERE area_id=? AND active=1 ORDER BY id", aid);
    if (!a || !cs.length) return "اختر منطقة ثانية";
    setSession(uid, "r:center", data);
    await edit(chat, mid, `🏫 المنطقة: <b>${esc(a.name)}</b>\nاختر المركز الامتحاني:`,
      [...cs.map((x) => [btn("🏫 " + x.name, `rn:${x.id}`)]), [btn("⬅️ رجوع للمناطق", "rb:area")]]);
  } else if (d === "rb:area" && st === "r:center") {
    await edit(chat, mid, "⬅️");
    await regAskArea(chat, uid, data);
  } else if (d.startsWith("rn:") && st === "r:center") {
    r.center_id = Number(d.slice(3));
    await edit(chat, mid, `🏫 المركز: <b>${esc(centerName(r.center_id))}</b>`);
    await regConfirm(chat, uid, data);
  } else if (d === "rs:ok" && st === "r:confirm") {
    if (!["name", "curr", "grade", "gov", "area", "phone1", "phone2", "exam"].every((k) => r[k])) return "المعلومات ناقصة، أعد التسجيل";
    saveStudent(uid, user.username ?? "", r, student(uid));
    await edit(chat, mid, "<b>📋 معلوماتك</b>\n\n" + profileText(r) + "\n\n✅ <b>تم الحفظ</b>");
    const nxt = data.next;
    setSession(uid, "", {});
    await send(chat, `✅ تم تسجيلك بنجاح. تگدر تعدل معلوماتك بأي وقت من زر «${BTN_ME}».`, { replyKb: mainKb(uid) });
    await afterReg(chat, uid, nxt);
  } else if (d === "rs:again") {
    await edit(chat, mid, "↩️ نعيد التسجيل.");
    await startReg(chat, uid, data.next, data.edit ?? false);
  } else return "انتهت صلاحية هذا الزر";
  return null;
}

export async function showMe(chat: number, uid: number) {
  const s = student(uid);
  if (!s) { await startReg(chat, uid, null); return; }
  await sendProfileCard(chat, s, "👤 معلوماتك", "🔒 لتغيير أي معلومة تواصل ويا قصي العميري.", mainKb(chat));
}
