"use client";
// التصحيح لازم يوصل حتى لو نت المصحح ضعيف (طلب الأستاذ 2026-11-19: «من ندز الأوراق ما توصل بسبب النت»):
// كل طلب يعيد وحده لحد ما يوصل. السيرفر إذا رفض (مثلاً الورقة أخذها مصحح ثاني) يوگف فوراً، بس انقطاع النت لا.
// والورقة الجاهزة للإرسال (درجتها وصورها المركبة) تنحفظ بالجهاز، فإذا انسدت الصفحة ترجع تنرسل وحدها من تنفتح.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** ينتظر النت يرجع، أو المدة، أيهم أول */
function waitOnline(ms: number) {
  return new Promise<void>((resolve) => {
    const done = () => { window.removeEventListener("online", done); resolve(); };
    window.addEventListener("online", done);
    setTimeout(done, ms);
  });
}

/** POST يعيد وحده: انقطاع النت أو خطأ بالسيرفر (5xx) يعيد بعد 1، 2، 4... لحد 15 ثانية.
 *  يرجّع الجواب أول ما يوصل (ناجح، أو رفض 4xx). tries = 0 يعني يبقى يحاول ما دامت الصفحة مفتوحة */
export async function postRetry(body: () => BodyInit, json: boolean, opts: { tries?: number; onWait?: (n: number) => void } = {}): Promise<Response> {
  const tries = opts.tries ?? 0;
  for (let n = 1; ; n++) {
    try {
      const res = await fetch("/api/grade", { method: "POST", ...(json ? { headers: { "Content-Type": "application/json" } } : {}), body: body() });
      if (res.status < 500 && res.status !== 408 && res.status !== 429) return res;
    } catch { /* ماكو نت: يعيد */ }
    if (tries && n >= tries) throw new Error("ماكو اتصال");
    opts.onWait?.(n);
    const ms = Math.min(15000, 1000 * 2 ** Math.min(n - 1, 4));
    if (typeof navigator !== "undefined" && navigator.onLine === false) await waitOnline(60000); else await sleep(ms);
  }
}

// ---------- الأوراق اللي تنتظر الإرسال، محفوظة بالجهاز (IndexedDB)
export type SendJob = { key: string; id: number; name: string; action: "finish" | "decide"; comment?: number; rejects?: Record<number, string>; photos: Blob[]; at: number };
const DB = "qmath-grade", STORE = "send";
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "key" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const d = await db();
    return await new Promise<T>((resolve, reject) => { const req = f(d.transaction(STORE, mode).objectStore(STORE)); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  } catch { return null; }   // متصفح بدون IndexedDB (وضع خاص): يبقى الإرسال يعيد ما دامت الصفحة مفتوحة
}
export const saveJob = (j: SendJob) => tx("readwrite", (s) => s.put(j));
export const dropJob = (key: string) => tx("readwrite", (s) => s.delete(key));
export const allJobs = async () => ((await tx<SendJob[]>("readonly", (s) => s.getAll() as IDBRequest<SendJob[]>)) ?? []).sort((a, b) => a.at - b.at);

/** يرسل ورقة محفوظة لحد ما توصل. رفض السيرفر (مثلاً «الورقة مخلصة»: وصلت قبل) يشيلها من الجهاز ويرجّع سببه */
export async function sendJob(j: SendJob, auth: () => string, onWait?: (n: number) => void): Promise<{ ok: boolean; error?: string }> {
  const body = () => {
    const fd = new FormData();
    fd.set("initData", auth()); fd.set("action", j.action); fd.set("id", String(j.id));
    if (j.action === "finish") fd.set("comment", String(j.comment ?? 0));
    if (j.action === "decide") fd.set("rejects", JSON.stringify(j.rejects ?? {}));
    j.photos.forEach((b, i) => fd.append("photo", b, `p${i}.jpg`));
    return fd;
  };
  const res = await postRetry(body, false, { onWait });
  const out = await res.json().catch(() => ({}));
  await dropJob(j.key);
  // «الورقة مخلصة»: وصلت بمرة قبل وضاع الجواب بالطريق، فهي واصلة
  return res.ok || /مخلصة/.test(out.error ?? "") ? { ok: true } : { ok: false, error: out.error ?? "" };
}
