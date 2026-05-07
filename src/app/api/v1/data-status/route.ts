import { errorResponse } from "@/lib/api";
import { getDataStatus } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await getDataStatus());
  } catch (error) {
    return errorResponse(error);
  }
}
