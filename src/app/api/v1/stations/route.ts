import { errorResponse, requiredParam } from "@/lib/api";
import { getSeatChanceRepository } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const lineNo = requiredParam(params, "line_no");
    const stations = await getSeatChanceRepository().getStations(lineNo);

    return Response.json({
      line_no: lineNo,
      stations: stations.map((station) => ({
        station_code: station.stationCode,
        station_name: station.stationName,
        sequence_no: station.sequenceNo
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}

