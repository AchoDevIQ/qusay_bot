// 📎 شرح السبورة ينزل بملحقات المحاضرة بتطبيق قصي (طلبه 2026-11-25): «جوا كل محاضرة أكو الملحقات».
// سيرفرنا يقرا محاضرات التطبيق (الفصل ← الموضوع ← عربي/انگليزي ← المحاضرة) ويضيف ملحق نوعه «board»
// رابطه صفحة السبورة بالشرح. التطبيق (بعد التحديث) يفتحه جوه التطبيق على سبورة الطالب.
// يحتاج إذن «Firebase Data Connect Admin» لحساب سيرفرنا على مشروع التطبيق qmath-iq (يعطيه الأستاذ بنفسه).
// مفتاح بيد الأستاذ: مطفي (الشرح يوصل برسالة بس) / تجربة (داتا التجربة) / الحقيقي
import { kvGet, kvSet, type Row } from "./db.ts";
import { PROJECT, type AppEnv } from "./appLink.ts";
import { need } from "./webApi.ts";

const REGION = "europe-west4";
const SERVICE: Record<AppEnv, string> = { staging: "qmath-iq-staging-service", prod: "qmath-iq-service" };
export const BOARD_TYPE = "board";
const KV = "board_app";

export async function boardAppEnv(): Promise<AppEnv | null> {
  const v = await kvGet(KV);
  return v === "staging" || v === "prod" ? v : null;
}
export const setBoardAppEnv = (v: unknown) => kvSet(KV, v === "staging" || v === "prod" ? v : "");

