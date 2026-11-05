# -*- coding: utf-8 -*-
"""يجهز امتحانات فصل واحد للبوت: يقص كل سؤال وجوابه كصور، ويفصل نسخ الطالب، ويكتب catalog.json.
ملفات الامتحانات سرية: كلها داخل data/ وما تنرفع على GitHub.

المطلوب: pip install pymupdf، وتحويل ملفي Word إلى PDF بـ tools/export_word.ps1

الاستخدام:
  python tools/import_exams.py --chapter "الفصل الأول" --slug ch1 \
    --ar data/exams/"الفصل الاول عربي.docx" --ar-pdf data/work/ar.pdf \
    --en data/exams/"الفصل الاول انكلش.docx" --en-pdf data/work/en.pdf \
    --answers data/exams/"الاجوبه النموذجيه" --out data/content/ch1
"""
import argparse, glob, json, os, re, sys, unicodedata, zipfile
import xml.etree.ElementTree as ET
import pymupdf

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
M = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"
# كل أشكال رأس السؤال بالملفات: «س 1 /» و«س /3» و«س1 /» و«س 3 اثبت» و«Q2/»
QRE = re.compile(r"^\s*(?:س|Q)\s*/?\s*(\d+)(?!\d)", re.I)
BARE = re.compile(r"^\s*س\s*/")   # «س / جد...» بدون رقم
# العنوان ممكن قبل «نموذج A» أو بعده
AR_MODEL = re.compile(r"^(?:(.*?)\s*·\s*)?نموذج\s*([A-Za-z]+)\s*(?:·\s*(.*?))?\s*$")
EN_MODEL = re.compile(r"^(?:(.*?)\s*·\s*)?Model\s*([A-Za-z]+)\s*(?:·\s*(.*?))?\s*$", re.I)
SKIP = re.compile(r"اختيارية|مراجع")
MARKS = {5: [20] * 5, 6: [15, 15, 15, 15, 20, 20], 7: [15] * 6 + [10]}
SCALE = 2.5
CONTENT_TOP, CONTENT_BOTTOM = 95, 800     # بين رأس الصفحة وذيلها، بالنقاط
X0, X1 = 32, 566
MIN_HEIGHT = 90                            # تليجرام يرفض الصور الطويلة العريضة جداً


def clean(t):
    return unicodedata.normalize("NFKC", t).replace("‎", "").replace("‏", "").replace("​", "").strip()


def blocks(path):
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    out = []
    for p in root.iter(W + "p"):
        t = clean("".join(n.text or "" for n in p.iter() if n.tag in (W + "t", M + "t")))
        if t:
            out.append(t)
    return out


def parse_versions(path, model_re):
    vs, cur = [], None
    for b in blocks(path):
        m = model_re.match(b)
        if m:
            cur = {"title": (m.group(1) or m.group(3) or "").strip(), "model": m.group(2).upper(), "info": "", "qs": [], "pre": [], "between": []}
            vs.append(cur)
            continue
        if cur is None:
            continue
        q = QRE.match(b)
        if not cur["info"] and not q and not BARE.match(b):
            cur["info"] = b
            continue
        if q:
            cur["qs"].append(int(q.group(1)))
        elif BARE.match(b):
            cur["qs"].append(len(cur["qs"]) + 1)    # الرقم ناقص بالملف، فناخذه من التسلسل
        elif not cur["qs"]:
            cur["pre"].append(b)
        elif not re.match(r"^\W*\d\s*/", b) and re.search(r"[ء-ي]{3}", b) and len(b) < 90 and not re.search(r"[=+]", b):
            cur["between"].append((cur["qs"][-1], b))   # تعليمة بين سؤالين تخص اللي بعدها
    return vs


def group(vs):
    gs = []
    for v in vs:
        if v["model"] == "A" or not gs:
            gs.append([])
        gs[-1].append(v)
    return gs


def minutes_of(info):
    if "ساعة ونصف" in info or "ساعه ونصف" in info:
        return 90
    if "ساعة وربع" in info or "ساعه وربع" in info:
        return 75
    if "ساعة" in info or "ساعه" in info:
        return 60
    return None


