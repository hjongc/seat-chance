import assert from "node:assert/strict";
import test from "node:test";
import { errorResponse } from "../src/lib/api";

test("returns service unavailable for missing database configuration", async () => {
  const error = new Error("DB 연결 설정이 없어 추천 데이터를 읽을 수 없습니다.");
  error.name = "DataUnavailableError";

  const response = withSuppressedConsoleError(() => errorResponse(error));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error.message, "DB 연결 설정이 없어 추천 데이터를 읽을 수 없습니다.");
});

test("returns service unavailable for missing database tables", async () => {
  const error = Object.assign(new Error('relation "recommendation_cache" does not exist'), {
    code: "42P01"
  });

  const response = withSuppressedConsoleError(() => errorResponse(error));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error.message, "DB 스키마가 최신 상태가 아닙니다. 데이터베이스 초기화를 실행해주세요.");
});

function withSuppressedConsoleError<T>(callback: () => T) {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    return callback();
  } finally {
    console.error = originalConsoleError;
  }
}
