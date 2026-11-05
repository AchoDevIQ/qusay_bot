# -*- coding: utf-8 -*-
"""يجهز امتحانات فصل من ملفات PDF: كل صفحة نسخة. يقص الأسئلة، ويفصل نسخ الطالب، ويكتب catalog.json.
الجواب النموذجي يبقى ملف كامل لكل نسخة، فما ينقص. ملفات الامتحانات سرية وتبقى داخل data/.

  python tools/import_pages.py --chapter "الفصل الثالث" --slug ch3 --ar ar.pdf --en en.pdf \
    --answers data/exams/ch3/answers --titles titles.json --out data/content/ch3
titles.json: عناوين الامتحانات بالترتيب. النسخ الزايدة بعد آخر عنوان ما تنحسب، وتطلع بالتقرير.
"""
import argparse, json, os, re, sys
import pymupdf
import import_exams
from import_exams import CONTENT_BOTTOM, MARKS, SCALE, Sheet, find_labels, page_lines, save_pages, stack, strip

# بهاي الملفات أول سؤال يبدي أعلى من ملفات الفصل الأول
CONTENT_TOP = import_exams.CONTENT_TOP = 45

BARE_NUM = re.compile(r"^\s*(\d{1,2})\s*/")   # «1/ ∫...» بدون حرف س، وينقبل بس إذا هو الرقم اللي بعده


def model_of(lines):
    top = [t for box, t in lines if box[1] < 125]
    for t in top:
        k = re.search(r"Model\s*([A-Za-z])\b", t)
        if k:
            return k.group(1).upper()
    for t in top:
        k = re.fullmatch(r"([A-Za-z])", t.strip())
        if k:
            return k.group(1).upper()
    for t in top:
        k = re.search(r"(?:^|\s)([A-Z])\s*$", t)
        if k and not re.search(r"[A-Z] [A-Z] [A-Z]", t):
            return k.group(1).upper()
    return None


def labels_of(lines):
    found = {round(y): n for y, n in find_labels(lines)}
    for box, t in lines:
        if CONTENT_TOP - 5 <= box[1] <= CONTENT_BOTTOM:
            m = BARE_NUM.match(t)
            if m:
                found.setdefault(round(box[1]), int(m.group(1)))
    out, last = [], 0
    for y in sorted(found):
        n = found[y]
        # رقم من وسط معادلة ما ينحسب: السؤال اللي بعده بس
        if n in (0, last + 1):
            last += 1
            out.append((y, last))
    # رقم واحد مقري غلط ما يضيع الباقي: رؤوس الأسئلة بترتيبها
    raw = find_labels(lines)
    if len(raw) > len(out):
        out = [(y, i + 1) for i, (y, _) in enumerate(raw)]
    return out


SUB = re.compile(r"^\s*(\d)\s*[)/]")
def branches(lines):
    """سؤال واحد بفروع «1) 2) 3)» وكل فرع إله درجة: يرجع ارتفاع نص السؤال والفروع، أو None"""
    head = next((b[1] for b, t in lines if re.search(r"ارسم كلا|Draw|sketch each|each of", t, re.I) and b[1] >= CONTENT_TOP), None)
    if head is None:
        return None
    below = sorted((b[1], t) for b, t in lines if b[1] > head + 12 and b[1] <= CONTENT_BOTTOM)
    items = [(round(y), int(SUB.match(t).group(1))) for y, t in below if SUB.match(t)]
    if len(items) < 3:
        return None
    # الفرع الأول ممكن بدون رقم بالملف
    if items[0][1] != 1 and below and below[0][0] < items[0][0] - 10:
        items.insert(0, (round(below[0][0]), 1))
    return head, [(y, i + 1) for i, (y, _) in enumerate(items)]


def crop(page, labels, outdir, head=None):
    sh = Sheet(page)
    bottom = int(CONTENT_BOTTOM * SCALE)
    tops = [sh.up(int(y * SCALE) + 2) for y, _ in labels]
    pre = strip(sh, sh.up(int(head * SCALE) + 2), tops[0]) if head is not None and tops else None
    files = {}
    for i, (_, n) in enumerate(labels):
        limit = tops[i + 1] if i + 1 < len(labels) else bottom
        name = f"q{n}.png"
        stack(([pre] if pre else []) + [strip(sh, tops[i], limit)], os.path.join(outdir, name))
        files[n] = name
    return files


