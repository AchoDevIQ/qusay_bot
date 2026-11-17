// توزيع صفحات السكانر على الأسئلة. ثلاث أنواع:
// ١. كل سؤال بصفحة وعليها كود: الكود يعرّف السؤال.
// ٢. ورقة توزيعها محفوظ للامتحان (A3 أو A4، مثلاً الصفحة 2 بيها السؤالين 2 و3): بعد الليبل، ترتيب الصفحات يعرّف الأسئلة.
// ٣. ورقة A4 الليبل بس على أول صفحة وماكو توزيع محفوظ: سؤال بكل صفحة بالترتيب.
// الصفحة البيضاء تنحسب بمكانها إذا بدونها العدد ما يطابق (الطالب ترك صفحة)، والصفحات الزايدة تنضاف لآخر صفحة
export type PageHit = { item: number; q: number; seq: number; label: string; qs?: number[]; blank?: boolean };
export type PageItem = { id: number; ok: boolean; name: string; graded?: boolean; qs: number[]; map?: number[][] | null };

/** يرجع الصفحات الصالحة (كل وحدة بأسئلتها) والمشاكل. ورقة صفحاتها ناقصة ما تنرفع، حتى ما يروح جواب لغير سؤاله */
export function assignPages<T extends PageHit>(hits: T[], items: Map<number, PageItem>) {
  const good: T[] = [], problems: string[] = [];
  for (const [id, it] of items) {
    if (!it.ok) { problems.push(it.graded ? `ورقة ${it.name} انصححت قبل، ما تنرفع مرة ثانية` : `ورقة رقم ${id} مو معروفة`); continue; }
    const mine = hits.filter((h) => h.item === id);
    const written = mine.filter((h) => !h.blank);
    let done: T[] = [];
    // ماكو توزيع محفوظ وولا صفحة عليها كود سؤال (الليبل بس على أول صفحة): سؤال بكل صفحة بالترتيب
    const byOrder = !it.map?.length && written.length > 0 && written.every((h) => !h.q);
    const map = it.map?.length ? it.map : byOrder ? [...it.qs].sort((a, b) => a - b).map((n) => [n]) : null;
    if (map) {
      const n = map.length;
      // صفحة زايدة وحدة بس (ورقة إضافية). أكثر: يمكن ليبل الطالب اللي بعده ما انقرا، فما تنرفع حتى ما تروح ورقته لغيره
      const inOrder = written.length === n ? written : mine.length === n ? mine : written.length === n + 1 ? written.slice(0, n) : null;
      if (!inOrder) {
        const hint = written.length > n ? ". يمكن ليبل الطالب اللي بعده ما انقرا" : byOrder ? ". إذا بالورقة صفحة بيها أكثر من سؤال، سوي توزيع صفحات الورقة لهذا الامتحان" : "";
        problems.push(`${it.name}: عنده ${written.length} صفحة، والمفروض ${n}${byOrder ? " (سؤال بكل صفحة)" : ""}. ما انرفعت ورقته${hint}`);
        continue;
      }
      const bad = map.flat().find((q) => !it.qs.includes(q));
      if (bad) { problems.push(`${it.name}: السؤال ${bad} بتوزيع الصفحات مو من نسخته. ما انرفعت ورقته`); continue; }
      const empty = inOrder.flatMap((h, i) => (h.blank ? map[i] : []));
      done = inOrder.map((h, i) => ({ ...h, q: map[i][0], qs: map[i] })).filter((h) => !h.blank);
      const extra = written.slice(n);
      if (extra.length) {
        const last = map[n - 1];
        done.push(...extra.map((h) => ({ ...h, q: last[0], qs: last })));
        problems.push(`${it.name}: صفحة زايدة انضافت لجواب السؤال ${last.join(" و")}. تأكد منها`);
      }
      if (empty.length) problems.push(`${it.name}: صفحة السؤال ${empty.join(" و")} بيضاء، تروح للمصحح بدون جواب`);
      const got = new Set([...done.flatMap((h) => h.qs ?? [h.q]), ...empty]);
      const miss = it.qs.filter((q) => !got.has(q));
      if (miss.length) problems.push(`${it.name}: ناقصة صفحة السؤال ${miss.join("، ")}`);
      good.push(...done);
      continue;
    } else {
      for (const h of written) {
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
