# -*- coding: utf-8 -*-
"""
بوت قصي العميري: المتجر + الأسئلة العلمية  (النسخة 8)
يشتغل ببايثون فقط، ما يحتاج تنصيب أي مكتبة.
التوكن ورقم حسابك بملف settings.txt بنفس المجلد.
التشغيل:  python bot.py
"""
import json, re, time, sqlite3, html, urllib.request, urllib.error, urllib.parse, os, traceback, uuid, base64, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "store.db")
SETTINGS = os.path.join(HERE, "settings.txt")
BANNER = os.path.join(HERE, "banner.jpg")
SUCCESS = os.path.join(HERE, "success.jpg")
LOGO = os.path.join(HERE, "logo.png")
PDF_DIR = os.path.join(HERE, "pdf")

DEFAULT_FEE = 5000
CURRENCY = "د.ع"
AGREE_TIMES = 3
NO_REFUND = "⚠️ <b>تنبيه مهم</b>\n\nجميع المشتريات <b>غير قابلة للإرجاع إطلاقاً ولأي سبب كان</b>."
SUCCESS_TEXT = ("✅ <b>تم استلام طلبك بنجاح</b>  (رقم الطلب <b>#%d</b>)\n\n"
                "🚚 سيصلك الطلب خلال مدة من <b>12 ساعة إلى 48 ساعة</b>.\n\n"
                "⚠️ وللتذكير: جميع المشتريات <b>غير قابلة للإرجاع إطلاقاً ولأي سبب كان</b>.")

GOVS = ["بغداد", "البصرة", "نينوى", "أربيل", "النجف", "كربلاء", "بابل", "الأنبار", "ديالى",
        "ذي قار", "ميسان", "المثنى", "القادسية", "واسط", "صلاح الدين", "كركوك", "دهوك", "السليمانية"]
SIDES = ["الرصافة", "الكرخ"]
CURRS = ["عربي", "إنجليزي"]

BTN_SHOP = "🛒 المتجر"
BTN_CANCEL = "❌ إلغاء"
BTN_ADMIN = "⚙️ لوحة التحكم"
BTN_OPEN = "🛍 افتح المتجر"
BTN_REG = "📝 افتح فورمة التسجيل"

AR_NAME = r"[\u0621-\u0652\u0670-\u06D3]+"
AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


# ---------------------------------------------------------------- الإعدادات
def load_settings():
    token, admins, url = "", [], ""
    if os.path.exists(SETTINGS):
        for line in open(SETTINGS, encoding="utf-8-sig"):
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip().upper(), v.strip().strip('"').strip()
            if k == "TOKEN":
                token = v
            elif k in ("ADMIN", "ADMIN_ID", "ADMIN_IDS"):
                admins = [int(x) for x in re.findall(r"\d+", v.translate(AR_DIGITS))]
            elif k in ("STORE", "STORE_URL"):
                url = v if v.startswith("https://") else ""
    return token, admins, url


TOKEN, ADMIN_IDS, STORE_URL = load_settings()
API = "https://api.telegram.org/bot%s/" % TOKEN


# ---------------------------------------------------------------- قاعدة البيانات
def db():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price INTEGER, active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS cats(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS fees(gov TEXT PRIMARY KEY, fee INTEGER);
        CREATE TABLE IF NOT EXISTS sessions(user_id INTEGER PRIMARY KEY, state TEXT, data TEXT);
        CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
        CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT,
            name TEXT, gov TEXT, side TEXT, area TEXT, phone1 TEXT, phone2 TEXT, items TEXT,
            subtotal INTEGER, fee INTEGER, total INTEGER, created TEXT);
        """)
        cols = [r["name"] for r in c.execute("PRAGMA table_info(products)")]
        ocols = [r["name"] for r in c.execute("PRAGMA table_info(orders)")]
        if "curr" not in ocols:
            c.execute("ALTER TABLE orders ADD COLUMN curr TEXT")
        if "printed" not in ocols:
            c.execute("ALTER TABLE orders ADD COLUMN printed INTEGER DEFAULT 0")
        if "seller" not in ocols:
            c.execute("ALTER TABLE orders ADD COLUMN seller INTEGER")
        if "office_id" not in ocols:
            c.execute("ALTER TABLE orders ADD COLUMN office_id INTEGER")
        if "settle_id" not in ocols:
            c.execute("ALTER TABLE orders ADD COLUMN settle_id INTEGER")
        if "cat_id" not in cols:
            c.execute("ALTER TABLE products ADD COLUMN cat_id INTEGER")
        if c.execute("SELECT COUNT(*) n FROM products WHERE active=1 AND cat_id IS NULL").fetchone()["n"]:
            cid = cat_id_for(c, "منتجات أخرى")
            c.execute("UPDATE products SET cat_id=? WHERE cat_id IS NULL", (cid,))
        for g in GOVS:
            c.execute("INSERT OR IGNORE INTO fees(gov, fee) VALUES(?, ?)", (g, DEFAULT_FEE))


def cat_id_for(c, name):
    name = name.strip()
    r = c.execute("SELECT id, active FROM cats WHERE name=?", (name,)).fetchone()
    if r:
        if not r["active"]:
            c.execute("UPDATE cats SET active=1 WHERE id=?", (r["id"],))
        return r["id"]
    return c.execute("INSERT INTO cats(name) VALUES(?)", (name,)).lastrowid


def kv_get(k):
    with db() as c:
        r = c.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
        return r["v"] if r else None


def kv_set(k, v):
    with db() as c:
        c.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (k, v))


def cats():
    """الأقسام اللي بيها منتجات"""
    with db() as c:
        return [dict(r) for r in c.execute(
            """SELECT cats.id, cats.name, COUNT(products.id) n FROM cats
               JOIN products ON products.cat_id=cats.id AND products.active=1
               WHERE cats.active=1 GROUP BY cats.id ORDER BY cats.id""")]


def all_cats():
    with db() as c:
        return [dict(r) for r in c.execute(
            """SELECT cats.id, cats.name, COUNT(products.id) n FROM cats
               LEFT JOIN products ON products.cat_id=cats.id AND products.active=1
               WHERE cats.active=1 GROUP BY cats.id ORDER BY cats.id""")]


def cat(cid):
    with db() as c:
        r = c.execute("SELECT * FROM cats WHERE id=? AND active=1", (cid,)).fetchone()
        return dict(r) if r else None


def products(cid=None):
    with db() as c:
        if cid is None:
            q = c.execute("""SELECT products.* FROM products JOIN cats ON cats.id=products.cat_id AND cats.active=1
                             WHERE products.active=1 ORDER BY products.id""")
        else:
            q = c.execute("SELECT * FROM products WHERE active=1 AND cat_id=? ORDER BY id", (cid,))
        return [dict(r) for r in q]


def product(pid):
    with db() as c:
        r = c.execute("""SELECT products.* FROM products JOIN cats ON cats.id=products.cat_id AND cats.active=1
                         WHERE products.id=? AND products.active=1""", (pid,)).fetchone()
        return dict(r) if r else None


def fee_of(gov):
    with db() as c:
        r = c.execute("SELECT fee FROM fees WHERE gov=?", (gov,)).fetchone()
        return r["fee"] if r else DEFAULT_FEE


def get_session(uid):
    with db() as c:
        r = c.execute("SELECT state, data FROM sessions WHERE user_id=?", (uid,)).fetchone()
    if not r:
        return "", {}
    return r["state"] or "", json.loads(r["data"] or "{}")


def set_session(uid, state, data):
    with db() as c:
        c.execute("INSERT OR REPLACE INTO sessions(user_id, state, data) VALUES(?,?,?)",
                  (uid, state, json.dumps(data, ensure_ascii=False)))


# ---------------------------------------------------------------- تليجرام
def _parse(r):
    try:
        return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return {"ok": False, "description": str(e)}


def api(method, **params):
    data = json.dumps(params).encode("utf-8")
    req = urllib.request.Request(API + method, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=70) as r:
            res = _parse(r)
    except urllib.error.HTTPError as e:
        res = _parse(e)
    except Exception as e:
        if method == "getUpdates":
            raise
        print("Connection problem:", method, e)
        return None
    if not res.get("ok"):
        d = res.get("description", "")
        if "message is not modified" not in d:
            print("Telegram error:", method, d)
    return res.get("result")


def api_upload(method, fields, file_field, path, fname="banner.jpg", ctype="image/jpeg"):
    """رفع ملف من الحاسبة (صورة أو PDF)"""
    b = uuid.uuid4().hex
    body = b""
    for k, v in fields.items():
        body += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (b, k, v)).encode("utf-8")
    body += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\nContent-Type: %s\r\n\r\n" % (b, file_field, fname, ctype)).encode("utf-8")
    body += open(path, "rb").read() + ("\r\n--%s--\r\n" % b).encode("utf-8")
    req = urllib.request.Request(API + method, data=body, headers={"Content-Type": "multipart/form-data; boundary=" + b})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = _parse(r)
    except urllib.error.HTTPError as e:
        res = _parse(e)
    except Exception as e:
        print("Connection problem:", method, e)
        return None
    if not res.get("ok"):
        print("Telegram error:", method, res.get("description"))
    return res.get("result")


def send(chat, text, kb=None, reply_kb=None):
    p = {"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
    if kb is not None:
        p["reply_markup"] = {"inline_keyboard": kb}
    elif reply_kb is not None:
        p["reply_markup"] = reply_kb
    return api("sendMessage", **p)


def edit(chat, mid, text, kb=None):
    p = {"chat_id": chat, "message_id": mid, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
    if kb is not None:
        p["reply_markup"] = {"inline_keyboard": kb}
    return api("editMessageText", **p)


def send_image(chat, path, key, caption, reply_kb):
    """يرسل صورة من مجلد البوت (أول مرة يرفعها، بعدين يستخدم النسخة المحفوظة بالتليجرام)"""
    if not os.path.exists(path):
        return send(chat, caption, reply_kb=reply_kb)
    stamp = str(int(os.path.getmtime(path)))
    fid = kv_get(key + "_id")
    if fid and kv_get(key + "_stamp") == stamp:
        r = api("sendPhoto", chat_id=chat, photo=fid, caption=caption, parse_mode="HTML", reply_markup=reply_kb)
        if r:
            return r
    r = api_upload("sendPhoto", {"chat_id": chat, "caption": caption, "parse_mode": "HTML",
                                 "reply_markup": json.dumps(reply_kb)}, "photo", path)
    if r and isinstance(r, dict) and r.get("photo"):
        kv_set(key + "_id", r["photo"][-1]["file_id"]); kv_set(key + "_stamp", stamp)
    elif not r:
        send(chat, caption, reply_kb=reply_kb)
    return r


def send_banner(chat, caption, reply_kb):
    return send_image(chat, BANNER, "banner", caption, reply_kb)


def chapter_label(name):
    m = re.search(r"الفصل\s+(ال\S+(?:\s+و\S+)?)", name or "")
    return ("الفصل " + m.group(1)) if m else None


def online_only():
    try:
        return json.loads(kv_get("online_only") or "[]")
    except Exception:
        return []


def mode_ok(p, s):
    m = p.get("mode") or "both"
    if m == "both" or not s or not s.get("exam"):
        return True
    if s["exam"] == "حضوري" and chapter_label(p["name"]) in online_only():
        return m != "in"            # الفصل خلص حضوري: يشوف الإلكتروني بداله
    return (m == "in") == (s["exam"] == "حضوري")


def store_link(uid=None):
    """رابط صفحة المتجر ويه المنتجات والأسعار الحالية ومعلومات الطالب"""
    s = student(uid) if uid else None
    c = []
    for ct in cats():
        ps = [[p["id"], p["name"], p["price"]] for p in products(ct["id"]) if mode_ok(p, s)]
        if ps:
            c.append([ct["name"], ps])
    d = {"c": c, "g": GOVS, "f": [fee_of(g) for g in GOVS]}
    if s and s.get("exam") == "حضوري":
        labels = sorted({chapter_label(p[1]) for ct in c for p in ct[1]} & set(online_only()))
        if labels:
            d["w"] = labels
    if s:
        d["p"] = {"n": s["name"], "cu": s["curr"], "g": s["gov"], "s": s.get("side") or "", "a": s["area"],
                  "p1": s["phone1"], "p2": s["phone2"]}
    raw = json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    # v= رقم يتغير حتى التليجرام ما يفتح نسخة قديمة محفوظة من الصفحة
    return STORE_URL + "?v=%d&d=" % int(time.time()) + base64.urlsafe_b64encode(raw).decode().rstrip("=")


def store_kb(uid=None):
    return {"keyboard": [[{"text": BTN_OPEN, "web_app": {"url": store_link(uid)}}], [{"text": BTN_CANCEL}]],
            "resize_keyboard": True}


def btn(text, data):
    return {"text": text, "callback_data": data}


def money(n):
    return "{:,} {}".format(int(n), CURRENCY)


def esc(s):
    return html.escape(str(s))


def new_orders_count():
    with db() as c:
        return c.execute("SELECT COUNT(*) n FROM orders WHERE IFNULL(printed,0)=0").fetchone()["n"]


def admin_btn(uid):
    n = new_orders_count() if can(uid, "orders") else 0
    return BTN_ADMIN + ("  🔴 %d" % n if n else "")


def main_kb(uid):
    rows = [[{"text": BTN_SHOP}, {"text": BTN_ASK}], [{"text": BTN_MYQ}, {"text": BTN_ME}]]
    if is_staff(uid):
        rows.append([{"text": admin_btn(uid)}])
    elif my_office(uid):
        rows.append([{"text": BTN_OFFICE}])
    return {"keyboard": rows, "resize_keyboard": True}


def flow_kb():
    return {"keyboard": [[{"text": BTN_CANCEL}]], "resize_keyboard": True}


# ---------------------------------------------------------------- المتجر (الطالب)
def clean_cart(cart):
    ids = {str(p["id"]) for p in products()}
    return {k: v for k, v in cart.items() if k in ids and v > 0}


def cart_lines(cart):
    lines, total = [], 0
    for pid, q in cart.items():
        p = product(int(pid))
        if p:
            lines.append("• %s × %d = %s" % (esc(p["name"]), q, money(q * p["price"])))
            total += q * p["price"]
    if not lines:
        return []
    return ["", "<b>🛒 سلتك:</b>"] + lines + ["<b>مجموع المنتجات: %s</b>" % money(total)]


def cart_buttons(cart):
    if cart:
        return [[btn("✅ إكمال الطلب", "checkout"), btn("🗑 تفريغ السلة", "clear")]]
    return []


def home_view(cart):
    cs = cats()
    if not cs:
        return "لا توجد منتجات حاليا.", [[btn("🔄 تحديث", "home")]]
    text = "\n".join(["<b>🛍 أقسام المتجر</b>", "", "اختر القسم:"] + cart_lines(cart))
    kb = [[btn("📂 %s  (%d)" % (c["name"], c["n"]), "cat:%d" % c["id"])] for c in cs]
    return text, kb + cart_buttons(cart)


def cat_view(cid, cart):
    c = cat(cid)
    ps = products(cid) if c else []
    if not ps:
        return home_view(cart)
    lines = ["<b>📂 %s</b>" % esc(c["name"]), ""]
    for i, p in enumerate(ps, 1):
        lines.append("%d) %s — <b>%s</b>" % (i, esc(p["name"]), money(p["price"])))
    lines += ["", "اضغط على المنتج حتى تضيفه للسلة ➕"]
    kb = []
    for p in ps:
        q = cart.get(str(p["id"]), 0)
        if q:
            kb.append([btn("✅ %s × %d" % (p["name"], q), "add:%d" % p["id"]), btn("➖", "sub:%d" % p["id"])])
        else:
            kb.append([btn("➕ %s — %s" % (p["name"], money(p["price"])), "add:%d" % p["id"])])
    kb.append([btn("⬅️ رجوع للأقسام", "home")])
    return "\n".join(lines + cart_lines(cart)), kb + cart_buttons(cart)


def agree_view(n):
    return NO_REFUND, [[btn("✅ موافق", "agree")]]


def after_agree(chat, uid, data):
    """بعد الموافقة الثالثة: يفتح المتجر"""
    if STORE_URL:
        set_session(uid, "store", data)
        send(chat, "🛍 اضغط زر <b>«%s»</b> اللي جوه الشاشة 👇\nتنفتح لك صفحة المتجر: اختار المنتجات واملي معلوماتك." % BTN_OPEN,
             reply_kb=store_kb(uid))
    else:
        set_session(uid, "cart", data)
        t, kb = home_view(clean_cart(data.get("cart", {})))
        send(chat, t, kb)


def open_shop(chat, uid):
    if not student(uid):
        send(chat, "حتى تطلب من المتجر، سجّل معلوماتك أول مرة 👇")
        start_reg(chat, uid, "shop"); return
    st, data = get_session(uid)
    data["cart"] = clean_cart(data.get("cart", {}))
    if data.get("agreed", 0) < AGREE_TIMES:
        data["agreed"] = 0
        set_session(uid, "agree", data)
        t, kb = agree_view(0)
        send(chat, t, kb)
        return
    after_agree(chat, uid, data)


def gov_kb(prefix="gov:"):
    kb, row = [], []
    for i, g in enumerate(GOVS):
        row.append(btn(g, prefix + "%d" % i))
        if len(row) == 3:
            kb.append(row); row = []
    if row:
        kb.append(row)
    return kb


def summary(data):
    cart = clean_cart(data.get("cart", {}))
    lines = ["<b>🧾 ملخص طلبك</b>", "", "<b>المنتجات:</b>"]
    sub, items = 0, []
    for pid, q in cart.items():
        p = product(int(pid))
        if not p:
            continue
        lines.append("• %s × %d — %s" % (esc(p["name"]), q, money(q * p["price"])))
        sub += q * p["price"]
        items.append({"name": p["name"], "qty": q, "price": p["price"]})
    fee = fee_of(data["gov"])
    place = data["gov"] + (" - " + data["side"] if data.get("side") else "")
    lines += ["",
              "مجموع المنتجات: %s" % money(sub),
              "سعر التوصيل (%s): %s" % (esc(data["gov"]), money(fee)),
              "<b>💰 المبلغ الكلي المطلوب: %s</b>" % money(sub + fee),
              "",
              "<b>معلوماتك:</b>",
              "الاسم: %s" % esc(data["name"]),
              "المنهج: %s" % esc(data.get("curr", "")),
              "المحافظة: %s" % esc(place),
              "المنطقة: %s" % esc(data["area"]),
              "الهاتف 1: %s" % esc(data["phone1"]),
              "الهاتف 2: %s" % esc(data["phone2"]),
              "",
              "⚠️ جميع المشتريات غير قابلة للإرجاع إطلاقاً ولأي سبب كان.",
              "",
              "هل توافق على المبلغ الكلي <b>%s</b> وتأكيد الطلب؟" % money(sub + fee)]
    return "\n".join(lines), items, sub, fee


def check_phone(t):
    t = t.replace(" ", "").replace("-", "")
    if re.search(r"[٠-٩۰-۹]", t):
        return None, "⚠️ اكتب الرقم <b>بالأرقام الإنجليزية</b> مو العربية.\nمثال: <code>07701234567</code>"
    if not re.fullmatch(r"07\d{9}", t):
        return None, "⚠️ الرقم غير صحيح. لازم يكون 11 رقم ويبدأ بـ 07 وبالإنجليزي.\nمثال: <code>07701234567</code>"
    return t, None


def on_student_text(chat, uid, text, st, data):
    if st == "name":
        words = text.split()
        if len(words) < 4 or not all(re.fullmatch(AR_NAME, w) for w in words):
            send(chat, "⚠️ اكتب اسمك <b>الرباعي</b> (أربع كلمات على الأقل) <b>بالحروف العربية فقط</b>.")
            return
        data["name"] = " ".join(words)
        set_session(uid, "curr", data)
        send(chat, "📘 اختر منهجك:", [[btn("📗 " + c, "curr:%d" % i) for i, c in enumerate(CURRS)]])
    elif st == "store":
        send(chat, "اضغط زر «%s» اللي جوه الشاشة 👇" % BTN_OPEN, reply_kb=store_kb(uid))
    elif st in ("gov", "side", "agree", "curr"):
        send(chat, "⚠️ اضغط على الأزرار فوق 👆")
    elif st == "area":
        if len(text) < 2:
            send(chat, "⚠️ اكتب اسم المنطقة."); return
        data["area"] = text
        set_session(uid, "phone1", data)
        send(chat, "📞 اكتب رقم الهاتف الأول <b>بالإنجليزي</b>\nمثال: <code>07701234567</code>")
    elif st == "phone1":
        ph, err = check_phone(text)
        if err:
            send(chat, err); return
        data["phone1"] = ph
        set_session(uid, "phone2", data)
        send(chat, "📞 اكتب رقم الهاتف الثاني <b>بالإنجليزي</b> (لازم يختلف عن الأول)")
    elif st == "phone2":
        ph, err = check_phone(text)
        if err:
            send(chat, err); return
        if ph == data.get("phone1"):
            send(chat, "⚠️ الرقم الثاني لازم يختلف عن الأول."); return
        data["phone2"] = ph
        set_session(uid, "confirm", data)
        text2, items, sub, fee = summary(data)
        if not items:
            set_session(uid, "", {})
            send(chat, "سلتك فارغة، ارجع للمتجر واختر منتجات.", reply_kb=main_kb(uid)); return
        send(chat, text2, [[btn("✅ نعم، أوافق وأؤكد الطلب", "confirm")],
                           [btn("✏️ تعديل المنتجات", "editcart"), btn("❌ إلغاء", "cancel")]])
    elif st == "confirm":
        send(chat, "⚠️ اضغط على أحد الأزرار: تأكيد أو تعديل أو إلغاء 👆")
    elif st == "cart":
        send(chat, "اختر المنتجات من الأزرار فوق 👆 ثم اضغط «إكمال الطلب».")
    else:
        send(chat, "أهلا بك 🌷 اضغط «%s» حتى تشوف المنتجات." % BTN_SHOP, reply_kb=main_kb(uid))


ORDER_READY = ("📦 <b>تم تجهيز طلبك #%d</b> وتسليمه إلى مندوب التوصيل.\n\n"
               "📞 سيتم الاتصال بك بأقرب وقت.")


def order_cancel_cb(chat, uid, mid, d):
    """الطالب يلغي طلبه قبل ما يتجهز (printed: 0 جديد، 1 تجهز/انطبع، 2 ملغي)"""
    oid = int(d.split(":")[1])
    with db() as c:
        o = c.execute("SELECT * FROM orders WHERE id=? AND user_id=?", (oid, uid)).fetchone()
    if not o:
        return "الطلب غير موجود"
    p = o["printed"] or 0
    if p == 2:
        edit(chat, mid, "❌ الطلب #%d ملغي." % oid); return None
    if p == 1:
        edit(chat, mid, "📦 الطلب #%d تجهز وانسلم لمندوب التوصيل، فما يمكن إلغاؤه." % oid)
        return "ما يمكن إلغاؤه، الطلب تجهز"
    if d.startswith("oc:"):
        edit(chat, mid, "⚠️ متأكد تريد تلغي الطلب <b>#%d</b>؟" % oid,
             [[btn("✅ نعم، ألغِ الطلب", "ocy:%d" % oid)], [btn("↩️ لا، خليه", "ocn:%d" % oid)]])
    elif d.startswith("ocn:"):
        edit(chat, mid, "تمام، طلبك #%d باقي ✅\n↩️ تگدر تلغيه <b>لحد ما توصلك رسالة «تم تجهيز طلبك»</b>." % oid,
             [[btn("❌ إلغاء الطلب #%d" % oid, "oc:%d" % oid)]])
    elif d.startswith("ocy:"):
        with db() as c:
            c.execute("UPDATE orders SET printed=2 WHERE id=? AND IFNULL(printed,0)=0", (oid,))
        edit(chat, mid, "❌ تم إلغاء طلبك <b>#%d</b>.\nتگدر تطلب من جديد بأي وقت من 🛒 المتجر." % oid)
        n = new_orders_count()
        for a in staff_ids("orders"):
            send(a, "❌ <b>الطالب %s ألغى الطلب #%d</b>\nلا تجهزه. 🔔 الطلبات الجديدة: <b>%d</b>" % (esc(o["name"]), oid, n),
                 reply_kb=main_kb(a))
    return None


def on_student_cb(chat, uid, mid, d, st, data, user):
    cart = data.get("cart", {})
    if d == "agree":
        if st != "agree":
            return "انتهت صلاحية هذا الزر"
        data["agreed"] = data.get("agreed", 0) + 1
        edit(chat, mid, NO_REFUND + "\n\n✅ <b>تمت الموافقة</b>")
        if data["agreed"] < AGREE_TIMES:
            set_session(uid, "agree", data)
            t, kb = agree_view(data["agreed"])
            send(chat, t, kb)
        else:
            after_agree(chat, uid, data)
        return None
    if st == "agree":
        return "اضغط موافق أولا"
    if d == "home" or d.startswith("cat:") or d.startswith("add:") or d.startswith("sub:") or d == "clear":
        if data.get("agreed", 0) < AGREE_TIMES:
            return "اضغط «المتجر» من جديد"
        view_cat = None
        if d.startswith("cat:"):
            view_cat = int(d[4:])
        elif d.startswith("add:") or d.startswith("sub:"):
            pid = d[4:]
            p = product(int(pid))
            if p:
                view_cat = p["cat_id"]
                cart[pid] = cart.get(pid, 0) + (1 if d.startswith("add:") else -1)
        elif d == "clear":
            cart = {}
            view_cat = data.get("view")
        cart = clean_cart(cart)
        data["cart"], data["view"] = cart, view_cat
        set_session(uid, "cart", data)
        t, kb = cat_view(view_cat, cart) if view_cat else home_view(cart)
        edit(chat, mid, t, kb)
    elif d == "checkout":
        cart = clean_cart(cart)
        if not cart:
            return "السلة فارغة"
        data["cart"] = cart
        sp = student(uid) or {}
        data.update({"name": sp.get("name", ""), "curr": sp.get("curr", ""), "gov": sp.get("gov", "بغداد"), "side": sp.get("side", ""),
                     "area": sp.get("area", ""), "phone1": sp.get("phone1", ""), "phone2": sp.get("phone2", "")})
        set_session(uid, "confirm", data)
        edit(chat, mid, "\n".join(["<b>🛒 طلبك</b>"] + cart_lines(cart)[2:]))
        text2, items, sub, fee = summary(data)
        send(chat, text2, [[btn("✅ نعم، أوافق وأؤكد الطلب", "confirm")],
                           [btn("✏️ تعديل المنتجات", "editcart"), btn("❌ إلغاء", "cancel")]])
    elif d.startswith("curr:") and st == "curr":
        data["curr"] = CURRS[int(d[5:])]
        set_session(uid, "gov", data)
        edit(chat, mid, "📘 المنهج: <b>%s</b>" % data["curr"])
        send(chat, "📍 اختر محافظتك:", gov_kb())
    elif d.startswith("gov:") and st == "gov":
        g = GOVS[int(d[4:])]
        data["gov"] = g
        data.pop("side", None)
        if g == "بغداد":
            set_session(uid, "side", data)
            edit(chat, mid, "📍 المحافظة: <b>بغداد</b>\nاختر الجانب:", [[btn(s, "side:%d" % i) for i, s in enumerate(SIDES)]])
        else:
            set_session(uid, "area", data)
            edit(chat, mid, "📍 المحافظة: <b>%s</b>" % esc(g))
            send(chat, "🏘 اكتب اسم المنطقة:")
    elif d.startswith("side:") and st == "side":
        data["side"] = SIDES[int(d[5:])]
        set_session(uid, "area", data)
        edit(chat, mid, "📍 المحافظة: <b>بغداد - %s</b>" % data["side"])
        send(chat, "🏘 اكتب اسم المنطقة:")
    elif d == "confirm" and st == "confirm":
        text, items, sub, fee = summary(data)
        if not items:
            return "سلتك فارغة"
        edit(chat, mid, text.rsplit("\n\n", 1)[0] + "\n\n✅ <b>تم التأكيد</b>")
        finalize(chat, uid, data, items, sub, fee, user)
    elif d == "editcart" and st == "confirm":
        data["cart"] = clean_cart(cart)
        if STORE_URL:
            set_session(uid, "store", data)
            send(chat, "اضغط «%s» حتى تعدل طلبك 👇" % BTN_OPEN, reply_kb=store_kb(uid))
        else:
            set_session(uid, "cart", data)
            t, kb = home_view(data["cart"])
            edit(chat, mid, t, kb)
    elif d == "cancel":
        set_session(uid, "", {})
        edit(chat, mid, "❌ تم إلغاء الطلب.")
        send(chat, "تقدر تطلب من جديد بأي وقت.", reply_kb=main_kb(uid))
    else:
        return "انتهت صلاحية هذا الزر"


def finalize(chat, uid, data, items, sub, fee, user):
    with db() as c:
        cur = c.execute("""INSERT INTO orders(user_id, username, name, curr, gov, side, area, phone1, phone2, items, subtotal, fee, total, created)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (uid, user.get("username", ""), data["name"], data.get("curr", ""), data["gov"], data.get("side", ""), data["area"],
                         data["phone1"], data["phone2"], json.dumps(items, ensure_ascii=False), sub, fee, sub + fee,
                         time.strftime("%Y-%m-%d %H:%M")))
        oid = cur.lastrowid
    set_session(uid, "", {})
    send_image(chat, SUCCESS, "success", SUCCESS_TEXT % oid, main_kb(uid))
    r = send(chat, "↩️ إذا غيرت رأيك، تگدر تلغي الطلب من هذا الزر <b>لحد ما توصلك رسالة «تم تجهيز طلبك»</b>.\n"
                   "بعد ما تتجهز، ما يمكن إلغاؤه.", [[btn("❌ إلغاء الطلب #%d" % oid, "oc:%d" % oid)]])
    if r and isinstance(r, dict):
        kv_set("ocmsg_%d" % oid, str(r.get("message_id", "")))
    notify_admins(oid)


