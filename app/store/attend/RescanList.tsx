"use client";
// أوراق انمسحت لأن السكنر طلع غلط: المساعد اللي رفعها يشوفها هنا لحد ما يعيد رفعها، وبعدها تنشال وحدها
export type Rescan = { item: number; sid: number; name: string; center: string; at: string; exam: string; when: string };

export default function RescanList({ list }: { list?: Rescan[] }) {
  if (!list?.length) return null;
  return (
    <div className="card expad rescan">
      <div className="exlabel">🔁 أوراق لازم تعيد رفعها ({list.length})</div>
      <div className="exhint">المصحح مسحها لأن رفعها ما طلع صحيح. ارفعها من جديد بالسكانر أو بالكاميرا، وأول ما تروح للتصحيح تنشال من هنا وحدها.</div>
      <div className="atlog">
        {list.map((r) => (
          <div key={r.item}><b>{r.name}</b> <span dir="ltr">#{r.sid}</span> · {r.center || "-"} · {r.at} · {r.exam}</div>
        ))}
      </div>
    </div>
  );
}
