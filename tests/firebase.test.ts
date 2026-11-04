// مفاتيح Firebase: قراءتها، والناقص منها، وما تطلع قيمتها برسالة الخطأ
import { test } from "node:test";
import assert from "node:assert/strict";

const KEYS = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_STORAGE_BUCKET"];
for (const k of KEYS) delete process.env[k];
const { firebaseConfig, firestore } = await import("../lib/firebase.ts");

test("الناقص ينذكر بالأسماء", () => {
  assert.deepEqual(firebaseConfig({}).missing, KEYS);
  assert.deepEqual(firebaseConfig({ FIREBASE_PROJECT_ID: "p", FIREBASE_STORAGE_BUCKET: " " }).missing, ["FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_STORAGE_BUCKET"]);
});

test("المفتاح المكتوب بسطر واحد يرجع لأسطره", () => {
  const c = firebaseConfig({ FIREBASE_PRIVATE_KEY: '"-----BEGIN\\nabc\\n-----END\\n"' });
  assert.equal(c.privateKey, "-----BEGIN\nabc\n-----END\n");
});

test("بدون مفاتيح يطلع خطأ واضح بدون اتصال", () => {
  assert.throws(() => firestore(), /مفاتيح Firebase ناقصة: FIREBASE_PROJECT_ID/);
});
