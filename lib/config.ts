// الإعدادات: من متغيرات البيئة (.env.local) أو من ملف settings.txt القديم
import fs from "node:fs";
import path from "node:path";

export const AR_DIGITS: Record<string, string> = {};
"٠١٢٣٤٥٦٧٨٩".split("").forEach((c, i) => (AR_DIGITS[c] = String(i)));
"۰۱۲۳۴۵۶۷۸۹".split("").forEach((c, i) => (AR_DIGITS[c] = String(i)));
export const toLatinDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (c) => AR_DIGITS[c] ?? c);

export function parseSettingsText(text: string) {
  let token = "", admins: number[] = [], url = "";
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toUpperCase();
    const v = line.slice(i + 1).trim().replace(/^"|"$/g, "").trim();
    if (k === "TOKEN") token = v;
    else if (["ADMIN", "ADMIN_ID", "ADMIN_IDS"].includes(k))
      admins = (toLatinDigits(v).match(/\d+/g) ?? []).map(Number);
    else if (["STORE", "STORE_URL"].includes(k)) url = v.startsWith("https://") ? v : "";
  }
  return { token, admins, url };
}

function load() {
  let { token, admins, url } = { token: "", admins: [] as number[], url: "" };
  const legacy = process.env.SETTINGS_FILE ?? path.join(process.cwd(), "settings.txt");
  if (fs.existsSync(legacy)) ({ token, admins, url } = parseSettingsText(fs.readFileSync(legacy, "utf8")));
  if (process.env.TOKEN) token = process.env.TOKEN;
  if (process.env.ADMIN) admins = (toLatinDigits(process.env.ADMIN).match(/\d+/g) ?? []).map(Number);
  if (process.env.STORE_URL) url = process.env.STORE_URL.startsWith("https://") ? process.env.STORE_URL : "";
  return { token, admins, url };
}

const s = load();
export const TOKEN = s.token;
export const ADMIN_IDS = s.admins;
export const STORE_URL = s.url;
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";
export const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "store.db");

const ASSETS_DIR = process.env.ASSETS_DIR ?? path.join(process.cwd(), "assets");
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? path.join(process.cwd(), "public");
export const BANNER = path.join(ASSETS_DIR, "banner.jpg");
export const SUCCESS = path.join(ASSETS_DIR, "success.jpg");
export const LOGO = path.join(PUBLIC_DIR, "logo.png");
export const FONT = path.join(PUBLIC_DIR, "boahmed.ttf");
export const PDF_DIR = process.env.PDF_DIR ?? path.join(process.cwd(), "data", "pdf");

export const DEFAULT_FEE = 5000;
export const CURRENCY = "د.ع";
export const AGREE_TIMES = 3;
export const NO_REFUND = "⚠️ <b>تنبيه مهم</b>\n\nجميع المشتريات <b>غير قابلة للإرجاع إطلاقاً ولأي سبب كان</b>.";
export const successText = (id: number) => `✅ <b>تم استلام طلبك بنجاح</b>  (رقم الطلب <b>#${id}</b>)\n\n` +
  "🚚 سيصلك الطلب خلال مدة من <b>12 ساعة إلى 48 ساعة</b>.\n\n" +
  "⚠️ وللتذكير: جميع المشتريات <b>غير قابلة للإرجاع إطلاقاً ولأي سبب كان</b>.";
export const orderReady = (id: number) => `📦 <b>تم تجهيز طلبك #${id}</b> وتسليمه إلى مندوب التوصيل.\n\n` +
  "📞 سيتم الاتصال بك بأقرب وقت.";
export const WELCOME = "أهلا بك في <b>QMath</b> 🌷\n\n" +
  "🛒 <b>المتجر</b>: محاضرات، امتحانات، ملازم\n" +
  "❓ <b>سؤال علمي</b>: اسأل قصي العميري عن أي محاضرة\n" +
  "📂 <b>أسئلتي</b>: أسئلتك وأجوبتها\n" +
  "👤 <b>معلوماتي</b>: معلوماتك المسجلة";
export const BULK_HELP = "📥 <b>إضافة منتجات دفعة وحدة</b>\n\n" +
  "أرسل رسالة وحدة بهذا الشكل:\n" +
  "• السطر اللي يبدي بعلامة <code>#</code> هو اسم القسم.\n" +
  "• تحته كل منتج بسطر: الاسم بعدين علامة <code>=</code> بعدين السعر.\n\n" +
  "<code># المحاضرات والامتحانات\n" +
  "المحاضرة الأولى مع امتحانها = 5000\n" +
  "المحاضرة الثانية مع امتحانها = 5000\n" +
  "# الملازم\n" +
  "ملزمة الفصل الأول = 15000</code>";

