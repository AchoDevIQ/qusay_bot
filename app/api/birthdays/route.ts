import { birthdayAction } from "../../../lib/birthdays.ts";
import { apiResponse } from "../../../lib/webApi.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => apiResponse(async () => await birthdayAction(await req.json()));
