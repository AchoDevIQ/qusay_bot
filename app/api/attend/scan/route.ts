import { scanUpload } from "../../../../lib/inPerson.ts";
import { apiResponse } from "../../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// صفحة وحدة من أوراق السكانر، بعد ما الصفحة قرت كودها
export const POST = (req: Request) => apiResponse(async () => await scanUpload(await req.formData()));
