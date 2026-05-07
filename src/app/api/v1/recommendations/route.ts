import { errorResponse, parseMode, parseOptionalDirection, requiredParam } from "@/lib/api";
import { recommendSeatPositions } from "@/lib/recommendations";
import { getSeatChanceRepository } from "@/lib/repository";
import { RecommendationInputError, toDayType, toTimeSlot } from "@/lib/time";
import type { DirectionCode } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const lineNo = requiredParam(params, "line_no");
    const datetime = requiredParam(params, "datetime");
    const input = {
      origin: requiredParam(params, "origin"),
      destination: requiredParam(params, "destination"),
      lineNo,
      datetime,
      mode: parseMode(params.get("mode"))
    };
    const repository = getSeatChanceRepository();
    const stations = await repository.getStations(lineNo);
    const inferredDirection = inferDirection(stations, input.origin, input.destination);
    const parsedDirection = parseOptionalDirection(params.get("direction"));
    const direction: DirectionCode =
      parsedDirection ??
      inferredDirection ??
      (() => {
        throw new RecommendationInputError("direction 또는 탑승역/내릴역으로 방향을 확인할 수 없습니다.");
      })();

    if (parsedDirection && parsedDirection !== inferredDirection) {
      throw new RecommendationInputError("direction이 탑승역/내릴역 순서와 일치하지 않습니다.");
    }

    const dataset = await repository.getDataset({
      lineNo,
      direction,
      dayType: toDayType(datetime),
      timeSlot: toTimeSlot(datetime)
    });
    return Response.json(
      recommendSeatPositions(
        {
          ...input,
          direction
        },
        dataset
      )
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function inferDirection(
  stations: Array<{ stationName: string; sequenceNo: number }>,
  origin: string,
  destination: string
) {
  const originStation = stations.find((station) => station.stationName === origin);
  const destinationStation = stations.find((station) => station.stationName === destination);

  if (!originStation || !destinationStation) {
    throw new RecommendationInputError("선택한 역이 해당 노선 데이터에 없습니다.");
  }
  if (originStation.sequenceNo === destinationStation.sequenceNo) {
    throw new RecommendationInputError("탑승역과 내릴역은 서로 달라야 합니다.");
  }

  return originStation.sequenceNo < destinationStation.sequenceNo ? "오금" : "대화";
}