def page_lines(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = clean("".join(s["text"] for s in l["spans"]))
            if t:
                out.append((l["bbox"], t))
    return out


def find_labels(lines):
    """رأس السؤال: الحرف والرقم ممكن يطلعون بأسطر منفصلة بنفس الارتفاع"""
    out = []
    for box, t in lines:
        if box[1] < CONTENT_TOP - 5 or box[1] > CONTENT_BOTTOM:
            continue
        m = QRE.match(t)
        if m:
            out.append((box[1], int(m.group(1))))
            continue
        if t == "س" or t.startswith("س ") or t.startswith("س/") or BARE.match(t):
            near = " ".join(x for bx, x in lines if abs((bx[1] + bx[3]) / 2 - (box[1] + box[3]) / 2) < 8 and bx[2] < box[0] + 1 and box[0] - bx[2] < 45)
            d = re.search(r"\d+", near)
            out.append((box[1], int(d.group()) if d else 0))
    out.sort()
    return out


class Sheet:
    """صورة الصفحة، ومعرفة الأسطر الفارغة حتى نقص على الحدود الصحيحة (الخلفية الباهتة ما تنحسب)"""

    def __init__(self, page, ink=175):
        self.pix = page.get_pixmap(matrix=pymupdf.Matrix(SCALE, SCALE), alpha=False)
        g = page.get_pixmap(matrix=pymupdf.Matrix(SCALE, SCALE), colorspace=pymupdf.csGRAY, alpha=False)
        self.x0, self.x1 = int(X0 * SCALE), int(X1 * SCALE)
        self.h = g.height
        s = g.samples
        self.rows = [min(s[r * g.stride + self.x0:r * g.stride + self.x1]) < ink for r in range(g.height)]

    def up(self, y):
        while y > 0 and self.rows[y]:
            y -= 1
        return y

    def trim(self, top, bottom):
        while bottom > top and not self.rows[bottom - 1]:
            bottom -= 1
        return top, bottom

    def has_ink(self, top, bottom):
        return any(self.rows[top:bottom])


def stack(sheets_segments, path):
    width = None
    total = 0
    for sh, a, b in sheets_segments:
        width = sh.x1 - sh.x0
        total += b - a
    pad = max(MIN_HEIGHT - total, 0)
    res = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, width, total + pad), False)
    res.set_rect(res.irect, (255, 255, 255))
    y, n = pad // 2, 3
    for sh, a, b in sheets_segments:
        src = sh.pix
        for r in range(a, b):
            res.samples_mv[y * res.stride:y * res.stride + width * n] = src.samples_mv[r * src.stride + sh.x0 * n:r * src.stride + sh.x1 * n]
            y += 1
    res.save(path)


def strip(sh, top, bottom):
    t, b = sh.trim(top, bottom)
    return sh, max(t - 4, 0), min(b + 6, sh.h)


def crop_question_page(page, version, outdir, problems, tag):
    """يرجع {رقم السؤال: اسم الملف}"""
    lines = page_lines(page)
    labels = find_labels(lines)
    # رأس بدون رقم: ناخذ الرقم من ترتيب الملف
    if [n for _, n in labels if n] != [n for n in version["qs"] if n] and len(labels) == len(version["qs"]):
        labels = [(y, version["qs"][i]) for i, (y, _) in enumerate(labels)]
    else:
        labels = [(y, n or version["qs"][i] if i < len(version["qs"]) else n) for i, (y, n) in enumerate(labels)]
    seen = [n for _, n in labels]
    if seen != version["qs"]:
        problems.append(f"{tag}: أسئلة الصفحة {seen} / الملف {version['qs']}")
    sh = Sheet(page)
    bottom = int(CONTENT_BOTTOM * SCALE)
    tops = [sh.up(int(y * SCALE) + 2) for y, _ in labels]
    pre = None
    if version["pre"] and tops:
        r = int(CONTENT_TOP * SCALE) + 5
        while r < tops[0] and not sh.rows[r]:
            r += 1
        if r < tops[0]:
            pre = strip(sh, r, tops[0])
    # تعليمة بين سؤالين: مكانها فوق السؤال اللي بعدها وتنضاف للأسئلة اللي بعدها
    shared = {}
    for after, text in version["between"]:
        key = re.sub(r"\s+", "", text)[:10]
        hit = next((box for box, t in lines if re.sub(r"\s+", "", t).startswith(key)), None)
        idx = next((i for i, (_, n) in enumerate(labels) if n == after), None)
        if hit is None or idx is None or idx + 1 >= len(labels):
            problems.append(f"{tag}: ما لگيت مكان التعليمة «{text[:30]}»")
            continue
        ins_top = sh.up(int(hit[1] * SCALE) + 2)
        shared[idx] = strip(sh, ins_top, tops[idx + 1])
    files = {}
    active = pre
    for i, (_, n) in enumerate(labels):
        limit = tops[i + 1] if i + 1 < len(labels) else bottom
        if i in shared:
            limit = shared[i][1] + 4
        seg = strip(sh, tops[i], limit)
        name = f"q{n}.png"
        stack(([active] if active else []) + [seg], os.path.join(outdir, name))
        files[n] = name
        if i in shared:
            active = shared[i]
    return files