def on_store_order(chat, uid, raw, user):
    """الطلب اللي يجي من صفحة المتجر"""
    st, data = get_session(uid)
    if data.get("agreed", 0) < AGREE_TIMES:
        open_shop(chat, uid); return
    try:
        o = json.loads(raw)
    except Exception:
        send(chat, "⚠️ صار خطأ، افتح المتجر من جديد.", reply_kb=store_kb(uid)); return
    reg = student(uid)
    if reg:      # المسجل: معلوماته المحفوظة هي اللي تنحسب (مقفولة)
        o.update({"n": reg["name"], "cu": reg["curr"], "g": reg["gov"], "s": reg.get("side") or "", "a": reg["area"]})
        # أرقام الهاتف يگدر يغيرها لهذا الطلب بس (معلوماته المسجلة تبقى نفسها)
    errs = []
    name = " ".join(str(o.get("n", "")).split())
    if len(name.split()) < 4 or not all(re.fullmatch(AR_NAME, w) for w in name.split()):
        errs.append("الاسم لازم يكون رباعي وبالحروف العربية فقط")
    cu = o.get("cu") if o.get("cu") in CURRS else None
    if not cu:
        errs.append("اختر المنهج")
    g = o.get("g") if o.get("g") in GOVS else None
    if not g:
        errs.append("اختر المحافظة")
    sd = o.get("s") if o.get("s") in SIDES else ""
    if g == "بغداد" and not sd:
        errs.append("اختر الرصافة أو الكرخ")
    area = str(o.get("a", "")).strip()
    if len(area) < 2:
        errs.append("اكتب المنطقة")
    p1, e1 = check_phone(str(o.get("p1", "")))
    p2, e2 = check_phone(str(o.get("p2", "")))
    if e1 or e2 or p1 == p2:
        errs.append("أرقام الهاتف لازم تكون بالإنجليزي، 11 رقم، ومختلفة")
    cart, missing = {}, False
    for it in o.get("i", []):
        try:
            pid, q = int(it[0]), int(it[1])
        except Exception:
            continue
        if q <= 0:
            continue
        if product(pid):
            cart[str(pid)] = min(q, 50)
        else:
            missing = True
    if not cart:
        errs.append("اختر منتج واحد على الأقل")
    if missing:
        errs.append("بعض المنتجات تغيرت أو انحذفت")
    if errs:
        set_session(uid, "store", data)
        send(chat, "⚠️ ما اكتمل الطلب:\n" + "\n".join("• " + e for e in errs) + "\n\nاضغط «%s» وصحح المعلومات 👇" % BTN_OPEN,
             reply_kb=store_kb(uid))
        return
    data.update({"cart": cart, "name": name, "curr": cu, "gov": g, "area": area, "phone1": p1, "phone2": p2})
    if sd:
        data["side"] = sd
    else:
        data.pop("side", None)
    text, items, sub, fee = summary(data)
    if sub + fee != o.get("t"):
        # الأسعار تغيرت بعد ما فتح الصفحة: نعرض الملخص الجديد حتى يوافق
        set_session(uid, "confirm", data)
        send(chat, "ℹ️ تحدثت بعض الأسعار، هذا طلبك بالأسعار الجديدة:\n\n" + text,
             [[btn("✅ نعم، أوافق وأؤكد الطلب", "confirm")], [btn("✏️ تعديل", "editcart"), btn("❌ إلغاء", "cancel")]])
        return
    finalize(chat, uid, data, items, sub, fee, user)


def order_text(o):
    items = json.loads(o["items"])
    place = o["gov"] + (" - " + o["side"] if o["side"] else "")
    user = ("@" + o["username"]) if o["username"] else '<a href="tg://user?id=%d">حساب الطالب</a>' % o["user_id"]
    lines = ["🆕 <b>طلب جديد #%d</b>  (%s)" % (o["id"], o["created"]), "",
             "الاسم: %s" % esc(o["name"]), "المنهج: %s" % esc(o.get("curr") or ""), "المحافظة: %s" % esc(place), "المنطقة: %s" % esc(o["area"]),
             "الهاتف 1: <code>%s</code>" % o["phone1"], "الهاتف 2: <code>%s</code>" % o["phone2"],
             "التليجرام: %s" % user, "", "<b>المنتجات:</b>"]
    for it in items:
        lines.append("• %s × %d — %s" % (esc(it["name"]), it["qty"], money(it["qty"] * it["price"])))
    lines += ["", "مجموع المنتجات: %s" % money(o["subtotal"]), "التوصيل: %s" % money(o["fee"]),
              "<b>المبلغ الكلي: %s</b>" % money(o["total"])]
    return "\n".join(lines)


def cbtn(label, value):
    """زر نسخ: يضغطه وينسخ القيمة"""
    return {"text": "📋 " + label, "copy_text": {"text": str(value)[:256]}}


def order_kb(o):
    place = o["gov"] + (" - " + o["side"] if o["side"] else "")
    items = "، ".join("%s × %d" % (it["name"], it["qty"]) for it in json.loads(o["items"]))
    return [[cbtn("الاسم", o["name"]), cbtn("المنهج", o.get("curr") or "")],
            [cbtn("المحافظة", place), cbtn("المنطقة", o["area"])],
            [cbtn("الهاتف 1", o["phone1"]), cbtn("الهاتف 2", o["phone2"])],
            [cbtn("المنتجات", items), cbtn("المبلغ الكلي", "{:,}".format(o["total"]))]]


def notify_admins(oid):
    with db() as c:
        o = dict(c.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone())
    n = new_orders_count()
    for a in staff_ids("orders"):
        send(a, order_text(o), order_kb(o))
        send(a, "🔔 الطلبات الجديدة اللي تنتظر الطباعة: <b>%d</b>" % n, reply_kb=main_kb(a))


# ---------------------------------------------------------------- لوحة التحكم (أنت)
BULK_HELP = ("📥 <b>إضافة منتجات دفعة وحدة</b>\n\n"
             "أرسل رسالة وحدة بهذا الشكل:\n"
             "• السطر اللي يبدي بعلامة <code>#</code> هو اسم القسم.\n"
             "• تحته كل منتج بسطر: الاسم بعدين علامة <code>=</code> بعدين السعر.\n\n"
             "<code># المحاضرات والامتحانات\n"
             "المحاضرة الأولى مع امتحانها = 5000\n"
             "المحاضرة الثانية مع امتحانها = 5000\n"
             "# الملازم\n"
             "ملزمة الفصل الأول = 15000</code>")


def pending_orders():
    with db() as c:
        return [dict(r) for r in c.execute("SELECT * FROM orders WHERE IFNULL(printed,0)=0 ORDER BY id LIMIT 60")]


def pend_view(pend, sel):
    if not pend:
        return "✅ لا توجد طلبات جديدة. كل الطلبات مطبوعة.", [[btn("⬅️ رجوع", "a:menu")]]
    kb = [[btn(("☑️" if o["id"] in sel else "⬜️") + "  #%d  %s  —  %s  —  %s" % (
        o["id"], " ".join(o["name"].split()[:2]), o["gov"], "{:,}".format(o["total"])), "a:t:%d" % o["id"])] for o in pend]
    kb.append([btn("☑️ تحديد الكل", "a:all"), btn("⬜️ إلغاء التحديد", "a:none")])
    if sel:
        kb.append([btn("🖨 إنشاء PDF للمحدد (%d)" % len(sel), "a:pdf")])
    kb.append([btn("⬅️ رجوع", "a:menu")])
    return ("<b>🖨 الطلبات الجديدة (غير مطبوعة): %d</b>\n"
            "اضغط على الطلبات حتى تحددها ☑️، بعدين اضغط «إنشاء PDF»." % len(pend)), kb


def orders_html(orders):
    """كل طلب بورقة A5 مستقلة"""
    logo = ""
    if os.path.exists(LOGO):
        logo = '<img src="data:image/png;base64,%s">' % base64.b64encode(open(LOGO, "rb").read()).decode()
    pages = []
    for o in orders:
        place = o["gov"] + (" - " + o["side"] if o["side"] else "")
        rows = "".join("<tr><td>%s</td><td class=n>%d</td><td class=n>%s</td></tr>" % (esc(it["name"]), it["qty"], "{:,}".format(it["qty"] * it["price"]))
                       for it in json.loads(o["items"]))
        pages.append("""<section class=page>
<div class=head>%s<div class=ht><h1>متجر قصي العميري</h1><p>الرياضيات · السادس الإعدادي</p></div>
<div class=no><b>#%d</b><span>%s</span></div></div>
<table class=info>
<tr><th>الاسم</th><td colspan=3 class=big>%s</td></tr>
<tr><th>المنهج</th><td>%s</td><th>المحافظة</th><td>%s</td></tr>
<tr><th>المنطقة</th><td colspan=3>%s</td></tr>
<tr><th>الهاتف 1</th><td class=ph>%s</td><th>الهاتف 2</th><td class=ph>%s</td></tr></table>
<table class=items><tr><th>المنتج</th><th class=n>العدد</th><th class=n>السعر</th></tr>%s
<tr class=s><td colspan=2>مجموع المنتجات</td><td class=n>%s</td></tr>
<tr class=s><td colspan=2>التوصيل</td><td class=n>%s</td></tr>
<tr class=t><td colspan=2>المبلغ الكلي</td><td class=n>%s د.ع</td></tr></table>
<div class=foot>⚠️ جميع المشتريات غير قابلة للإرجاع إطلاقاً ولأي سبب كان</div>
</section>""" % (logo, o["id"], esc(o["created"]), esc(o["name"]), esc(o.get("curr") or ""), esc(place), esc(o["area"]),
                  o["phone1"], o["phone2"], rows, "{:,}".format(o["subtotal"]), "{:,}".format(o["fee"]), "{:,}".format(o["total"])))
    return """<!doctype html><html lang=ar dir=rtl><head><meta charset=utf-8><style>
@page{size:A5;margin:9mm}
html,body{margin:0}
body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#101929}
.page{page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
.head{display:flex;align-items:center;gap:10px;background:#101929;color:#fff;border-radius:10px;padding:8px 12px;border-bottom:4px solid #CEA239}
.head img{height:46px}
.ht{flex:1}.ht h1{margin:0;font-size:16px;color:#F9C445}.ht p{margin:1px 0 0;font-size:10px;color:#cfd7e6}
.no{text-align:center}.no b{display:block;font-size:22px;color:#F9C445;line-height:1.1}.no span{font-size:9px;color:#cfd7e6}
table{width:100%%;border-collapse:collapse;font-size:12.5px;margin-top:9px}
td,th{padding:6px 8px;border:1px solid #d9dde5;text-align:right}
.info th{background:#FFF3CF;width:62px;font-weight:700;white-space:nowrap}
.big{font-size:15px;font-weight:700}
.ph{direction:ltr;text-align:left;font-weight:800;font-size:14px;letter-spacing:.5px}
.items th{background:#101929;color:#fff;font-weight:600;border-color:#101929}
.n{text-align:center;white-space:nowrap}
.s td{background:#f5f6f8}.t td{background:#F9C445;font-weight:800;font-size:15px;border-color:#CEA239}
.foot{margin-top:10px;font-size:10.5px;text-align:center;color:#8a2a20;border:1px dashed #d98b80;border-radius:8px;padding:5px}
</style></head><body>%s</body></html>""" % "".join(pages)


