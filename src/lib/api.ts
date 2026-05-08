import type { DirectionCode, RecommendationMode } from "./types";

export function parseDirection(value: string | null): DirectionCode {
  if (value === "오금" || value === "대화") {
    return value;
  }
  throw new ApiInputError("direction은 오금 또는 대화만 지원합니다.");
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

  return Response.json(
    {
      error: {
        message
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
