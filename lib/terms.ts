// شروط التسجيل: تنحفظ بالإعدادات، والمدير يعدلها من صفحة لوحة التحكم
import { createHash } from "node:crypto";
import { kvGet, kvSet, type Row } from "./db.ts";
import { authed, need } from "./webApi.ts";

export type Term = { id: number; text: string };
const KEY = "reg_terms";
const MAX_TEXT = 5000;
const DELETES_LECTURES = "تحذف المحاضرات مباشرة بعد انتهاء امتحانات الدور الأول مباشرة ولأيمكن ارجاعها لاي سبب كان و انا لست مسؤول عن عدم مشاهدتها *** انا ادفع للشركة اشتراك اجباري بغض النظر عن مشاهدة المحاضرات او عدم مشاهدتها";
const COURSE_TWO_NOTE = "هذا القسط يشمل فقط 5 افصل لان الفصل السادس الهندسه الفضائيه ( انا لا اشرحه ولم استلم قسطه ويوجد كود للفصل السادس ( الهندسه الفضائيه ) ويستطيع الطالب ان يشاهدها على اليوتيوب وانا اتكفل بامتحانه";

// الشروط الأولى من صور المستخدم، للتجربة وتتغير من الصفحة
const DEFAULTS = [
  "عزيزي الطالب / عزيزتي الطالبة\n\n- سيتم عرض التعليمات لتسجيلك ضمن دوراتنا لمادة الرياضيات\n\n- يجب قراءة التعليمات بعناية وحضور ولي الأمر وموافقتك عليها تعتبر تعهد خطي من قبلك ومن قبل ولي امرك\n\n- بعد الموافقة على التعليمات سيتم تنسيب حساب خاص بك داخل المنصه",
  "المبلغ غير قابل للارجاع نهائيا ولاي سبب كان لانني ادفع للشركة اشتراك اجباري بغض النظر عن مشاهدة المحاضرات او عدم مشاهدتها\nلذلك تأكد من فهمك للمحاضرات التجريبيه قبل دفع المبلغ",
  "سيكون هنالك امتحانين في الاسبوع وتحت اي ظرف لايوجد تاجيل اطلاقا اطلاقا اطلاقا ( الامتحانات حضوري اجباري لجماعه بغداد وبالنسبه لطلاب المحافظات او اطراف بغداد امتحانهم الكتروني )",
  "* عدم حضور الطالب للامتحان معناه درجته صفر في هذا الامتحان وفي نهايه كل فصل لايقبل الطالب في الفصل القادم اذا كانت درجاته اقل من الحد المسموح به وسوف يحدد الاستاذ الحد المسموح به من الدرجات لكل فصل ...\n*كل شهر سوف يقوم التطبيق ذاتيا بايقاف المنصه على الطالب الذي درجاته ضعيفه باخراجه من المنصه ولاتفتح المنصه اطلاقا الابحضور ولي الامر حصرا (حضور وليس اتصال )مع جلب مستمسك يثبت لنا ولي امر الطالب بالنسبه للمحافظات اتصال",
  DELETES_LECTURES,
  `سعر الكود التجريبي 25 الف\n\nطلاب بغداد\nسعر الكورس الاول 350 الف ويشمل الفصل الاول والفصل الثاني والفصل الثالث\nسعر الكورس الثاني 150 الف يشمل الفصل الرابع والفصل الخامس ${COURSE_TWO_NOTE}\nسعر الخمس فصول كدفعه واحده 450 الف\n\nالمحافظات\nسعر الكورس الاول 275 الف ويشمل الفصل الاول والفصل الثاني والفصل الثالث\nسعر الكورس الثاني 125 الف يشمل الفصل الرابع والفصل الخامس ${COURSE_TWO_NOTE}\nسعر الخمس فصول كدفعه واحده 350 الف`,
  "للتذكير مره اخرى " + DELETES_LECTURES,
];

export async function loadTerms(): Promise<Term[]> {
  const saved = await kvGet(KEY);
  if (saved === null) return DEFAULTS.map((text, i) => ({ id: i + 1, text }));
  try { return JSON.parse(saved); } catch { return []; }
}
/** بصمة نص الشروط، حتى ما يكمل الطالب على شروط تغيرت وهو فاتح الصفحة */
export const termsRev = (terms: Term[]) => createHash("sha256").update(JSON.stringify(terms)).digest("hex").slice(0, 16);

const textOf = (raw: unknown) => {
  const t = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  need(t, "اكتب نص الشرط");
  need(t.length <= MAX_TEXT, "الشرط طويل هواية، خليه أقصر");
  return t;
};

export async function termsAction(body: Row) {
  await authed(body?.initData, "owner");
  const a = String(body.action ?? "");
  const id = Number(body.id);
  let terms = await loadTerms();
  let notice = "";
  if (a === "add") {
    terms = [...terms, { id: Math.max(0, ...terms.map((t) => t.id)) + 1, text: textOf(body.text) }];
    notice = "✅ انضاف الشرط";
  } else if (a === "save") {
    need(terms.some((t) => t.id === id), "الشرط غير موجود");
    const text = textOf(body.text);
    terms = terms.map((t) => (t.id === id ? { ...t, text } : t));
    notice = "✅ انحفظ الشرط";
  } else if (a === "del") {
    need(terms.some((t) => t.id === id), "الشرط غير موجود");
    terms = terms.filter((t) => t.id !== id);
    notice = "🗑 انحذف الشرط";
  } else need(a === "list", "أمر غير معروف");
  if (a !== "list") await kvSet(KEY, JSON.stringify(terms));
  return { terms, notice };
}
