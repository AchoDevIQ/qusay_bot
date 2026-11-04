// البيع بالمكتب والمكتبات (نقاط البيع). printed: 0 طلب توصيل جديد، 1 تجهز، 2 ملغي، 3 بيع بالمكتب
import { randomInt } from "node:crypto";
import { all, get, kvGet, kvSet, run, setSession, tx, type Row } from "./db.ts";
import { ADMIN_IDS, BTN_OFFICE, toLatinDigits } from "./config.ts";
import {
  can, isAdmin, isStaff, myOffice, noteFail, office, officeUnsettled, orderItems, product, staffAccount, staffName, student, tooManyFails, viewingAsStudent,
} from "./data.ts";
import { flowKb, mainKb, posKb } from "./keyboards.ts";
import { listPdf, sendColorReceipt, sendPaperReceipt, sendReceiptImage } from "./documents.ts";
import { unlockFromSale } from "./exams.ts";
import { edit, send, type Kb } from "./telegram.ts";
import { btn, cut, esc, money, num, shiftDay, stamp, toInt, todayStr, words } from "./util.ts";

export async function onPosSale(chat: number, uid: number, o: any) {
  const off = myOffice(uid);
  if (!off && !can(uid, "orders")) { await send(chat, "⚠️ ما عندك صلاحية.", { replyKb: mainKb(uid) }); return; }
  const sid = toInt(o.sid || 0) ?? 0;
  const s = student(sid);
  if (!s) { await send(chat, "⚠️ الطالب غير موجود.", { replyKb: mainKb(uid) }); return; }
  const items: Row[] = [];
  for (const it of Array.isArray(o.i) ? o.i : []) {
    const pid = toInt(it?.[0]), q = toInt(it?.[1]);
    if (pid === null || q === null) continue;
    const p = product(pid);
    if (p && q > 0) items.push({ id: pid, name: p.name, price: p.price, qty: Math.min(q, 50) });
  }
  if (!items.length) { await send(chat, "⚠️ ما اخترت ولا منتج.", { replyKb: posKb(sid) }); return; }
  const total = items.reduce((t, i) => t + i.qty * i.price, 0);
  if (off) {
    const un = officeUnsettled(off.id);
    if (off.lim && un.total + total > off.lim) {
      await send(chat, `⛔ ما يصير تبيع هالبيعة: مبلغها أكثر من الرصيد الباقي للمكتبة.\n🔴 غير محاسب عليه: ${money(un.total)}\n🟢 الباقي: ${money(Math.max(off.lim - un.total, 0))}\n\nتحاسب ويا قصي العميري حتى ينفتح الرصيد.`, { replyKb: mainKb(uid) });
      return;
    }
  } else if (!isAdmin(uid)) {
    const a = staffAccount(uid);
    if (a.limit && a.owed + total > a.limit) {
      await send(chat, `⛔ ما يصير تبيع هالبيعة: مبلغها أكثر من الرصيد الباقي إلك.\n🔴 بذمتك: ${money(a.owed)}\n🟢 باقي تگدر تبيع بـ: ${money(Math.max(a.left, 0))}\n\nسلّم المبلغ لقصي العميري حتى ينفتح رصيدك.`, { replyKb: mainKb(uid) });
      return;
    }
  }
  const oid = run(`INSERT INTO orders(user_id, username, name, curr, gov, side, area, phone1, phone2, items, subtotal, fee, total,
    created, printed, seller, office_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  sid, s.username || "", s.name, s.curr || "", off ? off.name : "المكتب", "", "بيع بالمكتب",
  s.phone1, s.phone2, JSON.stringify(items), total, 0, total, stamp(), 3, uid, off ? off.id : null);
  const od = get("SELECT * FROM orders WHERE id=?", oid)!;
  setSession(uid, "", {});
  // الوصل الإلكتروني الملون للطالب
  let sent = false;
  try {
    sent = await sendReceiptImage(sid, od, items, `🧾 <b>وصل شرائك من مكتب QMath</b> (#${oid})\nشكراً لك 🌷`);
  } catch (e) { console.error(e); }
  if (!sent) {
    const lines = [`🧾 <b>وصل شرائك من مكتب QMath</b> (#${oid})`, "", ...items.map((i) => `• ${esc(i.name)} × ${i.qty} — ${money(i.qty * i.price)}`),
      "", `💰 المجموع: <b>${money(total)}</b>`, "شكراً لك 🌷"];
    sent = !!await send(sid, lines.join("\n"));
  }
  const unlocked = await unlockFromSale(sid, items, oid);
  let msg = `✅ <b>تم البيع #${oid}</b> — ${esc(s.name)}\n💰 ${money(total)}\n\n` +
    (sent ? "📱 وصل الوصل الإلكتروني للطالب." : "⚠️ ما گدرت أرسل الوصل للطالب (ممكن مسوي حظر للبوت).") + "\n📊 وانسجلت بمبيعات اليوم." +
    (unlocked.length ? `\n🔓 انفتحت عنده امتحانات: ${esc(unlocked.join("، "))}` : "");
  if (off) {
    const un = officeUnsettled(off.id);
    msg += `\n\n🔴 غير محاسب عليه: <b>${money(un.total)}</b>`;
    if (off.lim) msg += `\n🟢 الباقي من الرصيد: <b>${money(Math.max(off.lim - un.total, 0))}</b>`;
    await send(chat, msg, { replyKb: mainKb(uid) });
    await send(chat, "👇", { kb: [[btn("🏪 بيع جديد", "of:pos")], [btn("📊 مبيعات اليوم", "of:d:0")], [btn("🖼 وصل ملون (صورة)", `of:rc:${oid}`), btn("🖨 وصل للطباعة", `of:r:${oid}`)]] });
    return;
  }
  if (!isAdmin(uid)) {
    const a = staffAccount(uid);
    msg += `\n\n🔴 بذمتك هسه: <b>${money(a.owed)}</b>`;
    if (a.limit) msg += `\n🟢 باقي تگدر تبيع بـ: <b>${money(Math.max(a.left, 0))}</b>`;
  }
  await send(chat, msg, { replyKb: mainKb(uid) });
  await send(chat, "👇", { kb: [[btn("🏪 بيع جديد", "a:pos")], [btn("📊 مبيعات اليوم", "a:of")], [btn("🖼 وصل ملون (صورة)", `a:ofrc:${oid}`), btn("🖨 وصل للطباعة", `a:ofr:${oid}`)]] });
}

// ---------- مبيعات المكتب (الإدارة)
export function officeKb(day: string): Kb {
  const nav = [btn("◀️ اليوم السابق", `a:of:${shiftDay(day, -1)}`)];
  if (day < todayStr()) nav.push(btn("اليوم التالي ▶️", `a:of:${shiftDay(day, 1)}`));
  return [nav, [btn("📅 كل الأيام", "a:ofd")], [btn("📄 سجل هذا اليوم PDF", `a:ofp:${day}`)], [btn("🏪 بيع جديد", "a:pos")], [btn("⬅️ رجوع", "a:menu")]];
}
export function officeDays(): [string, Kb] {
  const rows = all("SELECT substr(created,1,10) d, COUNT(*) n, SUM(total) t FROM orders WHERE printed=3 GROUP BY d ORDER BY d DESC LIMIT 31");
  if (!rows.length) return ["ما أكو مبيعات بالمكتب بعد.", [[btn("⬅️ رجوع", "a:of")]]];
  const lines = ["<b>📅 سجل مبيعات المكتب (آخر 31 يوم)</b>", "", ...rows.map((r) => `• ${r.d} — ${r.n} بيعة — <b>${money(r.t)}</b>`),
    "", `المجموع: <b>${money(rows.reduce((s, r) => s + r.t, 0))}</b>`];
  return [lines.join("\n"), [...rows.slice(0, 15).map((r) => [btn(`📊 ${r.d}  (${money(r.t)})`, `a:of:${r.d}`)]), [btn("⬅️ رجوع", "a:of")]]];
}
export function officeView(day = todayStr()) {
  const rows = all("SELECT * FROM orders WHERE printed=3 AND created LIKE ? ORDER BY id", day + "%");
  const tot = rows.reduce((s, r) => s + r.total, 0);
  const lines = [`<b>📊 مبيعات المكتب — ${day}${day === todayStr() ? " (اليوم)" : ""}</b>`, "", `عدد المبيعات: <b>${rows.length}</b>`, `المجموع: <b>${money(tot)}</b>`, ""];
  const by = new Map<number | null, number>();
  for (const r of rows) by.set(r.seller, (by.get(r.seller) ?? 0) + r.total);
  if (by.size) lines.push("<b>حسب البائع:</b>", ...[...by].map(([k, v]) => `• ${esc(staffName(k))}: ${money(v)}`), "");
  for (const r of rows.slice(-25)) {
    lines.push(`#${r.id}  ${esc(words(r.name).slice(0, 2).join(" "))}  —  ${money(r.total)}  (${r.created.slice(11)} · ${esc(staffName(r.seller))})`);
  }
  return lines.join("\n");
}

// ---------- سجل المكتبة
const itemsLine = (r: Row, sep = " ×") => orderItems(r).map((i) => `${i.name}${sep}${i.qty}`).join("، ");
const saleLine = (r: Row) => `🕐 ${r.created.slice(11)} · #${r.id} · <b>${money(r.total)}</b>\n   👤 ${esc(r.name)}\n   📦 ${esc(itemsLine(r))}`;
function salesText(title: string, rows: Row[], limit = 30) {
  const tot = rows.reduce((s, r) => s + r.total, 0);
  const lines = [`<b>${title}</b>`, `عدد المبيعات: <b>${rows.length}</b> · المجموع: <b>${money(tot)}</b>`, "", ...rows.slice(-limit).map(saleLine)];
  if (rows.length > limit) lines.push(`… (وأكو ${rows.length - limit} قبلها، شوفهن بملف PDF)`);
  const t = lines.join("\n");
  return t.length < 3900 ? t : cut(t, 3850) + "\n…";
}
const officeDayRows = (oid: number, day: string) => all("SELECT * FROM orders WHERE printed=3 AND office_id=? AND created LIKE ? ORDER BY id", oid, day + "%");
const officeOpenRows = (oid: number) => all("SELECT * FROM orders WHERE printed=3 AND office_id=? AND settle_id IS NULL ORDER BY id", oid);
function officePdf(chat: number, title: string, rows: Row[], fname: string) {
  const data = rows.map((r) => [`#${r.id}`, r.created, r.name, itemsLine(r), num(r.total)]);
  return listPdf(chat, `${title} — المجموع ${money(rows.reduce((s, r) => s + r.total, 0))}`, ["رقم", "الوقت", "الطالب", "المنتجات", "المبلغ"], data, fname);
}
const dayTotal = (rows: Row[]) => money(rows.reduce((s, r) => s + r.total, 0));

// ---------- واجهة حساب المكتبة
export async function officeMenu(chat: number, uid: number) {
  const off = myOffice(uid);
  if (!off) return;
  const un = officeUnsettled(off.id);
  const td = officeDayRows(off.id, todayStr());
  const t = `<b>🏪 ${esc(off.name)}</b>\n\n📊 مبيعات اليوم: <b>${dayTotal(td)}</b> (${td.length})\n🔴 غير محاسب عليه: <b>${money(un.total)}</b> (${un.n} بيعة)` +
    (off.lim ? `\n🟢 الباقي من الرصيد: <b>${money(Math.max(off.lim - un.total, 0))}</b>` : "");
  await send(chat, t, { kb: [[btn("🏪 بيع جديد", "of:pos")], [btn("📊 مبيعات اليوم", "of:d:0"), btn("📅 مبيعات البارحة", "of:d:1")],
    [btn("🔴 غير المحاسب عليها", "of:u")], [btn("🗂 المحاسبات السابقة (الأرشيف)", "of:a")]] });
}
export async function officeCb(chat: number, uid: number, d: string): Promise<string | null> {
  const off = myOffice(uid);
  if (!off) return "ما عندك صلاحية";
  const oid: number = off.id;
  if (d === "of:pos") {
    setSession(uid, "o:pos", {});
    await send(chat, "🏪 <b>بيع جديد</b>\n🔍 اكتب اسم الطالب (أو جزء منه) أو رقم هاتفه:", { replyKb: flowKb() });
  } else if (d.startsWith("of:ps:")) {
    const sid = Number(d.slice(6));
    const s = student(sid);
    if (s) {
      setSession(uid, "o:posw", { sid });
      await send(chat, `👤 <b>${esc(s.name)}</b>\n👇 اضغط «🏪 افتح صفحة البيع» واختار المنتجات، وبعدين «✅ تم البيع».`, { replyKb: posKb(sid) });
    }
  } else if (d.startsWith("of:d:")) {
    const back = Number(d.slice(5)), day = todayStr(back);
    await send(chat, salesText(`📊 ${off.name} — ${back === 0 ? "اليوم" : back === 1 ? "البارحة" : ""} ${day}`, officeDayRows(oid, day)),
      { kb: [[btn("📄 PDF", `of:dp:${back}`)], [btn("⬅️ رجوع", "of:m")]] });
  } else if (d.startsWith("of:dp:")) {
    const day = todayStr(Number(d.slice(6)));
    await officePdf(chat, `${off.name} — ${day}`, officeDayRows(oid, day), `office${oid}_${day}`);
  } else if (d === "of:u") {
    await send(chat, salesText(`🔴 ${off.name} — غير المحاسب عليها`, officeOpenRows(oid)), { kb: [[btn("📄 PDF", "of:up")], [btn("⬅️ رجوع", "of:m")]] });
  } else if (d === "of:up") {
    await officePdf(chat, `${off.name} — غير المحاسب عليها`, officeOpenRows(oid), `office${oid}_open`);
  } else if (d === "of:a") {
    const [t, kb] = settlementsView(oid, "of");
    await send(chat, t, { kb });
  } else if (d.startsWith("of:sv:")) {
    await settleDetail(chat, oid, Number(d.slice(6)));
  } else if (d.startsWith("of:rc:")) {
    const r = get("SELECT id FROM orders WHERE id=? AND office_id=?", Number(d.slice(6)), oid);
    if (r) await sendColorReceipt(chat, r.id);
  } else if (d.startsWith("of:r:")) {
    const r = get("SELECT id FROM orders WHERE id=? AND office_id=?", Number(d.slice(5)), oid);
    if (r) await sendPaperReceipt(chat, r.id);
  } else if (d === "of:m") await officeMenu(chat, uid);
  return null;
}
function settlementsView(oid: number, pre: "of" | "a"): [string, Kb] {
  const rows = all("SELECT * FROM settlements WHERE office_id=? ORDER BY id DESC LIMIT 30", oid);
  const back = pre === "of" ? "of:m" : `a:libv:${oid}`;
  if (!rows.length) return ["🗂 ما أكو محاسبات سابقة بعد.", [[btn("⬅️ رجوع", back)]]];
  const lines = ["<b>🗂 المحاسبات السابقة (الأرشيف)</b>", "", ...rows.map((r) => `• ${r.created} — <b>${money(r.amount)}</b> (${r.n} بيعة)`)];
  const kb: Kb = rows.slice(0, 15).map((r) => [btn(`📂 ${r.created.slice(0, 10)} — ${money(r.amount)}`, `${pre === "of" ? "of" : "a:lib"}:sv:${r.id}`)]);
  kb.push([btn("⬅️ رجوع", back)]);
  return [lines.join("\n"), kb];
}
async function settleDetail(chat: number, oid: number, stid: number) {
  const st = get("SELECT * FROM settlements WHERE id=? AND office_id=?", stid, oid);
  if (!st) return;
  const rows = all("SELECT * FROM orders WHERE printed=3 AND office_id=? AND settle_id=? ORDER BY id", oid, stid);
  await officePdf(chat, `${office(oid)?.name ?? ""} — محاسبة ${st.created}`, rows, `settle_${stid}`);
}

// ---------- واجهة الإدارة للمكتبات
function libsView(): [string, Kb] {
  const offs = all("SELECT * FROM offices WHERE active=1 ORDER BY id");
  const lines = ["<b>🏬 المكتبات (نقاط البيع)</b>", `📅 اليوم ${todayStr()}`, ""];
  const kb: Kb = [];
  for (const o of offs) {
    const un = officeUnsettled(o.id), td = officeDayRows(o.id, todayStr());
    lines.push(`🏪 <b>${esc(o.name)}</b>\n   اليوم: ${dayTotal(td)} · غير محاسب: ${money(un.total)}`);
    kb.push([btn(`🏪 ${o.name} — اليوم: ${td.length} بيعة · ${dayTotal(td)}`, `a:libv:${o.id}`)]);
  }
  if (!offs.length) lines.push("ما أكو مكتبات بعد. اضغط «➕ إضافة مكتبة».");
  kb.push([btn("➕ إضافة مكتبة", "a:liba")], [btn("⬅️ رجوع", "a:menu")]);
  return [lines.join("\n"), kb];
}
function libView(oid: number): [string, Kb] {
  const o = office(oid);
  if (!o) return libsView();
  const un = officeUnsettled(oid), td = officeDayRows(oid, todayStr()), yd = officeDayRows(oid, todayStr(1));
  const us = all("SELECT * FROM office_users WHERE office_id=?", oid);
  const st = get("SELECT IFNULL(SUM(amount),0) t FROM settlements WHERE office_id=?", oid)!.t;
  const t = [`<b>🏪 ${esc(o.name)}</b>`, "", `📊 اليوم: <b>${dayTotal(td)}</b> (${td.length})`, `📅 البارحة: <b>${dayTotal(yd)}</b> (${yd.length})`,
    `🔴 غير محاسب عليه: <b>${money(un.total)}</b> (${un.n} بيعة)`, `✅ كل اللي تحاسبتوا عليه: <b>${money(st)}</b>`,
    `🎯 الرصيد المسموح: <b>${o.lim ? money(o.lim) : "بدون حد"}</b>`, "", "<b>👥 الحسابات:</b>",
    ...(us.length ? us.map((u) => `• ${esc(u.name || String(u.user_id))}`) : ["(ما أكو حساب، ضيف حساب حتى يبيع)"])];
  const kb: Kb = [[btn("📊 اليوم", `a:libd:${oid}:0`), btn("📅 البارحة", `a:libd:${oid}:1`)], [btn("🔴 غير المحاسب عليها (تفصيل)", `a:libu:${oid}`)],
    [btn("✅ تمت المحاسبة", `a:libs:${oid}`)], [btn("🗂 الأرشيف", `a:libar:${oid}`)], [btn("👤 إضافة حساب للمكتبة", `a:libm:${oid}`)],
    ...us.map((u) => [btn(`🗑 حذف حساب: ${u.name || u.user_id}`, `a:libmd:${u.user_id}`)]),
    [btn("🎯 الرصيد المسموح", `a:libl:${oid}`), btn("✏️ تغيير الاسم", `a:libn:${oid}`)], [btn("🗑 حذف المكتبة", `a:libx:${oid}`)], [btn("⬅️ رجوع للمكتبات", "a:lib")]];
  return [t.join("\n"), kb];
}
const sendView = (chat: number, [t, kb]: [string, Kb]) => send(chat, t, { kb });

/** أزرار a:lib. يرجع الملاحظة اللي تطلع للضاغط */
export async function libCb(chat: number, uid: number, mid: number, d: string): Promise<string | null> {
  if (d === "a:lib") await sendView(chat, libsView());
  else if (d === "a:liba") {
    setSession(uid, "a:liba", {});
    await send(chat, "✍️ اكتب اسم المكتبة (مثلاً: مكتبة 1):", { replyKb: flowKb() });
  } else if (d.startsWith("a:libv:")) await sendView(chat, libView(Number(d.slice(7))));
  else if (d.startsWith("a:libdp:")) {
    const [oid, back] = d.slice(8).split(":").map(Number);
    const day = todayStr(back);
    await officePdf(chat, `${office(oid)!.name} — ${day}`, officeDayRows(oid, day), `office${oid}_${day}`);
  } else if (d.startsWith("a:libd:")) {
    const [oid, back] = d.slice(7).split(":").map(Number);
    const day = todayStr(back);
    await send(chat, salesText(`📊 ${office(oid)!.name} — ${day}`, officeDayRows(oid, day)), { kb: [[btn("📄 PDF", `a:libdp:${oid}:${back}`)], [btn("⬅️ رجوع", `a:libv:${oid}`)]] });
  } else if (d.startsWith("a:libup:")) {
    const oid = Number(d.slice(8));
    await officePdf(chat, `${office(oid)!.name} — غير المحاسب عليها`, officeOpenRows(oid), `office${oid}_open`);
  } else if (d.startsWith("a:libu:")) {
    const oid = Number(d.slice(7));
    await send(chat, salesText(`🔴 ${office(oid)!.name} — غير المحاسب عليها`, officeOpenRows(oid)),
      { kb: [[btn("📄 PDF", `a:libup:${oid}`)], [btn("✅ تمت المحاسبة", `a:libs:${oid}`)], [btn("⬅️ رجوع", `a:libv:${oid}`)]] });
  } else if (d.startsWith("a:libsy:")) {
    const [oid, amt] = d.slice(8).split(":").map(Number);
    const un = officeUnsettled(oid);
    if (un.total !== amt) return "صارت مبيعات جديدة، اضغط «تمت المحاسبة» مرة ثانية";
    tx(() => {
      const id = run("INSERT INTO settlements(office_id, amount, n, created) VALUES(?,?,?,?)", oid, amt, un.n, stamp());
      run("UPDATE orders SET settle_id=? WHERE printed=3 AND office_id=? AND settle_id IS NULL", id, oid);
    });
    const us = all("SELECT user_id FROM office_users WHERE office_id=?", oid);
    await edit(chat, mid, `✅ تمت المحاسبة ويا <b>${esc(office(oid)!.name)}</b>: <b>${money(amt)}</b> (${un.n} بيعة)، وانتقلت للأرشيف.`);
    for (const u of us) await send(u.user_id, `✅ <b>تمت المحاسبة</b> ويا قصي العميري\n💰 ${money(amt)} (${un.n} بيعة)\nالمبيعات انتقلت للأرشيف «🗂 المحاسبات السابقة».`);
    await sendView(chat, libView(oid));
  } else if (d.startsWith("a:libs:")) {
    const oid = Number(d.slice(7));
    const un = officeUnsettled(oid);
    if (!un.n) return "ما أكو مبيعات غير محاسب عليها";
    await send(chat, `⚠️ متأكد استلمت من <b>${esc(office(oid)!.name)}</b> مبلغ <b>${money(un.total)}</b> (${un.n} بيعة)؟\nكل هالمبيعات راح تنتقل للأرشيف.`,
      { kb: [[btn(`✅ نعم، استلمت ${money(un.total)}`, `a:libsy:${oid}:${un.total}`)], [btn("↩️ لا", `a:libv:${oid}`)]] });
  } else if (d.startsWith("a:libar:")) await sendView(chat, settlementsView(Number(d.slice(8)), "a"));
  else if (d.startsWith("a:lib:sv:")) {
    const stid = Number(d.slice(9));
    const r = get("SELECT office_id FROM settlements WHERE id=?", stid);
    if (r) await settleDetail(chat, r.office_id, stid);
  } else if (d.startsWith("a:libmn:")) {
    setSession(uid, "a:libm", { oid: Number(d.slice(8)) });
    await send(chat, "✍️ اكتب رقم حساب صاحب المكتبة (يطلعه من البوت إذا كتب كلمة <code>رقمي</code>):", { replyKb: flowKb() });
  } else if (d.startsWith("a:libmd:")) {
    const u = Number(d.slice(8));
    const r = get("SELECT office_id FROM office_users WHERE user_id=?", u);
    run("DELETE FROM office_users WHERE user_id=?", u);
    await send(u, "ℹ️ انشال حسابك من المكتبة.", { replyKb: mainKb(u) });
    if (r) await sendView(chat, libView(r.office_id));
  } else if (d.startsWith("a:libm:")) {
    const oid = Number(d.slice(7));
    let code = String(randomInt(10000000, 100000000));
    while (kvGet("libinv_" + code)) code = String(randomInt(10000000, 100000000));
    kvSet("libinv_" + code, `${oid}:${Math.floor(Date.now() / 1000)}`);
    const link = `https://t.me/${kvGet("bot_username") || "Qusay_Alomairi_Bot"}?start=lib_${code}`;
    await send(chat, `👤 <b>إضافة حساب لـ ${esc(office(oid)!.name)}</b>\n\n` +
      "1️⃣ اضغط مطولاً على الرابط الأزرق جوة وانسخه (أو اضغط زر «📤 مشاركة الرابط»).\n" +
      "2️⃣ دزه لصاحب المكتبة بالواتساب أو التلكرام.\n" +
      "3️⃣ هو يضغط الرابط ← ينفتح البوت ← يضغط <b>Start / ابدأ</b>، وينضاف لوحده ✅\n\n" +
      `🔗 ${link}\n\n` +
      `🔢 <b>أو الأسهل:</b> خليه يفتح البوت ويكتب هذا الرقم بس ويدزه:\n<code>${code}</code>\n\n` +
      "⏳ الرابط والرقم يشتغلون مرة وحدة بس، وخلال 3 أيام. بعد ما ينضاف يبقى بالمكتبة دائماً.",
    { kb: [[{ text: "📤 مشاركة الرابط", url: "https://t.me/share/url?url=" + encodeURIComponent(link) }],
      [btn("✍️ أضيفه برقم الحساب بدل الرابط", `a:libmn:${oid}`)], [btn("⬅️ رجوع", `a:libv:${oid}`)]] });
  } else if (d.startsWith("a:libl:")) {
    setSession(uid, "a:libl", { oid: Number(d.slice(7)) });
    await send(chat, "🎯 اكتب الرصيد المسموح للمكتبة (أكثر مبلغ تبيع بيه قبل ما تتحاسب)\nمثال: <code>20 مليون</code> — واكتب <code>0</code> بدون حد.", { replyKb: flowKb() });
  } else if (d.startsWith("a:libn:")) {
    setSession(uid, "a:libn", { oid: Number(d.slice(7)) });
    await send(chat, "✍️ اكتب الاسم الجديد للمكتبة:", { replyKb: flowKb() });
  } else if (d.startsWith("a:libxy:")) {
    const oid = Number(d.slice(8));
    tx(() => {
      run("UPDATE offices SET active=0 WHERE id=?", oid);
      run("DELETE FROM office_users WHERE office_id=?", oid);
    });
    await sendView(chat, libsView());
  } else if (d.startsWith("a:libx:")) {
    const oid = Number(d.slice(7));
    await send(chat, `⚠️ متأكد تحذف <b>${esc(office(oid)!.name)}</b>؟ (المبيعات تبقى محفوظة بالسجل)`, { kb: [[btn("🗑 نعم، احذف", `a:libxy:${oid}`)], [btn("↩️ لا", `a:libv:${oid}`)]] });
  }
  return null;
}

export async function joinOfficeByCode(chat: number, uid: number, code: string, user: Row) {
  const key = "libinv_" + code.replace(/[^\p{L}\p{N}_]/gu, "");
  if (tooManyFails("invfail", uid)) { await send(chat, "⚠️ حاولت هوايا برموز غلط. حاول بعد ساعة.", { replyKb: mainKb(uid) }); return; }
  const v = kvGet(key);
  if (!v) {
    if (!isStaff(uid)) noteFail("invfail", uid);
    await send(chat, "⚠️ الرابط غير صالح أو انستخدم قبل. اطلب رابط جديد من قصي العميري.", { replyKb: mainKb(uid) });
    return;
  }
  const [oid, ts] = v.split(":").map(Number);
  const o = office(oid);
  if (!o || !o.active || Date.now() / 1000 - ts > 3 * 86400) { await send(chat, "⚠️ الرابط انتهى. اطلب رابط جديد من قصي العميري.", { replyKb: mainKb(uid) }); return; }
  if (isStaff(uid)) { await send(chat, "⚠️ هذا الحساب أدمن أو مساعد، ما يصير ينضاف لمكتبة.", { replyKb: mainKb(uid) }); return; }
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || (user.username ?? "");
  tx(() => {
    run("INSERT OR REPLACE INTO office_users(user_id, office_id, name) VALUES(?,?,?)", uid, oid, cut(name, 40));
    run("DELETE FROM kv WHERE k=?", key);
  });
  setSession(uid, "", {});
  await send(chat, `✅ <b>تمت إضافتك لـ ${esc(o.name)}</b>\nاضغط زر «${BTN_OFFICE}» اللي جوة حتى تبيع وتشوف مبيعاتك 👇`, { replyKb: mainKb(uid) });
  for (const a of ADMIN_IDS.filter((id) => !viewingAsStudent(id))) {
    await send(a, `✅ <b>${esc(name || String(uid))}</b> انضاف لـ <b>${esc(o.name)}</b> عن طريق الرابط.`, { kb: [[btn("🏪 فتح " + o.name, `a:libv:${oid}`)]] });
  }
}

export function parseAmount(raw: string | null | undefined) {
  let t = toLatinDigits(raw ?? "").replace(/[,٬،\s]/g, "").toLowerCase();
  let mult = 1;
  for (const [k, v] of [["مليون", 1000000], ["الف", 1000], ["ألف", 1000]] as const) {
    if (t.endsWith(k)) { t = t.slice(0, -k.length); mult = v; }
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Math.trunc(Number(t) * mult);
}

/** حالات الكتابة a:lib. يرجع true إذا عالج الرسالة */
export async function libText(chat: number, uid: number, text: string, st: string, data: Row) {
  if (st === "a:liba") {
    const oid = run("INSERT INTO offices(name) VALUES(?)", cut(text.trim(), 60));
    setSession(uid, "", {});
    await send(chat, "✅ انضافت المكتبة.", { replyKb: mainKb(uid) });
    await sendView(chat, libView(oid));
    return true;
  }
  if (st === "a:libm") {
    const ids = toLatinDigits(text).match(/\d{5,}/g);
    if (!ids) { await send(chat, "⚠️ اكتب رقم الحساب (أرقام فقط)."); return true; }
    setSession(uid, "a:libm2", { oid: data.oid, u: Number(ids[0]) });
    await send(chat, "✍️ اكتب اسم صاحب الحساب (مثلاً: أبو أحمد):");
    return true;
  }
  if (st === "a:libm2") {
    const { u, oid } = data;
    run("INSERT OR REPLACE INTO office_users(user_id, office_id, name) VALUES(?,?,?)", u, oid, cut(text.trim(), 40));
    setSession(uid, "", {});
    await send(chat, "✅ انضاف الحساب للمكتبة.", { replyKb: mainKb(uid) });
    await send(u, `✅ تمت إضافتك لـ <b>${esc(office(oid)!.name)}</b> بالبوت.\nاضغط زر «${BTN_OFFICE}» اللي جوة 👇`, { replyKb: mainKb(u) });
    await sendView(chat, libView(oid));
    return true;
  }
  if (st === "a:libl") {
    const amt = parseAmount(text);
    if (amt === null || amt < 0) { await send(chat, "⚠️ اكتب رقم صحيح، مثال: <code>20 مليون</code>"); return true; }
    run("UPDATE offices SET lim=? WHERE id=?", amt, data.oid);
    setSession(uid, "", {});
    await send(chat, "✅ انحفظ.", { replyKb: mainKb(uid) });
    await sendView(chat, libView(data.oid));
    return true;
  }
  if (st === "a:libn") {
    run("UPDATE offices SET name=? WHERE id=?", cut(text.trim(), 60), data.oid);
    setSession(uid, "", {});
    await send(chat, "✅ تغير الاسم.", { replyKb: mainKb(uid) });
    await sendView(chat, libView(data.oid));
    return true;
  }
  return false;
}

// ---------- البحث السريع (اكتب أي شي وارسله)
const norm = (t: unknown) => String(t ?? "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
/** يدور بكل المعلومات: الاسم، الهاتف، المحافظة، العنوان، المنهج، الصف، الامتحان، المركز */
function smartSearch(q: string, limit = 10): [Row[], number] {
  const ws = words(toLatinDigits(q));
  if (!ws.length) return [[], 0];
  const rows = all(`SELECT students.*, IFNULL(centers.name,'') cn, IFNULL(areas.name,'') an FROM students
    LEFT JOIN centers ON centers.id=students.center_id LEFT JOIN areas ON areas.id=centers.area_id`);
  const out = rows.filter((r) => {
    const hay = norm(["name", "phone1", "phone2", "gov", "side", "area", "curr", "grade", "exam", "cn", "an"].map((k) => r[k] ?? "").join(" "));
    return ws.every((w) => hay.includes(norm(w)));
  });
  const rank = (r: Row) => (norm(r.name).includes(norm(ws[0])) ? 0 : 1);
  out.sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [out.slice(0, limit), out.length];
}
export async function quickSearch(chat: number, uid: number, text: string) {
  const [res, total] = smartSearch(text);
  if (!res.length) { await send(chat, `🔍 ما لگيت شي لـ «${esc(text)}».\nاكتب جزء من الاسم، أو رقم الهاتف، أو المحافظة، أو اسم المركز…`); return; }
  const officeUser = !isStaff(uid);
  const sell = (id: number) => (officeUser ? `of:ps:${id}` : `a:pss:${id}`);
  const more = total > 10 ? " (أول 10)" : "";
  if (officeUser) {          // صاحب المكتبة يشوف الاسم والرقم بس
    await send(chat, `🔍 <b>${total} نتيجة</b>${more} — اضغط الطالب حتى تبيعله 👇`, { kb: res.map((r) => [btn(`🏪 ${r.name} — ${r.phone1}`, sell(r.user_id))]) });
    return;
  }
  const lines = [`🔍 <b>${total} نتيجة</b>${more} لـ «${esc(text)}»`];
  const kb: Kb = [];
  res.forEach((r, i) => {
    const place = r.gov + (r.side ? " - " + r.side : "");
    const ex = (r.exam ?? "") + (r.cn ? ` — ${r.cn} (${r.an})` : "");
    lines.push(`<b>${i + 1}) ${esc(r.name)}</b>\n📞 <code>${r.phone1}</code> · <code>${r.phone2}</code>\n🎓 ${esc(r.grade)} · 📘 ${esc(r.curr)}\n📍 ${esc(place)} — ${esc(r.area)}\n📝 ${esc(ex)}`);
    kb.push([btn(`${i + 1}) ✏️ تعديل`, `a:sv:${r.user_id}`), btn("🏪 بيع", sell(r.user_id)), btn("🗑", `a:sx:${r.user_id}`)]);
  });
  const t = lines.join("\n\n");
  await send(chat, t.length < 4000 ? t : cut(t, 3950) + "\n…", { kb });
}
