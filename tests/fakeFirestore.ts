// نسخة وهمية من Firestore للفحوصات، أقسى من الحقيقية بقصد:
// تمنع القراءة بعد الكتابة داخل العملية، وتعيد كل عملية مرتين حتى يبين أي شي ما يتحمل الإعادة
import type { FirestoreLike } from "../lib/firestoreDriver.ts";
import type { Row } from "../lib/types.ts";

const clone = <T>(v: T): T => structuredClone(v);

export function fakeFirestore() {
  const store = new Map<string, Map<string, Row>>();
  const coll = (n: string) => { if (!store.has(n)) store.set(n, new Map()); return store.get(n)!; };
  const snap = (id: string, d: Row | undefined) => ({ exists: d !== undefined, id, data: () => clone(d) });
  const stats = { reads: 0, txs: 0 };

  const makeQuery = (name: string, filters: [string, unknown][]): any => ({
    __query: true,
    where: (f: string, _op: string, v: unknown) => {
      if (v === undefined) throw new Error("Firestore يرفض undefined");
      return makeQuery(name, [...filters, [f, v]]);
    },
    get: async () => {
      const docs = [...coll(name)].filter(([, d]) => filters.every(([f, v]) => d[f] === v)).map(([id, d]) => snap(id, d));
      stats.reads += docs.length;
      return { docs };
    },
  });
  const check = (d: Row) => {
    for (const [k, v] of Object.entries(d)) if (v === undefined) throw new Error(`Firestore يرفض undefined: ${k}`);
  };
  const db: FirestoreLike = {
    collection: (name) => ({
      ...makeQuery(name, []),
      doc: (id: string) => ({
        __name: name,
        id,
        get: async () => { stats.reads++; return snap(id, coll(name).get(id)); },
        set: async (d: Row) => { check(d); coll(name).set(id, clone(d)); },
        update: async (d: Row) => { coll(name).set(id, { ...coll(name).get(id), ...clone(d) }); },
        delete: async () => { coll(name).delete(id); },
      }),
    }),
    async runTransaction<T>(fn: (t: any) => Promise<T>) {
      stats.txs++;
      const attempt = async () => {
        const writes: (() => void)[] = [];
        const t = {
          get: async (x: any) => {
            if (writes.length) throw new Error("Firestore يمنع القراءة بعد الكتابة");
            return x.get();
          },
          set: (r: any, d: Row) => { check(d); writes.push(() => coll(r.__name).set(r.id, clone(d))); },
          delete: (r: any) => { writes.push(() => coll(r.__name).delete(r.id)); },
        };
        const out = await fn(t);
        return { out, writes };
      };
      await attempt();                  // المحاولة الأولى تنرمى، مثل تعارض حقيقي
      const { out, writes } = await attempt();
      for (const w of writes) w();
      return out;
    },
  };
  return { db, store, stats };
}