type Dc = (env: AppEnv, query: string, variables: Row, write: boolean) => Promise<Row>;
/** الطلب لداتا التطبيق كمسؤول (بإذن حساب سيرفرنا) */
const dcAdmin: Dc = async (env, query, variables, write) => {
  const { GoogleAuth } = await import("google-auth-library");
  const token = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getAccessToken().catch(() => null);
  need(token, "ما گدرنا نوصل لداتا التطبيق هسه، حاول بعد شوية", 503);
  const url = `https://firebasedataconnect.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/services/${SERVICE[env]}:${write ? "executeGraphql" : "executeGraphqlRead"}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-goog-user-project": PROJECT },
    body: JSON.stringify({ query, variables }),
  });
  const j = (await r.json().catch(() => ({}))) as Row;
  if (r.status === 403) {
    console.error("board app dc 403", JSON.stringify(j).slice(0, 300));
    need(false, "سيرفرنا بعده ما عنده إذن يكتب بملحقات محاضرات التطبيق. لازم تعطيه إذن «Firebase Data Connect Admin» على مشروع التطبيق", 403);
  }
  if (!r.ok || (j.errors as unknown[] | undefined)?.length) {
    console.error("board app dc", r.status, JSON.stringify(j).slice(0, 400));
    need(false, "ما گدرنا نوصل لمحاضرات التطبيق، حاول مرة ثانية", 502);
  }
  return (j.data ?? {}) as Row;
};
let dc: Dc = dcAdmin;
/** للفحوصات بس */
export const setDcForTest = (f: Dc | null) => { dc = f ?? dcAdmin; };

export type AppLecture = { id: string; title: string; track: "arabic" | "english"; draft: boolean };
export type AppTopic = { id: string; name: string; lectures: AppLecture[] };
export type AppChapter = { ch: number; name: string; topics: AppTopic[] };

/** فصول التطبيق 1-5 (المنهج المنشور، بلا الفصول التجريبية) ومواضيعها ومحاضراتها بالترتيب */
export async function appLectures(env: AppEnv): Promise<AppChapter[]> {
  const d = await dc(env, `query {
    curricula(where: { status: { eq: "published" } }, limit: 20) {
      chapters_on_curriculum(orderBy: [{ orderPosition: ASC }], limit: 50) {
        orderPosition arabicTitle isTestChapter
        subjects_on_chapter(orderBy: [{ orderPosition: ASC }], limit: 200) {
          id arabicTitle
          lectures_on_subject(orderBy: [{ orderPosition: ASC }], limit: 500) { id title track state }
        }
      }
    }
  }`, {}, false);
  const out = new Map<number, AppChapter>();
  for (const cu of (d.curricula ?? []) as Row[]) {
    for (const c of (cu.chapters_on_curriculum ?? []) as Row[]) {
      const ch = Number(c.orderPosition);
      if (!(ch >= 1 && ch <= 5) || c.isTestChapter) continue;
      const row = out.get(ch) ?? { ch, name: String(c.arabicTitle ?? ""), topics: [] };
      for (const s of (c.subjects_on_chapter ?? []) as Row[]) {
        const lectures = ((s.lectures_on_subject ?? []) as Row[])
          .filter((l) => l.track === "arabic" || l.track === "english")
          .map((l) => ({ id: String(l.id), title: String(l.title ?? ""), track: l.track as AppLecture["track"], draft: l.state !== "published" }));
        if (lectures.length) row.topics.push({ id: String(s.id), name: String(s.arabicTitle ?? ""), lectures });
      }
      out.set(ch, row);
    }
  }
  return [...out.values()].sort((a, b) => a.ch - b.ch);
}

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** المحاضرة نفسها: عنوانها وموضوعها وفصلها (للرسالة ولفحص الفصل) */
export async function appLecture(env: AppEnv, id: string) {
  need(UUID.test(id), "اختار المحاضرة");
  const d = await dc(env, `query ($id: UUID!) {
    lecture(id: $id) { id title track subject { arabicTitle chapter { orderPosition } } lectureAttachments_on_lecture(limit: 10000) { id } }
  }`, { id }, false);
  const l = d.lecture as Row | null;
  need(l, "المحاضرة مو موجودة بالتطبيق", 404);
  return {
    id: String(l!.id), title: String(l!.title ?? ""), track: String(l!.track ?? ""),
    topic: String(l!.subject?.arabicTitle ?? ""), ch: Number(l!.subject?.chapter?.orderPosition ?? 0),
    count: ((l!.lectureAttachments_on_lecture ?? []) as Row[]).length,
  };
}

/** يضيف الشرح آخر ملحق بالمحاضرة */
export async function addBoardAttachment(env: AppEnv, lectureId: string, url: string, title: string, after: number, type = BOARD_TYPE): Promise<string> {
  const d = await dc(env, `mutation ($l: UUID!, $u: String!, $t: String, $o: Int!, $y: String!) {
    lectureAttachment_insert(data: { lecture: { id: $l }, type: $y, url: $u, title: $t, orderPosition: $o })
  }`, { l: lectureId, u: url, t: title.slice(0, 200), o: after + 1, y: type }, true);
  const id = String((d.lectureAttachment_insert as Row | undefined)?.id ?? "");
  need(id, "ما انضاف الملحق بالتطبيق، حاول مرة ثانية", 502);
  return id;
}

/** يشيل ملحق الشرح من المحاضرة (لما يسحب الشرح) */
export async function removeBoardAttachment(env: AppEnv, id: string) {
  if (!UUID.test(id)) return;
  await dc(env, `mutation ($id: UUID!) { lectureAttachment_delete(key: { id: $id }) }`, { id }, true);
}

// ---------- 📘✍️ أزرار «الملزمة» و«حلّي» بكل محاضرات التطبيق (lib/lectureQs.ts)
export const QBOOK_TYPE = "qbook", QSOLVE_TYPE = "qsolve";
type LqAtt = { lec: string; qbook: string; solve: string };
const lqKey = (env: AppEnv) => `lq_atts_${env}`;
async function lqList(env: AppEnv): Promise<LqAtt[]> { try { const j = JSON.parse((await kvGet(lqKey(env))) ?? "[]"); return Array.isArray(j) ? j : []; } catch { return []; } }

/** يمر على كل محاضرات التطبيق: يحفظ معلوماتها، واللي إلها أسئلة بالملازم وما بيها الزرين يضيفهن آخر ملحقاتها */
export async function syncLectureAtts(env: AppEnv, base: string) {
  const { find } = await import("./db.ts");
  const { lecNumber, lectureQs, saveLecInfo } = await import("./lectureQs.ts");
  const books = await find("note_books");
  const done = await lqList(env);
  const have = new Set(done.map((x) => x.lec));
  let added = 0, already = 0, none = 0;
  for (const c of await appLectures(env)) {
    const topics = c.topics.map((t) => t.name);
    for (const [ti, t] of c.topics.entries()) {
      for (const track of ["arabic", "english"] as const) {
        const lecs = t.lectures.filter((l) => l.track === track);
        for (const [k, l] of lecs.entries()) {
          const info = { id: l.id, env, ch: c.ch, lang: track === "english" ? "en" as const : "ar" as const, topics, ti, lec: lecNumber(l.title) || k + 1, title: l.title, topic: t.name };
          await saveLecInfo(info);
          if (!(await lectureQs(books, info, true)).length) { none++; continue; }
          if (have.has(l.id)) { already++; continue; }
          const n = (await appLecture(env, l.id)).count;
          const qbook = await addBoardAttachment(env, l.id, `${base}/store/qbook?lec=${l.id}`, "📘 ملزمة المحاضرة: الأسئلة وحلولها", n, QBOOK_TYPE);
          const solve = await addBoardAttachment(env, l.id, `${base}/store/board?solve=${l.id}`, "✍️ حلّي: اكتب حلك تحت كل سؤال", n + 1, QSOLVE_TYPE);
          done.push({ lec: l.id, qbook, solve }); have.add(l.id);
          await kvSet(lqKey(env), JSON.stringify(done));
          added++;
        }
      }
    }
  }
  return { added, already, none };
}
/** يشيل الزرين من كل المحاضرات */
export async function clearLectureAtts(env: AppEnv) {
  const done = await lqList(env);
  for (const x of done) { await removeBoardAttachment(env, x.qbook); await removeBoardAttachment(env, x.solve); }
  await kvSet(lqKey(env), "[]");
  return done.length;
}
export const lectureAttCount = async (env: AppEnv) => (await lqList(env)).length;
