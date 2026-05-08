import { cachedJsonResponse, errorResponse } from "@/lib/api";
import { getDataStatus } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getDataStatus();

    return cachedJsonResponse(
      {
        ready: status.ready,
        status: status.status,
        message: status.message,
        last_ingestion: status.lastIngestion
          ? {
              source_name: status.lastIngestion.sourceName,
              status: status.lastIngestion.status,
              finished_at: status.lastIngestion.finishedAt
            }
          : null
      },
      "public, max-age=15, s-maxage=60, stale-while-revalidate=300"
    );
  } catch (error) {
    return errorResponse(error);
  }
}
