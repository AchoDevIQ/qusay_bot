// توزيع صفحات السكانر على الأسئلة. نوعين:
// ١. كل سؤال بصفحة وعليها كود: الكود يعرّف السؤال.
// ٢. ورقة A3 وتوزيعها محفوظ للامتحان (مثلاً الصفحة 2 بيها السؤالين 2 و3): بعد الليبل، ترتيب الصفحات يعرّف الأسئلة
export type PageHit = { item: number; q: number; seq: number; label: string; qs?: number[] };
export type PageItem = { id: number; ok: boolean; name: string; graded?: boolean; qs: number[]; map?: number[][] | null };

/** يرجع الصفحات الصالحة (كل وحدة بأسئلتها) والمشاكل. ورقة عدد صفحاتها غلط ما تنرفع، حتى ما يروح جواب لغير سؤاله */
export function assignPages<T extends PageHit>(hits: T[], items: Map<number, PageItem>) {
  const good: T[] = [], problems: string[] = [];
  for (const [id, it] of items) {
    if (!it.ok) { problems.push(it.graded ? `ورقة ${it.name} انصححت قبل، ما تنرفع مرة ثانية` : `ورقة رقم ${id} مو معروفة`); continue; }
    const mine = hits.filter((h) => h.item === id);
    let done: T[] = [];
    if (it.map?.length) {
      if (mine.length !== it.map.length) { problems.push(`${it.name}: عنده ${mine.length} صفحة، والمفروض ${it.map.length}. ما انرفعت ورقته`); continue; }
      const bad = it.map.flat().find((q) => !it.qs.includes(q));
      if (bad) { problems.push(`${it.name}: السؤال ${bad} بتوزيع الصفحات مو من نسخته. ما انرفعت ورقته`); continue; }
      done = mine.map((h) => ({ ...h, q: it.map![h.seq - 1][0], qs: it.map![h.seq - 1] }));
    } else {
      for (const h of mine) {
        if (!h.q) problems.push(`${h.label}: ما معروف أي سؤال`);
        else if (!it.qs.includes(h.q)) problems.push(`${h.label}: السؤال ${h.q} مو من نسخة ${it.name}`);
        else done.push(h);
      }
    }
    const got = new Set(done.flatMap((h) => h.qs ?? [h.q]));
    const miss = it.qs.filter((q) => !got.has(q));
    if (miss.length) problems.push(`${it.name}: ناقصة صفحة السؤال ${miss.join("، ")}`);
    good.push(...done);
  }
  return { good, problems };
}
