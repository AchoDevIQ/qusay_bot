// الجداول: مفتاح كل جدول وأعمدته وقيمها الابتدائية. Firestore ما عنده جداول، فهذا الملف يقوم مقامها
import type { Row } from "./types.ts";

type Table = { key: string | string[]; auto?: boolean; cols: Row };
const nulls = (...names: string[]) => Object.fromEntries(names.map((n) => [n, null]));

export const SCHEMA: Record<string, Table> = {
  products: { key: "id", auto: true, cols: { ...nulls("name", "price", "cat_id", "mode"), active: 1, hidden: 0 } },
  cats: { key: "id", auto: true, cols: { name: null, active: 1 } },
  fees: { key: "gov", cols: { fee: null } },
  sessions: { key: "user_id", cols: nulls("state", "data") },
  kv: { key: "k", cols: { v: null } },
  orders: { key: "id", auto: true, cols: { ...nulls("user_id", "username", "name", "gov", "side", "area", "phone1", "phone2", "items", "subtotal", "fee", "total", "created", "curr", "seller", "office_id", "settle_id"), printed: 0 } },
  students: { key: "user_id", cols: nulls("username", "name", "curr", "grade", "gov", "side", "area", "phone1", "phone2", "exam", "center_id", "created", "updated") },
  areas: { key: "id", auto: true, cols: { gov: null, name: null, active: 1 } },
  centers: { key: "id", auto: true, cols: { area_id: null, name: null, active: 1 } },
  govmode: { key: "gov", cols: { mode: null } },
  chapters: { key: "id", auto: true, cols: { ...nulls("ord", "ar", "en"), active: 1 } },
  topics: { key: "id", auto: true, cols: { ...nulls("chapter_id", "ord", "ar", "en"), lectures: 0, active: 1 } },
  questions: { key: "id", auto: true, cols: nulls("user_id", "chapter_id", "topic_id", "lecture", "status", "thread_id", "created", "updated") },
  staff: { key: "user_id", cols: nulls("name", "perms") },
  offices: { key: "id", auto: true, cols: { name: null, lim: 0, active: 1 } },
  office_users: { key: "user_id", cols: nulls("office_id", "name") },
  settlements: { key: "id", auto: true, cols: nulls("office_id", "amount", "n", "created") },
  staff_pay: { key: "id", auto: true, cols: nulls("staff_id", "amount", "created") },
  qmsgs: { key: "id", auto: true, cols: nulls("qid", "kind", "chat_id", "msg_id") },
  bank_exams: { key: "id", auto: true, cols: { ...nulls("slug", "chapter", "ord", "title", "info", "minutes", "pos"), manual: 0 } },
  bank_versions: { key: "id", auto: true, cols: { ...nulls("exam_id", "model", "issues", "pdf_ar", "pdf_en", "pages_ar", "pages_en", "answer_pdf"), kind: "mandatory", ok: 1, has_en: 0, manual: 0 } },
  bank_questions: { key: "id", auto: true, cols: { ...nulls("version_id", "n", "max_mark", "q_file", "a_files"), edited: 0 } },
  bank_edits: { key: "id", auto: true, cols: nulls("user_id", "what", "created") },
  exam_access: { key: ["user_id", "chapter"], cols: nulls("order_id", "created") },
  order_codes: { key: "code", cols: nulls("order_id", "chapters", "used_at") },
};

export const keyCols = (table: string) => [SCHEMA[table].key].flat();
export const keyOf = (table: string, row: Row) => keyCols(table).map((k) => row[k]);
