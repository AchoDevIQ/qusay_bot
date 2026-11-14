// مخزن ملفات الامتحانات: Cloud Storage إذا اكو FIREBASE_STORAGE_BUCKET، وإلا مجلد المحتوى على القرص
import fs from "node:fs";
import path from "node:path";
import { CONTENT_DIR } from "./config.ts";
import { bucket } from "./firebase.ts";

export type FileStore = {
  read(ref: string): Promise<Buffer | null>;
  write(ref: string, body: Buffer, type: string): Promise<void>;
  /** كل الملفات تحت مجلد، بأسمائها الكاملة */
  list(prefix: string, fresh?: boolean): Promise<string[]>;
};

/** المسار الكامل لملف داخل المجلد، أو null إذا الاسم يطلع برّا المجلد ("../x"، "..\x"، مسار كامل).
 *  الشرطة المعكوسة تنحسب فاصل على كل نظام: على لينكس هي حرف عادي، فبدون هذا الفحص يعدّي "..\x" */
export function insideRoot(root: string, ref: string): string | null {
  const base = path.resolve(root);
  const full = path.resolve(base, String(ref ?? "").replace(/\\/g, "/"));
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

export function localStore(root: string): FileStore {
  return {
    async read(ref) {
      const f = insideRoot(root, ref);
      return f && fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f) : null;
    },
    async write(ref, body) {
      const f = insideRoot(root, ref);
      if (!f) throw new Error("ملف برّا مجلد المحتوى");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    },
    async list(prefix) {
      const dir = insideRoot(root, prefix);
      if (!dir || !fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
        .map((e) => path.relative(root, path.join(e.parentPath, e.name)).replace(/\\/g, "/"));
    },
  };
}

type Bucket = {
  file(name: string): { download(): Promise<[Buffer]>; save(body: Buffer, o: { contentType: string; resumable: boolean }): Promise<unknown> };
  getFiles(o: { prefix: string }): Promise<[{ name: string }[], ...unknown[]]>;
};
const CLOUD_ROOT = "content/";
const LIST_TTL = 5 * 60_000;

export function cloudStore(getBucket: () => Bucket, now = Date.now): FileStore {
  // القائمة تنطلب مع كل عرض لصفحة الامتحانات، وصور الصفحات ما تتغير من اللوحة
  const lists = new Map<string, { at: number; names: string[] }>();
  return {
    async read(ref) {
      try {
        return (await getBucket().file(CLOUD_ROOT + ref).download())[0];
      } catch (e: any) {
        if (e?.code === 404) return null;
        throw e;
      }
    },
    async write(ref, body, type) {
      await getBucket().file(CLOUD_ROOT + ref).save(body, { contentType: type, resumable: false });
      lists.clear();
    },
    async list(prefix, fresh) {
      const hit = fresh ? undefined : lists.get(prefix);
      if (hit && now() - hit.at < LIST_TTL) return hit.names;
      const [files] = await getBucket().getFiles({ prefix: CLOUD_ROOT + prefix });
      const names = files.map((f) => f.name.slice(CLOUD_ROOT.length));
      lists.set(prefix, { at: now(), names });
      return names;
    },
  };
}

let store: FileStore | null = null;
export function files(): FileStore {
  store ??= process.env.FIREBASE_STORAGE_BUCKET?.trim() ? cloudStore(bucket as unknown as () => Bucket) : localStore(CONTENT_DIR);
  return store;
}
