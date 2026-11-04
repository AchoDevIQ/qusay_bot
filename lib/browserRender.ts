// الرسم بمتصفح السيرفر. تشغيله المباشر من الأوامر يعلق على Firebase، فيتحكم بيه Puppeteer
import path from "node:path";
import puppeteer from "puppeteer-core";

export type RenderJob = { pdf: true } | { png: { w: number; h: number } };
const LIMIT_MS = 40_000;

export async function browserRender(executablePath: string, flags: string[], htmlPath: string, out: string, job: RenderJob) {
  const browser = await puppeteer.launch({ executablePath, args: flags, headless: "shell", timeout: LIMIT_MS });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(LIMIT_MS);
    if ("png" in job) await page.setViewport({ width: job.png.w, height: job.png.h, deviceScaleFactor: 2 });
    await page.goto("file:///" + path.resolve(htmlPath).replace(/\\/g, "/").replace(/^\/+/, ""), { waitUntil: "load" });
    if ("pdf" in job) await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true });
    else await page.screenshot({ path: out as `${string}.png` });
  } finally {
    await browser.close().catch(() => {});
  }
}
