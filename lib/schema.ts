// الجداول: مفتاح كل جدول وأعمدته وقيمها الابتدائية. Firestore ما عنده جداول، فهذا الملف يقوم مقامها
import type { Row } from "./types.ts";

type Table = { key: string | string[]; auto?: boolean; cols: Row };
const nulls = (...names: string[]) => Object.fromEntries(names.map((n) => [n, null]));

export const SCHEMA: Record<string, Table> = {
  products: { key: "id", auto: true, cols: { ...nulls("name", "price", "cat_id", "mode", "ask"), active: 1, hidden: 0 } },
  cats: { key: "id", auto: true, cols: { name: null, active: 1 } },
  fees: { key: "gov", cols: { fee: null } },
  sessions: { key: "user_id", cols: nulls("state", "data") },
  kv: { key: "k", cols: { v: null } },
  orders: { key: "id", auto: true, cols: { ...nulls("user_id", "username", "name", "gov", "side", "area", "phone1", "phone2", "items", "subtotal", "fee", "total", "created", "curr", "seller", "office_id", "settle_id", "printed_by", "printed_at"), printed: 0 } },
  students: { key: "user_id", cols: nulls("username", "name", "curr", "grade", "gov", "side", "area", "phone1", "phone2", "exam", "center_id", "created", "updated", "gender") },
  student_pass: { key: "user_id", cols: nulls("hash", "created") },
  pass_requests: { key: "user_id", cols: { created: null } },
  areas: { key: "id", auto: true, cols: { gov: null, name: null, active: 1 } },
  centers: { key: "id", auto: true, cols: { area_id: null, name: null, gender: null, active: 1 } },
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
  bank_exams: { key: "id", auto: true, cols: { ...nulls("slug", "chapter", "ord", "title", "info", "minutes", "pos", "group_versions"), manual: 0 } },
  bank_versions: { key: "id", auto: true, cols: { ...nulls("exam_id", "model", "issues", "pdf_ar", "pdf_en", "pages_ar", "pages_en", "answer_pdf"), kind: "mandatory", ok: 1, has_en: 0, manual: 0 } },
  bank_questions: { key: "id", auto: true, cols: { ...nulls("version_id", "n", "max_mark", "q_file", "a_files"), edited: 0 } },
  bank_edits: { key: "id", auto: true, cols: nulls("user_id", "what", "created") },
  exam_access: { key: ["user_id", "chapter"], cols: nulls("order_id", "created") },
  order_codes: { key: "code", cols: nulls("order_id", "chapters", "used_at") },
  schedules: { key: "user_id", cols: nulls("mode", "center_id", "picks", "start_day", "end_day", "weekdays", "hour", "created") },
  place_slots: { key: "center_id", cols: { slots: null } },
  place_dates: { key: ["center_id", "exam_id"], cols: nulls("day", "versions") },
  sched_items: { key: "id", auto: true, cols: nulls("user_id", "exam_id", "at", "status", "version_id", "started_at", "submitted_at", "opened_at", "notified", "grader_id", "total", "graded_at", "kind", "paid_id") },
  question_marks: { key: ["item_id", "q"], cols: { mark: null } },
  paper_ink: { key: ["item_id", "page"], cols: { ink: null } },
  student_stops: { key: "id", auto: true, cols: nulls("user_id", "chapter", "block", "score", "max", "need", "absent", "reason", "lectures", "created", "lifted", "lifted_by") },
  checkpoint_done: { key: ["user_id", "chapter", "block"], cols: nulls("passed", "score", "absent", "created") },
  student_devices: { key: "user_id", cols: nulls("device", "at", "tried") },
  grader_pay: { key: "user_id", cols: nulls("mandatory", "optional", "deduct", "chapters", "exams_off") },
  grader_settlements: { key: "id", auto: true, cols: nulls("user_id", "n_mand", "n_opt", "n_obj", "amount", "created", "by_id") },
  objections: { key: "id", auto: true, cols: nulls("item_id", "user_id", "q", "text", "voice", "status", "old_mark", "new_mark", "reason", "created", "decided_at", "decided_by", "paid_id") },
  grade_comments: { key: "id", auto: true, cols: nulls("lo", "hi", "text", "sticker_id", "created") },
  stickers: { key: "id", auto: true, cols: nulls("name", "file", "lo", "hi", "created") },
  comment_sent: { key: ["user_id", "comment_id"], cols: { at: null } },
  exam_answers: { key: "id", auto: true, cols: nulls("item_id", "q", "file", "created") },
  activity: { key: "id", auto: true, cols: nulls("user_id", "what", "created") },
  guardians: { key: ["guardian_id", "student_id"], cols: { created: null } },
  company_settlements: { key: "id", auto: true, cols: nulls("from_id", "to_id", "n", "gross", "fees", "net", "created") },
};

export const keyCols = (table: string) => [SCHEMA[table].key].flat();
export const keyOf = (table: string, row: Row) => keyCols(table).map((k) => row[k]);
