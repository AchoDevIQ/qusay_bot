# يضيف «گ چ ژ ک ی» لخط Tajawal من قطع الخط نفسه، حتى الحرف يطلع ويا الكلمة بنفس الخط.
# Tajawal ما بيه هالحروف، فچان المتصفح ياخذها من خط ثاني وتطلع غير عن باقي الكلمة.
#   ک = ك بلا الهمزة الصغيرة جوة، وبالشكل المنفصل والأخير تنضاف إله الشحطة المايلة مثل ک الأولى
#   گ = ک ووياها شحطة ثانية فوكها، موازية إلها
#   چ = ج بس نقطها ثلاث من «پ»
#   ژ = ز بس نقطها ثلاث من «ث»
#   ی = ى بالآخر، و ي بالأول والوسط
# تشغيل: python tools/build_iraqi_font.py assets/fonts/Tajawal-Bold.ttf assets/fonts/TajawalIQ-Bold.ttf
import sys
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphCoordinates
from fontTools.pens.ttGlyphPen import TTGlyphPen

src, out = sys.argv[1], sys.argv[2]
f = TTFont(src)
glyf, hmtx, cmap = f["glyf"], f["hmtx"], f.getBestCmap()
gsub = f["GSUB"].table


def contours(name):
    g = glyf[name]
    c, ends, flags = g.getCoordinates(glyf)
    out, st = [], 0
    for e in ends:
        out.append([(int(c[i][0]), int(c[i][1]), flags[i] & 1) for i in range(st, e + 1)])
        st = e + 1
    return out


def bbox(cs):
    xs = [p[0] for c in cs for p in c]; ys = [p[1] for c in cs for p in c]
    return min(xs), min(ys), max(xs), max(ys)


def move(cs, dx, dy):
    return [[(x + dx, y + dy, on) for x, y, on in c] for c in cs]


def poly(pts):
    return [[(x, y, 1) for x, y in pts]]


def make(name, cs, adv_from):
    pen = TTGlyphPen(None)
    for c in cs:
        # نقاط TrueType: on-curve و off-curve (تربيعية)
        pen.moveTo(c[0][:2]) if c[0][2] else None
        pts = c if c[0][2] else c[1:] + c[:1]
        if not c[0][2]:
            pen.moveTo(pts[-1][:2])
        buf = []
        for x, y, on in (pts[1:] if c[0][2] else pts[:-1]):
            if on:
                if buf:
                    pen.qCurveTo(*buf, (x, y)); buf = []
                else:
                    pen.lineTo((x, y))
            else:
                buf.append((x, y))
        if buf:
            pen.qCurveTo(*buf, None if False else (pts[0][:2] if c[0][2] else pts[-1][:2]))
        pen.closePath()
    g = pen.glyph()
    order = f.getGlyphOrder()
    if name not in order:
        f.setGlyphOrder(order + [name])
    glyf[name] = g
    g.recalcBounds(glyf)
    hmtx[name] = (hmtx[adv_from][0], g.xMin if hasattr(g, "xMin") else 0)
    return name


# ---- الشكل: init / medi / fina لكل حرف بالخط
def forms_of(g):
    res = {}
    for fr in gsub.FeatureList.FeatureRecord:
        if fr.FeatureTag not in ("init", "medi", "fina"):
            continue
        for li in fr.Feature.LookupListIndex:
            for st in gsub.LookupList.Lookup[li].SubTable:
                m = getattr(st, "mapping", None)
                if m and g in m:
                    res[fr.FeatureTag] = m[g]
    return res


def add_form(tag, base, form):
    for fr in gsub.FeatureList.FeatureRecord:
        if fr.FeatureTag != tag:
            continue
        for li in fr.Feature.LookupListIndex:
            for st in gsub.LookupList.Lookup[li].SubTable:
                if getattr(st, "mapping", None) is not None:
                    st.mapping[base] = form
                    return
    raise SystemExit(f"no {tag} lookup")


kaf = cmap[0x0643]; kf = forms_of(kaf)
# الشحطة المايلة فوك ك الأولى/الوسطى (من نقاط الخط نفسه)
stroke = [(57, 419), (260, 645), (387, 645), (205, 441)]
# مكان الجذع بالمنفصل والأخير: الشحطة تنزاح لهناك
SDX = 807 - 387
# شحطة گ الثانية: نفس الشحطة الأولى منقولة لفوك ولليسار (موازية إلها)، وأقصر من جوة شوية
BAR_T = (-118, 106)
def bar(dx=0):
    k1 = 203 / 226; k2 = 182 / 204
    tx, ty = BAR_T
    y0, y1 = 590, 645 + ty
    lx = lambda y: round(57 + tx + (y - 419 - ty) * k1)
    rx = lambda y: round(205 + tx + (y - 441 - ty) * k2)
    return poly([(lx(y0) + dx, y0), (lx(y1) + dx, y1), (rx(y1) + dx, y1), (rx(y0) + dx, y0)])


