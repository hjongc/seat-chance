import { cachedJsonResponse, errorResponse } from "@/lib/api";
import { getDataStatus, getSeatChanceRepository } from "@/lib/repository";

export const runtime = "nodejs";

const cacheControl = "public, max-age=60, s-maxage=600, stale-while-revalidate=3600";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const requestedLineNo = params.get("line_no")?.trim() || "3";
    const status = await getDataStatus();

    if (!status.ready) {
      return cachedJsonResponse(
        {
          data_status: toDataStatusPayload(status),
          selected_line_no: requestedLineNo,
          lines: [],
          stations: []
        },
        "public, max-age=15, s-maxage=60, stale-while-revalidate=300"
      );
    }

    const repository = getSeatChanceRepository();
    const lines = await repository.getLines();
    const selectedLineNo = selectLineNo(lines, requestedLineNo);
    const stations = selectedLineNo ? await repository.getStations(selectedLineNo) : [];

    return cachedJsonResponse(
      {
        data_status: toDataStatusPayload(status),
        selected_line_no: selectedLineNo,
        lines: lines.map((line) => ({
          line_no: line.lineNo,
          station_count: line.stationCount
        })),
        stations: stations.map((station) => ({
          station_code: station.stationCode,
          station_name: station.stationName,
          sequence_no: station.sequenceNo
        }))
      },
      cacheControl
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function selectLineNo(lines: Array<{ lineNo: string }>, requestedLineNo: string) {
  if (lines.some((line) => line.lineNo === requestedLineNo)) {
    return requestedLineNo;
  }
  return lines[0]?.lineNo ?? "";
}

function toDataStatusPayload(status: Awaited<ReturnType<typeof getDataStatus>>) {
  return {
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
  };
}
