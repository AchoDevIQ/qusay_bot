// تحويل كتابة القلم لنص بصفحة التصحيح: كل مصحح يختار لنفسه من «خيارات القلم»،
// أما الكتابة تبقى قلم، أو تتحول نص يگدر يعدله قبل ما ينحط على الورقة (وبعد ما ينحط هم).
// القراية بـ Claude Haiku 5.5 مثل باقي الذكاء الاصطناعي بالمستودع
import Anthropic from "@anthropic-ai/sdk";
import { kvGet, kvSet } from "./db.ts";
import { MODEL, hasKey } from "./booklets.ts";

const key = (uid: number) => `pen_text_${uid}`;
/** هذا المصحح مختار كتابته تتحول نص؟ */
export const penTextOn = async (uid: number) => (await kvGet(key(uid))) === "1";
export const setPenText = (uid: number, on: boolean) => kvSet(key(uid), on ? "1" : "0");

const USAGE = "pen_text_usage";
/** كم مرة انقرت الكتابة وكم كلفت (بالدولار)، حتى صاحب البوت يعرف */
export async function penTextUsage(): Promise<{ used: number; cost: number }> {
  try { const j = JSON.parse(await kvGet(USAGE) ?? "{}"); return { used: Number(j.used) || 0, cost: Number(j.cost) || 0 }; } catch { return { used: 0, cost: 0 }; }
}

const SYSTEM = `You read a short handwritten note that a math teacher wrote with a pen on a student's exam paper while grading.
The note may be Arabic (often Iraqi dialect), English, math, or a mix.
Return exactly what is written, as plain text: keep the teacher's own words and spelling, do not correct, translate, explain or add anything.
Write math with plain characters (x², √, π, ≠, ≤, →, fractions as a/b). Keep line breaks where the teacher started a new line.
If nothing readable is written, set ok to false and text to "".`;
const SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" }, text: { type: "string" } },
  required: ["ok", "text"],
  additionalProperties: false,
} as const;

let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic());
const MAX_IMG = 3 * 1024 * 1024;

/** يقرا صورة الكتابة (PNG بخلفية بيضة) ويرجع النص. خطأ مفهوم إذا ما گدر */
export async function readInk(dataUrl: unknown): Promise<string> {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
  if (!m) throw new Error("صورة الكتابة ما وصلت");
  if (m[2].length * 0.75 > MAX_IMG) throw new Error("الكتابة كبيرة هواية، اكتبها على دفعات");
  if (!hasKey()) throw new Error("مفتاح الذكاء الاصطناعي مو محطوط بالسيرفر، فالكتابة تبقى قلم");
  const res = await api().beta.messages.create({
    model: MODEL, max_tokens: 4000, system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: m[1] === "png" ? "image/png" : "image/jpeg", data: m[2] } },
      { type: "text", text: "Read this note." },
    ] }],
  });
  const u = res.usage;
  // نفس أسعار Haiku 5.5 اللي بنظام التصحيح AI (lib/aiGrade.ts)
  const cost = (((u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)) * 0.1 + (u.output_tokens ?? 0) * 0.5) / 1_000_000;
  const was = await penTextUsage();
  await kvSet(USAGE, JSON.stringify({ used: was.used + 1, cost: Math.round((was.cost + cost) * 1e6) / 1e6 }));
  if (res.stop_reason === "refusal") throw new Error("ما گدرت أقرا الكتابة");
  let j: { ok?: boolean; text?: string } = {};
  try { j = JSON.parse(res.content.map((b) => (b.type === "text" ? b.text : "")).join("")); } catch { /* مو مفهوم */ }
  const text = String(j.text ?? "").trim().slice(0, 600);
  if (!j.ok || !text) throw new Error("ما گدرت أقرا الكتابة، اكتبها أوضح أو خليها قلم");
  return text;
}
