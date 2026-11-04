// مخزن الملفات: القرص و Cloud Storage يتصرفون نفس الشي
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cloudStore, localStore, type FileStore } from "../lib/files.ts";

function fakeBucket() {
  const saved = new Map<string, Buffer>();
  const state = {
    saved, lists: 0,
    bucket: () => ({
      file: (name: string) => ({
        download: async (): Promise<[Buffer]> => {
          const b = saved.get(name);
          if (!b) throw Object.assign(new Error("No such object"), { code: 404 });
          return [b];
        },
        save: async (body: Buffer) => { saved.set(name, body); },
      }),
      getFiles: async ({ prefix }: { prefix: string }): Promise<[{ name: string }[]]> => {
        state.lists++;
        return [[...saved.keys()].filter((n) => n.startsWith(prefix)).map((name) => ({ name }))];
      },
    }),
  };
  return state;
}

async function behaves(s: FileStore) {
  assert.equal(await s.read("ch1/e1/none.png"), null);
  assert.deepEqual(await s.list("ch9/"), []);
  await s.write("ch1/e1/A/q1.png", Buffer.from("one"), "image/png");
  await s.write("ch1/e2/A/q1.png", Buffer.from("two"), "image/png");
  await s.write("uploads/x.pdf", Buffer.from("three"), "application/pdf");
  assert.equal((await s.read("ch1/e2/A/q1.png"))!.toString(), "two");
  assert.deepEqual((await s.list("ch1/")).sort(), ["ch1/e1/A/q1.png", "ch1/e2/A/q1.png"]);
}

test("القرص", () => behaves(localStore(fs.mkdtempSync(path.join(os.tmpdir(), "qmath-files-")))));
test("Cloud Storage", () => behaves(cloudStore(fakeBucket().bucket as any)));

test("Cloud Storage: الملفات داخل content، والخطأ غير «مو موجود» ما ينبلع", async () => {
  const f = fakeBucket();
  await cloudStore(f.bucket as any).write("a.png", Buffer.from("x"), "image/png");
  assert.deepEqual([...f.saved.keys()], ["content/a.png"]);
  const broken = () => ({ file: () => ({ download: async () => { throw Object.assign(new Error("denied"), { code: 403 }); } }) });
  await assert.rejects(cloudStore(broken as any).read("a.png"), /denied/);
});

test("Cloud Storage: القائمة تنحفظ مؤقتاً، والرفع الجديد يبين بيها", async () => {
  const f = fakeBucket();
  let t = 0;
  const s = cloudStore(f.bucket as any, () => t);
  await s.list("ch1/");
  await s.list("ch1/");
  assert.equal(f.lists, 1);
  await s.write("ch1/new.png", Buffer.from("x"), "image/png");
  assert.deepEqual(await s.list("ch1/"), ["ch1/new.png"]);
  t += 5 * 60_000;
  await s.list("ch1/");
  assert.equal(f.lists, 3);
});
