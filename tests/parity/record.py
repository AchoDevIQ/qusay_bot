# -*- coding: utf-8 -*-
"""يشغل البوت القديم (bot.py من تاريخ git) على السيناريوهات ويحفظ كل اللي سواه بـ golden/.
نسخة TypeScript تنقارن بهذي التسجيلات بـ tests/parity.test.ts، فـ npm test ما يحتاج بايثون.
التشغيل (من جذر المشروع):  python tests/parity/record.py
"""
import base64, glob, hashlib, importlib.util, io, json, os, re, shutil, subprocess, sys, tarfile, tempfile, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PY_COMMIT = "49f7f07"           # آخر commit بيه bot.py
BOT_FILES = ["bot.py", "logo.png", "boahmed.ttf", "banner.jpg", "success.jpg"]


def extract_bot(dest):
    raw = subprocess.run(["git", "archive", PY_COMMIT, "bot"], cwd=ROOT, capture_output=True, check=True).stdout
    with tarfile.open(fileobj=io.BytesIO(raw)) as t:
        for f in BOT_FILES:
            data = t.extractfile("bot/" + f).read()
            open(os.path.join(dest, f), "wb").write(data)


def b64sum(html):
    """الصور والخطوط المضمنة بالـ HTML تتبدل ببصمة، حتى التسجيل يبقى صغير"""
    return re.sub(r"base64,[A-Za-z0-9+/=]{100,}", lambda m: "base64:" + hashlib.md5(m.group(0).encode()).hexdigest(), html)


def expand(steps, prelude):
    out = []
    for s in steps:
        if s[0] == "u":
            out += expand(prelude[s[1]], prelude)
        else:
            out.append(s)
    return out


def subst(v, vars_):
    if isinstance(v, str):
        return re.sub(r"\$\{(\w+)\}", lambda m: vars_[m.group(1)], v)
    if isinstance(v, list):
        return [subst(x, vars_) for x in v]
    if isinstance(v, dict):
        return {k: subst(x, vars_) for k, x in v.items()}
    return v


def run_scenario(sc, prelude):
    tmp = tempfile.mkdtemp(prefix="qmath_py_")
    extract_bot(tmp)
    store = "" if sc.get("noStore") else "STORE =https://x.test\n"
    open(os.path.join(tmp, "settings.txt"), "w", encoding="utf-8").write("TOKEN =1:test\nADMIN =1\n" + store)
    spec = importlib.util.spec_from_file_location("bot_" + uuid_of(sc), os.path.join(tmp, "bot.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    trace, fail, next_id = [], [], [100]

    def result(method):
        if method in fail:
            return None
        if method == "createForumTopic":
            next_id[0] += 1
            return {"message_thread_id": next_id[0]}
        if method in ("sendMessage", "copyMessage", "sendDocument"):
            next_id[0] += 1
            return {"message_id": next_id[0]}
        if method == "sendPhoto":
            next_id[0] += 1
            return {"message_id": next_id[0], "photo": [{"file_id": "F%d" % next_id[0]}]}
        return True

    def api(method, **p):
        trace.append({"m": method, "p": json.loads(json.dumps(p))})
        return result(method)

    def api_upload(method, fields, file_field, path, fname="banner.jpg", ctype="image/jpeg"):
        p = {k: str(v) for k, v in fields.items()}
        if "reply_markup" in p:
            p["reply_markup"] = json.loads(p["reply_markup"])
        e = {"m": method, "p": p, "up": True}
        if method == "sendDocument":
            e["file"] = fname
        trace.append(e)
        return result(method)

    m.api, m.api_upload = api, api_upload
    m.find_browser = lambda: None       # بدون متصفح: البوت يرجع للنص أو HTML
    m.PDF_DIR = os.path.join(tmp, "pdf")
    m.init_db()
    m.init_db_v8()
    m.kv_set("bot_username", "test_bot")

    vars_, msg_id = {}, [5000]

    def user(uid):
        return {"id": uid, "username": "u%d" % uid, "first_name": "اسم"}

    def do_update(u):
        try:
            m.handle(u)
        except Exception:
            traceback.print_exc()
            trace.append({"m": "CRASH"})

    for s in expand(sc["steps"], prelude):
        s = subst(s, vars_)
        k = s[0]
        if k in ("m", "w", "g"):
            msg_id[0] += 1
            extra = s[3] if len(s) > 3 else {}
            chat = {"id": -1001234, "type": "supergroup"} if k == "g" else {"id": s[1], "type": "private"}
            msg = {"message_id": msg_id[0], "chat": chat, "from": user(s[1])}
            if k == "w":
                msg["web_app_data"] = {"data": s[2] if isinstance(s[2], str) else json.dumps(s[2], ensure_ascii=False)}
            elif s[2] is not None:
                msg["text"] = s[2]
            msg.update(extra)
            do_update({"message": msg})
        elif k == "c":
            do_update({"callback_query": {"id": "c", "from": user(s[1]), "message": {"chat": {"id": s[1]}, "message_id": 50}, "data": s[2]}})
        elif k == "s":
            with m.db() as c:
                c.execute(s[1])
        elif k == "f":
            fail[:] = s[1]
        elif k == "cap":
            for e in reversed(trace):
                f = re.search(s[1], json.dumps(e, ensure_ascii=False))
                if f:
                    vars_[s[2]] = f.group(1)
                    break
            else:
                raise SystemExit("cap: %s not found in %s" % (s[1], sc["name"]))
        else:
            raise SystemExit("bad step %r" % (s,))

    with m.db() as c:
        tables = [r["name"] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        db = {t: [dict(r) for r in c.execute("SELECT * FROM %s ORDER BY rowid" % t)] for t in tables}
    files = {}
    if os.path.isdir(m.PDF_DIR):
        for n in sorted(os.listdir(m.PDF_DIR)):
            files[n] = b64sum(open(os.path.join(m.PDF_DIR, n), encoding="utf-8").read())
    shutil.rmtree(tmp, ignore_errors=True)
    return {"trace": trace, "db": db, "files": files}


def uuid_of(sc):
    return hashlib.md5(sc["name"].encode()).hexdigest()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    prelude = json.load(open(os.path.join(HERE, "prelude.json"), encoding="utf-8"))
    os.makedirs(os.path.join(HERE, "golden"), exist_ok=True)
    only = sys.argv[1:]
    for path in sorted(glob.glob(os.path.join(HERE, "phase*.json"))):
        name = os.path.basename(path)
        if only and name not in only:
            continue
        out = {}
        for sc in json.load(open(path, encoding="utf-8")):
            out[sc["name"]] = run_scenario(sc, prelude)
        json.dump(out, open(os.path.join(HERE, "golden", name), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        print("recorded", name, len(out))


if __name__ == "__main__":
    main()
