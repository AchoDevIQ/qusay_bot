// ينسخ data/store.db إلى Firestore:  npm run copy-to-firestore
// إذا Firestore بيه بيانات يوقف، إلا إذا كتبت:  npm run copy-to-firestore -- --force
import { copyToFirestore } from "../lib/copyData.ts";
import { firestore } from "../lib/firebase.ts";
import type { FirestoreLike } from "../lib/firestoreDriver.ts";
import { all, sqliteDriver } from "../lib/sqliteDriver.ts";

await sqliteDriver.init();
const counts = await copyToFirestore((t) => all(`SELECT * FROM ${t}`), firestore as unknown as () => FirestoreLike, { force: process.argv.includes("--force") });
for (const [t, n] of Object.entries(counts)) if (n) console.log(`${t}: ${n}`);
console.log("✅ خلص النسخ");
process.exit(0);
