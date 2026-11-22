// عقد المصححين (طلب الأستاذ 2026-11-22): صاحب البوت يكتب صيغة العقد بنفسه، والمصحح يقراه بصفحة التصحيح
// ويوقع بإصبعه أو بقلم الآيباد. يعني حتى المصحح البعيد يوقع إلكتروني. التوقيع ينحفظ ويا نسخة العقد اللي وقع عليها،
// وإذا الأستاذ غير الصيغة، المصحح يوقع من جديد. بالصيغة تگدر تكتب {الاسم} و{الغرامة} و{الحصة} و{التاريخ} وتنملى وحدها
import { kvGet, kvSet, one } from "./db.ts";
import { staffName } from "./data.ts";
import { stamp } from "./util.ts";
import { need } from "./webApi.ts";

export type Contract = { text: string; v: number; updated: string };
export type Signed = { v: number; at: string; name: string; text: string; sig: { w: number; h: number; s: number[][] } };
const KEY = "grader_contract";
const signKey = (uid: number) => `grader_contract_sign_${uid}`;
const TEXT_MAX = 20000;

export async function contract(): Promise<Contract> {
  try { const j = JSON.parse((await kvGet(KEY)) ?? "null"); if (j?.text) return { text: String(j.text), v: Number(j.v) || 1, updated: String(j.updated ?? "") }; } catch { /* فارغ */ }
  return { text: "", v: 0, updated: "" };
}
/** صاحب البوت يحفظ الصيغة. إذا تغيرت، نسخة جديدة والمصححين يوقعون من جديد */
export async function saveContract(text: unknown) {
  const t = String(text ?? "").replace(/\r/g, "").trim().slice(0, TEXT_MAX);
  need(t.length >= 20, "اكتب صيغة العقد");
  const old = await contract();
  if (old.text === t) return old;
  const c = { text: t, v: old.v + 1, updated: stamp() };
  await kvSet(KEY, JSON.stringify(c));
  return c;
}
/** الصيغة بأرقام هذا المصحح: اسمه وغرامته وقدرته وتاريخ اليوم */
export async function filledFor(uid: number, text?: string) {
  const r = await one("grader_pay", { user_id: uid });
  const fine = Number(r?.fine ?? 0), weight = Number(r?.weight) > 0 ? Number(r!.weight) : 1;
  return String(text ?? (await contract()).text)
    .replaceAll("{الاسم}", await staffName(uid))
    .replaceAll("{الغرامة}", fine ? `${fine.toLocaleString("en-US")} دينار` : "(ما محددة)")
    .replaceAll("{الحصة}", weight === 1 ? "مثل باقي المصححين" : `${weight} مرة من حصة المصحح العادي`)
    .replaceAll("{التاريخ}", stamp().slice(0, 10));
}
export async function signedOf(uid: number): Promise<{ v: number; at: string; current: boolean } | null> {
  try {
    const j = JSON.parse((await kvGet(signKey(uid))) ?? "null") as Signed | null;
    if (!j?.v) return null;
    return { v: j.v, at: j.at, current: j.v === (await contract()).v };
  } catch { return null; }
}
export async function signedCopy(uid: number): Promise<Signed | null> {
  try { return JSON.parse((await kvGet(signKey(uid))) ?? "null"); } catch { return null; }
}
/** المصحح يوقع: يكتب اسمه ويرسم توقيعه. ينحفظ نص العقد نفسه اللي وقع عليه */
export async function sign(uid: number, name: unknown, sig: any) {
  const c = await contract();
  need(c.v > 0, "بعده ما انكتب عقد");
  const n = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  need(n.split(" ").length >= 2, "اكتب اسمك الكامل");
  const w = Math.round(Number(sig?.w)), h = Math.round(Number(sig?.h));
  need(w >= 100 && w <= 2000 && h >= 50 && h <= 1000, "ارسم توقيعك");
  const s: number[][] = [];
  let pts = 0;
  for (const st of Array.isArray(sig?.s) ? sig.s.slice(0, 200) : []) {
    if (!Array.isArray(st)) continue;
    const a = st.slice(0, 4000).map((v: unknown) => Math.round(Number(v))).filter((v: number) => Number.isFinite(v));
    if (a.length >= 2) { s.push(a); pts += a.length; }
  }
  need(s.length && pts >= 10, "ارسم توقيعك");
  const row: Signed = { v: c.v, at: stamp(), name: n, text: await filledFor(uid, c.text), sig: { w, h, s } };
  await kvSet(signKey(uid), JSON.stringify(row));
  return row;
}
