// واجهة صفحة المراكز الامتحانية: المناطق، المراكز، ونوع الامتحان لكل محافظة
import { find, insert, one, put, tx, update, type Row } from "./db.ts";
import { GOVS } from "./config.ts";
import { centerName } from "./data.ts";
import { listPdf } from "./documents.ts";
import { STUDENTS_PERM } from "./studentApi.ts";
import { authed, need } from "./webApi.ts";

const MODES = ["both", "in", "online"];
const nameOf = (raw: unknown, label: string) => {
  const t = String(raw ?? "").trim();
  need(t, label);
  need(t.length <= 80, "الاسم طويل، خليه أقصر");
  return t;
};
export async function sendCenterPdf(chat: number, cid: number) {
  const rows = await find("students", { center_id: cid }, { order: ["name"] });
  await listPdf(chat, "طلاب مركز " + await centerName(cid), ["الاسم", "الصف", "المنهج", "الهاتف 1", "الهاتف 2"],
    rows.map((r) => [r.name, r.grade, r.curr, r.phone1, r.phone2]), `center_${cid}`);
}
async function pageData() {
  const counts = new Map<number, number>();
  for (const s of await find("students")) if (s.center_id) counts.set(s.center_id, (counts.get(s.center_id) ?? 0) + 1);
  const centers = await find("centers", { active: 1 }, { order: ["id"] });
  const modes = new Map((await find("govmode")).map((r) => [r.gov, r.mode]));
  return {
    govs: GOVS,
    modes: GOVS.map((gov) => ({ gov, mode: modes.get(gov) ?? "online" })),
    areas: (await find("areas", { active: 1 }, { order: ["gov", "id"] })).map((a) => ({
      id: a.id, gov: a.gov, name: a.name,
      centers: centers.filter((c) => c.area_id === a.id).map((c) => ({ id: c.id, name: c.name, n: counts.get(c.id) ?? 0 })),
    })),
  };
}
const liveArea = async (id: number) => { const a = await one("areas", { id, active: 1 }); need(a, "المنطقة غير موجودة"); return a!; };
const liveCenter = async (id: number) => { const c = await one("centers", { id, active: 1 }); need(c, "المركز غير موجود"); return c!; };
const areaFree = async (gov: string, name: string, self = 0) => need(!(await find("areas", { gov, name, active: 1 })).some((a) => a.id !== self), "اكو منطقة بهذا الاسم بنفس المحافظة");
const centerFree = async (area_id: number, name: string, self = 0) => need(!(await find("centers", { area_id, name, active: 1 })).some((c) => c.id !== self), "اكو مركز بهذا الاسم بنفس المنطقة");

export async function centerAction(body: Row) {
  const uid = await authed(body?.initData, STUDENTS_PERM);
  const a = String(body.action ?? "");
  const id = Number(body.id);
  let notice = "";
  if (a === "addArea") {
    need(GOVS.includes(String(body.gov)), "اختار المحافظة");
    const name = nameOf(body.name, "اكتب اسم المنطقة");
    await areaFree(String(body.gov), name);
    const center = nameOf(body.center, "اكتب اسم أول مركز بالمنطقة");
    await tx(async () => { await insert("centers", { area_id: await insert("areas", { gov: String(body.gov), name }), name: center }); });
    notice = "✅ انضافت المنطقة ومركزها";
  } else if (a === "renameArea") {
    const area = await liveArea(id);
    const name = nameOf(body.name, "اكتب اسم المنطقة");
    await areaFree(area.gov, name, id);
    await update("areas", { id }, { name });
  } else if (a === "delArea") {
    await liveArea(id);
    await tx(async () => {
      await update("areas", { id }, { active: 0 });
      await update("centers", { area_id: id }, { active: 0 });
    });
    notice = "🗑 انحذفت المنطقة. طلابها يبقون مسجلين، وغيرهم من صفحة الطلاب";
  } else if (a === "addCenter") {
    await liveArea(id);
    const name = nameOf(body.name, "اكتب اسم المركز");
    await centerFree(id, name);
    await insert("centers", { area_id: id, name });
    notice = "✅ انضاف المركز";
  } else if (a === "renameCenter") {
    const c = await liveCenter(id);
    const name = nameOf(body.name, "اكتب اسم المركز");
    await centerFree(c.area_id, name, id);
    await update("centers", { id }, { name });
  } else if (a === "delCenter") {
    await liveCenter(id);
    await update("centers", { id }, { active: 0 });
    notice = "🗑 انحذف المركز. طلابه يبقون مسجلين عليه، وغيرهم من صفحة الطلاب";
  } else if (a === "pdf") {
    await liveCenter(id);
    await sendCenterPdf(uid, id);
    notice = "✅ الملف وصلك بمحادثة البوت";
  } else if (a === "mode") {
    need(GOVS.includes(String(body.gov)), "محافظة غير معروفة");
    need(MODES.includes(String(body.mode)), "اختار نوع الامتحان");
    await put("govmode", { gov: String(body.gov), mode: String(body.mode) });
  } else need(a === "list", "أمر غير معروف");
  return { ...await pageData(), notice };
}
