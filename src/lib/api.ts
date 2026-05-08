import type { DirectionCode, RecommendationMode } from "./types";

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
  const status = error instanceof ApiInputError || errorName === "RecommendationInputError" ? 400 : 500;
  if (status >= 500) {
    console.error(error);
  }

  return Response.json(
    {
      error: {
        message: status >= 500 ? "서버에서 요청을 처리하지 못했습니다." : message
      }
    },
    { status }
  );
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