def versions(en_doc):
    """نسخ كل امتحان من الملف الإنجليزي، لأن حرف النسخة بي واضح. الصفحة بدون حرف تكملة للي قبلها"""
    groups = []
    for i in range(len(en_doc)):
        m = model_of(page_lines(en_doc[i]))
        if m is None:
            if groups:
                groups[-1][-1]["end"] = i + 1
            continue
        if m == "A" or not groups:
            groups.append([])
        groups[-1].append({"model": m, "start": i, "end": i + 1})
    return groups


def minutes_of(lines):
    text = " ".join(t for b, t in lines if b[1] < 125)
    m = re.search(r"([12]):(\d{2})", text)
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def main():
    ap = argparse.ArgumentParser()
    for name in ("chapter", "slug", "ar", "en", "answers", "titles", "out"):
        ap.add_argument("--" + name, required=True)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    ar, en = pymupdf.open(a.ar), pymupdf.open(a.en)
    if len(ar) != len(en):
        raise SystemExit(f"صفحات العربي {len(ar)} والإنجليزي {len(en)} ما متساوية")
    titles = json.load(open(a.titles, encoding="utf-8"))
    groups = versions(en)
    report = {"chapter": a.chapter, "groups": len(groups), "titles": len(titles), "extra": [len(g) for g in groups[len(titles):]], "versions": []}
    catalog = {"chapter": a.chapter, "slug": a.slug, "exams": []}
    for number, g in enumerate(groups[:len(titles)], 1):
        title, info = titles[number - 1]
        first = page_lines(ar[g[0]["start"]])
        exam = {"ord": number, "title": title, "info": info, "minutes": minutes_of(first) or 75, "versions": []}
        for v in g:
            model = v["model"]
            outdir = os.path.join(a.out, f"e{number}", model)
            os.makedirs(outdir, exist_ok=True)
            ar_lines = page_lines(ar[v["start"]])
            labels = labels_of(ar_lines)
            en_labels = labels_of(page_lines(en[v["start"]]))
            parts = branches(ar_lines) if len(labels) <= 1 else None
            if parts:
                labels = parts[1]
                en_parts = branches(page_lines(en[v["start"]]))
                en_labels = en_parts[1] if en_parts else labels
            files = crop(ar[v["start"]], labels, outdir, parts[0] if parts else None)
            for lang, doc in (("ar", ar), ("en", en)):
                one = pymupdf.open()
                one.insert_pdf(doc, from_page=v["start"], to_page=v["end"] - 1)
                one.save(os.path.join(outdir, f"student_{lang}.pdf"))
                save_pages(one, outdir, lang)
                one.close()
            issues = []
            if not labels:
                issues.append("ما گدرت أقص أسئلتها")
            if len(labels) != len(en_labels):
                issues.append(f"عدد الأسئلة: عربي {len(labels)} وإنجليزي {len(en_labels)}")
            if v["end"] - v["start"] > 1:
                issues.append(f"النسخة {v['end'] - v['start']} صفحات")
            if not os.path.exists(os.path.join(a.answers, str(number), f"{model} {number}.pdf")):
                issues.append("ماكو ملف حلول")
            marks = MARKS.get(len(labels))
            if not marks:
                issues.append(f"{len(labels)} أسئلة، درجاتها تحتاج تحديد")
            qs = [{"n": n, "max": marks[i] if marks else 0, "q": files.get(n), "a": []} for i, (_, n) in enumerate(labels)]
            exam["versions"].append({"model": model, "ok": not issues, "issues": issues, "has_en": True, "questions": qs})
            report["versions"].append({"exam": number, "title": title, "model": model, "q": len(labels), "qEn": len(en_labels), "issues": issues, "page": v["start"] + 1})
        catalog["exams"].append(exam)
        print(number, title, len(g), flush=True)
    os.makedirs(a.out, exist_ok=True)
    json.dump(catalog, open(os.path.join(a.out, "catalog.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(report, open(os.path.join(a.out, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    bad = [v for v in report["versions"] if v["issues"]]
    print(f"انتهى: {len(report['versions'])} نسخة، بيها ملاحظات {len(bad)}، مجاميع زايدة {report['extra']}")


if __name__ == "__main__":
    main()
