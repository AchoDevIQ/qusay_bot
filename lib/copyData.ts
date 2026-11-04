// ينسخ بيانات ملف store.db إلى Firestore بنفس الأرقام، مرة وحدة قبل التشغيل على السيرفر
import { SCHEMA, keyCols } from "./schema.ts";
import { firestoreDriver, setCounter, type FirestoreLike } from "./firestoreDriver.ts";
import type { Row } from "./types.ts";

const WORKERS = 20;

export async function copyToFirestore(rowsOf: (table: string) => Promise<Row[]>, getDb: () => FirestoreLike, opts: { force?: boolean } = {}) {
  if (!opts.force) {
    for (const t of Object.keys(SCHEMA)) {
      const { docs } = await getDb().collection(t).get();
      if (docs.length) throw new Error(`Firestore بيه بيانات بجدول ${t}. النسخ يكتب فوگها، فلازم تأكد بـ --force`);
    }
  }
  const driver = firestoreDriver(getDb);
  const counts: Record<string, number> = {};
  for (const [t, def] of Object.entries(SCHEMA)) {
    const rows = await rowsOf(t);
    let next = 0;
    await Promise.all(Array.from({ length: WORKERS }, async () => {
      while (next < rows.length) await driver.put(t, rows[next++]);
    }));
    if (def.auto) await setCounter(getDb, t, rows.reduce((m, r) => Math.max(m, r[keyCols(t)[0]]), 0));
    counts[t] = rows.length;
  }
  return counts;
}
