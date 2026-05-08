import { cachedJsonResponse, errorResponse, requiredParam } from "@/lib/api";
import { getSeatChanceRepository } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const lineNo = requiredParam(params, "line_no");
    const stations = await getSeatChanceRepository().getStations(lineNo);

    return cachedJsonResponse(
      {
        line_no: lineNo,
        stations: stations.map((station) => ({
          station_code: station.stationCode,
          station_name: station.stationName,
          sequence_no: station.sequenceNo
        }))
      },
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
    );
  } catch (error) {
    return errorResponse(error);
  }
}