export const GOVS = ["بغداد", "البصرة", "نينوى", "أربيل", "النجف", "كربلاء", "بابل", "الأنبار", "ديالى",
  "ذي قار", "ميسان", "المثنى", "القادسية", "واسط", "صلاح الدين", "كركوك", "دهوك", "السليمانية"];
export const SIDES = ["الرصافة", "الكرخ"];
export const CURRS = ["عربي", "إنجليزي"];
export const GRADES = ["السادس العلمي", "الخامس العلمي"];
export const EXAMS = ["حضوري", "إلكتروني"];
export const MODE_ICON: Record<string, string> = { both: "🔄 كليهما", in: "🏫 حضوري", online: "💻 إلكتروني" };
export const MODE_NEXT: Record<string, string> = { both: "in", in: "online", online: "both" };
export const DAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]; // 0 = الاثنين
export const DAY_ORDER = [5, 6, 0, 1, 2, 3, 4];                                                // نعرضها من السبت
export const ORD_AR = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];
export const PERMS: Record<string, string> = {
  q: "❓ الأسئلة العلمية", orders: "🖨 الطلبات والطباعة",
  products: "🛒 المنتجات والأسعار والتوصيل", students: "🎓 الطلاب والمراكز",
};

export const BTN_SHOP = "🛒 المتجر";
export const BTN_CANCEL = "❌ إلغاء";
export const BTN_ADMIN = "⚙️ لوحة التحكم";
export const BTN_OPEN = "🛍 افتح المتجر";
export const BTN_REG = "📝 افتح فورمة التسجيل";
export const BTN_ASK = "❓ سؤال علمي";
export const BTN_MYQ = "📂 أسئلتي";
export const BTN_ME = "👤 معلوماتي";
export const BTN_OFFICE = "🏪 مكتبتي";
export const BTN_EXAMS = "📝 امتحاناتي";
export const BTN_SCAN = "📷 افتح الكاميرا";
export const AR_WORD = /^[ء-ْٰ-ۓ]+$/;

export const SEED_CURRIC = `# الأعداد المركبة | Complex Numbers
ما قبل إيجاد x و y | Before Finding x and y = 8
الجذور التربيعية | Square Roots = 2
المعادلة التربيعية | Quadratic Equation = 4
إيجاد قيم x و y | Finding x and y = 2
الأوميگا ω | Omega (Cube Roots of Unity) = 3
الصيغة القطبية وديموافر | Polar Form and De Moivre's Theorem = 6
أشكال آرگاند | Argand Diagrams = 1
# القطوع المخروطية | Conic Sections
القطع المكافئ | Parabola = 5
القطع الناقص والزائد | Ellipse & Hyperbola = 10
الربط | Linking = 4
الانسحاب | Translation = 3
# تطبيقات التفاضل | Applications of Differentiation
الاشتقاقات | Derivatives = 2
الساين والكوساين | Sine and Cosine = 2
المعدلات الزمنية | Related Rates = 8
رول والقيمة المتوسطة | Rolle's Theorem and the Mean Value Theorem = 4
التقريب | Approximation = 5
رسم الدوال | Curve Sketching = 7
الثوابت | Constants = 4
تطبيقات النهايات العظمى والصغرى | Applications of Maxima and Minima = 8
# التكامل | Integration
ممنوع أو مسموح | Allowed or Not Allowed = 4
المتفرقات | Miscellaneous = 2
ln والأسية | ln and Exponential = 2
الحجوم | Volume of Revolution = 1
تطبيقات فيزيائية | Physical Applications = 2
المجاميع العليا والسفلى | The Lower and Upper Rectangles = 3
الدالة المقابلة | Antiderivative = 1
المساحات | Area = 3
الساين والكوساين | Sine and Cosine = 6
# المعادلات التفاضلية | Differential Equations
الهل والإثبات | Verifying Solutions = 2
فصل المتغيرات | Separation of Variables = 3`;

export const SEED_CENTERS: [string, string, string[]][] = [
  ["بغداد", "المنصور", ["قمة النجاح للبنات", "قمة المنصور للبنين"]],
  ["بغداد", "الصليخ", ["قمة صليخ 2"]],
  ["بغداد", "البنوك", ["معهد قصي العميري"]],
  ["بغداد", "زيونة", ["معهد أثر"]],
];