keheh = {
    "isol": contours(kaf)[:1] + move(poly(stroke), SDX, 0),
    "fina": contours(kf["fina"])[:1] + move(poly(stroke), SDX, 0),
    "init": contours(kf["init"]),
    "medi": contours(kf["medi"]),
}
adv = {"isol": kaf, "fina": kf["fina"], "init": kf["init"], "medi": kf["medi"]}
gaf = {k: v + (bar(SDX) if k in ("isol", "fina") else bar()) for k, v in keheh.items()}


def dots_like(target_dot, three):
    """النقطة الوحدة تتبدل بثلاث نقاط، بنفس مركزها"""
    x0, y0, x1, y1 = bbox([target_dot]); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    a0, b0, a1, b1 = bbox(three); tx, ty = (a0 + a1) / 2, (b0 + b1) / 2
    return move(three, round(cx - tx), round(cy - ty))


peh3 = contours(cmap[0x067E])[1:]          # ثلاث نقاط تحت
theh3 = contours(cmap[0x062B])[:3]          # ثلاث نقاط فوك
jeem = cmap[0x062C]; jf = forms_of(jeem)
tcheh = {}
for k, n in {"isol": jeem, **jf}.items():
    cs = contours(n)
    body = max(cs, key=lambda c: len(c)); dot = min(cs, key=lambda c: len(c))
    d3 = dots_like(dot, peh3)
    if k in ("isol", "fina"):
        # جوة الكرشة: النقاط تنزل شوية حتى ما تلزق بالخط اللي فوكها
        d3 = move(d3, 0, -60)
    tcheh[k] = [body] + d3
tadv = {"isol": jeem, **jf}
zain = cmap[0x0632]; zf = forms_of(zain)
jeh = {}
for k, n in {"isol": zain, **zf}.items():
    cs = contours(n)
    body = max(cs, key=lambda c: len(c)); dot = min(cs, key=lambda c: len(c))
    jeh[k] = [body] + move(dots_like(dot, theh3), 0, 40)
zadv = {"isol": zain, **zf}
alefmaks = cmap[0x0649]; yeh = cmap[0x064A]
amf, yf = forms_of(alefmaks), forms_of(yeh)
fyeh = {"isol": contours(alefmaks), "fina": contours(amf["fina"]), "init": contours(yf["init"]), "medi": contours(yf["medi"])}
yadv = {"isol": alefmaks, "fina": amf["fina"], "init": yf["init"], "medi": yf["medi"]}

# الحرف، أشكاله، والأحرف الجاهزة بيونيكود (Presentation Forms)
LETTERS = [
    (0x06A9, "keheh", keheh, adv, {"isol": 0xFB8E, "fina": 0xFB8F, "init": 0xFB90, "medi": 0xFB91}),
    (0x06AF, "gaf", gaf, adv, {"isol": 0xFB92, "fina": 0xFB93, "init": 0xFB94, "medi": 0xFB95}),
    (0x0686, "tcheh", tcheh, tadv, {"isol": 0xFB7A, "fina": 0xFB7B, "init": 0xFB7C, "medi": 0xFB7D}),
    (0x0698, "jeh", jeh, zadv, {"isol": 0xFB8A, "fina": 0xFB8B}),
    (0x06CC, "yehfarsi", fyeh, yadv, {"isol": 0xFBFC, "fina": 0xFBFD, "init": 0xFBFE, "medi": 0xFBFF}),
]
gdef = f["GDEF"].table if "GDEF" in f else None
for code, nm, shapes, advs, pres in LETTERS:
    names = {}
    for k, cs in shapes.items():
        names[k] = make(f"{nm}.{k}" if k != "isol" else f"uni{code:04X}", cs, advs[k])
    for t in f["cmap"].tables:
        if t.isUnicode():
            t.cmap[code] = names["isol"]
            for k, u in pres.items():
                t.cmap[u] = names[k]
    for k in ("init", "medi", "fina"):
        if k in names:
            add_form(k, names["isol"], names[k])
    if gdef and gdef.GlyphClassDef:
        for n in names.values():
            gdef.GlyphClassDef.classDefs[n] = 1

# اسم الخط: نسخة معدلة، فتاخذ اسم غير
for rec in f["name"].names:
    if rec.nameID in (1, 4, 16):
        rec.string = "QMath Arabic"
    elif rec.nameID == 6:
        rec.string = "QMathArabic-Bold"
for t in ("hdmx", "LTSH", "VDMX"):
    if t in f:
        del f[t]
f.save(out)
print("ok", out)
