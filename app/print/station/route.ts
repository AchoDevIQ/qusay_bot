// محطة طباعة الليبل: تبقى مفتوحة بمتصفح Bluefy ومتصلة بطابعة البلوتوث، وكل ليبل يوصلها من صفحة الحضوري تطبعه
export const dynamic = "force-static";

const HTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>محطة الطباعة</title>
<style>body{margin:0;padding:16px;background:#0f1a2e;color:#fff;font-family:Tahoma,Arial,sans-serif;font-size:18px;line-height:1.6}
button{display:block;width:100%;margin:12px 0;padding:18px;border:0;border-radius:12px;background:#f7c548;color:#0f1a2e;font-size:19px;font-weight:700}
#s{padding:14px;border-radius:12px;background:#26303f;font-weight:700}pre{white-space:pre-wrap;word-break:break-all;direction:ltr;text-align:left;background:#000;padding:10px;border-radius:8px;font-size:13px}</style></head>
<body><h2>🖨 محطة طباعة الليبل</h2>
<div id="s">ماكو اتصال بالطابعة</div>
<button id="c">🔌 اتصل بالطابعة</button>
<div>خلي هاي الصفحة مفتوحة. أي ليبل يوصلها ينطبع وحده.</div>
<h3 id="n"></h3>
<pre id="o"></pre>
<script>
const SERVICES = ["000018f0-0000-1000-8000-00805f9b34fb", "e7810a71-73ae-499d-8c15-faa9aef0c3f2"];
const station = new URLSearchParams(location.search).get("k") || "";
const statusEl = document.getElementById("s"), countEl = document.getElementById("n"), out = document.getElementById("o");
const log = (t) => { out.textContent = t + "\\n" + out.textContent.slice(0, 1500); };
const say = (t) => { statusEl.textContent = t; };
const why = (e) => (e && e.message) || String(e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let dev = null, ch = null, busy = false, done = 0, chunk = 180;

async function attach() {
  const gatt = await dev.gatt.connect();
  const s = await gatt.getPrimaryService(SERVICES[0]);
  ch = (await s.getCharacteristics()).find((c) => c.properties.write) || null;
  if (!ch) throw new Error("no writable characteristic");
  say("✅ متصلة، تنتظر الليبلات");
}
async function connect() {
  if (!navigator.bluetooth) { say("⚠️ افتح هاي الصفحة بمتصفح Bluefy"); return; }
  try {
    dev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "Thermal" }], optionalServices: SERVICES });
    dev.addEventListener("gattserverdisconnected", () => { ch = null; say("⚠️ انقطع الاتصال، دا أرجع أتصل..."); });
    await attach();
  } catch (e) { say("⚠️ ما انربطت: " + why(e)); log(why(e)); }
}
const writeOne = (part) => ch.writeValueWithResponse ? ch.writeValueWithResponse(part) : ch.writeValue(part);
async function write(bytes) {
  for (let i = 0; i < bytes.length;) {
    const part = bytes.slice(i, i + chunk);
    try { await writeOne(part); }
    catch (e) {
      if (i === 0 && chunk > 20) { chunk = chunk === 180 ? 100 : 20; log("chunk " + chunk); continue; }
      throw e;
    }
    i += part.length;
    await sleep(4);
  }
}
async function api(body) {
  const res = await fetch("/api/attend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ station, ...body }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "server error");
  return j;
}
async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (!ch && dev) await attach();
    const r = await api({ action: "next" });
    if (!ch) { if (r.job) say("⚠️ أكو ليبل ينتظر. دوس اتصل بالطابعة"); return; }
    if (!r.job) return;
    say("🖨 دا يطبع: " + r.job.name);
    const bytes = Uint8Array.from(atob(r.job.b64), (x) => x.charCodeAt(0));
    await write(bytes);
    await api({ action: "done", id: r.job.id });
    done++;
    countEl.textContent = "انطبع: " + done;
    log("printed " + r.job.name + " (" + bytes.length + " bytes)");
    say("✅ متصلة، تنتظر الليبلات");
  } catch (e) { say("⚠️ " + why(e)); log(why(e)); await sleep(2000); }
  finally { busy = false; }
}
document.getElementById("c").onclick = connect;
if (!station) say("⚠️ الرابط ناقص. انسخه من صفحة الحضوري");
else { void tick(); setInterval(tick, 3000); }
</script></body></html>`;

export const GET = () => new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
