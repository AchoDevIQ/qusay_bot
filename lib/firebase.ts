// الاتصال بـ Firestore و Cloud Storage. المفاتيح من .env.local بس، وما ينفتح اتصال لحد ما ينطلب
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const FIELDS = { projectId: "FIREBASE_PROJECT_ID", clientEmail: "FIREBASE_CLIENT_EMAIL", privateKey: "FIREBASE_PRIVATE_KEY", storageBucket: "FIREBASE_STORAGE_BUCKET" } as const;

/** يقرا المفاتيح ويرجع أسماء الناقصة. أسماء بس، حتى قيمة المفتاح ما تطلع بأي رسالة خطأ */
export function firebaseConfig(env: Record<string, string | undefined> = process.env) {
  const read = (k: string) => env[k]?.trim() ?? "";
  return {
    projectId: read(FIELDS.projectId),
    clientEmail: read(FIELDS.clientEmail),
    // ملف .env يخزن المفتاح بسطر واحد
    privateKey: read(FIELDS.privateKey).replace(/^"|"$/g, "").replace(/\\n/g, "\n"),
    storageBucket: read(FIELDS.storageBucket),
    missing: Object.values(FIELDS).filter((k) => !read(k)),
  };
}

function app() {
  if (getApps().length) return getApps()[0];
  const { missing, storageBucket, ...credential } = firebaseConfig();
  if (missing.length) throw new Error(`مفاتيح Firebase ناقصة: ${missing.join(", ")}`);
  return initializeApp({ credential: cert(credential), storageBucket });
}
export const firestore = () => getFirestore(app());
export const bucket = () => getStorage(app()).bucket();