def crop_answers(pdf_path, want, outdir, problems, tag):
    """الجواب ممكن يمتد على أكثر من صفحة: كل صفحة تصير صورة. يرجع {رقم السؤال: [ملفات]}"""
    doc = pymupdf.open(pdf_path)
    parts, current, note = {}, None, None
    for pno in range(len(doc)):
        page = doc[pno]
        lines = page_lines(page)
        labels = find_labels(lines)
        sh = Sheet(page, ink=250)       # بالأجوبة ماكو خلفية باهتة، وشريط رأس السؤال الفاتح جزء من المحتوى
        top = int(CONTENT_TOP * SCALE)
        bottom = int(CONTENT_BOTTOM * SCALE)
        tops = [sh.up(int(y * SCALE) + 2) for y, _ in labels]
        first = tops[0] if tops else bottom
        # تكملة السؤال من الصفحة السابقة، بس إذا بيها كتابة (مو خط الزينة اللي بأول الصفحة)
        has_text = any(top <= b[1] * SCALE and b[3] * SCALE <= first + 2 for b, _ in lines)
        if current is not None and has_text and sh.has_ink(top, first):
            parts.setdefault(current, []).append(strip(sh, top, first))
        elif current is None and pno == 0:
            # ملاحظة عامة قبل أول سؤال تطلع ويا كل جواب، بدون رأس الصفحة
            box = next((b for b, t in lines if "ملاحظ" in t and int(b[1] * SCALE) < first), None)
            if box:
                note = strip(sh, sh.up(int(box[1] * SCALE) + 2), first)
        for i, (_, n) in enumerate(labels):
            lim = tops[i + 1] if i + 1 < len(labels) else bottom
            n = n or (current + 1 if current else 1)
            # رقم مكرر بالملف: يبقى ويا السؤال نفسه
            parts.setdefault(n, []).append(strip(sh, tops[i], lim))
            current = n
    files = {}
    for n, segs in parts.items():
        names = []
        segs = [s for s in segs if s[2] - s[1] >= 60]    # أقل من هيچ يعني خط زينة، مو كتابة
        for k, seg in enumerate(segs):
            name = f"a{n}_{k + 1}.png"
            stack(([note] if note and k == 0 else []) + [seg], os.path.join(outdir, name))
            names.append(name)
        files[n] = names
    missing = [n for n in want if n not in files]
    if missing:
        problems.append(f"{tag}: ماكو جواب للأسئلة {missing}")
    doc.close()
    return files


def save_pages(doc, outdir, lang):
    """صور صفحات نسخة الطالب، حتى تنعرض داخل صفحة الإدارة"""
    for i in range(len(doc)):
        doc[i].get_pixmap(matrix=pymupdf.Matrix(1.6, 1.6), alpha=False).save(os.path.join(outdir, f"student_{lang}_{i + 1}.png"))


def page_map(doc, model_re_words, count):
    """بداية كل نسخة بملف PDF"""
    starts = []
    for i in range(len(doc)):
        txt = clean(doc[i].get_text())
        if re.search(model_re_words, txt.replace("\n", " ")):
            starts.append(i)
    return starts


