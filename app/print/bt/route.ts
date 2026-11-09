// فحص طابعة الليبل بالبلوتوث من الآيباد (متصفح Bluefy): يتصل بالطابعة، ويجرب لغتين حتى نعرف ياهي لغتها.
// الصفحة ما بيها أي معلومة طالب، وتكلم بس الجهاز اللي يختاره المستخدم
export const dynamic = "force-static";

const HTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>فحص الطابعة</title>
<style>body{margin:0;padding:16px;background:#0f1a2e;color:#fff;font-family:Tahoma,Arial,sans-serif;font-size:17px;line-height:1.6}
button{display:block;width:100%;margin:12px 0;padding:16px;border:0;border-radius:12px;background:#f7c548;color:#0f1a2e;font-size:18px;font-weight:700}
button:disabled{opacity:.4}pre{white-space:pre-wrap;word-break:break-all;direction:ltr;text-align:left;background:#000;padding:10px;border-radius:8px;font-size:13px}</style></head>
<body><h2>🖨 فحص طابعة الليبل</h2>
<button id="c">١. اتصل بالطابعة</button>
<button id="a" disabled>٢. تجربة A</button>
<button id="b" disabled>٣. تجربة B</button>
<pre id="o"></pre>
<script>
const SERVICES = ["000018f0-0000-1000-8000-00805f9b34fb", "e7810a71-73ae-499d-8c15-faa9aef0c3f2"];
const why = (e) => "name=" + (e && e.name) + " message=" + (e && e.message) + " raw=" + e;
const out = document.getElementById("o");
const log = (t) => { out.textContent += t + "\\n"; };
let ch = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect() {
  out.textContent = "";
  if (!navigator.bluetooth) { log("NO WEB BLUETOOTH: open this page in Bluefy"); return; }
  let step = "requestDevice";
  try {
    log("step 1: choose printer");
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "Thermal" }], optionalServices: SERVICES });
    log("device: " + dev.name);
    step = "gatt.connect";
    log("step 2: connect");
    const gatt = await dev.gatt.connect();
    log("connected: " + gatt.connected);
    ch = null;
    for (const id of SERVICES) {
      step = "service " + id;
      log("step 3: " + step);
      let s;
      try { s = await gatt.getPrimaryService(id); } catch (e) { log("  not available " + why(e)); continue; }
      step = "characteristics " + id;
      const list = await s.getCharacteristics();
      for (const c of list) {
        const p = c.properties;
        log("  char " + c.uuid + (p.write ? " W" : "") + (p.writeWithoutResponse ? " WNR" : "") + (p.notify ? " N" : "") + (p.read ? " R" : ""));
        if (!ch && (p.write || p.writeWithoutResponse)) ch = c;
      }
    }
    if (!ch) { log("NO WRITABLE CHARACTERISTIC"); return; }
    log("using " + ch.uuid);
    document.getElementById("a").disabled = document.getElementById("b").disabled = false;
  } catch (e) { log("FAILED AT " + step + " " + why(e)); }
}
async function send(bytes) {
  try {
    for (let i = 0; i < bytes.length; i += 20) {
      const part = bytes.slice(i, i + 20);
      if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(part);
      else await ch.writeValue(part);
      await sleep(25);
    }
    log("sent " + bytes.length + " bytes");
  } catch (e) { log("SEND FAILED " + why(e)); }
}
const ascii = (s) => new TextEncoder().encode(s);
document.getElementById("c").onclick = connect;
document.getElementById("a").onclick = () => send(ascii('SIZE 58 mm,39 mm\\r\\nGAP 2 mm,0 mm\\r\\nDIRECTION 1\\r\\nCLS\\r\\nTEXT 20,20,"3",0,1,1,"QMath A"\\r\\nQRCODE 20,70,M,5,A,0,"QMath"\\r\\nPRINT 1\\r\\n'));
document.getElementById("b").onclick = () => send(new Uint8Array([0x1b, 0x40, ...ascii("QMath B\\n\\n\\n\\n")]));
</script></body></html>`;

export const GET = () => new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
