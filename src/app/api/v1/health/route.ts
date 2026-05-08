import { cachedJsonResponse, errorResponse } from "@/lib/api";
import { getDataStatus } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getDataStatus();
    const lastFinishedAt = status.lastSuccessfulIngestion?.finishedAt
      ? new Date(status.lastSuccessfulIngestion.finishedAt).getTime()
      : 0;
    const maxAgeHours = Number(process.env.HEALTH_MAX_INGESTION_AGE_HOURS ?? 48);
    const ingestionFresh =
      lastFinishedAt > 0 && Date.now() - lastFinishedAt <= maxAgeHours * 60 * 60 * 1000;
    const ok = status.ready && ingestionFresh;

    return cachedJsonResponse(
      {
        ok,
        ready: status.ready,
        status: status.status,
        ingestion_fresh: ingestionFresh,
        max_ingestion_age_hours: maxAgeHours,
        last_ingestion: status.lastIngestion
          ? {
              source_name: status.lastIngestion.sourceName,
              status: status.lastIngestion.status,
              finished_at: status.lastIngestion.finishedAt
            }
          : null,
        last_successful_ingestion: status.lastSuccessfulIngestion
          ? {
              source_name: status.lastSuccessfulIngestion.sourceName,
              row_count: status.lastSuccessfulIngestion.rowCount,
              finished_at: status.lastSuccessfulIngestion.finishedAt
            }
          : null
      },
      "public, max-age=15, s-maxage=60, stale-while-revalidate=300",
      { status: ok ? 200 : 503 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