def main():
    ap = argparse.ArgumentParser()
    for name in ("chapter", "slug", "ar", "ar-pdf", "en", "en-pdf", "answers", "out"):
        ap.add_argument("--" + name, required=True)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    ar = group(parse_versions(a.ar, AR_MODEL))
    en = group(parse_versions(a.en, EN_MODEL))
    ar_pdf, en_pdf = pymupdf.open(a.ar_pdf), pymupdf.open(a.en_pdf)
    ar_starts = page_map(ar_pdf, r"نموذج\s*[A-Za-z]+", 0)
    en_starts = page_map(en_pdf, r"Model\s*[A-Za-z]+", 0)
    n_ar, n_en = sum(map(len, ar)), sum(map(len, en))
    print(f"نسخ: عربي {n_ar} ({len(ar_starts)} بداية بالـPDF) / إنجليزي {n_en} ({len(en_starts)} بداية بالـPDF)")
    if len(ar_starts) != n_ar or len(en_starts) != n_en:
        raise SystemExit("عدد النسخ بالـPDF ما يطابق ملف Word")
    catalog = {"chapter": a.chapter, "slug": a.slug, "exams": []}
    problems = []
    ai = ei = 0
    ans_dirs = {int(d): d for d in os.listdir(a.answers) if d.isdigit()}
    for number, g in enumerate(ar, 1):
        e = en[number - 1] if number <= len(en) else []
        if SKIP.search(g[0]["title"]):      # ملغية بطلب صاحب الامتحانات
            print(f"تخطي: {g[0]['title']}")
            ai += len(g)
            ei += len(e)
            continue
        info = g[0]["info"]
        exam = {"ord": number, "title": g[0]["title"], "info": info if "الوقت" in info else "", "minutes": minutes_of(info) or 75, "versions": []}
        for v in g:
            model = v["model"]
            tag = f"امتحان {number} ({g[0]['title']}) نسخة {model}"
            outdir = os.path.join(a.out, f"e{number}", model)
            os.makedirs(outdir, exist_ok=True)
            start, end = ar_starts[ai], ar_starts[ai + 1] if ai + 1 < len(ar_starts) else len(ar_pdf)
            ai += 1
            if end - start != 1:
                problems.append(f"{tag}: النسخة بالعربي {end - start} صفحات")
            issues = []
            local = []
            qfiles = crop_question_page(ar_pdf[start], v, outdir, local, tag)
            issues += local
            out_ar = pymupdf.open(); out_ar.insert_pdf(ar_pdf, from_page=start, to_page=end - 1)
            out_ar.save(os.path.join(outdir, "student_ar.pdf")); save_pages(out_ar, outdir, "ar"); out_ar.close()
            ev = next((x for x in e if x["model"] == model), None)
            has_en = False
            if ev:
                idx = ei + [x["model"] for x in e].index(model)
                s2, e2 = en_starts[idx], en_starts[idx + 1] if idx + 1 < len(en_starts) else len(en_pdf)
                out_en = pymupdf.open(); out_en.insert_pdf(en_pdf, from_page=s2, to_page=e2 - 1)
                out_en.save(os.path.join(outdir, "student_en.pdf")); save_pages(out_en, outdir, "en"); out_en.close()
                has_en = True
                if len(ev["qs"]) != len(v["qs"]):
                    issues.append(f"{tag}: عدد الأسئلة بالإنجليزي {len(ev['qs'])} والعربي {len(v['qs'])}")
            else:
                issues.append(f"{tag}: ماكو نسخة إنجليزية")
            answers = {}
            ans_file = None
            if number in ans_dirs:
                for f in glob.glob(os.path.join(a.answers, ans_dirs[number], "*.pdf")):
                    m = re.match(r"^([A-Za-z]+)\s*\d+$", os.path.basename(f)[:-4])
                    if m and m.group(1).upper() == model:
                        ans_file = f
            if ans_file:
                alocal = []
                answers = crop_answers(ans_file, v["qs"], outdir, alocal, tag)
                issues += alocal
            else:
                issues.append(f"{tag}: ماكو ملف أجوبة")
            count = len(v["qs"])
            marks = MARKS.get(count)
            if not marks:
                issues.append(f"{tag}: {count} أسئلة، ما إلها توزيع درجات")
            questions = [{"n": n, "max": marks[i] if marks else 0, "q": qfiles.get(n), "a": answers.get(n, [])} for i, n in enumerate(v["qs"])]
            exam["versions"].append({"model": model, "ok": not issues, "issues": issues, "has_en": has_en, "questions": questions})
            problems += issues
        ei += len(e)
        catalog["exams"].append(exam)
    with open(os.path.join(a.out, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=1)
    total = sum(len(v["questions"]) for ex in catalog["exams"] for v in ex["versions"])
    ready = sum(v["ok"] for ex in catalog["exams"] for v in ex["versions"])
    print(f"امتحانات {len(catalog['exams'])} · نسخ {n_ar} · جاهزة {ready} · أسئلة {total}")
    print("نواقص:", len(problems))
    for p in problems:
        print(" -", p)


if __name__ == "__main__":
    main()
