import { errorResponse, parseDirection, parseMode, requiredParam } from "@/lib/api";
import { recommendSeatPositions } from "@/lib/recommendations";
import { getSeatChanceRepository } from "@/lib/repository";
import { toDayType, toTimeSlot } from "@/lib/time";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const lineNo = requiredParam(params, "line_no");
    const direction = parseDirection(requiredParam(params, "direction"));
    const datetime = requiredParam(params, "datetime");
    const input = {
      origin: requiredParam(params, "origin"),
      destination: requiredParam(params, "destination"),
      lineNo,
      direction,
      datetime,
      mode: parseMode(params.get("mode"))
    };
    const dataset = await getSeatChanceRepository().getDataset({
      lineNo,
      direction,
      dayType: toDayType(datetime),
      timeSlot: toTimeSlot(datetime)
    });

    return Response.json(recommendSeatPositions(input, dataset));
  } catch (error) {
    return errorResponse(error);
  }
}

