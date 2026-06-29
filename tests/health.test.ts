import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHealth, positiveNumber } from "../src/lib/health";
import type { DataStatus } from "../src/lib/repository";

const readyStatus: DataStatus = {
  ready: true,
  status: "READY",
  message: "ready",
  counts: {
    station_line_order: 743,
    train_layout: 10,
    ridership_profile: 100,
    congestion_profile: 10,
    transfer_door: 10,
    exit_or_facility_door: 10
  },
  lineCoverage: [],
  lastIngestion: null,
  lastSuccessfulIngestion: {
    sourceName: "서울 열린데이터광장 CardSubwayTime",
    rowCount: 100,
    finishedAt: "2026-05-08T00:00:00.000Z"
  }
};

test("health freshness default matches monthly ingestion cadence", () => {
  const result = evaluateHealth({
    status: readyStatus,
    now: new Date("2026-05-11T00:00:00.000Z").getTime()
  });

  assert.equal(result.ok, true);
  assert.equal(result.maxAgeHours, 45 * 24);
  assert.equal(result.ingestionFresh, true);
});

test("health fails when station coverage is below production threshold", () => {
  const result = evaluateHealth({
    status: {
      ...readyStatus,
      counts: {
        ...readyStatus.counts,
        station_line_order: 485
      }
    },
    now: new Date("2026-05-11T00:00:00.000Z").getTime()
  });

  assert.equal(result.ok, false);
  assert.equal(result.stationCoverageReady, false);
});

test("positiveNumber rejects missing or non-positive values", () => {
  assert.equal(positiveNumber(undefined, 12), 12);
  assert.equal(positiveNumber("0", 12), 12);
  assert.equal(positiveNumber("24", 12), 24);
});
