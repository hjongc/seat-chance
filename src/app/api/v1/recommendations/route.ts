import { cachedJsonResponse, errorResponse, parseMode, parseOptionalDirection, requiredParam } from "@/lib/api";
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
    const parsedDirection = parseOptionalDirection(params.get("direction"));
    const repository = getSeatChanceRepository();
    let direction: DirectionCode | undefined = parsedDirection;

    if (!direction) {
      const stations = await repository.getStations(lineNo);
      direction = inferDirection(stations, input.origin, input.destination);
    }

    const dataset = await repository.getDataset({
      lineNo,
      direction,
      dayType: toDayType(datetime),
      timeSlot: toTimeSlot(datetime)
    });
    const recommendation = recommendSeatPositions(
      {
        ...input,
        direction
      },
      dataset
    );
    const layout = dataset.trainLayouts.find(
      (candidate) => candidate.lineNo === lineNo && candidate.direction === direction
    );

    return cachedJsonResponse(
      {
        ...recommendation,
        train_layout: layout
          ? {
              line_no: layout.lineNo,
              direction: layout.direction,
              car_count: layout.carCount,
              doors_per_car: layout.doorsPerCar,
              source: layout.source,
              confidence: layout.confidence
            }
          : null
      },
      "public, max-age=60, s-maxage=600, stale-while-revalidate=3600"
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
