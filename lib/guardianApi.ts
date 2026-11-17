// صفحة «👨‍👧 ولي الأمر» بتطبيق الطالب: ولي الأمر يحط رمزه أول مرة، وبعدين يفتح بيه رسائله (الدرجات ويا «✅ استلمت»)
import { chatList, mediaRow, takeAnswer } from "./appChat.ts";
import { handleUpdate } from "./bot.ts";
import { files } from "./files.ts";
import { openWithFace, openWithPin, pinGuardian, pinState, setFace, setPin, verifyGuardToken } from "./guardianPin.ts";
import { api } from "./telegram.ts";
import { TOKEN } from "./config.ts";
import { student } from "./data.ts";
import { ensure, need } from "./webApi.ts";
import { isAppKey, verifyHomeToken } from "./webAuth.ts";

function studentOf(token: unknown, app: unknown) {
  const uid = verifyHomeToken(token);
  need(uid !== null, "هذا الرابط قديم. سد الصفحة وافتحها من جديد", 401);
  need(isAppKey(uid!, app), "هاي الصفحة تنفتح من التطبيق بس", 403);
  return uid!;
}
let seq = Date.now();

export async function guardianAction(body: any) {
  await ensure();
  const sid = studentOf(body?.token, body?.app);
  need(await student(sid), "سجل معلوماتك أول");
  const a = String(body?.action ?? "state");
  if (a === "state") return { ...await pinState(sid), name: String((await student(sid))?.name ?? "") };
  if (a === "setPin") { await setPin(sid, body.pin, body.pin2); return { ...await pinState(sid), gtoken: await openWithPin(sid, body.pin) }; }
  if (a === "open") return { gtoken: await openWithPin(sid, body.pin) };
  if (a === "faceOpen") return { gtoken: await openWithFace(sid, body.desc, body.photo) };
  // من هنا: ولي الأمر فاتح برمزه
  need(verifyGuardToken(body.gtoken) === sid, "اكتب رمزك مرة ثانية", 401);
  const gid = pinGuardian(sid);
  if (a === "faceSet") { await setFace(sid, body.desc, body.photo); return { ...await pinState(sid), notice: "✅ انسجل وجهك. من هسه تگدر تفتح بوجهك أو برمزك" }; }
  if (a === "list") return await chatList(gid, Number(body.after) || 0);
  if (a === "cb") {
    const id = `app:${gid}:${++seq}`;
    await handleUpdate({ update_id: ++seq, callback_query: { id, from: { id: gid, is_bot: false, first_name: "ولي الأمر" }, chat_instance: "app", data: String(body.data ?? ""), message: { message_id: Number(body.mid), chat: { id: gid, type: "private" }, date: Math.floor(Date.now() / 1000), text: "" } } });
    return { ...await chatList(gid, Number(body.after) || 0), answer: takeAnswer(id) };
  }
  need(false, "أمر غير معروف");
  return {};
}

/** ملف رسالة ولي الأمر (صورة بطاقة الدرجة) */
export async function guardianFile(url: URL): Promise<Response> {
  await ensure();
  const sid = verifyGuardToken(url.searchParams.get("g"));
  if (sid === null) return new Response("no", { status: 401 });
  const m = await mediaRow(pinGuardian(sid), Number(url.searchParams.get("m")), Number(url.searchParams.get("k")) || 0);
  if (!m) return new Response("not found", { status: 404 });
  const headers = { "Content-Type": m.t === "photo" ? "image/jpeg" : m.t === "voice" ? "audio/ogg" : "application/octet-stream", "Cache-Control": "private, max-age=3600" };
  if (m.s) { const b = await files().read(m.s); return b ? new Response(new Uint8Array(b), { headers }) : new Response("gone", { status: 404 }); }
  const info: any = m.f ? await api("getFile", { file_id: m.f }) : null;
  if (!info?.file_path) return new Response("gone", { status: 404 });
  const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${info.file_path}`);
  return r.ok ? new Response(r.body, { headers }) : new Response("gone", { status: 404 });
}
