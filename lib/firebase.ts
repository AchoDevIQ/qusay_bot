// الاتصال بـ Firestore و Cloud Storage. المفاتيح من .env.local بس، وما ينفتح اتصال لحد ما ينطلب
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const PROJECT = "FIREBASE_PROJECT_ID", EMAIL = "FIREBASE_CLIENT_EMAIL", KEY = "FIREBASE_PRIVATE_KEY", BUCKET = "FIREBASE_STORAGE_BUCKET";

/** يقرا المفاتيح ويرجع أسماء الناقصة. أسماء بس، حتى قيمة المفتاح ما تطلع بأي رسالة خطأ */
export function firebaseConfig(env: Record<string, string | undefined> = process.env) {
  const read = (k: string) => env[k]?.trim() ?? "";
  // على سيرفر Firebase الحساب جاهز، فالمفتاح الخاص يلزم بس للتشغيل من الحاسبة
  const needKey = !!(read(EMAIL) || read(KEY));
  return {
    projectId: read(PROJECT),
    clientEmail: read(EMAIL),
    // ملف .env يخزن المفتاح بسطر واحد
    privateKey: read(KEY).replace(/^"|"$/g, "").replace(/\\n/g, "\n"),
    storageBucket: read(BUCKET),
    missing: [PROJECT, ...(needKey ? [EMAIL, KEY] : []), BUCKET].filter((k) => !read(k)),
  };
}

function app() {
  if (getApps().length) return getApps()[0];
  const { missing, projectId, clientEmail, privateKey, storageBucket } = firebaseConfig();
  if (missing.length) throw new Error(`مفاتيح Firebase ناقصة: ${missing.join(", ")}`);
  return initializeApp({ projectId, storageBucket, ...(clientEmail ? { credential: cert({ projectId, clientEmail, privateKey }) } : {}) });
}
export const firestore = () => getFirestore(app());
export const bucket = () => getStorage(app()).bucket();
