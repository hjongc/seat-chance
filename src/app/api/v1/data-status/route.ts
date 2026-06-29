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
          : null,
        last_successful_ingestion: status.lastSuccessfulIngestion
          ? {
              source_name: status.lastSuccessfulIngestion.sourceName,
              row_count: status.lastSuccessfulIngestion.rowCount,
              finished_at: status.lastSuccessfulIngestion.finishedAt
            }
          : null,
        line_coverage: status.lineCoverage.map((line) => ({
          line_no: line.lineNo,
          station_rows: line.stationRows,
          raw_station_rows: line.rawStationRows,
          ridership_rows: line.ridershipRows,
          train_layout_rows: line.trainLayoutRows,
          estimated_train_layout: line.estimatedTrainLayout,
          congestion_rows: line.congestionRows,
          door_hint_rows: line.doorHintRows,
          station_congestion_rows: line.stationCongestionRows,
          transfer_demand_rows: line.transferDemandRows,
          missing_recommendation_inputs: line.missingRecommendationInputs,
          quality_warnings: line.qualityWarnings,
          recommendable: line.recommendable
        })),
        recommendable_line_count: status.lineCoverage.filter((line) => line.recommendable).length
      },
      "public, max-age=15, s-maxage=60, stale-while-revalidate=300"
    );
  } catch (error) {
    return errorResponse(error);
  }
}
