// جدول امتحانات الكتاب من نظام قصي القديم، بترتيب الكتاب: أول امتحان بكل فصل هو الأول.
// الفصل الأول ملفاته مدخلة أصلاً. هذي عناوين بس، والنسخ والأسئلة تنضاف بعدين
export const BOOK: { slug: string; chapter: string; exams: [string, string][] }[] = [
  { slug: "ch2", chapter: "الفصل الثاني", exams: [
    ["قطع مكافئ 1&2", "Parabola 1&2"], ["قطع مكافئ 3&4", "Parabola 3&4"], ["قطع مكافئ شامل", "All Parabola"],
    ["القطع الناقص والزائد 1&2", "Ellipse & Hyperbola 1&2"], ["القطع الناقص والزائد 3&4", "Ellipse & Hyperbola 3&4"], ["القطع الناقص والزائد 5&6", "Ellipse & Hyperbola 5&6"],
    ["القطع الناقص والزائد 7&8", "Ellipse & Hyperbola 7&8"], ["القطع الناقص والزائد 9&10", "Ellipse & Hyperbola 9&10"],
    ["نصف فاينل (قطع مكافئ، قطع ناقص، قطع زائد)", "Mid Final (Parabola, Ellipse, Hyperbola)"],
    ["ربط القطوع 1&2", "ربط القطوع 1&2"], ["ربط القطوع 3&4", "ربط القطوع 3&4"], ["الانسحاب 1&2&3", "Translation 1&2&3"], ["فاينل", "Final"],
  ] },
  { slug: "ch3", chapter: "الفصل الثالث", exams: [
    ["الاشتقاق 1&2", "Derivation 1&2"], ["اشتقاق الساين والكوساين", "Derivations of the Trigonometric Function"],
    ["المعدلات الزمنية 1&2", "Related Rates 1&2"], ["المعدلات الزمنية 3&4", "Related Rates 3&4"], ["المعدلات الزمنية 5&6", "Related Rates 5&6"], ["المعدلات الزمنية 7&8", "Related Rates 7&8"], ["المعدلات الزمنية شامل", "All Related Rates"],
    ["رول والقيمة المتوسطة 1&2", "Rolle's and Mean Value Theorem 1&2"], ["رول والقيمة المتوسطة 3&4", "Rolle's and Mean Value Theorem 3&4"],
    ["التقريب 1&2&3", "Approximation 1&2&3"], ["التقريب 4&5", "Approximation 4&5"], ["نصف فاينل (من البداية للتقريب داخل)", "Mid Final (from the start to Approximation)"],
    ["رسم الدوال 1&2", "Graph of Function 1&2"], ["رسم الدوال 3&4", "Graph of Function 3&4"], ["رسم الدوال شامل", "All Graph of Function"],
    ["الثوابت 1&2", "Constant 1&2"], ["الثوابت 3&4", "Constant 3&4"],
    ["تطبيقات النهايات العظمى والصغرى المحلية 1&2", "Optimization problems 1&2"], ["تطبيقات النهايات العظمى والصغرى المحلية 3&4", "Optimization problems 3&4"], ["تطبيقات النهايات العظمى والصغرى المحلية 5&6", "Optimization problems 5&6"], ["تطبيقات النهايات العظمى والصغرى المحلية 7&8", "Optimization problems 7&8"],
    ["فقط مسائل (التقريب والمعدلات الزمنية والتطبيقات على النهايات العظمى والصغرى)", "Approximation & Related Rates & Optimization problems only"],
    ["رول والمتوسطة والتقريب والثوابت ورسم الدوال", "Rolle & Mean Value & Approximation & Constant & Graph of Function"], ["فاينل", "Final"], ["إعادة فاينل", "Re-Final"],
  ] },
  { slug: "ch4", chapter: "الفصل الرابع", exams: [
    ["ممنوع لو مسموح 1&2", ""], ["ممنوع لو مسموح 3&4", ""], ["المتفرقات", ""], ["Ln&E", "Ln&E"], ["التطبيقات الفيزيائية", "Physical Applications"], ["الحجوم", "Volume of Revolution"],
    ["نصف فاينل", "Mid Final"], ["ساين وكوساين 1&2", "Sin&Cos 1&2"], ["ساين وكوساين 3&4", "Sin&Cos 3&4"], ["ساين وكوساين 5&6", "Sin&Cos 5&6"],
    ["الدالة المقابلة + المجاميع العليا والسفلى محاضرة 1 فقط", "Antiderivative & The Lower and Upper only Lecture 1"], ["المجاميع العليا والسفلى 1&2&3", "The Lower & Upper 1&2&3"], ["المساحات 1&2&3", "Area 1&2&3"], ["فاينل", "Final"],
  ] },
  { slug: "ch5", chapter: "الفصل الخامس", exams: [["هل والإثبات", ""], ["فصل المتغيرات", "Separation of Variables"], ["فاينل", "Final"]] },
];

// تصحيح الفصل الثالث لمن انضاف الجدول قبل ما تجي صورة العناوين الكاملة
export const OLD_ONLY_PROBLEMS = "فقط مسائل (التقريب والمعدلات الزمنية والتطبيقات على النهايات)";

// أوقات كل مكان مثل ما كتبها قصي: كل يوم إله أوقاته، والطالب يختار وقت لكل يوم بكيفه. الأيام: 0 = الاثنين
const SAT = 5, SUN = 6, MON = 0, TUE = 1, WED = 2, FRI = 4;
export const PLACE_SLOTS: { match: string | null; gender?: string; days: [number, string[]][] }[] = [
  { match: null, days: [[SUN, ["16:00", "20:30", "22:00"]], [WED, ["16:00", "20:30", "22:00"]]] },
  { match: "أثر", days: [[SAT, ["11:00", "12:30", "14:00", "15:30"]], [TUE, ["14:00", "15:30", "17:00", "18:30"]]] },
  { match: "قصي العميري", days: [[FRI, ["09:30", "11:00", "12:30", "14:00"]], [MON, ["13:00", "14:30", "16:00", "17:30"]]] },
  { match: "صليخ 2", days: [[SUN, ["14:00", "15:30", "17:00"]], [WED, ["14:00", "15:30", "17:00"]]] },
  { match: "قمة المنصور للبنين", gender: "بنين", days: [[FRI, ["08:00", "09:30", "11:00"]], [MON, ["14:00", "15:30", "17:00"]]] },
  { match: "قمة النجاح للبنات", gender: "بنات", days: [[SUN, ["14:00", "15:30", "17:00"]], [WED, ["14:00", "15:30", "17:00"]]] },
];
