import { cachedJsonResponse, errorResponse } from "@/lib/api";
import { evaluateHealth, positiveNumber } from "@/lib/health";
import { getDataStatus } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getDataStatus();
    const health = evaluateHealth({
      status,
      maxAgeHours: positiveNumber(process.env.HEALTH_MAX_INGESTION_AGE_HOURS, 45 * 24),
      minStationRows: positiveNumber(process.env.HEALTH_MIN_STATION_ROWS, 500)
    });

    return cachedJsonResponse(
      {
        ok: health.ok,
        ready: status.ready,
        status: status.status,
        ingestion_fresh: health.ingestionFresh,
        station_coverage_ready: health.stationCoverageReady,
        max_ingestion_age_hours: health.maxAgeHours,
        min_station_rows: health.minStationRows,
        station_rows: status.counts.station_line_order ?? 0,
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
      { status: health.ok ? 200 : 503 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
