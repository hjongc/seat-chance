import type { DayType, DirectionCode, RecommendationMode } from "./types";

export function parseDirection(value: string | null): DirectionCode {
  const direction = value?.trim() ?? "";
  if (direction && direction.length <= 40 && !/[\u0000-\u001f\u007f]/.test(direction)) {
    return direction;
  }
  throw new ApiInputError("direction 값이 올바르지 않습니다.");
}

export function parseOptionalDirection(value: string | null): DirectionCode | undefined {
  if (!value || value.trim() === "") {
    return undefined;
  }
  return parseDirection(value);
}

export function parseMode(value: string | null): RecommendationMode {
  if (!value || value === "seat") {
    return "seat";
  }
  throw new ApiInputError("mode는 seat만 지원합니다.");
}

export function parseDayType(value: string | null): DayType {
  if (value === "WEEKDAY" || value === "WEEKEND") {
    return value;
  }
  throw new ApiInputError("day_type 값은 WEEKDAY 또는 WEEKEND여야 합니다.");
}

export function parseTimeSlot(value: string | null): string {
  const timeSlot = value?.trim() ?? "";
  if (/^([01][0-9]|2[0-3]):(00|30)$/.test(timeSlot)) {
    return timeSlot;
  }
  throw new ApiInputError("time_slot 값은 HH:00 또는 HH:30 형식이어야 합니다.");
}

export function requiredParam(params: URLSearchParams, key: string): string {
  const value = params.get(key)?.trim();
  if (!value) {
    throw new ApiInputError(`${key} query parameter is required.`);
  }
  return value;
}

export class ApiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiInputError";
  }
}

export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const errorName = error instanceof Error ? error.name : "";
  const errorCode = errorCodeOf(error);
  const isInputError = error instanceof ApiInputError || errorName === "RecommendationInputError";
  const isDataUnavailableError = errorName === "DataUnavailableError";
  const isMissingTableError = errorCode === "42P01";
  const status = isInputError ? 400 : isDataUnavailableError || isMissingTableError ? 503 : 500;
  if (status >= 500) {
    console.error(error);
  }

  return Response.json(
    {
      error: {
        message: errorMessageForStatus({ status, message, isDataUnavailableError, isMissingTableError })
      }
    },
    { status }
  );
}

function errorCodeOf(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

function errorMessageForStatus({
  status,
  message,
  isDataUnavailableError,
  isMissingTableError
}: {
  status: number;
  message: string;
  isDataUnavailableError: boolean;
  isMissingTableError: boolean;
}) {
  if (status < 500) {
    return message;
  }
  if (isDataUnavailableError) {
    return message;
  }
  if (isMissingTableError) {
    return "DB 스키마가 최신 상태가 아닙니다. 데이터베이스 초기화를 실행해주세요.";
  }
  return "서버에서 요청을 처리하지 못했습니다.";
}

export function cachedJsonResponse(body: unknown, cacheControl: string, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", cacheControl);
  headers.set("CDN-Cache-Control", cacheControl);
  headers.set("Vercel-CDN-Cache-Control", cacheControl);

  return Response.json(body, {
    ...init,
    headers
  });
}
