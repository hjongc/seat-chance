import {
  cachedJsonResponse,
  errorResponse,
  parseDayType,
  parseMode,
  parseOptionalDirection,
  parseTimeSlot,
  requiredParam
} from "@/lib/api";
import { inferDirectionName } from "@/lib/directions";
import { recommendSeatPositions } from "@/lib/recommendations";
import { getSeatChanceRepository } from "@/lib/repository";
import { toDayType, toTimeSlot } from "@/lib/time";
import { fallbackTrainLayout } from "@/lib/train-layout";
import type { DirectionCode } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const lineNo = requiredParam(params, "line_no");
    const { dayType, timeSlot } = parseRecommendationTimeInput(params);
    const input = {
      origin: requiredParam(params, "origin"),
      destination: requiredParam(params, "destination"),
      lineNo,
      dayType,
      timeSlot,
      mode: parseMode(params.get("mode"))
    };
    const parsedDirection = parseOptionalDirection(params.get("direction"));
    const repository = getSeatChanceRepository();
    let direction: DirectionCode | undefined = parsedDirection;

    if (!direction) {
      const stations = await repository.getStations(lineNo);
      direction = inferDirectionName(lineNo, stations, input.origin, input.destination);
    }

    const cacheKey = recommendationCacheKey({
      origin: input.origin,
      destination: input.destination,
      lineNo,
      direction,
      dayType,
      timeSlot
    });
    const cached = await repository.getCachedRecommendation(cacheKey, recommendationCacheTtlSeconds());
    if (cached) {
      return cachedJsonResponse(cached, "public, max-age=60, s-maxage=600, stale-while-revalidate=3600");
    }

    const dataset = await repository.getDataset({
      lineNo,
      direction,
      dayType,
      timeSlot
    });
    const recommendation = recommendSeatPositions(
      {
        ...input,
        direction
      },
      dataset
    );
    const layout =
      dataset.trainLayouts.find((candidate) => candidate.lineNo === lineNo && candidate.direction === direction) ??
      fallbackTrainLayout(lineNo, direction);

    const payload = {
      ...recommendation,
      train_layout: {
        line_no: layout.lineNo,
        direction: layout.direction,
        car_count: layout.carCount,
        doors_per_car: layout.doorsPerCar,
        source: layout.source,
        confidence: layout.confidence
      }
    };

    await repository.setCachedRecommendation({
      cacheKey,
      origin: input.origin,
      destination: input.destination,
      lineNo,
      direction,
      dayType,
      timeSlot,
      payload
    });

    return cachedJsonResponse(payload, "public, max-age=60, s-maxage=600, stale-while-revalidate=3600");
  } catch (error) {
    return errorResponse(error);
  }
}

function recommendationCacheTtlSeconds() {
  const ttl = Number(process.env.RECOMMENDATION_CACHE_TTL_SECONDS ?? 86400);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 86400;
}

function parseRecommendationTimeInput(params: URLSearchParams) {
  const hasExplicitTimeInput = params.has("day_type") || params.has("time_slot");
  if (hasExplicitTimeInput) {
    return {
      dayType: parseDayType(params.get("day_type")),
      timeSlot: parseTimeSlot(params.get("time_slot"))
    };
  }

  const datetime = requiredParam(params, "datetime");
  return {
    dayType: toDayType(datetime),
    timeSlot: toTimeSlot(datetime)
  };
}

function recommendationCacheKey({
  origin,
  destination,
  lineNo,
  direction,
  dayType,
  timeSlot
}: {
  origin: string;
  destination: string;
  lineNo: string;
  direction: DirectionCode;
  dayType: string;
  timeSlot: string;
}) {
  return ["seat-v11", lineNo, direction, dayType, timeSlot, origin, destination].join("|");
}
