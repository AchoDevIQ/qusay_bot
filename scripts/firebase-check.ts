// يتأكد إن مفاتيح Firebase تشتغل:  npm run firebase-check
// يكتب ملف وسجل تجريبي، يقراهم، ويمسحهم. ما يلمس بيانات البوت
import { bucket, firestore } from "../lib/firebase.ts";

const NAME = "_setup_check";
const VALUE = String(Date.now());

const doc = firestore().collection(NAME).doc("check");
await doc.set({ value: VALUE });
const saved = (await doc.get()).data()?.value;
await doc.delete();
if (saved !== VALUE) throw new Error("Firestore ما رجع نفس القيمة");
console.log("✅ Firestore يشتغل");

const file = bucket().file(`${NAME}.txt`);
await file.save(VALUE);
const [content] = await file.download();
await file.delete();
if (content.toString() !== VALUE) throw new Error("Cloud Storage ما رجع نفس القيمة");
console.log("✅ Cloud Storage يشتغل");
process.exit(0);
