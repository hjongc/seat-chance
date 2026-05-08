import assert from "node:assert/strict";
import test from "node:test";
import { recommendSeatPositions } from "../src/lib/recommendations";
import type { SeatChanceDataset } from "../src/lib/types";

const dataset: SeatChanceDataset = {
  stations: [
    "경복궁",
    "안국",
    "종로3가",
    "을지로3가",
    "충무로",
    "동대입구",
    "약수",
    "금호",
    "옥수",
    "압구정",
    "신사"
  ].map((stationName, index) => ({
    operator: "서울교통공사",
    lineNo: "3",
    stationCode: `T-${index + 1}`,
    stationName,
    sequenceNo: index + 1
  })),
  trainLayouts: [
    {
      operator: "서울교통공사",
      lineNo: "3",
      branchCode: "MAIN",
      direction: "오금",
      carCount: 4,
      doorsPerCar: 4,
      source: "test fixture",
      confidence: 0.9,
      validFrom: "2026-05-01",
      validTo: null
    }
  ],
  ridershipProfiles: [
    ["안국", 1000, 1200],
    ["종로3가", 2300, 5600],
    ["을지로3가", 2600, 4900],
    ["충무로", 2450, 5350],
    ["동대입구", 1050, 1350],
    ["약수", 1900, 2700],
    ["금호", 900, 980],
    ["옥수", 1350, 2300],
    ["압구정", 1850, 2850]
  ].map(([stationName, boardings, alightings]) => ({
    lineNo: "3",
    stationName: String(stationName),
    dayType: "WEEKDAY",
    timeSlot: "08:00",
    boardings: Number(boardings),
    alightings: Number(alightings),
    source: "test fixture",
    observedMonth: "2026-05-01"
  })),
  congestionProfiles: [
    {
      lineNo: "3",
      direction: "오금",
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      congestionPct: 140,
      source: "test fixture"
    }
  ],
  doorHints: [
    {
      kind: "transfer",
      lineNo: "3",
      stationName: "종로3가",
      direction: "오금",
      carNo: 2,
      doorNo: 3,
      weight: 1,
      description: "환승 동선",
      source: "test fixture",
      confidence: 0.8
    },
    {
      kind: "transfer",
      lineNo: "3",
      stationName: "충무로",
      direction: "오금",
      carNo: 4,
      doorNo: 1,
      weight: 0.95,
      description: "환승 동선",
      source: "test fixture",
      confidence: 0.8
    }
  ]
};

test("returns ranked seat turnover recommendations without probability wording", () => {
  const result = recommendSeatPositions(
    {
      origin: "경복궁",
      destination: "신사",
      lineNo: "3",
      direction: "오금",
      datetime: "2026-05-07T08:30:00+09:00",
      mode: "seat"
    },
    dataset
  );

  assert.equal(result.recommendations.length, 3);
  assert.deepEqual(
    result.recommendations.map((item) => item.rank),
    [1, 2, 3]
  );
  assert.ok(result.recommendations[0].score >= result.recommendations[1].score);
  assert.ok(result.recommendations.some((item) => item.car_no === 2 && item.door_no === 3));
  assert.match(result.cautions[0], /좌석각 점수는 실제 착석 확률이 아니라/);
  assert.doesNotMatch(JSON.stringify(result), /확률 \d+%/);
});

test("rejects reverse route when direction does not match station order", () => {
  assert.throws(
    () =>
      recommendSeatPositions(
        {
          origin: "신사",
          destination: "경복궁",
          lineNo: "3",
          direction: "오금",
          datetime: "2026-05-07T08:30:00+09:00",
          mode: "seat"
        },
        dataset
      ),
    /방향/
  );
});