def find_browser():
    pf = [os.environ.get(k, "") for k in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
    cands = []
    for base in pf:
        if base:
            cands += [os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
                      os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")]
    cands += ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/snap/bin/chromium"]
    import glob
    cands += sorted(glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome")), reverse=True)
    for p in cands:
        if os.path.exists(p):
            return p
    return None


def html_to_pdf(html_path, pdf_path):
    b = find_browser()
    if not b:
        return False
    url = "file:///" + os.path.abspath(html_path).replace("\\", "/").lstrip("/")
    for flags in (["--headless=new"], ["--headless"]):
        try:
            if os.path.exists(pdf_path):
                os.remove(pdf_path)
            extra = ["--no-sandbox"] if os.name != "nt" else []
            subprocess.run([b] + flags + extra + ["--disable-gpu", "--no-pdf-header-footer", "--print-to-pdf-no-header",
                                          "--user-data-dir=" + os.path.join(tempfile.gettempdir(), "qstore_pdf"),
                                          "--print-to-pdf=" + pdf_path, url], timeout=90,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            print("PDF problem:", e)
        if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 1000:
            return True
    return False


def html_to_png(html_path, png_path, w=760, h=1000):
    """صورة للصفحة (نقيس طولها أول شي حتى ما تنقص)"""
    b = find_browser()
    if not b:
        return False
    url = "file:///" + os.path.abspath(html_path).replace("\\", "/").lstrip("/")
    for flags in (["--headless=new"], ["--headless"]):
        try:
            if os.path.exists(png_path):
                os.remove(png_path)
            extra = ["--no-sandbox"] if os.name != "nt" else []
            subprocess.run([b] + flags + extra + ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
                                          "--window-size=%d,%d" % (w, h),
                                          "--user-data-dir=" + os.path.join(tempfile.gettempdir(), "qstore_png"),
                                          "--screenshot=" + os.path.abspath(png_path), url], timeout=90,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            print("Image problem:", e)
        if os.path.exists(png_path) and os.path.getsize(png_path) > 1000:
            return True
    return False


def profile_card_html(s, title):
    logo = ""
    if os.path.exists(LOGO):
        logo = '<img src="data:image/png;base64,%s">' % base64.b64encode(open(LOGO, "rb").read()).decode()
    fnt = os.path.join(HERE, "boahmed.ttf")
    face = ("@font-face{font-family:Boahmed;src:url(data:font/ttf;base64,%s)}" % base64.b64encode(open(fnt, "rb").read()).decode()) if os.path.exists(fnt) else ""
    place = s["gov"] + (" - " + s["side"] if s.get("side") else "")
    rows = [("👤", "الاسم", s["name"], False), ("📘", "المنهج", s["curr"], False),
            ("🎓", "صفك بالمدرسة", s["grade"], False), ("📍", "المحافظة", place, False), ("🏘", "العنوان", s["area"], False),
            ("📞", "الهاتف الأول", s["phone1"], False), ("📞", "الهاتف الثاني", s["phone2"], False),
            ("📝", "نوع الامتحان", s.get("exam") or "", False)]
    if s.get("exam") == "حضوري":
        rows.append(("🏫", "المركز الامتحاني", center_name(s.get("center_id")) or "—", False))
    tr = "".join('<tr><td class="k"><span>%s</span>%s</td><td class="v%s">%s%s</td></tr>' % (
        i, esc(k), " ltr" if k.startswith("الهاتف") else "", esc(v), ' <em>🔒</em>' if lock else "") for i, k, v, lock in rows)
    return """<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>%s
*{box-sizing:border-box}html{background:#101929}html,body{margin:0;width:760px;overflow:hidden}
body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#F4F1E8;
background:radial-gradient(ellipse at 50%% 0%%,rgba(249,196,69,.20),transparent 55%%),linear-gradient(180deg,#14203a,#101929 40%%);
display:flex;flex-direction:column;align-items:center;padding:24px 30px 40px;min-height:1200px}
.top{text-align:center}.top img{height:92px;filter:drop-shadow(0 8px 18px rgba(0,0,0,.5))}
.top h1{margin:0;font-size:38px;font-weight:800;letter-spacing:2px;color:#F9C445}
.top p{margin:2px 0 0;font-family:Boahmed,'Segoe UI';font-size:23px;color:#cfd7e6}
.card{width:100%%;margin-top:16px;background:#162238;border:1px solid #2a3b5c;border-radius:24px;overflow:hidden;box-shadow:0 14px 30px rgba(0,0,0,.35)}
.card h2{margin:0;padding:12px 22px;font-size:24px;font-weight:800;color:#101929;background:linear-gradient(90deg,#F9C445,#CEA239)}
table{width:100%%;border-collapse:collapse}td{padding:11px 22px;border-top:1px solid #2a3b5c;font-size:21px;vertical-align:middle}
td.k{width:38%%;color:#9fb0c9;font-weight:600;white-space:nowrap}td.k span{display:inline-block;width:38px}
td.v{font-weight:700}td.ltr{direction:ltr;text-align:right;letter-spacing:1px}td em{font-style:normal;font-size:17px;opacity:.75}
tr:nth-child(even) td{background:rgba(255,255,255,.025)}
.foot{margin:12px 16px 16px;padding:10px 16px;border-radius:14px;border:1px dashed #CEA239;background:rgba(249,196,69,.08);font-size:17px;line-height:1.6;color:#e9e3d2}
</style></head><body>
<div class="top">%s<h1>QMath</h1><p>قصي العميري</p></div>
<div class="card"><h2>%s</h2><table>%s</table>
<div class="foot">🔒 معلوماتك مقفولة، ولتغيير أي معلومة تواصل ويا قصي العميري.</div></div>
</body></html>""" % (face, logo, esc(title), tr)


def send_profile_card(chat, s, title, caption, kb):
    """يرسل معلومات الطالب كبطاقة ملونة (صورة)، وإذا ما صار يرسلها نص"""
    try:
        os.makedirs(PDF_DIR, exist_ok=True)
        hp, pp = os.path.join(PDF_DIR, "card_%s.html" % chat), os.path.join(PDF_DIR, "card_%s.png" % chat)
        open(hp, "w", encoding="utf-8").write(profile_card_html(s, title))
        if html_to_png(hp, pp, 760, 960 if s.get("exam") == "حضوري" else 905):
            r = api_upload("sendPhoto", {"chat_id": chat, "caption": caption, "parse_mode": "HTML",
                                         "reply_markup": json.dumps(kb)}, "photo", pp, "card.png", "image/png")
            if r:
                return r
    except Exception:
        traceback.print_exc()
    return send(chat, "<b>📋 معلوماتك</b>\n\n" + profile_text(s) + "\n\n" + caption, reply_kb=kb)


def send_orders_pdf(chat, ids):
    with db() as c:
        orders = [dict(r) for r in c.execute("SELECT * FROM orders WHERE id IN (%s) ORDER BY id" % ",".join("?" * len(ids)), ids)]
    os.makedirs(PDF_DIR, exist_ok=True)
    name = "orders_%s" % time.strftime("%Y-%m-%d_%H-%M")
    hp, pp = os.path.join(PDF_DIR, name + ".html"), os.path.join(PDF_DIR, name + ".pdf")
    open(hp, "w", encoding="utf-8").write(orders_html(orders))
    bid = str(int(time.time()))
    kv_set("batch_" + bid, ",".join(str(o["id"]) for o in orders))
    kb = {"inline_keyboard": [[btn("✅ تم الطباعة (إخفاؤها)", "a:done:" + bid)], [btn("↩️ لا، خليها", "a:keep")]]}
    cap = "🖨 ملف %d طلب: %s\n\nاطبعه، وبعد الطباعة اضغط «تم الطباعة» حتى تختفي من الطلبات الجديدة." % (
        len(orders), "، ".join("#%d" % o["id"] for o in orders))
    if html_to_pdf(hp, pp):
        r = api_upload("sendDocument", {"chat_id": chat, "caption": cap, "reply_markup": json.dumps(kb)},
                       "document", pp, name + ".pdf", "application/pdf")
    else:
        r = api_upload("sendDocument", {"chat_id": chat, "caption": cap + "\n\n(افتح الملف بالمتصفح واضغط Ctrl + P حتى تطبعه أو تحفظه PDF)",
                                        "reply_markup": json.dumps(kb)}, "document", hp, name + ".html", "text/html")
    if not r:
        send(chat, "⚠️ ما گدرت أرسل الملف. تلگاه بمجلد البوت داخل مجلد pdf.", kb["inline_keyboard"])


def admin_menu():
    return ("<b>⚙️ لوحة التحكم</b>",
            [[btn("📥 إضافة منتجات دفعة وحدة", "a:bulk")],
             [btn("➕ إضافة منتج واحد", "a:add")],
             [btn("📋 المنتجات والأقسام", "a:list")],
             [btn("🚚 أسعار التوصيل", "a:fees")],
             [btn("🖨 الطلبات الجديدة (للطباعة)", "a:pend")],
             [btn("🗂 الطلبات المطبوعة", "a:printed")]])


def admin_cats():
    cs = all_cats()
    kb = [[btn("📂 %s  (%d)" % (c["name"], c["n"]), "a:lc:%d" % c["id"]), btn("🗑", "a:dc:%d" % c["id"])] for c in cs]
    kb.append([btn("⬅️ رجوع", "a:menu")])
    return ("<b>📋 الأقسام</b>\nاضغط على القسم حتى تشوف منتجاته وتعدلها.\n🗑 يحذف القسم مع منتجاته." if cs
            else "لا توجد أقسام بعد."), kb


def admin_cat(cid):
    c = cat(cid)
    if not c:
        return admin_cats()
    ps = products(cid)
    kb = [[btn("✏️ %s — %s" % (p["name"], money(p["price"])), "a:ep:%d" % p["id"]), btn("🗑", "a:del:%d" % p["id"])] for p in ps]
    kb.append([btn("⬅️ رجوع للأقسام", "a:list")])
    return "<b>📂 %s</b>\n✏️ لتعديل السعر   🗑 للحذف" % esc(c["name"]), kb


def admin_fees():
    with db() as c:
        fees = {r["gov"]: r["fee"] for r in c.execute("SELECT * FROM fees")}
    kb, row = [], []
    for i, g in enumerate(GOVS):
        row.append(btn("%s: %s" % (g, "{:,}".format(fees.get(g, DEFAULT_FEE))), "a:fee:%d" % i))
        if len(row) == 2:
            kb.append(row); row = []
    if row:
        kb.append(row)
    kb.append([btn("💲 نفس السعر لكل المحافظات", "a:feeall")])
    kb.append([btn("⬅️ رجوع", "a:menu")])
    return "<b>🚚 أسعار التوصيل</b>\nاضغط على المحافظة حتى تغير سعرها:", kb


def parse_price(t):
    t = t.translate(AR_DIGITS).replace(",", "").replace("،", "").replace("٬", "").replace(".", "").replace(" ", "")
    t = re.sub(r"(دينار|د\.ع|IQD)$", "", t)
    return int(t) if t.isdigit() else None


def bulk_add(text):
    added, bad, cur = [], [], None
    with db() as c:
        for raw in text.splitlines():
            line = raw.strip()
            if not line:
                continue
            if line.startswith("#"):
                name = line.lstrip("#").strip()
                cur = cat_id_for(c, name) if name else None
                continue
            m = re.match(r"^(.+?)\s*[=:]\s*([\d٠-٩۰-۹,،٬.\s]+)\s*(دينار|د\.ع)?\s*$", line)
            pr = parse_price(m.group(2)) if m else None
            if not m or pr is None:
                bad.append(line); continue
            if cur is None:
                cur = cat_id_for(c, "منتجات أخرى")
            c.execute("INSERT INTO products(name, price, cat_id, mode) VALUES(?,?,?,?)", (m.group(1).strip(), pr, cur, mode_from_name(m.group(1))))
            added.append(m.group(1).strip())
    return added, bad


def on_admin_text(chat, uid, text, st, data):
    if admin_text_v8(chat, uid, text, st, data):
        return True
    if st == "a:bulk":
        added, bad = bulk_add(text)
        set_session(uid, "", {})
        msg = "✅ تمت إضافة %d منتج." % len(added)
        if bad:
            msg += "\n\n⚠️ هاي السطور ما فهمتها، ما انضافت:\n" + "\n".join("• " + esc(b) for b in bad[:20])
        send(chat, msg)
        t, kb = admin_cats(); send(chat, t, kb)
        return True
    if st == "a:newcat":
        with db() as c:
            cid = cat_id_for(c, text)
        set_session(uid, "a:add_name", {"cat": cid})
        send(chat, "✍️ اكتب اسم المنتج:")
        return True
    if st == "a:add_name":
        data["new_name"] = text.strip()
        set_session(uid, "a:add_price", data)
        send(chat, "💰 اكتب سعر «%s» بالدينار (أرقام فقط):" % esc(text.strip()))
        return True
    if st == "a:add_price":
        pr = parse_price(text)
        if pr is None:
            send(chat, "⚠️ اكتب السعر أرقام فقط، مثل 15000"); return True
        with db() as c:
            c.execute("INSERT INTO products(name, price, cat_id, mode) VALUES(?,?,?,?)", (data["new_name"], pr, data["cat"], mode_from_name(data["new_name"])))
        set_session(uid, "", {})
        send(chat, "✅ تمت إضافة «%s» بسعر %s" % (esc(data["new_name"]), money(pr)))
        t, kb = admin_cat_v8(data["cat"]); send(chat, t, kb)
        return True
    if st == "a:edit_price":
        pr = parse_price(text)
        if pr is None:
            send(chat, "⚠️ اكتب السعر أرقام فقط"); return True
        with db() as c:
            c.execute("UPDATE products SET price=? WHERE id=?", (pr, data["pid"]))
            cid = c.execute("SELECT cat_id FROM products WHERE id=?", (data["pid"],)).fetchone()["cat_id"]
        set_session(uid, "", {})
        send(chat, "✅ تم تعديل السعر إلى %s" % money(pr))
        t, kb = admin_cat_v8(cid); send(chat, t, kb)
        return True
    if st == "a:fee":
        pr = parse_price(text)
        if pr is None:
            send(chat, "⚠️ اكتب السعر أرقام فقط"); return True
        with db() as c:
            if data["gov"] == "*":
                c.execute("UPDATE fees SET fee=?", (pr,))
            else:
                c.execute("UPDATE fees SET fee=? WHERE gov=?", (pr, data["gov"]))
        set_session(uid, "", {})
        send(chat, "✅ تم تعديل سعر التوصيل.")
        t, kb = admin_fees(); send(chat, t, kb)
        return True
    return False


def on_admin_cb(chat, uid, mid, d):
    if d == "a:menu":
        t, kb = admin_menu_for(uid); edit(chat, mid, t, kb)
    elif d == "a:bulk":
        set_session(uid, "a:bulk", {})
        send(chat, BULK_HELP)
    elif d == "a:add":
        kb = [[btn("📂 " + c["name"], "a:ac:%d" % c["id"])] for c in all_cats()]
        kb.append([btn("➕ قسم جديد", "a:nc")])
        edit(chat, mid, "اختر قسم المنتج:", kb)
    elif d.startswith("a:ac:"):
        set_session(uid, "a:add_name", {"cat": int(d[5:])})
        send(chat, "✍️ اكتب اسم المنتج:")
    elif d == "a:nc":
        set_session(uid, "a:newcat", {})
        send(chat, "✍️ اكتب اسم القسم الجديد:")
    elif d == "a:list":
        t, kb = admin_cats(); edit(chat, mid, t, kb)
    elif d.startswith("a:lc:"):
        t, kb = admin_cat_v8(int(d[5:])); edit(chat, mid, t, kb)
    elif d.startswith("a:dc:"):
        c = cat(int(d[5:]))
        if c:
            edit(chat, mid, "هل تريد حذف قسم «%s» مع كل منتجاته؟" % esc(c["name"]),
                 [[btn("نعم احذف", "a:dc2:%d" % c["id"]), btn("لا", "a:list")]])
    elif d.startswith("a:dc2:"):
        cid = int(d[6:])
        with db() as c:
            c.execute("UPDATE cats SET active=0 WHERE id=?", (cid,))
            c.execute("UPDATE products SET active=0 WHERE cat_id=?", (cid,))
        t, kb = admin_cats(); edit(chat, mid, "🗑 تم حذف القسم.\n\n" + t, kb)
    elif d.startswith("a:ep:"):
        p = product(int(d[5:]))
        if p:
            set_session(uid, "a:edit_price", {"pid": p["id"]})
            send(chat, "💰 اكتب السعر الجديد لـ «%s» (الحالي %s):" % (esc(p["name"]), money(p["price"])))
    elif d.startswith("a:del:"):
        p = product(int(d[6:]))
        if p:
            edit(chat, mid, "هل تريد حذف «%s»؟" % esc(p["name"]),
                 [[btn("نعم احذف", "a:del2:%d" % p["id"]), btn("لا", "a:lc:%d" % p["cat_id"])]])
    elif d.startswith("a:del2:"):
        pid = int(d[7:])
        with db() as c:
            c.execute("UPDATE products SET active=0 WHERE id=?", (pid,))
            cid = c.execute("SELECT cat_id FROM products WHERE id=?", (pid,)).fetchone()["cat_id"]
        t, kb = admin_cat_v8(cid); edit(chat, mid, "🗑 تم الحذف.\n\n" + t, kb)
    elif d == "a:fees":
        t, kb = admin_fees(); edit(chat, mid, t, kb)
    elif d.startswith("a:fee:"):
        g = GOVS[int(d[6:])]
        set_session(uid, "a:fee", {"gov": g})
        send(chat, "🚚 اكتب سعر التوصيل لـ %s:" % g)
    elif d == "a:feeall":
        set_session(uid, "a:fee", {"gov": "*"})
        send(chat, "🚚 اكتب سعر التوصيل لكل المحافظات:")
    elif d == "a:pend" or d.startswith("a:t:") or d in ("a:all", "a:none"):
        st, data = get_session(uid)
        sel = set(data.get("sel", []))
        pend = pending_orders()
        ids = [o["id"] for o in pend]
        if d.startswith("a:t:"):
            i = int(d[4:])
            sel ^= {i}
        elif d == "a:all":
            sel = set(ids)
        elif d == "a:none":
            sel = set()
        sel &= set(ids)
        set_session(uid, st if st.startswith("a:") else "", dict(data, sel=sorted(sel)))
        t, kb = pend_view(pend, sel)
        if d == "a:pend":
            send(chat, t, kb)
        else:
            edit(chat, mid, t, kb)
    elif d == "a:pdf":
        st, data = get_session(uid)
        sel = [i for i in data.get("sel", []) if i in {o["id"] for o in pending_orders()}]
        if not sel:
            return "حدد طلب واحد على الأقل"
        edit(chat, mid, "⏳ جاري تجهيز ملف PDF لـ %d طلب..." % len(sel))
        send_orders_pdf(chat, sel)
    elif d.startswith("a:done:"):
        ids = [int(x) for x in kv_get("batch_" + d[7:]).split(",")] if kv_get("batch_" + d[7:]) else []
        with db() as c:
            rows = {r["id"]: dict(r) for r in c.execute("SELECT * FROM orders WHERE id IN (%s)" % ",".join("?" * len(ids)), ids)} if ids else {}
        gone = [i for i in ids if (rows.get(i) or {}).get("printed") == 2]
        ready = [i for i in ids if (rows.get(i) or {}).get("printed") in (0, None)]
        with db() as c:
            c.executemany("UPDATE orders SET printed=1 WHERE id=?", [(i,) for i in ready])
        for i in ready:
            cm = kv_get("ocmsg_%d" % i)
            if cm:                       # نشيل رسالة زر الإلغاء من عند الطالب
                if not api("deleteMessage", chat_id=rows[i]["user_id"], message_id=int(cm)):
                    api("editMessageReplyMarkup", chat_id=rows[i]["user_id"], message_id=int(cm), reply_markup={"inline_keyboard": []})
            send(rows[i]["user_id"], ORDER_READY % i)
        if gone:
            send(chat, "⚠️ <b>انتبه:</b> الطالب ألغى هالطلبات قبل التجهيز، <b>لا ترسلها</b>: %s" % "، ".join("#%d" % i for i in gone))
        ids = ready
        st, data = get_session(uid)
        set_session(uid, "", dict(data, sel=[]))
        edit(chat, mid, "✅ تم. الطلبات (%s) انتقلت للطلبات المطبوعة." % "، ".join("#%d" % i for i in ids))
        n = new_orders_count()
        send(chat, ("🔔 باقي <b>%d</b> طلبات جديدة." % n) if n else "✅ ما باقي طلبات جديدة.", reply_kb=main_kb(uid))
        t, kb = pend_view(pending_orders(), set()); send(chat, t, kb)
    elif d == "a:keep":
        edit(chat, mid, "تمام، الطلبات بقت بالطلبات الجديدة.")
    elif d == "a:printed":
        with db() as c:
            os_ = [dict(r) for r in c.execute("SELECT * FROM orders WHERE printed=1 ORDER BY id DESC LIMIT 20")]
        if not os_:
            send(chat, "لا توجد طلبات مطبوعة بعد."); return
        kb = [[btn("#%d  %s  —  %s" % (o["id"], o["name"].split()[0], o["gov"]), "a:v:%d" % o["id"]),
               btn("↩️ إرجاع", "a:un:%d" % o["id"])] for o in os_]
        send(chat, "<b>🗂 آخر الطلبات المطبوعة</b>\nاضغط على الطلب حتى تشوفه، أو «إرجاع» حتى يرجع للطلبات الجديدة.", kb)
    elif d.startswith("a:un:"):
        with db() as c:
            c.execute("UPDATE orders SET printed=0 WHERE id=?", (int(d[5:]),))
        return "رجع للطلبات الجديدة"
    elif d.startswith("a:v:"):
        with db() as c:
            r = c.execute("SELECT * FROM orders WHERE id=?", (int(d[4:]),)).fetchone()
        if r:
            o = dict(r); send(chat, order_text(o).replace("🆕 <b>طلب جديد", "<b>طلب"), order_kb(o))


# ================================================================= النسخة 8: التسجيل + الأسئلة العلمية + المراكز + المساعدين
GRADES = ["السادس العلمي", "الخامس العلمي"]
EXAMS = ["حضوري", "إلكتروني"]
MODE_ICON = {"both": "🔄 كليهما", "in": "🏫 حضوري", "online": "💻 إلكتروني"}
MODE_NEXT = {"both": "in", "in": "online", "online": "both"}
BTN_ASK = "❓ سؤال علمي"
BTN_MYQ = "📂 أسئلتي"
BTN_ME = "👤 معلوماتي"
BTN_OFFICE = "🏪 مكتبتي"
DAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]   # 0 = الاثنين
DAY_ORDER = [5, 6, 0, 1, 2, 3, 4]                                                   # نعرضها من السبت
PERMS = {"q": "❓ الأسئلة العلمية", "orders": "🖨 الطلبات والطباعة",
         "products": "🛒 المنتجات والأسعار والتوصيل", "students": "🎓 الطلاب والمراكز"}

SEED_CURRIC = """# الأعداد المركبة | Complex Numbers
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
فصل المتغيرات | Separation of Variables = 3"""

SEED_CENTERS = [("بغداد", "المنصور", ["قمة النجاح للبنات", "قمة المنصور للبنين"]),
                ("بغداد", "الصليخ", ["قمة صليخ 2"]),
                ("بغداد", "البنوك", ["معهد قصي العميري"]),
                ("بغداد", "زيونة", ["معهد أثر"])]


def init_db_v8():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS students(user_id INTEGER PRIMARY KEY, username TEXT, name TEXT, curr TEXT, grade TEXT,
            gov TEXT, side TEXT, area TEXT, phone1 TEXT, phone2 TEXT, exam TEXT, center_id INTEGER, created TEXT, updated TEXT);
        CREATE TABLE IF NOT EXISTS areas(id INTEGER PRIMARY KEY AUTOINCREMENT, gov TEXT, name TEXT, active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS centers(id INTEGER PRIMARY KEY AUTOINCREMENT, area_id INTEGER, name TEXT, active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS govmode(gov TEXT PRIMARY KEY, mode TEXT);
        CREATE TABLE IF NOT EXISTS chapters(id INTEGER PRIMARY KEY AUTOINCREMENT, ord INTEGER, ar TEXT, en TEXT, active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS topics(id INTEGER PRIMARY KEY AUTOINCREMENT, chapter_id INTEGER, ord INTEGER, ar TEXT, en TEXT,
            lectures INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, chapter_id INTEGER, topic_id INTEGER,
            lecture INTEGER, status TEXT, thread_id INTEGER, created TEXT, updated TEXT);
        CREATE TABLE IF NOT EXISTS staff(user_id INTEGER PRIMARY KEY, name TEXT, perms TEXT);
        CREATE TABLE IF NOT EXISTS offices(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, lim INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS office_users(user_id INTEGER PRIMARY KEY, office_id INTEGER, name TEXT);
        CREATE TABLE IF NOT EXISTS settlements(id INTEGER PRIMARY KEY AUTOINCREMENT, office_id INTEGER, amount INTEGER, n INTEGER, created TEXT);
        CREATE TABLE IF NOT EXISTS staff_pay(id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, amount INTEGER, created TEXT);
        CREATE TABLE IF NOT EXISTS qmsgs(id INTEGER PRIMARY KEY AUTOINCREMENT, qid INTEGER, kind TEXT, chat_id INTEGER, msg_id INTEGER);
        """)
        pcols = [r["name"] for r in c.execute("PRAGMA table_info(products)")]
        if "mode" not in pcols:
            c.execute("ALTER TABLE products ADD COLUMN mode TEXT")
        for r in c.execute("SELECT id, name FROM products WHERE mode IS NULL").fetchall():
            c.execute("UPDATE products SET mode=? WHERE id=?", (mode_from_name(r["name"]), r["id"]))
        for g in GOVS:
            c.execute("INSERT OR IGNORE INTO govmode(gov, mode) VALUES(?,?)", (g, "both" if g == "بغداد" else "online"))
        if not c.execute("SELECT COUNT(*) n FROM areas").fetchone()["n"]:
            for gov, area, cs in SEED_CENTERS:
                aid = c.execute("INSERT INTO areas(gov, name) VALUES(?,?)", (gov, area)).lastrowid
                for cn in cs:
                    c.execute("INSERT INTO centers(area_id, name) VALUES(?,?)", (aid, cn))
    with db() as c:
        empty = not c.execute("SELECT COUNT(*) n FROM chapters").fetchone()["n"]
    if empty:
        save_curriculum(SEED_CURRIC)


def mode_from_name(name):
    if "حضوري" in name:
        return "in"
    if "إلكتروني" in name or "الكتروني" in name:
        return "online"
    return "both"


def now_iq():
    return time.gmtime(time.time() + 3 * 3600)        # توقيت بغداد


def stamp():
    return time.strftime("%Y-%m-%d %H:%M", now_iq())


# ---------------------------------------------------------------- الصلاحيات
def staff_row(uid):
    with db() as c:
        r = c.execute("SELECT * FROM staff WHERE user_id=?", (uid,)).fetchone()
    return dict(r) if r else None


def can(uid, perm):
    if uid in ADMIN_IDS:
        return True
    s = staff_row(uid)
    return bool(s and perm in (s["perms"] or "").split(","))


def is_staff(uid):
    return uid in ADMIN_IDS or staff_row(uid) is not None


def staff_ids(perm):
    with db() as c:
        rows = [r["user_id"] for r in c.execute("SELECT user_id, perms FROM staff") if perm in (r["perms"] or "").split(",")]
    return list(dict.fromkeys(ADMIN_IDS + rows))


def perm_of(d):
    if d in ("a:menu",):
        return "any"
    if d.startswith(("a:sf", "a:hr", "a:grp", "a:cur", "a:lib")):
        return "owner"
    if d.startswith(("a:q", "a:oq")):
        return "q"
    if d.startswith(("a:pend", "a:t:", "a:all", "a:none", "a:pdf", "a:done", "a:keep", "a:printed", "a:un:", "a:v:", "a:pos", "a:ps", "a:of")):
        return "orders"
    if d.startswith(("a:st", "a:sv", "a:sc", "a:se", "a:ce", "a:ca", "a:cc", "a:cd", "a:na", "a:nc2", "a:gm", "a:5th", "a:stall", "a:ad", "a:sg", "a:sx", "a:sw")):
        return "students"
    return "products"


def allowed(uid, d):
    p = perm_of(d)
    if p == "any":
        return is_staff(uid)
    if p == "owner":
        return uid in ADMIN_IDS
    return can(uid, p)


# ---------------------------------------------------------------- الطالب: التسجيل
def student(uid):
    with db() as c:
        r = c.execute("SELECT * FROM students WHERE user_id=?", (uid,)).fetchone()
    return dict(r) if r else None


def center_name(cid):
    if not cid:
        return ""
    with db() as c:
        r = c.execute("SELECT centers.name cn, areas.name an FROM centers JOIN areas ON areas.id=centers.area_id WHERE centers.id=?",
                      (cid,)).fetchone()
    return ("%s (%s)" % (r["cn"], r["an"])) if r else ""


def gov_mode(gov):
    with db() as c:
        r = c.execute("SELECT mode FROM govmode WHERE gov=?", (gov,)).fetchone()
    return r["mode"] if r else "online"


def profile_text(s):
    place = s["gov"] + (" - " + s["side"] if s.get("side") else "")
    lines = ["الاسم: <b>%s</b>" % esc(s["name"]), "المنهج: %s" % esc(s["curr"]), "صفك بالمدرسة هذه السنة: %s" % esc(s["grade"]),
             "المحافظة: %s" % esc(place), "العنوان: %s" % esc(s["area"]),
             "الهاتف 1: %s" % esc(s["phone1"]), "الهاتف 2: %s" % esc(s["phone2"]),
             "الامتحان: %s" % esc(s.get("exam") or "")]
    if s.get("exam") == "حضوري":
        lines.append("المركز الامتحاني: %s" % esc(center_name(s.get("center_id")) or "—"))
    return "\n".join(lines)


def reg_link(uid, edit_mode=False, admin_for=None):
    """رابط فورمة التسجيل (صفحة reg.html بنفس موقع المتجر)"""
    base = STORE_URL.split("?")[0]
    base = base.rsplit("/", 1)[0] if base.endswith(".html") else base.rstrip("/")
    with db() as c:
        modes = {r["gov"]: r["mode"] for r in c.execute("SELECT * FROM govmode")}
        areas = []
        for a in c.execute("""SELECT * FROM areas WHERE active=1
                              AND EXISTS(SELECT 1 FROM centers WHERE area_id=areas.id AND active=1) ORDER BY gov, id"""):
            cs = [[x["id"], x["name"]] for x in c.execute("SELECT * FROM centers WHERE area_id=? AND active=1 ORDER BY id", (a["id"],))]
            areas.append([a["id"], a["gov"], a["name"], cs])
    d = {"g": GOVS, "m": [modes.get(g, "online") for g in GOVS], "a": areas}
    s = student(admin_for or uid)
    if s:
        d["p"] = {"n": s["name"], "cu": s["curr"], "gr": s["grade"], "g": s["gov"], "s": s.get("side") or "",
                  "a": s["area"], "p1": s["phone1"], "p2": s["phone2"], "e": s.get("exam") or "", "c": s.get("center_id") or 0}
    if admin_for:
        d["adm"] = admin_for
    elif s:
        if s.get("exam"):
            d["x"] = {"gr": s.get("grade") or "", "e": s["exam"], "c": center_name(s.get("center_id")) if s["exam"] == "حضوري" else ""}
    raw = json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base + "/reg.html?v=%d&d=" % int(time.time()) + base64.urlsafe_b64encode(raw).decode().rstrip("=")


def reg_kb(uid, edit_mode=False, admin_for=None):
    label = "✏️ افتح فورمة الطالب" if admin_for else BTN_REG
    return {"keyboard": [[{"text": label, "web_app": {"url": reg_link(uid, edit_mode, admin_for)}}], [{"text": BTN_CANCEL}]],
            "resize_keyboard": True}


def start_reg(chat, uid, nxt, edit_mode=False):
    old = student(uid) if edit_mode else None
    if not STORE_URL:
        return start_reg_chat(chat, uid, nxt, edit_mode)
    set_session(uid, "r:form", {"next": nxt, "edit": bool(old)})
    head = "📝 <b>التسجيل</b> (مرة وحدة بس، وبعدها معلوماتك تطلع تلقائياً بالمتجر والأسئلة)"
    send(chat, head + "\n⚠️ بعد الحفظ ما تگدر تغير معلوماتك إلا عن طريق الإدارة، فاكتبها صح." + "\n\n👇 اضغط زر «%s» اللي جوة، واملأ الفورمة، وبعدين اضغط «حفظ معلوماتي»." % BTN_REG,
         reply_kb=reg_kb(uid, edit_mode))


def on_reg_form(chat, uid, o, user):
    """المعلومات اللي تجي من فورمة التسجيل"""
    st, data = get_session(uid)
    target, by_admin = uid, False
    if o.get("adm"):
        try:
            target = int(o["adm"])
        except Exception:
            return
        if not can(uid, "students") or not student(target):
            send(chat, "⚠️ ما عندك صلاحية.", reply_kb=main_kb(uid)); return
        by_admin = True
    old = student(target)
    if old and not by_admin:
        set_session(uid, "", {})
        send(chat, "🔒 معلوماتك محفوظة ومقفولة. لتغيير أي معلومة تواصل ويا قصي العميري.", reply_kb=main_kb(uid))
        return
    errs = []
    name = " ".join(str(o.get("n", "")).split())
    if len(name.split()) < 4 or not all(re.fullmatch(AR_NAME, w) for w in name.split()):
        errs.append("الاسم لازم يكون رباعي وبالحروف العربية فقط")
    cu = o.get("cu") if o.get("cu") in CURRS else None
    gr = o.get("gr") if o.get("gr") in GRADES else None
    g = o.get("g") if o.get("g") in GOVS else None
    if not cu: errs.append("اختر المنهج")
    if not gr: errs.append("اختر الصف")
    if not g: errs.append("اختر المحافظة")
    sd = o.get("s") if o.get("s") in SIDES else ""
    if g == "بغداد" and not sd:
        errs.append("اختر الرصافة أو الكرخ")
    if g != "بغداد":
        sd = ""
    area = str(o.get("a", "")).strip()
    if len(area) < 3:
        errs.append("اكتب العنوان بالتفصيل")
    p1, e1 = check_phone(str(o.get("p1", "")))
    p2, e2 = check_phone(str(o.get("p2", "")))
    if e1 or e2 or p1 == p2:
        errs.append("أرقام الهاتف لازم تكون بالإنجليزي، 11 رقم، ومختلفة")
    if True:
        mode = gov_mode(g) if g else "online"
        if by_admin:
            exam = o.get("e") if o.get("e") in EXAMS else None   # الإدارة تختار بحرية
        else:
            exam = {"online": "إلكتروني", "in": "حضوري"}.get(mode) or (o.get("e") if o.get("e") in EXAMS else None)
        cid = None
        if not exam:
            errs.append("اختر نوع الامتحان")
        elif exam == "حضوري" and g and center_areas(g):
            try:
                cid = int(o.get("c") or 0)
            except Exception:
                cid = 0
            if not cid or not center_name(cid):
                errs.append("اختر المركز الامتحاني"); cid = None
    if errs:
        send(chat, "⚠️ ما انحفظت المعلومات:\n" + "\n".join("• " + e for e in errs) +
             "\n\nافتح الفورمة مرة ثانية وصحح 👇", reply_kb=reg_kb(uid, bool(old), target if by_admin else None))
        return
    r = {"name": name, "curr": cu, "grade": gr, "gov": g, "side": sd, "area": area, "phone1": p1, "phone2": p2,
         "exam": exam, "center_id": cid}
    with db() as c:
        c.execute("""INSERT OR REPLACE INTO students(user_id, username, name, curr, grade, gov, side, area, phone1, phone2, exam,
                     center_id, created, updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                  (target, old["username"] if by_admin else user.get("username", ""), name, cu, gr, g, sd, area, p1, p2, exam, cid,
                   old["created"] if old else stamp(), stamp()))
    if by_admin:
        set_session(uid, "", {})
        send(chat, "✅ <b>تم تعديل معلومات الطالب</b>\n\n" + profile_text(r), reply_kb=main_kb(uid))
        return
    nxt = data.get("next") if st.startswith("r:") else None
    set_session(uid, "", {})
    send_profile_card(chat, r, "✅ تم حفظ معلوماتك", "✅ <b>تم الحفظ بنجاح</b>\nتگدر تشوف معلوماتك بأي وقت من زر «%s»." % BTN_ME,
                      main_kb(uid))
    if nxt == "shop":
        open_shop(chat, uid)
    elif nxt == "ask":
        ask_start(chat, uid)


def start_reg_chat(chat, uid, nxt, edit_mode=False):
    old = student(uid) if edit_mode else None
    set_session(uid, "r:name", {"next": nxt, "reg": {}, "edit": bool(old)})
    head = "✏️ <b>تعديل معلوماتك</b>" if old else "📝 <b>التسجيل</b> (مرة وحدة بس، وبعدها معلوماتك تطلع تلقائياً بالمتجر والأسئلة)"
    send(chat, head + "\n\n✍️ اكتب اسمك <b>الرباعي بالعربي</b>:", reply_kb=flow_kb())


def reg_ask_exam(chat, uid, data):
    r = data["reg"]
    if data.get("edit"):
        old = student(uid)
        if old and old.get("exam"):
            r["exam"], r["center_id"] = old["exam"], old.get("center_id")
            return reg_confirm(chat, uid, data)
    mode = gov_mode(r["gov"])
    if mode == "online":
        r["exam"], r["center_id"] = "إلكتروني", None
        return reg_confirm(chat, uid, data)
    if mode == "in":
        r["exam"] = "حضوري"
        return reg_ask_area(chat, uid, data)
    set_session(uid, "r:exam", data)
    send(chat, "📝 نوع الامتحان:", [[btn("🏫 حضوري", "rx:0"), btn("💻 إلكتروني", "rx:1")]])


def center_areas(gov):
    with db() as c:
        q = """SELECT areas.* FROM areas WHERE active=1 AND gov=? AND EXISTS(SELECT 1 FROM centers WHERE area_id=areas.id AND active=1)
               ORDER BY id"""
        rows = [dict(r) for r in c.execute(q, (gov,))]
        if not rows:
            rows = [dict(r) for r in c.execute("""SELECT areas.* FROM areas WHERE active=1
                       AND EXISTS(SELECT 1 FROM centers WHERE area_id=areas.id AND active=1) ORDER BY gov, id""")]
    return rows


def reg_ask_area(chat, uid, data):
    areas = center_areas(data["reg"]["gov"])
    if not areas:
        data["reg"]["center_id"] = None
        return reg_confirm(chat, uid, data)
    set_session(uid, "r:carea", data)
    kb = [[btn("📍 " + a["name"] + ("" if a["gov"] == data["reg"]["gov"] else " (%s)" % a["gov"]), "ra:%d" % a["id"])] for a in areas]
    send(chat, "🏫 اختر <b>منطقة</b> المركز الامتحاني:", kb)


def reg_confirm(chat, uid, data):
    r = data["reg"]
    set_session(uid, "r:confirm", data)
    send(chat, "<b>📋 راجع معلوماتك</b>\n\n" + profile_text(r) +
         "\n\n⚠️ المركز الامتحاني ونوع الامتحان ما تگدر تغيرهم بعدين إلا عن طريق الإدارة.",
         [[btn("✅ حفظ", "rs:ok")], [btn("✏️ إعادة من البداية", "rs:again")]])


def reg_text(chat, uid, text, st, data):
    r = data.setdefault("reg", {})
    if st == "r:name":
        words = text.split()
        if len(words) < 4 or not all(re.fullmatch(AR_NAME, w) for w in words):
            send(chat, "⚠️ اكتب اسمك <b>الرباعي</b> (أربع كلمات على الأقل) <b>بالحروف العربية فقط</b>."); return
        r["name"] = " ".join(words)
        set_session(uid, "r:curr", data)
        send(chat, "📘 اختر منهجك:", [[btn("📗 " + c, "rc:%d" % i) for i, c in enumerate(CURRS)]])
    elif st == "r:area":
        if len(text) < 3:
            send(chat, "⚠️ اكتب العنوان بالتفصيل (المنطقة، المحلة، أقرب نقطة دالة)."); return
        r["area"] = text
        set_session(uid, "r:p1", data)
        send(chat, "📞 اكتب رقم الهاتف الأول <b>بالإنجليزي</b>\nمثال: <code>07701234567</code>")
    elif st == "r:p1":
        ph, err = check_phone(text)
        if err:
            send(chat, err); return
        r["phone1"] = ph
        set_session(uid, "r:p2", data)
        send(chat, "📞 اكتب رقم الهاتف الثاني <b>بالإنجليزي</b> (لازم يختلف عن الأول)")
    elif st == "r:p2":
        ph, err = check_phone(text)
        if err:
            send(chat, err); return
        if ph == r.get("phone1"):
            send(chat, "⚠️ الرقم الثاني لازم يختلف عن الأول."); return
        r["phone2"] = ph
        reg_ask_exam(chat, uid, data)
    else:
        send(chat, "⚠️ اضغط على الأزرار فوق 👆")


def reg_cb(chat, uid, mid, d, st, data, user):
    r = data.setdefault("reg", {})
    if d.startswith("rc:") and st == "r:curr":
        r["curr"] = CURRS[int(d[3:])]
        set_session(uid, "r:grade", data)
        edit(chat, mid, "📘 المنهج: <b>%s</b>" % r["curr"])
        send(chat, "🎓 إنت هذه السنة طالب بالمدرسة بأي صف؟\n(حتى لو تدرس ويانا مادة السادس)", [[btn(g, "rg:%d" % i)] for i, g in enumerate(GRADES)])
    elif d.startswith("rg:") and st == "r:grade":
        r["grade"] = GRADES[int(d[3:])]
        set_session(uid, "r:gov", data)
        edit(chat, mid, "🎓 صفك بالمدرسة: <b>%s</b>" % r["grade"])
        send(chat, "📍 اختر محافظتك:", gov_kb("rv:"))
    elif d.startswith("rv:") and st == "r:gov":
        r["gov"] = GOVS[int(d[3:])]
        r.pop("side", None)
        if r["gov"] == "بغداد":
            set_session(uid, "r:side", data)
            edit(chat, mid, "📍 المحافظة: <b>بغداد</b>\nاختر الجانب:", [[btn(s, "rd:%d" % i) for i, s in enumerate(SIDES)]])
        else:
            set_session(uid, "r:area", data)
            edit(chat, mid, "📍 المحافظة: <b>%s</b>" % esc(r["gov"]))
            send(chat, "🏘 اكتب عنوانك بالتفصيل (المنطقة، المحلة، أقرب نقطة دالة):")
    elif d.startswith("rd:") and st == "r:side":
        r["side"] = SIDES[int(d[3:])]
        set_session(uid, "r:area", data)
        edit(chat, mid, "📍 المحافظة: <b>بغداد - %s</b>" % r["side"])
        send(chat, "🏘 اكتب عنوانك بالتفصيل (المنطقة، المحلة، أقرب نقطة دالة):")
    elif d.startswith("rx:") and st == "r:exam":
        r["exam"] = EXAMS[int(d[3:])]
        edit(chat, mid, "📝 الامتحان: <b>%s</b>" % r["exam"])
        if r["exam"] == "حضوري":
            reg_ask_area(chat, uid, data)
        else:
            r["center_id"] = None
            reg_confirm(chat, uid, data)
    elif d.startswith("ra:") and st == "r:carea":
        aid = int(d[3:])
        with db() as c:
            a = c.execute("SELECT * FROM areas WHERE id=?", (aid,)).fetchone()
            cs = [dict(x) for x in c.execute("SELECT * FROM centers WHERE area_id=? AND active=1 ORDER BY id", (aid,))]
        if not a or not cs:
            return "اختر منطقة ثانية"
        set_session(uid, "r:center", data)
        edit(chat, mid, "🏫 المنطقة: <b>%s</b>\nاختر المركز الامتحاني:" % esc(a["name"]),
             [[btn("🏫 " + x["name"], "rn:%d" % x["id"])] for x in cs] + [[btn("⬅️ رجوع للمناطق", "rb:area")]])
    elif d == "rb:area" and st == "r:center":
        edit(chat, mid, "⬅️")
        reg_ask_area(chat, uid, data)
    elif d.startswith("rn:") and st == "r:center":
        r["center_id"] = int(d[3:])
        edit(chat, mid, "🏫 المركز: <b>%s</b>" % esc(center_name(r["center_id"])))
        reg_confirm(chat, uid, data)
    elif d == "rs:ok" and st == "r:confirm":
        need = ("name", "curr", "grade", "gov", "area", "phone1", "phone2", "exam")
        if not all(r.get(k) for k in need):
            return "المعلومات ناقصة، أعد التسجيل"
        old = student(uid)
        with db() as c:
            c.execute("""INSERT OR REPLACE INTO students(user_id, username, name, curr, grade, gov, side, area, phone1, phone2, exam,
                         center_id, created, updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                      (uid, user.get("username", ""), r["name"], r["curr"], r["grade"], r["gov"], r.get("side", ""), r["area"],
                       r["phone1"], r["phone2"], r["exam"], r.get("center_id"), old["created"] if old else stamp(), stamp()))
        edit(chat, mid, "<b>📋 معلوماتك</b>\n\n" + profile_text(r) + "\n\n✅ <b>تم الحفظ</b>")
        nxt = data.get("next")
        set_session(uid, "", {})
        send(chat, "✅ تم تسجيلك بنجاح. تگدر تعدل معلوماتك بأي وقت من زر «%s»." % BTN_ME, reply_kb=main_kb(uid))
        if nxt == "shop":
            open_shop(chat, uid)
        elif nxt == "ask":
            ask_start(chat, uid)
    elif d == "rs:again":
        edit(chat, mid, "↩️ نعيد التسجيل.")
        start_reg(chat, uid, data.get("next"), edit_mode=data.get("edit", False))
    else:
        return "انتهت صلاحية هذا الزر"


def show_me(chat, uid):
    s = student(uid)
    if not s:
        start_reg(chat, uid, None); return
    send_profile_card(chat, s, "👤 معلوماتك", "🔒 لتغيير أي معلومة تواصل ويا قصي العميري.", main_kb(chat))


# ---------------------------------------------------------------- الأسئلة العلمية
def q_hours():
    try:
        h = json.loads(kv_get("q_hours") or "")
    except Exception:
        h = None
    return h or {"on": True, "days": list(range(7)), "from": "00:00", "to": "23:59"}


def hours_text(h):
    days = "، ".join(DAYS[i] for i in DAY_ORDER if i in h["days"]) or "لا يوجد"
    return "الأيام: %s\nالوقت: من %s إلى %s" % (days, h["from"], h["to"])


def q_open_now():
    h = q_hours()
    if not h.get("on", True):
        return False
    t = now_iq()
    if t.tm_wday not in h["days"]:
        return False
    cur = "%02d:%02d" % (t.tm_hour, t.tm_min)
    a, b = h["from"], h["to"]
    return a <= cur <= b if a <= b else (cur >= a or cur <= b)


def chapters():
    with db() as c:
        return [dict(r) for r in c.execute("SELECT * FROM chapters WHERE active=1 ORDER BY ord")]


def topics(chid):
    with db() as c:
        return [dict(r) for r in c.execute("SELECT * FROM topics WHERE active=1 AND chapter_id=? ORDER BY ord", (chid,))]


def topic(tid):
    with db() as c:
        r = c.execute("SELECT topics.*, chapters.ar char, chapters.en chen, chapters.ord chord FROM topics JOIN chapters ON chapters.id=topics.chapter_id WHERE topics.id=?", (tid,)).fetchone()
    return dict(r) if r else None


ORD_AR = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"]


def ch_label(ch, en):
    if en:
        return "Chapter %d: %s" % (ch["ord"], ch["en"] or ch["ar"])
    return "الفصل %s: %s" % (ORD_AR[ch["ord"] - 1] if ch["ord"] <= 10 else ch["ord"], ch["ar"])


def q_where(q, en=False):
    t = topic(q["topic_id"])
    if not t:
        return "—"
    lec = (" — Lecture %d" if en else " — المحاضرة %d") % q["lecture"] if q.get("lecture") else ""
    if en:
        return "Ch%d › %s%s" % (t["chord"], t["en"] or t["ar"], lec)
    return "ف%d › %s%s" % (t["chord"], t["ar"], lec)


def group_id():
    g = kv_get("q_group")
    return int(g) if g else None


def ask_start(chat, uid):
    s = student(uid)
    if not s:
        send(chat, "حتى تسأل، سجّل معلوماتك أول مرة 👇")
        start_reg(chat, uid, "ask"); return
    if not group_id():
        send(chat, "⚠️ قسم الأسئلة العلمية غير مفعّل حالياً."); return
    if not q_open_now():
        send(chat, "⏰ <b>استقبال الأسئلة مغلق هسه.</b>\n\n" + hours_text(q_hours())); return
    en = s["curr"] == "إنجليزي"
    set_session(uid, "q:pick", {})
    send(chat, "❓ <b>سؤال علمي</b>\nاختر الفصل:", [[btn(ch_label(c, en), "qc:%d" % c["id"])] for c in chapters()])


def q_cb(chat, uid, mid, d, st, data, user):
    s = student(uid)
    en = bool(s and s["curr"] == "إنجليزي")
    if d.startswith("qc:"):
        chid = int(d[3:])
        ts = topics(chid)
        set_session(uid, "q:pick", {"c": chid})
        edit(chat, mid, "❓ اختر الموضوع:", [[btn((t["en"] or t["ar"]) if en else t["ar"], "qt:%d" % t["id"])] for t in ts] +
             [[btn("⬅️ رجوع للفصول", "qb:ch")]])
    elif d == "qb:ch":
        edit(chat, mid, "❓ <b>سؤال علمي</b>\nاختر الفصل:", [[btn(ch_label(c, en), "qc:%d" % c["id"])] for c in chapters()])
    elif d.startswith("qt:"):
        t = topic(int(d[3:]))
        if not t:
            return "الموضوع غير موجود"
        if t["lectures"] > 0:
            set_session(uid, "q:pick", {"c": t["chapter_id"], "t": t["id"]})
            kb, row = [], []
            for i in range(1, t["lectures"] + 1):
                row.append(btn(("Lecture %d" if en else "المحاضرة %d") % i, "ql:%d:%d" % (t["id"], i)))
                if len(row) == 2:
                    kb.append(row); row = []
            if row:
                kb.append(row)
            kb.append([btn("⬅️ رجوع للمواضيع", "qc:%d" % t["chapter_id"])])
            edit(chat, mid, "❓ <b>%s</b>\nاختر المحاضرة:" % esc((t["en"] or t["ar"]) if en else t["ar"]), kb)
        else:
            q_write(chat, uid, mid, t["id"], 0, en)
    elif d.startswith("ql:"):
        _, tid, lec = d.split(":")
        t = topic(int(tid))
        if not t or not 1 <= int(lec) <= max(t["lectures"], 1):
            return "اختر من الأزرار"
        q_write(chat, uid, mid, int(tid), int(lec), en)
    elif d.startswith("qf:"):
        qid = int(d[3:])
        q = question(qid)
        if not q or q["user_id"] != uid:
            return "السؤال غير موجود"
        set_session(uid, "q:follow", {"qid": qid})
        send(chat, "🔁 اكتب استفسارك على السؤال <b>#%d</b> (كتابة أو صورة أو صوت):" % qid, reply_kb=flow_kb())
    elif d.startswith("qok:"):
        qid = int(d[4:])
        q = question(qid)
        if not q or q["user_id"] != uid:
            return "السؤال غير موجود"
        set_q(qid, status="closed")
        hide_topic(q)
        api("editMessageReplyMarkup", chat_id=chat, message_id=mid, reply_markup={"inline_keyboard": []})
        send(chat, "✅ تمام، انغلق السؤال <b>#%d</b>. إذا عندك سؤال جديد اضغط «%s»." % (qid, BTN_ASK))
    else:
        return "انتهت صلاحية هذا الزر"


def q_write(chat, uid, mid, tid, lec, en):
    t = topic(tid)
    set_session(uid, "q:write", {"t": tid, "l": lec})
    where = ("%s — %s" % (t["en"] or t["ar"], ("Lecture %d" % lec) if lec else "")) if en else (
        "%s%s" % (t["ar"], (" — المحاضرة %d" % lec) if lec else ""))
    edit(chat, mid, "❓ <b>%s</b>" % esc(where))
    send(chat, "✍️ هسه <b>اكتب سؤالك</b>، أو أرسل <b>صورة</b> أو <b>تسجيل صوتي</b>:", reply_kb=flow_kb())


def question(qid):
    with db() as c:
        r = c.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
    return dict(r) if r else None


def set_q(qid, **kw):
    kw["updated"] = stamp()
    with db() as c:
        c.execute("UPDATE questions SET %s WHERE id=?" % ",".join("%s=?" % k for k in kw), list(kw.values()) + [qid])


def topic_title(q, done=False, follow=False):
    s = student(q["user_id"]) or {"name": "طالب"}
    t = topic(q["topic_id"])
    name = " ".join(s["name"].split()[:3])
    where = ("ف%d %s" % (t["chord"], t["ar"]) if t else "") + (" م%d" % q["lecture"] if q.get("lecture") else "")
    mark = "✅ " if done else ("🔁 استفسار " if follow else "🔴 ")
    return (mark + "#%d %s — %s" % (q["id"], name, where))[:120]


def log_msg(qid, kind, chat_id, msg_id):
    """نحفظ رسائل السؤال والجواب حتى نرجعها إذا الطالب استفسر بعدين"""
    if msg_id:
        with db() as c:
            c.execute("INSERT INTO qmsgs(qid, kind, chat_id, msg_id) VALUES(?,?,?,?)", (qid, kind, chat_id, msg_id))


def hide_topic(q):
    """يخفي موضوع السؤال من المجموعة (السؤال يبقى محفوظ ويرجع إذا الطالب استفسر)"""
    g = group_id()
    if not g or not q.get("thread_id"):
        return
    if not api("deleteForumTopic", chat_id=g, message_thread_id=q["thread_id"]):
        api("editForumTopic", chat_id=g, message_thread_id=q["thread_id"], name=topic_title(q, done=True))
        api("closeForumTopic", chat_id=g, message_thread_id=q["thread_id"])
    set_q(q["id"], thread_id=None)


def student_head(q, s, title):
    return ("%s\n\n<b>%s</b>\nالمنهج: %s — %s\nالامتحان: %s%s\n📞 <code>%s</code>\n\n📍 %s") % (
        title, esc(s["name"]), esc(s["curr"]), esc(s["grade"]), esc(s.get("exam") or ""),
        (" — " + esc(center_name(s.get("center_id")))) if s.get("center_id") else "", s["phone1"], esc(q_where(q)))


def q_new_message(chat, uid, m, data):
    """أول رسالة بالسؤال: يفتح موضوع بالمجموعة وينقلها"""
    g = group_id()
    s = student(uid)
    if not g or not s:
        set_session(uid, "", {}); send(chat, "⚠️ صار خطأ، حاول مرة ثانية.", reply_kb=main_kb(uid)); return
    mg = m.get("media_group_id")
    if mg and data.get("mg") == mg and data.get("qid"):          # باقي صور نفس الألبوم
        q = question(data["qid"])
        api("copyMessage", chat_id=g, from_chat_id=chat, message_id=m["message_id"], message_thread_id=q["thread_id"])
        log_msg(q["id"], "q", chat, m["message_id"])
        return
    if not data.get("t"):
        return
    with db() as c:
        qid = c.execute("INSERT INTO questions(user_id, chapter_id, topic_id, lecture, status, created, updated) VALUES(?,?,?,?,?,?,?)",
                        (uid, (topic(data["t"]) or {}).get("chapter_id"), data["t"], data.get("l") or 0, "open", stamp(), stamp())).lastrowid
    q = question(qid)
    r = api("createForumTopic", chat_id=g, name=topic_title(q))
    if not r:
        set_session(uid, "", {})
        send(chat, "⚠️ ما گدرت أوصل سؤالك هسه، حاول بعد شوية.", reply_kb=main_kb(uid))
        with db() as c:
            c.execute("DELETE FROM questions WHERE id=?", (qid,))
        return
    tid = r["message_thread_id"]
    set_q(qid, thread_id=tid)
    head = student_head(q, s, "❓ <b>سؤال جديد #%d</b>" % qid) + \
        "\n\n✍️ اكتب جوابك هنا بهذا الموضوع (كتابة أو صورة أو صوت) ويوصل للطالب مباشرة.\nلمن تخلص جوابك اضغط «✅ خلصت» حتى يختفي السؤال من عندك."
    api("sendMessage", chat_id=g, message_thread_id=tid, text=head, parse_mode="HTML")
    api("copyMessage", chat_id=g, from_chat_id=chat, message_id=m["message_id"], message_thread_id=tid)
    log_msg(qid, "q", chat, m["message_id"])
    set_session(uid, "q:sent", {"qid": qid, "mg": mg} if mg else {})
    send(chat, "✅ <b>وصل سؤالك</b> (رقم <b>#%d</b>)\n📍 %s\n\nراح يوصلك الجواب هنا بالبوت. وتگدر تشوف أسئلتك من «%s»." % (
        qid, esc(q_where(q, s["curr"] == "إنجليزي")), BTN_MYQ), reply_kb=main_kb(uid))


def q_follow_message(chat, uid, m, data):
    q = question(data.get("qid", 0))
    g = group_id()
    set_session(uid, "", {})
    if not q or not g:
        send(chat, "⚠️ السؤال غير موجود.", reply_kb=main_kb(uid)); return
    s = student(uid) or {"name": "طالب", "curr": "", "grade": "", "phone1": ""}
    tid = q.get("thread_id")
    if tid:                                     # الموضوع بعده موجود: نفتحه ونغير اسمه
        api("reopenForumTopic", chat_id=g, message_thread_id=tid)
        api("editForumTopic", chat_id=g, message_thread_id=tid, name=topic_title(q, follow=True))
    else:                                       # الموضوع مخفي: نفتح موضوع جديد بيه السؤال الأصلي وجوابك السابق
        r = api("createForumTopic", chat_id=g, name=topic_title(q, follow=True))
        if not r:
            send(chat, "⚠️ ما گدرت أوصل استفسارك هسه، حاول بعد شوية.", reply_kb=main_kb(uid)); return
        tid = r["message_thread_id"]
        set_q(q["id"], thread_id=tid)
        api("sendMessage", chat_id=g, message_thread_id=tid, parse_mode="HTML",
            text=student_head(q, s, "🔁 <b>استفسار على سؤال قديم #%d</b>" % q["id"]))
        with db() as c:
            logs = [dict(r) for r in c.execute("SELECT * FROM qmsgs WHERE qid=? ORDER BY id", (q["id"],))]
        last = None
        for lg in logs:
            if lg["kind"] != last:
                api("sendMessage", chat_id=g, message_thread_id=tid, parse_mode="HTML",
                    text="📜 <b>الطالب:</b>" if lg["kind"] == "q" else "💬 <b>جوابك:</b>")
                last = lg["kind"]
            api("copyMessage", chat_id=g, from_chat_id=lg["chat_id"], message_id=lg["msg_id"], message_thread_id=tid)
        if not logs:
            api("sendMessage", chat_id=g, message_thread_id=tid, text="(السؤال القديم ما محفوظ، لأنه انسأل قبل هذا التحديث)")
    set_q(q["id"], status="open")
    api("sendMessage", chat_id=g, message_thread_id=tid, parse_mode="HTML",
        text="━━━━━━━━━━━━\n🔁 <b>الاستفسار الجديد (ما فهم):</b>")
    api("copyMessage", chat_id=g, from_chat_id=chat, message_id=m["message_id"], message_thread_id=tid)
    log_msg(q["id"], "q", chat, m["message_id"])
    send(chat, "✅ وصل استفسارك على السؤال <b>#%d</b>. راح يوصلك الجواب هنا." % q["id"], reply_kb=main_kb(uid))


def on_group_message(m):
    """رد المدرس أو المساعد داخل موضوع السؤال بالمجموعة"""
    uid = m.get("from", {}).get("id")
    text = (m.get("text") or "").strip()
    if text.startswith("/setgroup"):
        if uid in ADMIN_IDS:
            kv_set("q_group", str(m["chat"]["id"]))
            api("sendMessage", chat_id=m["chat"]["id"], text="✅ تم ربط هاي المجموعة بالأسئلة العلمية. كل سؤال جديد راح ينفتحله موضوع هنا.")
        return
    if m["chat"]["id"] != group_id() or not m.get("message_thread_id") or not m.get("is_topic_message"):
        return
    if any(k in m for k in ("forum_topic_created", "forum_topic_closed", "forum_topic_reopened", "forum_topic_edited",
                            "new_chat_members", "left_chat_member", "pinned_message")):
        return
    if text.startswith("/") or not can(uid, "q"):
        return
    with db() as c:
        r = c.execute("SELECT * FROM questions WHERE thread_id=?", (m["message_thread_id"],)).fetchone()
    if not r:
        return
    q = dict(r)
    s = student(q["user_id"]) or {"curr": "عربي"}
    api("sendMessage", chat_id=q["user_id"], parse_mode="HTML",
        text="💬 <b>جواب سؤالك #%d</b>\n📍 %s" % (q["id"], esc(q_where(q, s["curr"] == "إنجليزي"))))
    res = api("copyMessage", chat_id=q["user_id"], from_chat_id=m["chat"]["id"], message_id=m["message_id"],
              reply_markup={"inline_keyboard": [[btn("✅ فهمت", "qok:%d" % q["id"]), btn("🔁 عندي استفسار", "qf:%d" % q["id"])]]})
    if res:
        log_msg(q["id"], "a", q["user_id"], res.get("message_id") if isinstance(res, dict) else None)
        first = q["status"] == "open"
        set_q(q["id"], status="answered")
        api("setMessageReaction", chat_id=m["chat"]["id"], message_id=m["message_id"], reaction=[{"type": "emoji", "emoji": "👍"}])
        if first:
            api("editForumTopic", chat_id=m["chat"]["id"], message_thread_id=m["message_thread_id"], name=topic_title(q, done=True))
            api("sendMessage", chat_id=m["chat"]["id"], message_thread_id=m["message_thread_id"], parse_mode="HTML",
                text="✅ وصل جوابك للطالب.\nإذا خلصت جوابك اضغط الزر حتى يختفي السؤال من عندك.\n(إذا الطالب استفسر بعدين، يرجعلك السؤال نفسه ويا جوابك)",
                reply_markup={"inline_keyboard": [[btn("✅ خلصت — أخفِ السؤال", "qh:%d" % q["id"])]]})
    else:
        api("sendMessage", chat_id=m["chat"]["id"], message_thread_id=m["message_thread_id"],
            text="⚠️ ما گدرت أوصل الجواب للطالب (ممكن مسوي حظر للبوت).")


def my_questions(chat, uid):
    s = student(uid)
    with db() as c:
        qs = [dict(r) for r in c.execute("SELECT * FROM questions WHERE user_id=? ORDER BY id DESC LIMIT 10", (uid,))]
    if not qs:
        send(chat, "ما عندك أسئلة بعد. اضغط «%s» حتى تسأل." % BTN_ASK); return
    st = {"open": "🟡 بانتظار الجواب", "answered": "🟢 تم الجواب", "closed": "✅ مغلق"}
    en = bool(s and s["curr"] == "إنجليزي")
    lines = ["<b>📂 أسئلتك (آخر 10)</b>", ""]
    kb = []
    for q in qs:
        lines.append("#%d — %s\n%s" % (q["id"], esc(q_where(q, en)), st.get(q["status"], "")))
        kb.append([btn("🔁 استفسار على #%d" % q["id"], "qf:%d" % q["id"])])
    send(chat, "\n\n".join(lines), kb)



# ---------------------------------------------------------------- بيع بالمكتب (كاشير)
# printed: 0 طلب توصيل جديد، 1 تجهز، 2 ملغي، 3 بيع بالمكتب
def site_base():
    base = STORE_URL.split("?")[0]
    return base.rsplit("/", 1)[0] if base.endswith(".html") else base.rstrip("/")


def pos_link(sid):
    s = student(sid) or {}
    c = []
    for ct in cats():
        ps = [[p["id"], p["name"], p["price"]] for p in products(ct["id"])]
        if ps:
            c.append([ct["name"], ps])
    d = {"c": c, "s": {"id": sid, "n": s.get("name", ""), "p": s.get("phone1", ""),
                       "g": "%s — %s" % (s.get("grade", ""), s.get("curr", ""))}}
    raw = json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return site_base() + "/pos.html?v=%d&d=" % int(time.time()) + base64.urlsafe_b64encode(raw).decode().rstrip("=")


def pos_kb(sid):
    return {"keyboard": [[{"text": "🏪 افتح صفحة البيع", "web_app": {"url": pos_link(sid)}}], [{"text": BTN_CANCEL}]],
            "resize_keyboard": True}


def staff_name(uid):
    if uid in ADMIN_IDS:
        return "قصي العميري"
    with db() as c:
        u = c.execute("""SELECT office_users.name un, offices.name onm FROM office_users JOIN offices ON offices.id=office_users.office_id
                         WHERE user_id=?""", (uid,)).fetchone()
        if u:
            return "%s (%s)" % (u["onm"], u["un"]) if u["un"] else u["onm"]
        r = c.execute("SELECT name FROM staff WHERE user_id=?", (uid,)).fetchone()
    return r["name"] if r and r["name"] else "مساعد"


def logo_data():
    return ("data:image/png;base64," + base64.b64encode(open(LOGO, "rb").read()).decode()) if os.path.exists(LOGO) else ""


def seller_label(o):
    """البائع بالوصل: اسم المكتبة بس، أو اسمك"""
    if o.get("office_id"):
        of = office(o["office_id"])
        if of:
            return of["name"]
    return "قصي العميري" if o.get("seller") in ADMIN_IDS or not o.get("seller") else staff_name(o.get("seller"))


def send_color_receipt(chat, oid):
    """نفس الوصل الملون مال الطالب، يوصل للبائع حتى يدزه لأي أحد"""
    with db() as c:
        r = c.execute("SELECT * FROM orders WHERE id=? AND printed=3", (oid,)).fetchone()
    if not r:
        return
    od = dict(r); items = json.loads(od["items"])
    os.makedirs(PDF_DIR, exist_ok=True)
    ch, cp = os.path.join(PDF_DIR, "rc_%d.html" % oid), os.path.join(PDF_DIR, "rc_%d.png" % oid)
    open(ch, "w", encoding="utf-8").write(receipt_card_html(od, items))
    if html_to_png(ch, cp, 760, 640 + 100 * len(items)):
        api_upload("sendPhoto", {"chat_id": chat, "caption": "🖼 وصل بيع #%d — %s" % (oid, esc(od["name"])), "parse_mode": "HTML"},
                   "photo", cp, "receipt.png", "image/png")
    else:
        send(chat, "⚠️ ما گدرت أسوي الصورة.")


def exam_label(sid):
    st = student(sid) or {}
    if st.get("exam") == "حضوري":
        return "حضوري — " + (center_name(st.get("center_id")) or "بدون مركز")
    return st.get("exam") or "—"


def receipt_paper_html(o, items, img=False):
    """وصل ورقي لطابعة الوصولات (عرض 58 ملم)"""
    rows = "".join('<tr><td>%s</td><td class="n">%d</td><td class="n">%s</td></tr>' % (esc(it["name"]), it["qty"], "{:,}".format(it["qty"] * it["price"]))
                   for it in items)
    h = 130 + 17 * len(items)
    lg = logo_data()
    return """<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@page{size:58mm %dmm;margin:0}
*{box-sizing:border-box}body{margin:0;width:58mm;padding:3mm 2.5mm;font-family:Tahoma,'Segoe UI',Arial,sans-serif;color:#000;font-size:10.5pt}
.c{text-align:center}.logo{height:15mm;filter:grayscale(1) contrast(1.6)}
h1{margin:1mm 0 0;font-size:15pt;letter-spacing:.5px;font-family:'Segoe UI',Arial}
.sub{font-size:9.5pt}.hr{border-top:1.4px dashed #000;margin:2mm 0}
.kv{display:flex;justify-content:space-between;font-size:9.5pt;line-height:1.55}
table{width:100%%;border-collapse:collapse;font-size:9.5pt}th{border-bottom:1.2px solid #000;padding:1mm 0;text-align:right}
td{padding:1.1mm 0;vertical-align:top;border-bottom:.6px dotted #000}.n{text-align:left;white-space:nowrap;padding-right:1.5mm;direction:ltr}
.tot{display:flex;justify-content:space-between;font-size:13pt;font-weight:bold;margin-top:2mm}
.note{font-size:8.5pt;text-align:center;margin-top:2mm;line-height:1.5}
%s
</style></head><body>
<div class="c">%s<h1>QMath</h1><div class="sub">قصي العميري — رياضيات السادس العلمي</div></div>
<div class="hr"></div>
<div class="c" style="font-weight:bold">وصل بيع رقم #%d</div>
<div class="kv"><span>التاريخ</span><span dir="ltr">%s</span></div>
<div class="kv"><span>الطالب</span><span>%s</span></div>
<div class="kv"><span>الهاتف</span><span dir="ltr">%s</span></div>
<div class="kv"><span>الامتحان</span><span style="text-align:left">%s</span></div>
<div class="kv"><span>البائع</span><span>%s</span></div>
<div class="hr"></div>
<table><tr><th>المنتج</th><th class="n">العدد</th><th class="n">المبلغ</th></tr>%s</table>
<div class="tot"><span>المجموع</span><span dir="ltr">%s د.ع</span></div>
<div class="hr"></div>
<div class="note">جميع المشتريات غير قابلة للإرجاع<br>شكراً لك 🌷</div>
</body></html>""" % (h, "html{direction:ltr;background:#fff}body{direction:rtl;zoom:2.28;background:#fff}" if img else "",
                      ('<img class="logo" src="%s">' % lg) if lg else "", o["id"], esc(o["created"]), esc(o["name"]),
                      esc(o["phone1"]), esc(exam_label(o["user_id"])), esc(seller_label(o)), rows, "{:,}".format(o["total"]))


def receipt_card_html(o, items):
    """وصل إلكتروني ملون يوصل للطالب بالبوت"""
    fnt = os.path.join(HERE, "boahmed.ttf")
    face = ("@font-face{font-family:Boahmed;src:url(data:font/ttf;base64,%s)}" % base64.b64encode(open(fnt, "rb").read()).decode()) if os.path.exists(fnt) else ""
    lg = logo_data()
    rows = "".join('<tr><td>%s</td><td class="n">× %d</td><td class="m">%s</td></tr>' % (esc(it["name"]), it["qty"], money(it["qty"] * it["price"]))
                   for it in items)
    return """<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>%s
*{box-sizing:border-box}html{background:#101929}html,body{margin:0;width:760px;overflow:hidden}
body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#F4F1E8;min-height:1600px;padding:24px 30px 40px;
background:radial-gradient(ellipse at 50%% 0%%,rgba(249,196,69,.20),transparent 55%%),linear-gradient(180deg,#14203a,#101929 40%%)}
.top{text-align:center}.top img{height:86px;filter:drop-shadow(0 8px 18px rgba(0,0,0,.5))}
.top h1{margin:0;font-size:36px;font-weight:800;letter-spacing:2px;color:#F9C445}
.top p{margin:0;font-family:Boahmed,'Segoe UI';font-size:22px;color:#cfd7e6}
.card{margin-top:16px;background:#162238;border:1px solid #2a3b5c;border-radius:24px;overflow:hidden;box-shadow:0 14px 30px rgba(0,0,0,.35)}
.card h2{margin:0;padding:12px 22px;font-size:24px;font-weight:800;color:#101929;background:linear-gradient(90deg,#F9C445,#CEA239);display:flex;justify-content:space-between}
.info{display:flex;flex-wrap:wrap;gap:6px 24px;padding:14px 22px;font-size:19px;color:#cfd7e6;border-bottom:1px solid #2a3b5c}.info b{color:#F4F1E8}
table{width:100%%;border-collapse:collapse}td{padding:12px 22px;border-top:1px solid #2a3b5c;font-size:20px;font-weight:600}
td.n{color:#9fb0c9;white-space:nowrap;direction:ltr;text-align:center}td.m{color:#F9C445;white-space:nowrap;text-align:left;direction:ltr}
tr:nth-child(even) td{background:rgba(255,255,255,.025)}
.tot{display:flex;justify-content:space-between;align-items:center;padding:14px 22px;background:#1d2c47;font-size:26px;font-weight:800;color:#F9C445}
.ok{margin:14px 16px 16px;padding:10px 16px;border-radius:14px;border:1px dashed #CEA239;background:rgba(249,196,69,.08);font-size:17px;line-height:1.6;text-align:center}
</style></head><body>
<div class="top">%s<h1>QMath</h1><p>قصي العميري</p></div>
<div class="card"><h2><span>🧾 وصل الشراء</span><span dir="ltr">#%d</span></h2>
<div class="info"><span>👤 <b>%s</b></span><span>📅 <b dir="ltr">%s</b></span><span>🏪 <b>استلام من %s</b></span><span>📝 الامتحان: <b>%s</b></span></div>
<table>%s</table>
<div class="tot"><span>💰 المجموع</span><span dir="ltr">%s</span></div>
<div class="ok">✅ تم الدفع والاستلام · شكراً لك 🌷<br>جميع المشتريات غير قابلة للإرجاع</div></div>
</body></html>""" % (face, ('<img src="%s">' % lg) if lg else "", o["id"], esc(o["name"]), esc(o["created"]), esc(o.get("gov") or "المكتب"), esc(exam_label(o["user_id"])), rows, money(o["total"]))


def send_paper_receipt(chat, oid):
    """وصل للطباعة (بس إذا طلبه البائع)"""
    with db() as c:
        r = c.execute("SELECT * FROM orders WHERE id=? AND printed=3", (oid,)).fetchone()
    if not r:
        send(chat, "⚠️ البيعة غير موجودة."); return
    od = dict(r); items = json.loads(od["items"])
    os.makedirs(PDF_DIR, exist_ok=True)
    hp, pp = os.path.join(PDF_DIR, "receipt_%d.html" % oid), os.path.join(PDF_DIR, "وصل_%d.pdf" % oid)
    open(hp, "w", encoding="utf-8").write(receipt_paper_html(od, items))
    if html_to_pdf(hp, pp):
        api_upload("sendDocument", {"chat_id": chat, "caption": "🧾 وصل بيع #%d\n🖨 افتح الملف ← ⋮ ← Print ← طابعة SUNMI" % oid}, "document", pp, "وصل_%d.pdf" % oid, "application/pdf")


def on_pos_sale(chat, uid, o):
    off = my_office(uid)
    if not off and not can(uid, "orders"):
        send(chat, "⚠️ ما عندك صلاحية.", reply_kb=main_kb(uid)); return
    try:
        sid = int(o.get("sid") or 0)
    except Exception:
        sid = 0
    s = student(sid)
    if not s:
        send(chat, "⚠️ الطالب غير موجود.", reply_kb=main_kb(uid)); return
    items = []
    for it in o.get("i", []):
        try:
            pid, q = int(it[0]), int(it[1])
        except Exception:
            continue
        p = product(pid)
        if p and q > 0:
            items.append({"id": pid, "name": p["name"], "price": p["price"], "qty": min(q, 50)})
    if not items:
        send(chat, "⚠️ ما اخترت ولا منتج.", reply_kb=pos_kb(sid)); return
    total = sum(i["qty"] * i["price"] for i in items)
    if off:
        un = office_unsettled(off["id"])
        if off["lim"] and un["total"] + total > off["lim"]:
            send(chat, "⛔ ما يصير تبيع هالبيعة: مبلغها أكثر من الرصيد الباقي للمكتبة.\n🔴 غير محاسب عليه: %s\n🟢 الباقي: %s\n\nتحاسب ويا قصي العميري حتى ينفتح الرصيد."
                 % (money(un["total"]), money(max(off["lim"] - un["total"], 0))), reply_kb=main_kb(uid))
            return
    elif uid not in ADMIN_IDS:
        a = staff_account(uid)
        if a["limit"] and a["owed"] + total > a["limit"]:
            send(chat, "⛔ ما يصير تبيع هالبيعة: مبلغها أكثر من الرصيد الباقي إلك.\n🔴 بذمتك: %s\n🟢 باقي تگدر تبيع بـ: %s\n\nسلّم المبلغ لقصي العميري حتى ينفتح رصيدك."
                 % (money(a["owed"]), money(max(a["left"], 0))), reply_kb=main_kb(uid))
            return
    with db() as c:
        oid = c.execute("""INSERT INTO orders(user_id, username, name, curr, gov, side, area, phone1, phone2, items, subtotal, fee, total,
                           created, printed, seller, office_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (sid, s.get("username") or "", s["name"], s.get("curr") or "", off["name"] if off else "المكتب", "", "بيع بالمكتب",
                         s["phone1"], s["phone2"], json.dumps(items, ensure_ascii=False), total, 0, total, stamp(), 3, uid,
                         off["id"] if off else None)).lastrowid
        od = dict(c.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone())
    set_session(uid, "", {})
    os.makedirs(PDF_DIR, exist_ok=True)
    # 2) الوصل الإلكتروني الملون للطالب
    sent = False
    try:
        ch, cp = os.path.join(PDF_DIR, "rc_%d.html" % oid), os.path.join(PDF_DIR, "rc_%d.png" % oid)
        open(ch, "w", encoding="utf-8").write(receipt_card_html(od, items))
        if html_to_png(ch, cp, 760, 640 + 100 * len(items)):
            sent = bool(api_upload("sendPhoto", {"chat_id": sid, "caption": "🧾 <b>وصل شرائك من مكتب QMath</b> (#%d)\nشكراً لك 🌷" % oid,
                                                 "parse_mode": "HTML"}, "photo", cp, "receipt.png", "image/png"))
    except Exception:
        traceback.print_exc()
    if not sent:
        lines = ["🧾 <b>وصل شرائك من مكتب QMath</b> (#%d)" % oid, ""] + \
                ["• %s × %d — %s" % (esc(i["name"]), i["qty"], money(i["qty"] * i["price"])) for i in items] + \
                ["", "💰 المجموع: <b>%s</b>" % money(total), "شكراً لك 🌷"]
        sent = bool(send(sid, "\n".join(lines)))
    msg = ("✅ <b>تم البيع #%d</b> — %s\n💰 %s\n\n" % (oid, esc(s["name"]), money(total))) + \
          ("📱 وصل الوصل الإلكتروني للطالب." if sent else "⚠️ ما گدرت أرسل الوصل للطالب (ممكن مسوي حظر للبوت).") + \
          "\n📊 وانسجلت بمبيعات اليوم."
    if off:
        un = office_unsettled(off["id"])
        msg += "\n\n🔴 غير محاسب عليه: <b>%s</b>" % money(un["total"])
        if off["lim"]:
            msg += "\n🟢 الباقي من الرصيد: <b>%s</b>" % money(max(off["lim"] - un["total"], 0))
        send(chat, msg, reply_kb=main_kb(uid))
        send(chat, "👇", [[btn("🏪 بيع جديد", "of:pos")], [btn("📊 مبيعات اليوم", "of:d:0")], [btn("🖼 وصل ملون (صورة)", "of:rc:%d" % oid), btn("🖨 وصل للطباعة", "of:r:%d" % oid)]])
        return
    if uid not in ADMIN_IDS:
        a = staff_account(uid)
        msg += "\n\n🔴 بذمتك هسه: <b>%s</b>" % money(a["owed"])
        if a["limit"]:
            msg += "\n🟢 باقي تگدر تبيع بـ: <b>%s</b>" % money(max(a["left"], 0))
    send(chat, msg, reply_kb=main_kb(uid))
    send(chat, "👇", [[btn("🏪 بيع جديد", "a:pos")], [btn("📊 مبيعات اليوم", "a:of")], [btn("🖼 وصل ملون (صورة)", "a:ofrc:%d" % oid), btn("🖨 وصل للطباعة", "a:ofr:%d" % oid)]])


def shift_day(day, n):
    t = time.mktime(time.strptime(day, "%Y-%m-%d")) + n * 86400 + 3600
    return time.strftime("%Y-%m-%d", time.localtime(t))


def office_kb(day):
    today = time.strftime("%Y-%m-%d", now_iq())
    nav = [btn("◀️ اليوم السابق", "a:of:%s" % shift_day(day, -1))]
    if day < today:
        nav.append(btn("اليوم التالي ▶️", "a:of:%s" % shift_day(day, 1)))
    return [nav, [btn("📅 كل الأيام", "a:ofd")], [btn("📄 سجل هذا اليوم PDF", "a:ofp:%s" % day)],
            [btn("🏪 بيع جديد", "a:pos")], [btn("⬅️ رجوع", "a:menu")]]


def office_days():
    with db() as c:
        rows = [dict(r) for r in c.execute("""SELECT substr(created,1,10) d, COUNT(*) n, SUM(total) t FROM orders WHERE printed=3
                                              GROUP BY d ORDER BY d DESC LIMIT 31""")]
    if not rows:
        return "ما أكو مبيعات بالمكتب بعد.", [[btn("⬅️ رجوع", "a:of")]]
    lines = ["<b>📅 سجل مبيعات المكتب (آخر 31 يوم)</b>", ""] + ["• %s — %d بيعة — <b>%s</b>" % (r["d"], r["n"], money(r["t"])) for r in rows]
    lines += ["", "المجموع: <b>%s</b>" % money(sum(r["t"] for r in rows))]
    kb = [[btn("📊 %s  (%s)" % (r["d"], money(r["t"])), "a:of:%s" % r["d"])] for r in rows[:15]] + [[btn("⬅️ رجوع", "a:of")]]
    return "\n".join(lines), kb


def office_view(day=None):
    day = day or time.strftime("%Y-%m-%d", now_iq())
    with db() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM orders WHERE printed=3 AND created LIKE ? ORDER BY id", (day + "%",))]
    tot = sum(r["total"] for r in rows)
    lines = ["<b>📊 مبيعات المكتب — %s%s</b>" % (day, " (اليوم)" if day == time.strftime("%Y-%m-%d", now_iq()) else ""), "", "عدد المبيعات: <b>%d</b>" % len(rows), "المجموع: <b>%s</b>" % money(tot), ""]
    by = {}
    for r in rows:
        by[r.get("seller")] = by.get(r.get("seller"), 0) + r["total"]
    if by:
        lines += ["<b>حسب البائع:</b>"] + ["• %s: %s" % (esc(staff_name(k)), money(v)) for k, v in by.items()] + [""]
    for r in rows[-25:]:
        lines.append("#%d  %s  —  %s  (%s · %s)" % (r["id"], esc(" ".join(r["name"].split()[:2])), money(r["total"]), r["created"][11:],
                                                  esc(staff_name(r.get("seller")))))
    return "\n".join(lines)



# ---------------------------------------------------------------- المكتبات (نقاط البيع)
def my_office(uid):
    with db() as c:
        r = c.execute("""SELECT offices.* FROM office_users JOIN offices ON offices.id=office_users.office_id
                         WHERE office_users.user_id=? AND offices.active=1""", (uid,)).fetchone()
    return dict(r) if r else None


def office(oid):
    with db() as c:
        r = c.execute("SELECT * FROM offices WHERE id=?", (oid,)).fetchone()
    return dict(r) if r else None


def office_unsettled(oid):
    with db() as c:
        r = c.execute("""SELECT COUNT(*) n, IFNULL(SUM(total),0) t FROM orders WHERE printed=3 AND office_id=? AND settle_id IS NULL""",
                      (oid,)).fetchone()
    return {"n": r["n"], "total": r["t"]}


def sale_line(r):
    its = "، ".join("%s ×%d" % (i["name"], i["qty"]) for i in json.loads(r["items"]))
    return "🕐 %s · #%d · <b>%s</b>\n   👤 %s\n   📦 %s" % (r["created"][11:], r["id"], money(r["total"]), esc(r["name"]), esc(its))


def sales_text(title, rows, limit=30):
    tot = sum(r["total"] for r in rows)
    lines = ["<b>%s</b>" % title, "عدد المبيعات: <b>%d</b> · المجموع: <b>%s</b>" % (len(rows), money(tot)), ""]
    lines += [sale_line(r) for r in rows[-limit:]]
    if len(rows) > limit:
        lines.append("… (وأكو %d قبلها، شوفهن بملف PDF)" % (len(rows) - limit))
    t = "\n".join(lines)
    return t if len(t) < 3900 else t[:3850] + "\n…"


def office_day_rows(oid, day):
    with db() as c:
        return [dict(r) for r in c.execute("SELECT * FROM orders WHERE printed=3 AND office_id=? AND created LIKE ? ORDER BY id",
                                           (oid, day + "%"))]


def office_rows(oid, where, args=()):
    with db() as c:
        return [dict(r) for r in c.execute("SELECT * FROM orders WHERE printed=3 AND office_id=? AND %s ORDER BY id" % where, (oid,) + tuple(args))]


def office_pdf(chat, title, rows, fname):
    data = [["#%d" % r["id"], r["created"], r["name"], "، ".join("%s ×%d" % (i["name"], i["qty"]) for i in json.loads(r["items"])),
             "{:,}".format(r["total"])] for r in rows]
    list_pdf(chat, "%s — المجموع %s" % (title, money(sum(r["total"] for r in rows))), ["رقم", "الوقت", "الطالب", "المنتجات", "المبلغ"], data, fname)


def today_str(back=0):
    return time.strftime("%Y-%m-%d", time.gmtime(time.time() + 3 * 3600 - back * 86400))


# ---- واجهة حساب المكتبة
def office_menu(chat, uid):
    off = my_office(uid)
    if not off:
        return
    un = office_unsettled(off["id"])
    td = office_day_rows(off["id"], today_str())
    t = ("<b>🏪 %s</b>\n\n📊 مبيعات اليوم: <b>%s</b> (%d)\n🔴 غير محاسب عليه: <b>%s</b> (%d بيعة)%s") % (
        esc(off["name"]), money(sum(r["total"] for r in td)), len(td), money(un["total"]), un["n"],
        ("\n🟢 الباقي من الرصيد: <b>%s</b>" % money(max(off["lim"] - un["total"], 0))) if off["lim"] else "")
    send(chat, t, [[btn("🏪 بيع جديد", "of:pos")], [btn("📊 مبيعات اليوم", "of:d:0"), btn("📅 مبيعات البارحة", "of:d:1")],
                   [btn("🔴 غير المحاسب عليها", "of:u")], [btn("🗂 المحاسبات السابقة (الأرشيف)", "of:a")]])


def office_cb(chat, uid, mid, d):
    off = my_office(uid)
    if not off:
        return "ما عندك صلاحية"
    oid = off["id"]
    if d == "of:pos":
        set_session(uid, "o:pos", {})
        send(chat, "🏪 <b>بيع جديد</b>\n🔍 اكتب اسم الطالب (أو جزء منه) أو رقم هاتفه:", reply_kb=flow_kb())
    elif d.startswith("of:ps:"):
        sid = int(d[6:]); s = student(sid)
        if s:
            set_session(uid, "o:posw", {"sid": sid})
            send(chat, "👤 <b>%s</b>\n👇 اضغط «🏪 افتح صفحة البيع» واختار المنتجات، وبعدين «✅ تم البيع»." % esc(s["name"]), reply_kb=pos_kb(sid))
    elif d.startswith("of:d:"):
        back = int(d[5:]); day = today_str(back)
        rows = office_day_rows(oid, day)
        send(chat, sales_text("📊 %s — %s %s" % (off["name"], "اليوم" if back == 0 else "البارحة" if back == 1 else "", day), rows),
             [[btn("📄 PDF", "of:dp:%d" % back)], [btn("⬅️ رجوع", "of:m")]])
    elif d.startswith("of:dp:"):
        day = today_str(int(d[6:])); office_pdf(chat, "%s — %s" % (off["name"], day), office_day_rows(oid, day), "office%d_%s" % (oid, day))
    elif d == "of:u":
        rows = office_rows(oid, "settle_id IS NULL")
        send(chat, sales_text("🔴 %s — غير المحاسب عليها" % off["name"], rows), [[btn("📄 PDF", "of:up")], [btn("⬅️ رجوع", "of:m")]])
    elif d == "of:up":
        office_pdf(chat, "%s — غير المحاسب عليها" % off["name"], office_rows(oid, "settle_id IS NULL"), "office%d_open" % oid)
    elif d == "of:a":
        t, kb = settlements_view(oid, "of"); send(chat, t, kb)
    elif d.startswith("of:sv:"):
        settle_detail(chat, oid, int(d[6:]), "of")
    elif d.startswith("of:rc:"):
        with db() as c:
            r = c.execute("SELECT id FROM orders WHERE id=? AND office_id=?", (int(d[6:]), oid)).fetchone()
        if r:
            send_color_receipt(chat, r["id"])
    elif d.startswith("of:r:"):
        with db() as c:
            r = c.execute("SELECT id FROM orders WHERE id=? AND office_id=?", (int(d[5:]), oid)).fetchone()
        if r:
            send_paper_receipt(chat, r["id"])
    elif d == "of:m":
        office_menu(chat, uid)
    return None


def settlements_view(oid, pre):
    with db() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM settlements WHERE office_id=? ORDER BY id DESC LIMIT 30", (oid,))]
    if not rows:
        return "🗂 ما أكو محاسبات سابقة بعد.", [[btn("⬅️ رجوع", "of:m" if pre == "of" else "a:libv:%d" % oid)]]
    lines = ["<b>🗂 المحاسبات السابقة (الأرشيف)</b>", ""] + ["• %s — <b>%s</b> (%d بيعة)" % (r["created"], money(r["amount"]), r["n"]) for r in rows]
    kb = [[btn("📂 %s — %s" % (r["created"][:10], money(r["amount"])), "%s:sv:%d" % (pre if pre == "of" else "a:lib", r["id"]))] for r in rows[:15]]
    kb.append([btn("⬅️ رجوع", "of:m" if pre == "of" else "a:libv:%d" % oid)])
    return "\n".join(lines), kb


def settle_detail(chat, oid, stid, pre):
    with db() as c:
        st = c.execute("SELECT * FROM settlements WHERE id=? AND office_id=?", (stid, oid)).fetchone()
    if not st:
        return
    rows = office_rows(oid, "settle_id=?", (stid,))
    o = office(oid) or {"name": ""}
    office_pdf(chat, "%s — محاسبة %s" % (o["name"], st["created"]), rows, "settle_%d" % stid)


# ---- واجهة الإدارة للمكتبات
def libs_view():
    with db() as c:
        offs = [dict(r) for r in c.execute("SELECT * FROM offices WHERE active=1 ORDER BY id")]
    lines = ["<b>🏬 المكتبات (نقاط البيع)</b>", "📅 اليوم %s" % today_str(), ""]
    kb = []
    for o in offs:
        un = office_unsettled(o["id"]); td = office_day_rows(o["id"], today_str())
        lines.append("🏪 <b>%s</b>\n   اليوم: %s · غير محاسب: %s" % (esc(o["name"]), money(sum(r["total"] for r in td)), money(un["total"])))
        kb.append([btn("🏪 %s — اليوم: %d بيعة · %s" % (o["name"], len(td), money(sum(r["total"] for r in td))), "a:libv:%d" % o["id"])])
    if not offs:
        lines.append("ما أكو مكتبات بعد. اضغط «➕ إضافة مكتبة».")
    kb += [[btn("➕ إضافة مكتبة", "a:liba")], [btn("⬅️ رجوع", "a:menu")]]
    return "\n".join(lines), kb


def lib_view(oid):
    o = office(oid)
    if not o:
        return libs_view()
    un = office_unsettled(oid); td = office_day_rows(oid, today_str()); yd = office_day_rows(oid, today_str(1))
    with db() as c:
        us = [dict(r) for r in c.execute("SELECT * FROM office_users WHERE office_id=?", (oid,))]
        st = c.execute("SELECT IFNULL(SUM(amount),0) t FROM settlements WHERE office_id=?", (oid,)).fetchone()["t"]
    t = ["<b>🏪 %s</b>" % esc(o["name"]), "",
         "📊 اليوم: <b>%s</b> (%d)" % (money(sum(r["total"] for r in td)), len(td)),
         "📅 البارحة: <b>%s</b> (%d)" % (money(sum(r["total"] for r in yd)), len(yd)),
         "🔴 غير محاسب عليه: <b>%s</b> (%d بيعة)" % (money(un["total"]), un["n"]),
         "✅ كل اللي تحاسبتوا عليه: <b>%s</b>" % money(st),
         "🎯 الرصيد المسموح: <b>%s</b>" % (money(o["lim"]) if o["lim"] else "بدون حد"), "",
         "<b>👥 الحسابات:</b>"] + (["• %s" % esc(u["name"] or str(u["user_id"])) for u in us] or ["(ما أكو حساب، ضيف حساب حتى يبيع)"])
    kb = [[btn("📊 اليوم", "a:libd:%d:0" % oid), btn("📅 البارحة", "a:libd:%d:1" % oid)],
          [btn("🔴 غير المحاسب عليها (تفصيل)", "a:libu:%d" % oid)],
          [btn("✅ تمت المحاسبة", "a:libs:%d" % oid)], [btn("🗂 الأرشيف", "a:libar:%d" % oid)],
          [btn("👤 إضافة حساب للمكتبة", "a:libm:%d" % oid)]] + \
         [[btn("🗑 حذف حساب: %s" % (u["name"] or u["user_id"]), "a:libmd:%d" % u["user_id"])] for u in us] + \
         [[btn("🎯 الرصيد المسموح", "a:libl:%d" % oid), btn("✏️ تغيير الاسم", "a:libn:%d" % oid)],
          [btn("🗑 حذف المكتبة", "a:libx:%d" % oid)], [btn("⬅️ رجوع للمكتبات", "a:lib")]]
    return "\n".join(t), kb


def lib_cb(chat, uid, mid, d):
    """ترجع (handled, note)"""
    if d == "a:lib":
        t, kb = libs_view(); send(chat, t, kb); return True, None
    if d == "a:liba":
        set_session(uid, "a:liba", {}); send(chat, "✍️ اكتب اسم المكتبة (مثلاً: مكتبة 1):", reply_kb=flow_kb()); return True, None
    if d.startswith("a:libv:"):
        t, kb = lib_view(int(d[7:])); send(chat, t, kb); return True, None
    if d.startswith("a:libd:"):
        oid, back = [int(x) for x in d[7:].split(":")]
        o = office(oid); day = today_str(back)
        send(chat, sales_text("📊 %s — %s" % (o["name"], day), office_day_rows(oid, day)),
             [[btn("📄 PDF", "a:libdp:%d:%d" % (oid, back))], [btn("⬅️ رجوع", "a:libv:%d" % oid)]]); return True, None
    if d.startswith("a:libdp:"):
        oid, back = [int(x) for x in d[8:].split(":")]
        day = today_str(back); office_pdf(chat, "%s — %s" % (office(oid)["name"], day), office_day_rows(oid, day), "office%d_%s" % (oid, day))
        return True, None
    if d.startswith("a:libu:"):
        oid = int(d[7:]); o = office(oid)
        send(chat, sales_text("🔴 %s — غير المحاسب عليها" % o["name"], office_rows(oid, "settle_id IS NULL")),
             [[btn("📄 PDF", "a:libup:%d" % oid)], [btn("✅ تمت المحاسبة", "a:libs:%d" % oid)], [btn("⬅️ رجوع", "a:libv:%d" % oid)]])
        return True, None
    if d.startswith("a:libup:"):
        oid = int(d[8:]); office_pdf(chat, "%s — غير المحاسب عليها" % office(oid)["name"], office_rows(oid, "settle_id IS NULL"), "office%d_open" % oid)
        return True, None
    if d.startswith("a:libs:"):
        oid = int(d[7:]); un = office_unsettled(oid)
        if not un["n"]:
            return True, "ما أكو مبيعات غير محاسب عليها"
        send(chat, "⚠️ متأكد استلمت من <b>%s</b> مبلغ <b>%s</b> (%d بيعة)؟\nكل هالمبيعات راح تنتقل للأرشيف." % (
            esc(office(oid)["name"]), money(un["total"]), un["n"]),
             [[btn("✅ نعم، استلمت %s" % money(un["total"]), "a:libsy:%d:%d" % (oid, un["total"]))], [btn("↩️ لا", "a:libv:%d" % oid)]])
        return True, None
    if d.startswith("a:libsy:"):
        oid, amt = [int(x) for x in d[8:].split(":")]
        un = office_unsettled(oid)
        if un["total"] != amt:
            return True, "صارت مبيعات جديدة، اضغط «تمت المحاسبة» مرة ثانية"
        with db() as c:
            stid = c.execute("INSERT INTO settlements(office_id, amount, n, created) VALUES(?,?,?,?)", (oid, amt, un["n"], stamp())).lastrowid
            c.execute("UPDATE orders SET settle_id=? WHERE printed=3 AND office_id=? AND settle_id IS NULL", (stid, oid))
            us = [r["user_id"] for r in c.execute("SELECT user_id FROM office_users WHERE office_id=?", (oid,))]
        edit(chat, mid, "✅ تمت المحاسبة ويا <b>%s</b>: <b>%s</b> (%d بيعة)، وانتقلت للأرشيف." % (esc(office(oid)["name"]), money(amt), un["n"]))
        for u in us:
            send(u, "✅ <b>تمت المحاسبة</b> ويا قصي العميري\n💰 %s (%d بيعة)\nالمبيعات انتقلت للأرشيف «🗂 المحاسبات السابقة»." % (money(amt), un["n"]))
        t, kb = lib_view(oid); send(chat, t, kb)
        return True, None
    if d.startswith("a:libar:"):
        t, kb = settlements_view(int(d[8:]), "a"); send(chat, t, kb); return True, None
    if d.startswith("a:lib:sv:"):
        stid = int(d[9:])
        with db() as c:
            r = c.execute("SELECT office_id FROM settlements WHERE id=?", (stid,)).fetchone()
        if r:
            settle_detail(chat, r["office_id"], stid, "a")
        return True, None
    if d.startswith("a:libm:"):
        oid = int(d[7:])
        import random
        code = str(random.randint(100000, 999999))
        while kv_get("libinv_" + code):
            code = str(random.randint(100000, 999999))
        kv_set("libinv_" + code, "%d:%d" % (oid, int(time.time())))
        link = "https://t.me/%s?start=lib_%s" % (kv_get("bot_username") or "Qusay_Alomairi_Bot", code)
        send(chat, ("👤 <b>إضافة حساب لـ %s</b>\n\n"
                    "1️⃣ اضغط مطولاً على الرابط الأزرق جوة وانسخه (أو اضغط زر «📤 مشاركة الرابط»).\n"
                    "2️⃣ دزه لصاحب المكتبة بالواتساب أو التلكرام.\n"
                    "3️⃣ هو يضغط الرابط ← ينفتح البوت ← يضغط <b>Start / ابدأ</b>، وينضاف لوحده ✅\n\n"
                    "🔗 %s\n\n"
                    "🔢 <b>أو الأسهل:</b> خليه يفتح البوت ويكتب هذا الرقم بس ويدزه:\n<code>%s</code>\n\n"
                    "⏳ الرابط والرقم يشتغلون مرة وحدة بس، وخلال 3 أيام. بعد ما ينضاف يبقى بالمكتبة دائماً.") % (esc(office(oid)["name"]), link, code),
             [[{"text": "📤 مشاركة الرابط", "url": "https://t.me/share/url?url=" + urllib.parse.quote(link)}],
              [btn("✍️ أضيفه برقم الحساب بدل الرابط", "a:libmn:%d" % oid)], [btn("⬅️ رجوع", "a:libv:%d" % oid)]])
        return True, None
    if d.startswith("a:libmn:"):
        set_session(uid, "a:libm", {"oid": int(d[8:])})
        send(chat, "✍️ اكتب رقم حساب صاحب المكتبة (يطلعه من البوت إذا كتب كلمة <code>رقمي</code>):", reply_kb=flow_kb())
        return True, None
    if d.startswith("a:libmd:"):
        u = int(d[8:])
        with db() as c:
            r = c.execute("SELECT office_id FROM office_users WHERE user_id=?", (u,)).fetchone()
            c.execute("DELETE FROM office_users WHERE user_id=?", (u,))
        send(u, "ℹ️ انشال حسابك من المكتبة.", reply_kb=main_kb(u))
        if r:
            t, kb = lib_view(r["office_id"]); send(chat, t, kb)
        return True, None
    if d.startswith("a:libl:"):
        set_session(uid, "a:libl", {"oid": int(d[7:])})
        send(chat, "🎯 اكتب الرصيد المسموح للمكتبة (أكثر مبلغ تبيع بيه قبل ما تتحاسب)\nمثال: <code>20 مليون</code> — واكتب <code>0</code> بدون حد.", reply_kb=flow_kb())
        return True, None
    if d.startswith("a:libn:"):
        set_session(uid, "a:libn", {"oid": int(d[7:])}); send(chat, "✍️ اكتب الاسم الجديد للمكتبة:", reply_kb=flow_kb()); return True, None
    if d.startswith("a:libx:"):
        oid = int(d[7:])
        send(chat, "⚠️ متأكد تحذف <b>%s</b>؟ (المبيعات تبقى محفوظة بالسجل)" % esc(office(oid)["name"]),
             [[btn("🗑 نعم، احذف", "a:libxy:%d" % oid)], [btn("↩️ لا", "a:libv:%d" % oid)]])
        return True, None
    if d.startswith("a:libxy:"):
        oid = int(d[8:])
        with db() as c:
            c.execute("UPDATE offices SET active=0 WHERE id=?", (oid,))
            c.execute("DELETE FROM office_users WHERE office_id=?", (oid,))
        t, kb = libs_view(); send(chat, t, kb)
        return True, None
    return False, None


def join_office_by_code(chat, uid, code, user):
    v = kv_get("libinv_" + re.sub(r"\W", "", code))
    if not v:
        send(chat, "⚠️ الرابط غير صالح أو انستخدم قبل. اطلب رابط جديد من قصي العميري.", reply_kb=main_kb(uid)); return
    oid, ts = [int(x) for x in v.split(":")]
    o = office(oid)
    if not o or not o["active"] or time.time() - ts > 3 * 86400:
        send(chat, "⚠️ الرابط انتهى. اطلب رابط جديد من قصي العميري.", reply_kb=main_kb(uid)); return
    if is_staff(uid):
        send(chat, "⚠️ هذا الحساب أدمن أو مساعد، ما يصير ينضاف لمكتبة.", reply_kb=main_kb(uid)); return
    name = " ".join(x for x in (user.get("first_name"), user.get("last_name")) if x) or (user.get("username") or "")
    with db() as c:
        c.execute("INSERT OR REPLACE INTO office_users(user_id, office_id, name) VALUES(?,?,?)", (uid, oid, name[:40]))
        c.execute("DELETE FROM kv WHERE k=?", ("libinv_" + re.sub(r"\W", "", code),))
    set_session(uid, "", {})
    send(chat, "✅ <b>تمت إضافتك لـ %s</b>\nاضغط زر «%s» اللي جوة حتى تبيع وتشوف مبيعاتك 👇" % (esc(o["name"]), BTN_OFFICE), reply_kb=main_kb(uid))
    for a in ADMIN_IDS:
        send(a, "✅ <b>%s</b> انضاف لـ <b>%s</b> عن طريق الرابط." % (esc(name or str(uid)), esc(o["name"])), [[btn("🏪 فتح " + o["name"], "a:libv:%d" % oid)]])


def lib_text(chat, uid, text, st, data):
    if st == "a:liba":
        with db() as c:
            oid = c.execute("INSERT INTO offices(name) VALUES(?)", (text.strip()[:60],)).lastrowid
        set_session(uid, "", {})
        send(chat, "✅ انضافت المكتبة.", reply_kb=main_kb(uid))
        t, kb = lib_view(oid); send(chat, t, kb); return True
    if st == "a:libm":
        ids = re.findall(r"\d{5,}", text.translate(AR_DIGITS))
        if not ids:
            send(chat, "⚠️ اكتب رقم الحساب (أرقام فقط)."); return True
        set_session(uid, "a:libm2", {"oid": data["oid"], "u": int(ids[0])})
        send(chat, "✍️ اكتب اسم صاحب الحساب (مثلاً: أبو أحمد):"); return True
    if st == "a:libm2":
        u, oid = data["u"], data["oid"]
        with db() as c:
            c.execute("INSERT OR REPLACE INTO office_users(user_id, office_id, name) VALUES(?,?,?)", (u, oid, text.strip()[:40]))
        set_session(uid, "", {})
        send(chat, "✅ انضاف الحساب للمكتبة.", reply_kb=main_kb(uid))
        send(u, "✅ تمت إضافتك لـ <b>%s</b> بالبوت.\nاضغط زر «%s» اللي جوة 👇" % (esc(office(oid)["name"]), BTN_OFFICE), reply_kb=main_kb(u))
        t, kb = lib_view(oid); send(chat, t, kb); return True
    if st == "a:libl":
        amt = parse_amount(text)
        if amt is None or amt < 0:
            send(chat, "⚠️ اكتب رقم صحيح، مثال: <code>20 مليون</code>"); return True
        with db() as c:
            c.execute("UPDATE offices SET lim=? WHERE id=?", (amt, data["oid"]))
        set_session(uid, "", {}); send(chat, "✅ انحفظ.", reply_kb=main_kb(uid))
        t, kb = lib_view(data["oid"]); send(chat, t, kb); return True
    if st == "a:libn":
        with db() as c:
            c.execute("UPDATE offices SET name=? WHERE id=?", (text.strip()[:60], data["oid"]))
        set_session(uid, "", {}); send(chat, "✅ تغير الاسم.", reply_kb=main_kb(uid))
        t, kb = lib_view(data["oid"]); send(chat, t, kb); return True
    return False



# ---------------------------------------------------------------- البحث السريع (اكتب أي شي وارسله)
def smart_search(q, limit=10):
    """يدور بكل المعلومات: الاسم، الهاتف، المحافظة، العنوان، المنهج، الصف، الامتحان، المركز"""
    q = q.translate(AR_DIGITS).strip()
    words = [w for w in re.split(r"\s+", q) if w]
    if not words:
        return []
    with db() as c:
        rows = [dict(r) for r in c.execute("""SELECT students.*, IFNULL(centers.name,'') cn, IFNULL(areas.name,'') an FROM students
                                              LEFT JOIN centers ON centers.id=students.center_id LEFT JOIN areas ON areas.id=centers.area_id""")]
    norm = lambda t: (t or "").replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي")
    out = []
    for r in rows:
        hay = norm(" ".join(str(r.get(k) or "") for k in ("name", "phone1", "phone2", "gov", "side", "area", "curr", "grade", "exam", "cn", "an")))
        if all(norm(w) in hay for w in words):
            out.append(r)
    out.sort(key=lambda r: (0 if norm(words[0]) in norm(r["name"]) else 1, r["name"]))
    return out[:limit], len(out)


def quick_search(chat, uid, text):
    res, total = smart_search(text)
    if not res:
        send(chat, "🔍 ما لگيت شي لـ «%s».\nاكتب جزء من الاسم، أو رقم الهاتف، أو المحافظة، أو اسم المركز…" % esc(text)); return
    office_user = not is_staff(uid)
    sell = "of:ps:%d" if office_user else "a:pss:%d"
    if office_user:          # صاحب المكتبة يشوف الاسم والرقم بس
        send(chat, "🔍 <b>%d نتيجة</b>%s — اضغط الطالب حتى تبيعله 👇" % (total, " (أول 10)" if total > 10 else ""),
             [[btn("🏪 %s — %s" % (r["name"], r["phone1"]), sell % r["user_id"])] for r in res])
        return
    lines = ["🔍 <b>%d نتيجة</b>%s لـ «%s»" % (total, " (أول 10)" if total > 10 else "", esc(text))]
    kb = []
    for i, r in enumerate(res, 1):
        place = r["gov"] + (" - " + r["side"] if r.get("side") else "")
        ex = (r.get("exam") or "") + ((" — %s (%s)" % (r["cn"], r["an"])) if r.get("cn") else "")
        lines.append("<b>%d) %s</b>\n📞 <code>%s</code> · <code>%s</code>\n🎓 %s · 📘 %s\n📍 %s — %s\n📝 %s" % (
            i, esc(r["name"]), r["phone1"], r["phone2"], esc(r["grade"]), esc(r["curr"]), esc(place), esc(r["area"]), esc(ex)))
        kb.append([btn("%d) ✏️ تعديل" % i, "a:sv:%d" % r["user_id"]), btn("🏪 بيع", sell % r["user_id"]), btn("🗑", "a:sx:%d" % r["user_id"])])
    t = "\n\n".join(lines)
    send(chat, t if len(t) < 4000 else t[:3950] + "\n…", kb)

# ---------------------------------------------------------------- لوحة التحكم الجديدة
def admin_menu_for(uid):
    kb = []
    if can(uid, "products"):
        kb += [[btn("📥 إضافة منتجات دفعة وحدة", "a:bulk")], [btn("➕ إضافة منتج واحد", "a:add")],
               [btn("📋 المنتجات والأقسام", "a:list")], [btn("🚚 أسعار التوصيل", "a:fees")],
               [btn("💻 فصول امتحانها إلكتروني فقط", "a:oo")]]
    if can(uid, "orders"):
        n = new_orders_count()
        kb += [[btn("🖨 الطلبات الجديدة (للطباعة)" + ("  🔴 %d" % n if n else ""), "a:pend")], [btn("🗂 الطلبات المطبوعة", "a:printed")],
               [btn("🏪 بيع بالمكتب", "a:pos")], [btn("📊 مبيعات المكتب", "a:of")]]
    if can(uid, "students"):
        kb += [[btn("🎓 الطلاب", "a:st")], [btn("🏫 المراكز الامتحانية", "a:ce")]]
    if can(uid, "q"):
        with db() as c:
            n = c.execute("SELECT COUNT(*) n FROM questions WHERE status='open'").fetchone()["n"]
        kb += [[btn("❓ الأسئلة اللي تنتظر جواب (%d)" % n, "a:oq")]]
    if uid in ADMIN_IDS:
        with db() as c:
            r_ = c.execute("SELECT COUNT(*) n, IFNULL(SUM(total),0) t FROM orders WHERE printed=3 AND office_id IS NOT NULL AND created LIKE ?",
                           (today_str() + "%",)).fetchone()
        kb += [[btn("🏬 المكتبات — اليوم: %d بيعة · %s" % (r_["n"], money(r_["t"])), "a:lib")], [btn("⏰ أوقات استقبال الأسئلة", "a:hr")], [btn("📚 الفصول والمواضيع", "a:cur")],
               [btn("👥 المساعدين والصلاحيات", "a:sf")], [btn("🔗 ربط مجموعة الأسئلة", "a:grp")]]
    return "<b>⚙️ لوحة التحكم</b>", kb


def admin_cat_v8(cid):
    c = cat(cid)
    if not c:
        return admin_cats()
    ps = products(cid)
    kb = [[btn("✏️ %s — %s" % (p["name"], money(p["price"])), "a:ep:%d" % p["id"]),
           btn(MODE_ICON.get(p.get("mode") or "both", "🔄").split()[0], "a:pm:%d" % p["id"]),
           btn("🗑", "a:del:%d" % p["id"])] for p in ps]
    kb.append([btn("⬅️ رجوع للأقسام", "a:list")])
    return ("<b>📂 %s</b>\n✏️ تعديل السعر   🗑 حذف\n🏫 حضوري / 💻 إلكتروني / 🔄 كليهما: اضغط الأيقونة حتى تغير نوع المنتج "
            "(طالب الحضوري يشوف 🏫 و 🔄، وطالب الإلكتروني يشوف 💻 و 🔄)") % esc(c["name"]), kb


def list_pdf(chat, title, headers, rows, fname):
    logo = ""
    if os.path.exists(LOGO):
        logo = '<img src="data:image/png;base64,%s">' % base64.b64encode(open(LOGO, "rb").read()).decode()
    th = "".join("<th>%s</th>" % esc(h) for h in headers)
    tr = "".join("<tr><td class=n>%d</td>%s</tr>" % (i, "".join("<td>%s</td>" % esc(x) for x in r)) for i, r in enumerate(rows, 1))
    htm = """<!doctype html><html lang=ar dir=rtl><head><meta charset=utf-8><style>@page{size:A4;margin:12mm}
body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#101929}
.h{display:flex;align-items:center;gap:12px;background:#101929;color:#F9C445;padding:8px 14px;border-radius:10px;border-bottom:4px solid #CEA239}
.h img{height:44px}.h b{font-size:18px}.h span{color:#cfd7e6;font-size:11px;display:block}
table{width:100%%;border-collapse:collapse;margin-top:10px;font-size:12px}th{background:#101929;color:#fff;padding:6px}
td{border:1px solid #d9dde5;padding:5px 7px}tr:nth-child(even) td{background:#f6f7fa}.n{text-align:center;width:28px}
</style></head><body><div class=h>%s<div><b>%s</b><span>العدد: %d — %s</span></div></div>
<table><tr><th>#</th>%s</tr>%s</table></body></html>""" % (logo, esc(title), len(rows), stamp(), th, tr)
    os.makedirs(PDF_DIR, exist_ok=True)
    base = os.path.join(PDF_DIR, "%s_%s" % (fname, time.strftime("%Y-%m-%d_%H-%M")))
    open(base + ".html", "w", encoding="utf-8").write(htm)
    if html_to_pdf(base + ".html", base + ".pdf"):
        api_upload("sendDocument", {"chat_id": chat, "caption": title}, "document", base + ".pdf", fname + ".pdf", "application/pdf")
    else:
        api_upload("sendDocument", {"chat_id": chat, "caption": title}, "document", base + ".html", fname + ".html", "text/html")


def students_stats():
    with db() as c:
        f = lambda q, *a: c.execute(q, a).fetchone()["n"]
        return {"all": f("SELECT COUNT(*) n FROM students"),
                "g6": f("SELECT COUNT(*) n FROM students WHERE grade=?", GRADES[0]),
                "g5": f("SELECT COUNT(*) n FROM students WHERE grade=?", GRADES[1]),
                "in": f("SELECT COUNT(*) n FROM students WHERE exam='حضوري'"),
                "on": f("SELECT COUNT(*) n FROM students WHERE exam='إلكتروني'"),
                "ar": f("SELECT COUNT(*) n FROM students WHERE curr='عربي'"),
                "en": f("SELECT COUNT(*) n FROM students WHERE curr='إنجليزي'")}


def student_card_kb(sid):
    return [[btn("🏫 تغيير المركز الامتحاني", "a:sc:%d" % sid)], [btn("🔄 تغيير نوع الامتحان", "a:se:%d" % sid)],
            [btn("🎓 تغيير صفه بالمدرسة", "a:sg:%d" % sid)], [btn("✏️ تعديل كل معلوماته (فورمة)", "a:sw:%d" % sid)],
            [btn("🗑 حذف تسجيله (يسجل من جديد)", "a:sx:%d" % sid)]]


def centers_overview():
    with db() as c:
        areas = [dict(r) for r in c.execute("SELECT * FROM areas WHERE active=1 ORDER BY gov, id")]
        lines, kb = ["<b>🏫 المراكز الامتحانية</b>", ""], []
        for a in areas:
            cs = [dict(r) for r in c.execute("""SELECT centers.*, (SELECT COUNT(*) FROM students WHERE center_id=centers.id) n
                                                FROM centers WHERE area_id=? AND active=1 ORDER BY id""", (a["id"],))]
            tot = sum(x["n"] for x in cs)
            lines.append("📍 <b>%s</b> (%s) — %d طالب" % (esc(a["name"]), esc(a["gov"]), tot))
            for x in cs:
                lines.append("    🏫 %s: <b>%d</b> طالب" % (esc(x["name"]), x["n"]))
            kb.append([btn("📍 %s (%s)" % (a["name"], a["gov"]), "a:ca:%d" % a["id"])])
    kb += [[btn("➕ منطقة جديدة", "a:na")], [btn("🗺 نوع الامتحان لكل محافظة", "a:gm")], [btn("⬅️ رجوع", "a:menu")]]
    return "\n".join(lines), kb


def area_view(aid):
    with db() as c:
        a = c.execute("SELECT * FROM areas WHERE id=?", (aid,)).fetchone()
        cs = [dict(r) for r in c.execute("""SELECT centers.*, (SELECT COUNT(*) FROM students WHERE center_id=centers.id) n
                                            FROM centers WHERE area_id=? AND active=1 ORDER BY id""", (aid,))]
    kb = [[btn("🏫 %s (%d طالب)" % (x["name"], x["n"]), "a:cc:%d" % x["id"]), btn("🗑", "a:cd:%d" % x["id"])] for x in cs]
    kb += [[btn("➕ مركز جديد بهاي المنطقة", "a:nc2:%d" % aid)], [btn("🗑 حذف المنطقة كلها", "a:cad:%d" % aid)],
           [btn("⬅️ رجوع للمراكز", "a:ce")]]
    return "<b>📍 %s</b> (%s)\nاضغط على المركز حتى تطلع قائمة طلابه PDF." % (esc(a["name"]), esc(a["gov"])), kb


def govmode_view():
    with db() as c:
        modes = {r["gov"]: r["mode"] for r in c.execute("SELECT * FROM govmode")}
    kb, row = [], []
    for i, g in enumerate(GOVS):
        row.append(btn("%s: %s" % (g, MODE_ICON[modes.get(g, "online")]), "a:gm:%d" % i))
        if len(row) == 2:
            kb.append(row); row = []
    if row:
        kb.append(row)
    kb.append([btn("⬅️ رجوع", "a:ce")])
    return ("<b>🗺 نوع الامتحان لكل محافظة</b>\nاضغط على المحافظة حتى تغيرها:\n"
            "🏫 حضوري بس — 💻 إلكتروني بس — 🔄 الطالب يختار"), kb


def hours_view():
    h = q_hours()
    kb, row = [], []
    for i in DAY_ORDER:
        row.append(btn(("☑️ " if i in h["days"] else "⬜️ ") + DAYS[i], "a:hrd:%d" % i))
        if len(row) == 3:
            kb.append(row); row = []
    if row:
        kb.append(row)
    kb += [[btn("🕓 تغيير الوقت", "a:hrt")],
           [btn("🔴 إيقاف الاستقبال مؤقتاً" if h.get("on", True) else "🟢 تشغيل الاستقبال", "a:hro")],
           [btn("⬅️ رجوع", "a:menu")]]
    state = "🟢 شغال" if h.get("on", True) else "🔴 متوقف"
    return "<b>⏰ أوقات استقبال الأسئلة</b> (%s)\n\n%s\n\nاضغط الأيام حتى تأشرها." % (state, hours_text(h)), kb


def curriculum_text():
    lines = []
    for ch in chapters():
        lines.append("# %s | %s" % (ch["ar"], ch["en"] or ""))
        for t in topics(ch["id"]):
            lines.append("%s | %s = %d" % (t["ar"], t["en"] or "", t["lectures"]))
    return "\n".join(lines)


def save_curriculum(text):
    chs, cur = [], None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            ar, _, en = line.lstrip("#").partition("|")
            cur = {"ar": ar.strip(), "en": en.strip(), "t": []}
            chs.append(cur)
            continue
        if cur is None:
            continue
        m = re.match(r"^(.+?)\s*=\s*([\d٠-٩]+)\s*$", line)
        name, n = (m.group(1), int(m.group(2).translate(AR_DIGITS))) if m else (line, 0)
        ar, _, en = name.partition("|")
        cur["t"].append({"ar": ar.strip(), "en": en.strip(), "n": n})
    if not chs:
        return 0, 0
    with db() as c:
        old_ch = [dict(r) for r in c.execute("SELECT * FROM chapters WHERE active=1 ORDER BY ord")]
        nt = 0
        for i, ch in enumerate(chs, 1):
            if i <= len(old_ch):
                chid = old_ch[i - 1]["id"]
                c.execute("UPDATE chapters SET ord=?, ar=?, en=? WHERE id=?", (i, ch["ar"], ch["en"], chid))
            else:
                chid = c.execute("INSERT INTO chapters(ord, ar, en) VALUES(?,?,?)", (i, ch["ar"], ch["en"])).lastrowid
            old_t = [dict(r) for r in c.execute("SELECT * FROM topics WHERE chapter_id=? AND active=1 ORDER BY ord", (chid,))]
            for j, t in enumerate(ch["t"], 1):
                nt += 1
                if j <= len(old_t):
                    c.execute("UPDATE topics SET ord=?, ar=?, en=?, lectures=? WHERE id=?", (j, t["ar"], t["en"], t["n"], old_t[j - 1]["id"]))
                else:
                    c.execute("INSERT INTO topics(chapter_id, ord, ar, en, lectures) VALUES(?,?,?,?,?)", (chid, j, t["ar"], t["en"], t["n"]))
            for t in old_t[len(ch["t"]):]:
                c.execute("UPDATE topics SET active=0 WHERE id=?", (t["id"],))
        for ch in old_ch[len(chs):]:
            c.execute("UPDATE chapters SET active=0 WHERE id=?", (ch["id"],))
    return len(chs), nt


def staff_view():
    with db() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM staff ORDER BY name")]
    kb = [[btn("👤 " + s["name"], "a:sfv:%d" % s["user_id"]), btn("🗑", "a:sfd:%d" % s["user_id"])] for s in rows]
    kb += [[btn("➕ إضافة مساعد", "a:sfa")], [btn("⬅️ رجوع", "a:menu")]]
    return "<b>👥 المساعدين</b>\nاضغط على المساعد حتى تحدد صلاحياته." if rows else "<b>👥 المساعدين</b>\nلا يوجد مساعدين بعد.", kb



def parse_amount(t):
    t = (t or "").translate(AR_DIGITS).replace(",", "").replace("٬", "").replace("،", "").replace(" ", "").lower()
    mult = 1
    for k, v in (("مليون", 1000000), ("الف", 1000), ("ألف", 1000)):
        if t.endswith(k):
            t, mult = t[:-len(k)], v
    try:
        return int(float(t) * mult)
    except Exception:
        return None


def staff_account(sid):
    """ذمة المساعد = مبيعاته بالمكتب − اللي سلمه إلك"""
    with db() as c:
        sold = c.execute("SELECT IFNULL(SUM(total),0) n FROM orders WHERE printed=3 AND seller=?", (sid,)).fetchone()["n"]
        paid = c.execute("SELECT IFNULL(SUM(amount),0) n FROM staff_pay WHERE staff_id=?", (sid,)).fetchone()["n"]
    limit = int(kv_get("limit_%d" % sid) or 0)
    owed = sold - paid
    return {"sold": sold, "paid": paid, "owed": owed, "limit": limit, "left": (limit - owed) if limit else None}


def staff_account_view(sid):
    a = staff_account(sid)
    with db() as c:
        pays = [dict(r) for r in c.execute("SELECT * FROM staff_pay WHERE staff_id=? ORDER BY id DESC LIMIT 8", (sid,))]
    s = staff_row(sid) or {"name": "مساعد"}
    lines = ["<b>💰 حساب %s</b>" % esc(s["name"]), "",
             "🎯 الرصيد المسموح: <b>%s</b>" % (money(a["limit"]) if a["limit"] else "بدون حد"),
             "🛒 كل مبيعاته بالمكتب: <b>%s</b>" % money(a["sold"]),
             "✅ سلّمك: <b>%s</b>" % money(a["paid"]),
             "🔴 <b>باقي بذمته (لازم يسلمك): %s</b>" % money(a["owed"])]
    if a["limit"]:
        lines.append("🟢 يگدر يبيع بعد بـ: <b>%s</b>" % money(max(a["left"], 0)))
    if pays:
        lines += ["", "<b>آخر الدفعات:</b>"] + ["• %s — %s" % (p["created"], money(p["amount"])) for p in pays]
    kb = [[btn("✅ سلّمني مبلغ (تسجيل دفعة)", "a:sfy:%d" % sid)], [btn("🎯 تحديد الرصيد المسموح", "a:sfl:%d" % sid)],
          [btn("⬅️ رجوع", "a:sfv:%d" % sid)]]
    return "\n".join(lines), kb

def staff_one(sid):
    s = staff_row(sid)
    if not s:
        return staff_view()
    ps = (s["perms"] or "").split(",")
    kb = [[btn(("☑️ " if k in ps else "⬜️ ") + v, "a:sfp:%d:%s" % (sid, k))] for k, v in PERMS.items()]
    kb.append([btn("💰 حساب المبيعات والرصيد", "a:sfm:%d" % sid)])
    kb.append([btn("⬅️ رجوع", "a:sf")])
    return "<b>👤 %s</b>\nاضغط حتى تنطيه الصلاحية أو تسحبها:" % esc(s["name"]), kb


def search_students(q):
    q = q.strip().translate(AR_DIGITS)
    with db() as c:
        return [dict(r) for r in c.execute("""SELECT * FROM students WHERE name LIKE ? OR phone1 LIKE ? OR phone2 LIKE ?
                                              ORDER BY name LIMIT 15""", ("%" + q + "%",) * 3)]


def admin_text_v8(chat, uid, text, st, data):
    if st.startswith("a:lib") and uid in ADMIN_IDS:
        return lib_text(chat, uid, text, st, data)
    if st in ("a:sfy", "a:sfl") and uid in ADMIN_IDS:
        amt = parse_amount(text)
        if amt is None or amt < 0:
            send(chat, "⚠️ اكتب رقم صحيح، مثال: <code>10000000</code> أو <code>10 مليون</code>"); return True
        sid = data.get("sid")
        set_session(uid, "", {})
        if st == "a:sfy":
            with db() as c:
                c.execute("INSERT INTO staff_pay(staff_id, amount, created) VALUES(?,?,?)", (sid, amt, stamp()))
            a = staff_account(sid)
            send(sid, "✅ قصي العميري سجّل استلام <b>%s</b> منك.\n🔴 باقي بذمتك: <b>%s</b>" % (money(amt), money(a["owed"])))
            send(chat, "✅ انسجلت الدفعة.", reply_kb=main_kb(uid))
        else:
            kv_set("limit_%d" % sid, str(amt))
            send(chat, "✅ انحفظ الرصيد المسموح.", reply_kb=main_kb(uid))
        t, kb = staff_account_view(sid); send(chat, t, kb)
        return True
    if st == "a:pos":
        res = search_students(text)
        if not res:
            send(chat, "ما لگيت طالب بهذا الاسم أو الرقم. اكتب مرة ثانية، أو الطالب لازم يسجل بالبوت أول."); return True
        send(chat, "اختار الطالب 👇", [[btn("👤 %s — %s" % (x["name"], x["phone1"]), "a:pss:%d" % x["user_id"])] for x in res])
        return True
    if st == "a:sts":
        set_session(uid, "", {})
        res = search_students(text)
        if not res:
            send(chat, "ما لگيت طالب بهذا الاسم أو الرقم."); return True
        send(chat, "نتائج البحث (%d):\n👤 اضغط الاسم حتى تشوف معلوماته وتعدلها\n🗑 اضغط السلة حتى تحذف تسجيله" % len(res),
             [[btn("👤 %s — %s" % (s["name"], s["phone1"]), "a:sv:%d" % s["user_id"]), btn("🗑", "a:sx:%d" % s["user_id"])] for s in res])
        return True
    if st == "a:na2":
        with db() as c:
            aid = c.execute("INSERT INTO areas(gov, name) VALUES(?,?)", (data["gov"], text.strip())).lastrowid
        set_session(uid, "a:nc3", {"aid": aid})
        send(chat, "✅ انضافت المنطقة. هسه اكتب اسم أول مركز امتحاني بيها:")
        return True
    if st == "a:nc3":
        with db() as c:
            c.execute("INSERT INTO centers(area_id, name) VALUES(?,?)", (data["aid"], text.strip()))
        set_session(uid, "", {})
        t, kb = area_view(data["aid"]); send(chat, "✅ انضاف المركز.\n\n" + t, kb)
        return True
    if st == "a:hrt":
        m = re.match(r"^\s*(\d{1,2})(?::(\d{2}))?\s*[-–—إلى ]+\s*(\d{1,2})(?::(\d{2}))?\s*$", text.translate(AR_DIGITS))
        if not m:
            send(chat, "⚠️ اكتب الوقت هيچ: <code>16-22</code> أو <code>16:30-22:00</code>"); return True
        h = q_hours()
        h["from"] = "%02d:%02d" % (int(m.group(1)), int(m.group(2) or 0))
        h["to"] = "%02d:%02d" % (int(m.group(3)), int(m.group(4) or 0))
        kv_set("q_hours", json.dumps(h))
        set_session(uid, "", {})
        t, kb = hours_view(); send(chat, "✅ تم.\n\n" + t, kb)
        return True
    if st == "a:cur":
        n1, n2 = save_curriculum(text)
        set_session(uid, "", {})
        send(chat, "✅ تم الحفظ: %d فصول و %d موضوع." % (n1, n2) if n1 else "⚠️ ما فهمت النص، تأكد من الشكل.")
        return True
    if st == "a:sfa":
        ids = re.findall(r"\d{5,}", text.translate(AR_DIGITS))
        if not ids:
            send(chat, "⚠️ اكتب رقم حساب المساعد (أرقام فقط)."); return True
        set_session(uid, "a:sfa2", {"sid": int(ids[0])})
        send(chat, "✍️ اكتب اسم المساعد:")
        return True
    if st == "a:sfa2":
        with db() as c:
            c.execute("INSERT OR REPLACE INTO staff(user_id, name, perms) VALUES(?,?,?)", (data["sid"], text.strip(), "q"))
        set_session(uid, "", {})
        t, kb = staff_one(data["sid"])
        send(chat, "✅ انضاف المساعد، وصلاحيته هسه الأسئلة العلمية بس.\nلازم تضيفه هم لمجموعة الأسئلة حتى يگدر يجاوب.\n\n" + t, kb)
        api("sendMessage", chat_id=data["sid"], text="✅ تمت إضافتك مساعد بالبوت. اكتب /start", )
        return True
    return False


def online_only_view():
    labels = []
    for p in products():
        l = chapter_label(p["name"])
        if l and l not in labels:
            labels.append(l)
    oo = online_only()
    kb = [[btn(("☑️ " if l in oo else "⬜️ ") + l, "a:oo:%d" % i)] for i, l in enumerate(labels)]
    kb.append([btn("⬅️ رجوع", "a:menu")])
    return ("<b>💻 فصول امتحانها إلكتروني فقط</b>\n\nأشّر ☑️ على الفصل اللي خلص امتحانه الحضوري.\n"
            "طالب الحضوري راح يشوف منتجات <b>الإلكتروني</b> لهذا الفصل بدل الحضوري، ويطلعله تنبيه: «امتحانات هذا الفصل إلكترونية فقط».\n"
            "(الفصل يتعرف من اسم المنتج، مثل «الفصل الأول»)"), kb, labels


def admin_cb_v8(chat, uid, mid, d):
    """يرجع (True, note) إذا عالج الزر"""
    if d == "a:oo" or d.startswith("a:oo:"):
        t, kb, labels = online_only_view()
        if d.startswith("a:oo:"):
            l = labels[int(d[5:])]
            oo = set(online_only()) ^ {l}
            kv_set("online_only", json.dumps(sorted(oo), ensure_ascii=False))
            t, kb, labels = online_only_view()
            edit(chat, mid, t, kb)
        else:
            send(chat, t, kb)
        return True, None
    if d.startswith("a:pm:"):
        pid = int(d[5:])
        p = product(pid)
        if p:
            with db() as c:
                c.execute("UPDATE products SET mode=? WHERE id=?", (MODE_NEXT[p.get("mode") or "both"], pid))
            t, kb = admin_cat_v8(p["cat_id"]); edit(chat, mid, t, kb)
        return True, None
    if d.startswith("a:lc:"):
        t, kb = admin_cat_v8(int(d[5:])); edit(chat, mid, t, kb)
        return True, None
    if d == "a:st":
        s = students_stats()
        t = ("<b>🎓 الطلاب المسجلين: %d</b>\n\nالسادس العلمي: %d\nالخامس العلمي: %d\n\nحضوري: %d\nإلكتروني: %d\n\nالمنهج العربي: %d\nالمنهج الإنجليزي: %d"
             % (s["all"], s["g6"], s["g5"], s["in"], s["on"], s["ar"], s["en"]))
        send(chat, t, [[btn("🔍 بحث عن طالب (بالاسم أو الرقم)", "a:sts")], [btn("📄 قائمة طلاب الخامس العلمي PDF", "a:5th")],
                       [btn("📄 قائمة كل الطلاب PDF", "a:stall")], [btn("⬅️ رجوع", "a:menu")]])
        return True, None
    if d == "a:sts":
        set_session(uid, "a:sts", {})
        send(chat, "🔍 اكتب اسم الطالب (أو جزء منه) أو رقم هاتفه:")
        return True, None
    if d in ("a:5th", "a:stall"):
        with db() as c:
            if d == "a:5th":
                rows = c.execute("SELECT * FROM students WHERE grade=? ORDER BY name", (GRADES[1],)).fetchall()
            else:
                rows = c.execute("SELECT * FROM students ORDER BY grade, name").fetchall()
        title = "طلاب الخامس العلمي" if d == "a:5th" else "كل الطلاب المسجلين"
        list_pdf(chat, title, ["الاسم", "الصف", "المنهج", "المحافظة", "الهاتف 1", "الهاتف 2", "الامتحان"],
                 [[r["name"], r["grade"], r["curr"], r["gov"] + (" - " + r["side"] if r["side"] else ""), r["phone1"], r["phone2"],
                   (r["exam"] or "") + ((" - " + center_name(r["center_id"])) if r["center_id"] else "")] for r in rows],
                 "students_5th" if d == "a:5th" else "students_all")
        return True, None
    if d.startswith("a:sv:"):
        s = student(int(d[5:]))
        if s:
            send(chat, "<b>🎓 بطاقة الطالب</b>\n\n" + profile_text(s) + "\nمسجل من: %s" % s["created"], student_card_kb(s["user_id"]))
        return True, None
    if d.startswith("a:lib"):
        return lib_cb(chat, uid, mid, d)
    if d == "a:pos":
        set_session(uid, "a:pos", {})
        send(chat, "🏪 <b>بيع بالمكتب</b>\n🔍 اكتب اسم الطالب (أو جزء منه) أو رقم هاتفه:", reply_kb=flow_kb())
        return True, None
    if d.startswith("a:pss:"):
        sid = int(d[6:])
        s = student(sid)
        if s:
            set_session(uid, "a:posw", {"sid": sid})
            send(chat, "👤 <b>%s</b>\n👇 اضغط «🏪 افتح صفحة البيع» واختار المنتجات، وبعدين «✅ تم البيع»." % esc(s["name"]), reply_kb=pos_kb(sid))
        return True, None
    if d == "a:of" or d.startswith("a:of:"):
        day = d[5:] if d.startswith("a:of:") else time.strftime("%Y-%m-%d", now_iq())
        if d.startswith("a:of:") and mid:
            edit(chat, mid, office_view(day), office_kb(day))
        else:
            send(chat, office_view(day), office_kb(day))
        return True, None
    if d == "a:ofd":
        t, kb = office_days(); send(chat, t, kb)
        return True, None
    if d.startswith("a:ofrc:"):
        send_color_receipt(chat, int(d[7:]))
        return True, "⏳"
    if d.startswith("a:ofr:"):
        send_paper_receipt(chat, int(d[6:]))
        return True, "⏳"
    if d.startswith("a:ofp:"):
        day = d[6:]
        with db() as c:
            rows = [dict(r) for r in c.execute("SELECT * FROM orders WHERE printed=3 AND created LIKE ? ORDER BY id", (day + "%",))]
        if not rows:
            return True, "ما أكو مبيعات بهذا اليوم"
        data = []
        for r in rows:
            its = "، ".join("%s ×%d" % (i["name"], i["qty"]) for i in json.loads(r["items"]))
            data.append(["#%d" % r["id"], r["created"][11:], r["name"], its, "{:,}".format(r["total"]), staff_name(r.get("seller"))])
        list_pdf(chat, "مبيعات المكتب — %s — المجموع %s" % (day, money(sum(r["total"] for r in rows))), ["رقم", "الوقت", "الطالب", "المنتجات", "المبلغ", "البائع"], data, "office_" + day)
        return True, None
    if d.startswith("a:sw:"):
        sid = int(d[5:])
        s = student(sid)
        if s:
            set_session(uid, "a:sw", {})
            send(chat, "✏️ تعديل معلومات <b>%s</b>\n👇 اضغط «✏️ افتح فورمة الطالب»، عدّل اللي تريده، واضغط حفظ." % esc(s["name"]),
                 reply_kb=reg_kb(uid, True, sid))
        return True, None
    if d.startswith("a:sg:"):
        sid = int(d[5:])
        s = student(sid)
        if s:
            new = GRADES[1] if s["grade"] == GRADES[0] else GRADES[0]
            with db() as c:
                c.execute("UPDATE students SET grade=? WHERE user_id=?", (new, sid))
            send(chat, "✅ صار صفه بالمدرسة: <b>%s</b>" % new)
        return True, None
    if d.startswith("a:sxy:"):
        sid = int(d[6:])
        s = student(sid)
        with db() as c:
            c.execute("DELETE FROM students WHERE user_id=?", (sid,))
        set_session(sid, "", {})
        edit(chat, mid, "🗑 تم حذف تسجيل <b>%s</b>.\nلمن يفتح البوت ويضغط /start يسجل من جديد.\n(طلباته وأسئلته القديمة باقية)" % esc(s["name"] if s else sid))
        return True, None
    if d.startswith("a:sx:"):
        sid = int(d[5:])
        s = student(sid)
        if s:
            send(chat, "⚠️ متأكد تريد تحذف تسجيل <b>%s</b>؟\nراح يسجل من جديد ويختار كل شي من البداية (الصف ونوع الامتحان والمركز)." % esc(s["name"]),
                 [[btn("🗑 نعم، احذف", "a:sxy:%d" % sid)], [btn("↩️ لا", "a:sv:%d" % sid)]])
        return True, None
    if d.startswith("a:se:"):
        sid = int(d[5:])
        s = student(sid)
        if s:
            new = "إلكتروني" if s["exam"] == "حضوري" else "حضوري"
            with db() as c:
                c.execute("UPDATE students SET exam=?, center_id=CASE WHEN ?='إلكتروني' THEN NULL ELSE center_id END WHERE user_id=?",
                          (new, new, sid))
            if new == "حضوري":
                send(chat, "تم تغييره إلى حضوري. هسه اختار مركزه 👇")
                return admin_cb_v8(chat, uid, mid, "a:sc:%d" % sid)
            send(chat, "✅ صار نوع امتحانه: إلكتروني.")
        return True, None
    if d.startswith("a:sc:"):
        sid = int(d[5:])
        with db() as c:
            rows = c.execute("""SELECT centers.id, centers.name cn, areas.name an FROM centers JOIN areas ON areas.id=centers.area_id
                                WHERE centers.active=1 AND areas.active=1 ORDER BY areas.gov, areas.id, centers.id""").fetchall()
        send(chat, "اختر المركز الجديد للطالب:", [[btn("🏫 %s (%s)" % (r["cn"], r["an"]), "a:scs:%d:%d" % (sid, r["id"]))] for r in rows])
        return True, None
    if d.startswith("a:scs:"):
        _, _, sid, cid = d.split(":")
        with db() as c:
            c.execute("UPDATE students SET center_id=?, exam='حضوري' WHERE user_id=?", (int(cid), int(sid)))
        edit(chat, mid, "✅ تم تغيير المركز إلى: %s" % esc(center_name(int(cid))))
        api("sendMessage", chat_id=int(sid), parse_mode="HTML",
            text="ℹ️ تم تغيير مركزك الامتحاني إلى: <b>%s</b>" % esc(center_name(int(cid))))
        return True, None
    if d == "a:ce":
        t, kb = centers_overview(); send(chat, t, kb)
        return True, None
    if d.startswith("a:ca:"):
        t, kb = area_view(int(d[5:])); edit(chat, mid, t, kb)
        return True, None
    if d.startswith("a:cad:"):
        aid = int(d[6:])
        with db() as c:
            c.execute("UPDATE areas SET active=0 WHERE id=?", (aid,))
            c.execute("UPDATE centers SET active=0 WHERE area_id=?", (aid,))
        t, kb = centers_overview(); edit(chat, mid, "🗑 انحذفت المنطقة.\n\n" + t, kb)
        return True, None
    if d.startswith("a:cd:"):
        cid = int(d[5:])
        with db() as c:
            aid = c.execute("SELECT area_id FROM centers WHERE id=?", (cid,)).fetchone()["area_id"]
            c.execute("UPDATE centers SET active=0 WHERE id=?", (cid,))
        t, kb = area_view(aid); edit(chat, mid, "🗑 انحذف المركز (طلابه يبقون مسجلين عليه، غيّرهم من 🎓 الطلاب).\n\n" + t, kb)
        return True, None
    if d.startswith("a:cc:"):
        cid = int(d[5:])
        with db() as c:
            rows = c.execute("SELECT * FROM students WHERE center_id=? ORDER BY name", (cid,)).fetchall()
        list_pdf(chat, "طلاب مركز " + center_name(cid), ["الاسم", "الصف", "المنهج", "الهاتف 1", "الهاتف 2"],
                 [[r["name"], r["grade"], r["curr"], r["phone1"], r["phone2"]] for r in rows], "center_%d" % cid)
        return True, None
    if d == "a:na":
        kb, row = [], []
        for i, g in enumerate(GOVS):
            row.append(btn(g, "a:nag:%d" % i))
            if len(row) == 3:
                kb.append(row); row = []
        if row:
            kb.append(row)
        edit(chat, mid, "اختر محافظة المنطقة الجديدة:", kb)
        return True, None
    if d.startswith("a:nag:"):
        set_session(uid, "a:na2", {"gov": GOVS[int(d[6:])]})
        send(chat, "✍️ اكتب اسم المنطقة (مثل: المنصور):")
        return True, None
    if d.startswith("a:nc2:"):
        set_session(uid, "a:nc3", {"aid": int(d[6:])})
        send(chat, "✍️ اكتب اسم المركز الامتحاني:")
        return True, None
    if d == "a:gm":
        t, kb = govmode_view(); edit(chat, mid, t, kb)
        return True, None
    if d.startswith("a:gm:"):
        g = GOVS[int(d[5:])]
        with db() as c:
            c.execute("UPDATE govmode SET mode=? WHERE gov=?", ({"both": "in", "in": "online", "online": "both"}[gov_mode(g)], g))
        t, kb = govmode_view(); edit(chat, mid, t, kb)
        return True, None
    if d == "a:oq":
        with db() as c:
            qs = [dict(r) for r in c.execute("SELECT * FROM questions WHERE status='open' ORDER BY id LIMIT 30")]
        g = group_id()
        if not qs:
            send(chat, "✅ ماكو أسئلة تنتظر جواب."); return True, None
        base = "https://t.me/c/%s/" % str(g)[4:] if g and str(g).startswith("-100") else None
        lines = ["<b>❓ الأسئلة اللي تنتظر جواب: %d</b>" % len(qs), ""]
        for q in qs:
            s = student(q["user_id"]) or {"name": "—"}
            link = ('<a href="%s%d">افتح</a>' % (base, q["thread_id"])) if base and q["thread_id"] else ""
            lines.append("#%d — %s\n%s  %s" % (q["id"], esc(s["name"]), esc(q_where(q)), link))
        send(chat, "\n\n".join(lines))
        return True, None
    if d == "a:hr":
        t, kb = hours_view(); send(chat, t, kb)
        return True, None
    if d.startswith("a:hrd:"):
        i = int(d[6:])
        h = q_hours()
        h["days"] = sorted(set(h["days"]) ^ {i})
        kv_set("q_hours", json.dumps(h))
        t, kb = hours_view(); edit(chat, mid, t, kb)
        return True, None
    if d == "a:hro":
        h = q_hours()
        h["on"] = not h.get("on", True)
        kv_set("q_hours", json.dumps(h))
        t, kb = hours_view(); edit(chat, mid, t, kb)
        return True, None
    if d == "a:hrt":
        set_session(uid, "a:hrt", {})
        send(chat, "🕓 اكتب الوقت بنظام 24 ساعة، مثلاً:\n<code>16-22</code>  يعني من 4 العصر إلى 10 بالليل\n<code>9:30-23:00</code>")
        return True, None
    if d == "a:cur":
        set_session(uid, "a:cur", {})
        send(chat, "<b>📚 الفصول والمواضيع</b>\n\nهذا الموجود هسه. حتى تعدّل: انسخه، وعدّل عليه (أسماء، عدد محاضرات، ترتيب)، وأرسله برسالة وحدة.\n"
                   "• السطر اللي يبدي بـ # هو الفصل: الاسم العربي | الاسم الإنجليزي\n"
                   "• تحته المواضيع: العربي | الإنجليزي = عدد المحاضرات")
        send(chat, "<code>%s</code>" % esc(curriculum_text()))
        return True, None
    if d == "a:sf":
        t, kb = staff_view(); send(chat, t, kb)
        return True, None
    if d.startswith("a:sfm:"):
        t, kb = staff_account_view(int(d[6:])); send(chat, t, kb)
        return True, None
    if d.startswith("a:sfy:"):
        set_session(uid, "a:sfy", {"sid": int(d[6:])})
        send(chat, "✅ اكتب المبلغ اللي سلمك إياه (أرقام بس)\nمثال: <code>10000000</code> أو <code>10 مليون</code>", reply_kb=flow_kb())
        return True, None
    if d.startswith("a:sfl:"):
        set_session(uid, "a:sfl", {"sid": int(d[6:])})
        send(chat, "🎯 اكتب الرصيد المسموح إله (أكثر مبلغ يگدر يبيع بيه قبل ما يسلمك)\nمثال: <code>20000000</code> أو <code>20 مليون</code>\nاكتب <code>0</code> إذا تريد بدون حد.",
             reply_kb=flow_kb())
        return True, None
    if d.startswith("a:sfv:"):
        t, kb = staff_one(int(d[6:])); edit(chat, mid, t, kb)
        return True, None
    if d.startswith("a:sfp:"):
        _, _, sid, k = d.split(":")
        s = staff_row(int(sid))
        if s:
            ps = set(filter(None, (s["perms"] or "").split(","))) ^ {k}
            with db() as c:
                c.execute("UPDATE staff SET perms=? WHERE user_id=?", (",".join(sorted(ps)), int(sid)))
        t, kb = staff_one(int(sid)); edit(chat, mid, t, kb)
        return True, None
    if d.startswith("a:sfd:"):
        with db() as c:
            c.execute("DELETE FROM staff WHERE user_id=?", (int(d[6:]),))
        t, kb = staff_view(); edit(chat, mid, t, kb)
        return True, None
    if d == "a:sfa":
        set_session(uid, "a:sfa", {})
        send(chat, "➕ <b>إضافة مساعد</b>\n\n1) خلي المساعد يفتح البوت ويكتب <code>/myid</code>\n2) البوت ينطيه رقم حسابه، يرسلك ياه\n3) اكتب الرقم هنا 👇")
        return True, None
    if d == "a:grp":
        g = group_id()
        send(chat, ("✅ مجموعة الأسئلة مربوطة.\n\n" if g else "⚠️ مجموعة الأسئلة مو مربوطة بعد.\n\n") +
             "<b>طريقة الربط:</b>\n1) سوّي مجموعة تليجرام جديدة (مثلاً: أسئلة الطلاب).\n"
             "2) من إعدادات المجموعة فعّل <b>Topics</b> (المواضيع).\n3) ضيف البوت للمجموعة وخليه <b>Admin</b> ويه صلاحية <b>Manage Topics</b>.\n"
             "4) داخل المجموعة اكتب: <code>/setgroup</code>")
        return True, None
    return False, None


# ---------------------------------------------------------------- توزيع التحديثات
WELCOME = ("أهلا بك في <b>QMath</b> 🌷\n\n"
           "🛒 <b>المتجر</b>: محاضرات، امتحانات، ملازم\n"
           "❓ <b>سؤال علمي</b>: اسأل قصي العميري عن أي محاضرة\n"
           "📂 <b>أسئلتي</b>: أسئلتك وأجوبتها\n"
           "👤 <b>معلوماتي</b>: معلوماتك المسجلة")
MENU_TEXTS = None


def handle(u):
    if "message" in u:
        m = u["message"]
        chat, uid = m["chat"]["id"], m.get("from", {}).get("id")
        if m["chat"].get("type") in ("group", "supergroup"):
            on_group_message(m)
            return
        if m["chat"].get("type") != "private" or not uid:
            return
        if m.get("web_app_data"):
            raw = m["web_app_data"].get("data", "")
            try:
                o = json.loads(raw)
            except Exception:
                o = {}
            if isinstance(o, dict) and o.get("k") == "reg":
                on_reg_form(chat, uid, o, m["from"])
            elif isinstance(o, dict) and o.get("k") == "pos":
                on_pos_sale(chat, uid, o)
            else:
                on_store_order(chat, uid, raw, m["from"])
            return
        text = (m.get("text") or "").strip()
        st, data = get_session(uid)
        if text == "/start":
            set_session(uid, "", {"cart": data.get("cart", {})})
            send_banner(chat, WELCOME, main_kb(uid))
            if not student(uid):
                start_reg(chat, uid, None)
            return
        if text.lower().split("@")[0].strip("/ ").replace(" ", "") in ("myid", "id", "رقمي", "ايدي", "آيدي"):
            send(chat, "رقم حسابك: <code>%d</code>" % uid); return
        if text.startswith("/start lib_"):
            join_office_by_code(chat, uid, text.split("lib_", 1)[1].strip(), m.get("from", {})); return
        _c = text.translate(AR_DIGITS).replace(" ", "")
        if re.fullmatch(r"\d{6}", _c) and kv_get("libinv_" + _c):
            join_office_by_code(chat, uid, _c, m.get("from", {})); return
        if text == BTN_SHOP:
            set_session(uid, "", {"cart": data.get("cart", {})}) if not st.startswith("a:") else None
            open_shop(chat, uid); return
        if text == BTN_ASK:
            set_session(uid, "", {})
            ask_start(chat, uid); return
        if text == BTN_MYQ:
            my_questions(chat, uid); return
        if text == BTN_ME:
            show_me(chat, uid); return
        if text == BTN_OFFICE and my_office(uid):
            set_session(uid, "", {}); office_menu(chat, uid); return
        if st == "o:pos" and text and text not in (BTN_CANCEL, "/cancel", "❌ إلغاء الطلب") and my_office(uid):
            res = search_students(text)
            if not res:
                send(chat, "ما لگيت طالب بهذا الاسم أو الرقم. اكتب مرة ثانية، أو الطالب لازم يسجل بالبوت أول."); return
            send(chat, "اختار الطالب 👇", [[btn("👤 %s — %s" % (x["name"], x["phone1"]), "of:ps:%d" % x["user_id"])] for x in res]); return
        if text in ("/cancel", BTN_CANCEL, "❌ إلغاء الطلب"):
            set_session(uid, "", {})
            send(chat, "❌ تم الإلغاء.", reply_kb=main_kb(uid))
            return
        if is_staff(uid):
            if text == "/admin" or text.startswith(BTN_ADMIN):
                set_session(uid, "", {})
                t, kb = admin_menu_for(uid); send(chat, t, kb); return
            if st.startswith("a:") and text and on_admin_text(chat, uid, text, st, data):
                return
        if st == "q:write" or (st == "q:sent" and m.get("media_group_id") and data.get("mg") == m.get("media_group_id")):
            q_new_message(chat, uid, m, data if st == "q:write" else dict(data, t=None)); return
        if st == "q:follow":
            q_follow_message(chat, uid, m, data); return
        if st == "r:form":
            send(chat, "👇 اضغط زر «%s» اللي جوة حتى تملأ معلوماتك." % BTN_REG, reply_kb=reg_kb(uid, data.get("edit"))); return
        if st.startswith("r:"):
            if not text:
                send(chat, "⚠️ اكتب نص فقط."); return
            reg_text(chat, uid, text, st, data); return
        if not text:
            send(chat, "⚠️ اكتب نص فقط.")
            return
        if st in ("", "cart") and not text.startswith("/") and (is_staff(uid) or my_office(uid)):
            quick_search(chat, uid, text); return
        on_student_text(chat, uid, text, st, data)
    elif "callback_query" in u:
        q = u["callback_query"]
        uid = q["from"]["id"]
        m = q.get("message") or {}
        chat, mid = m.get("chat", {}).get("id", uid), m.get("message_id")
        d = q.get("data", "")
        note = None
        st, data = get_session(uid)
        if d.startswith("a:"):
            if allowed(uid, d):
                done, note = admin_cb_v8(chat, uid, mid, d)
                if not done:
                    note = on_admin_cb(chat, uid, mid, d)
            else:
                note = "ما عندك صلاحية"
        elif d[:3] in ("rc:", "rg:", "rv:", "rd:", "rx:", "ra:", "rb:", "rn:", "rs:"):
            note = reg_cb(chat, uid, mid, d, st, data, q["from"])
        elif d.startswith("of:"):
            note = office_cb(chat, uid, mid, d)
        elif d.startswith("qh:"):
            if can(uid, "q"):
                qq = question(int(d[3:]))
                if qq:
                    hide_topic(qq)
                note = "✅ اختفى السؤال"
            else:
                note = "ما عندك صلاحية"
        elif d.startswith(("qc:", "qb:", "qt:", "ql:", "qf:", "qok:")):
            note = q_cb(chat, uid, mid, d, st, data, q["from"])
        elif d.startswith(("oc:", "ocy:", "ocn:")):
            note = order_cancel_cb(chat, uid, mid, d)
        elif d == "me:edit":
            note = "لتغيير معلوماتك تواصل ويا قصي العميري"
            if not student(uid):
                start_reg(chat, uid, None)
        else:
            note = on_student_cb(chat, uid, mid, d, st, data, q["from"])
        api("answerCallbackQuery", callback_query_id=q["id"], **({"text": note} if note else {}))


def main():
    if not re.match(r"^\d+:", TOKEN) or not ADMIN_IDS:
        print("Put TOKEN and ADMIN in settings.txt first.")
        input("Press Enter to close...")
        return
    init_db()
    init_db_v8()
    me = api("getMe")
    if me:
        kv_set("bot_username", me["username"])
    print("Bot is running:", me and ("@" + me["username"]))
    print("Do not close this window.")
    offset = 0
    while True:
        try:
            ups = api("getUpdates", offset=offset, timeout=50, allowed_updates=["message", "callback_query"]) or []
            for u in ups:
                offset = u["update_id"] + 1
                try:
                    handle(u)
                except Exception:
                    traceback.print_exc()
        except Exception as e:
            print("Connection problem, retrying...", e)
            time.sleep(5)


if __name__ == "__main__":
    main()
