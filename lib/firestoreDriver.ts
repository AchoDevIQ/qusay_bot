// Firestore: كل جدول مجموعة، وكل صف وثيقة اسمها مفتاحه
import { AsyncLocalStorage } from "node:async_hooks";
import { SCHEMA, keyCols, keyOf } from "./schema.ts";
import type { Driver, Row } from "./types.ts";

// الجزء اللي نستخدمه من Firestore، حتى تقدر الفحوصات تشغله على نسخة وهمية
type Snap = { exists: boolean; id: string; data(): Row | undefined };
type QSnap = { docs: Snap[] };
type DocRef = { id: string; get(): Promise<Snap>; set(d: Row): Promise<unknown>; update(d: Row): Promise<unknown>; delete(): Promise<unknown> };
type Query = { where(f: string, op: "==", v: unknown): Query; get(): Promise<QSnap> };
type Coll = Query & { doc(id: string): DocRef };
type Tx = { get(r: DocRef): Promise<Snap>; get(q: Query): Promise<QSnap>; set(r: DocRef, d: Row): unknown; delete(r: DocRef): unknown };
export type FirestoreLike = { collection(name: string): Coll; runTransaction<T>(fn: (t: Tx) => Promise<T>): Promise<T> };

const COUNTERS = "_counters";
export const docId = (key: unknown[]) => key.map((k) => encodeURIComponent(String(k))).join("|");
const matches = (r: Row, eq: Row) => Object.entries(eq).every(([k, v]) => (r[k] ?? null) === v);
const numericFirst = (a: Row, b: Row, keys: string[]) => {
  for (const k of keys) {
    if (a[k] === b[k]) continue;
    return a[k] < b[k] ? -1 : 1;
  }
  return 0;
};
/** الصف كامل بكل أعمدته، حتى البحث عن القيم الفارغة يلگاه */
const full = (table: string, row: Row): Row => {
  const out: Row = { ...SCHEMA[table].cols };
  for (const [k, v] of Object.entries(row)) out[k] = v === undefined ? null : v;
  return out;
};

type Scope = { t: Tx; writes: Map<string, { table: string; id: string; row: Row | null }> };
const scope = new AsyncLocalStorage<Scope>();

export function firestoreDriver(getDb: () => FirestoreLike): Driver {
  const ref = (table: string, id: string) => getDb().collection(table).doc(id);
  const slot = (table: string, id: string) => `${table}/${id}`;

  async function read(table: string, id: string): Promise<Row | null> {
    const s = scope.getStore();
    const w = s?.writes.get(slot(table, id));
    if (w) return w.row;
    const snap = s ? await s.t.get(ref(table, id)) : await ref(table, id).get();
    return snap.exists ? snap.data()! : null;
  }
  function write(table: string, id: string, row: Row | null) {
    const s = scope.getStore();
    if (s) { s.writes.set(slot(table, id), { table, id, row }); return Promise.resolve(); }
    return row ? ref(table, id).set(row) : ref(table, id).delete();
  }
  async function query(table: string, eq: Row): Promise<Row[]> {
    let q: Query = getDb().collection(table);
    for (const [k, v] of Object.entries(eq)) q = q.where(k, "==", v);
    const s = scope.getStore();
    const snap = s ? await s.t.get(q) : await q.get();
    const rows = new Map(snap.docs.map((d) => [d.id, d.data()!]));
    if (s) for (const w of s.writes.values()) {
      if (w.table !== table) continue;
      if (w.row && matches(w.row, eq)) rows.set(w.id, w.row);
      else rows.delete(w.id);
    }
    return [...rows.values()];
  }

  const driver: Driver = {
    seedOnce: true,
    async init() {},
    async list(table, eq) {
      const keys = keyCols(table);
      if (keys.every((k) => k in eq)) {
        const r = await read(table, docId(keys.map((k) => eq[k])));
        return r && matches(r, eq) ? [r] : [];
      }
      return (await query(table, eq)).sort((a, b) => numericFirst(a, b, keys));
    },
    async insert(table, row) {
      const { auto } = SCHEMA[table];
      if (!auto) { await driver.put(table, row); return 0; }
      return driver.tx(async () => {
        const counter = await read(COUNTERS, table);
        const id = Number(counter?.last ?? 0) + 1;
        await write(COUNTERS, table, { last: id });
        const keyName = keyCols(table)[0];
        await write(table, String(id), full(table, { ...row, [keyName]: id }));
        return id;
      });
    },
    async put(table, row) { await write(table, docId(keyOf(table, row)), full(table, row)); },
    async patch(table, key, fields) {
      await driver.tx(async () => {
        const id = docId(key);
        const old = await read(table, id);
        if (old) await write(table, id, { ...old, ...fields });
      });
    },
    async del(table, key) { await write(table, docId(key), null); },
    tx(fn) {
      if (scope.getStore()) return fn();
      return getDb().runTransaction(async (t) => {
        const s: Scope = { t, writes: new Map() };
        const r = await scope.run(s, fn);
        // Firestore يمنع القراءة بعد الكتابة، فكل الكتابات تصير بالنهاية
        for (const w of s.writes.values()) {
          if (w.row) t.set(ref(w.table, w.id), w.row);
          else t.delete(ref(w.table, w.id));
        }
        return r;
      });
    },
  };
  return driver;
}

/** يعدل عداد الجدول بعد نسخ بيانات قديمة، حتى الأرقام الجديدة ما تتكرر */
export async function setCounter(getDb: () => FirestoreLike, table: string, last: number) {
  await getDb().collection(COUNTERS).doc(table).set({ last });
}
