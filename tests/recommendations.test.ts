import assert from "node:assert/strict";
import test from "node:test";
import { recommendSeatPositions } from "../src/lib/recommendations";
import {
  currentKoreaDateInputValue,
  currentKoreaDayType,
  dayTypeForKoreaDateInputValue,
  isKoreanPublicHoliday
} from "../src/lib/day-type";
import { toDayType, toTimeSlot } from "../src/lib/time";
import type { SeatChanceDataset } from "../src/lib/types";

const dataset: SeatChanceDataset = {
  stations: [
    "대화",
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
    "신사",
    "오금"
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
  stationCongestionProfiles: [],
  transferDemandProfiles: [],
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
      dayType: "WEEKDAY",
      timeSlot: "08:30",
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
  assert.match(result.cautions[0], /앉을각 점수는 실제 착석 확률이 아니라/);
  assert.doesNotMatch(JSON.stringify(result), /확률 \d+%/);
});

test("applies a meaningful penalty during heavier congestion windows", () => {
  const congestedResult = recommendSeatPositions(
    {
      origin: "경복궁",
      destination: "신사",
      lineNo: "3",
      direction: "오금",
      dayType: "WEEKDAY",
      timeSlot: "08:30",
      mode: "seat"
    },
    dataset
  );
  const lighterDataset: SeatChanceDataset = {
    ...dataset,
    congestionProfiles: [
      {
        lineNo: "3",
        direction: "오금",
        dayType: "WEEKDAY",
        timeSlot: "08:00",
        congestionPct: 100,
        source: "test fixture"
      }
    ]
  };
  const lighterResult = recommendSeatPositions(
    {
      origin: "경복궁",
      destination: "신사",
      lineNo: "3",
      direction: "오금",
      dayType: "WEEKDAY",
      timeSlot: "08:30",
      mode: "seat"
    },
    lighterDataset
  );

  assert.equal(congestedResult.recommendations[0].car_no, lighterResult.recommendations[0].car_no);
  assert.equal(congestedResult.recommendations[0].door_no, lighterResult.recommendations[0].door_no);
  assert.ok(lighterResult.recommendations[0].score - congestedResult.recommendations[0].score >= 8);
  assert.ok(congestedResult.recommendations[0].score < 75);
});

test("supports limited recommendations when only estimated layout and no congestion are available", () => {
  const limitedDataset: SeatChanceDataset = {
    stations: ["개화", "김포공항", "마곡나루", "당산", "여의도"].map((stationName, index) => ({
      operator: "서울시메트로9호선",
      lineNo: "9",
      stationCode: `9-${index + 1}`,
      stationName,
      sequenceNo: index + 1
    })),
    trainLayouts: [],
    ridershipProfiles: [
      ["김포공항", 1200, 2100],
      ["마곡나루", 900, 1800],
      ["당산", 700, 3400]
    ].map(([stationName, boardings, alightings]) => ({
      lineNo: "9",
      stationName: String(stationName),
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      boardings: Number(boardings),
      alightings: Number(alightings),
      source: "test fixture",
      observedMonth: "2026-05-01"
    })),
    congestionProfiles: [],
    stationCongestionProfiles: [],
    transferDemandProfiles: [],
    doorHints: [
      {
        kind: "transfer",
        lineNo: "9",
        stationName: "당산",
        direction: "여의도",
        carNo: 6,
        doorNo: 4,
        weight: 1,
        description: "환승 동선",
        source: "test fixture",
        confidence: 0.8
      }
    ]
  };

  const result = recommendSeatPositions(
    {
      origin: "개화",
      destination: "여의도",
      lineNo: "9",
      direction: "여의도",
      dayType: "WEEKDAY",
      timeSlot: "08:30",
      mode: "seat"
    },
    limitedDataset
  );

  assert.equal(result.recommendations.length, 3);
  assert.ok(result.recommendations.some((item) => item.car_no === 6 && item.door_no === 4));
  assert.match(result.cautions.join(" "), /열차 편성은 .*추정/);
  assert.match(result.cautions.join(" "), /혼잡도 데이터가 없어/);
});

test("describes exact and nearby door recommendations differently", () => {
  const doorDataset: SeatChanceDataset = {
    stations: ["출발", "환승역", "도착"].map((stationName, index) => ({
      operator: "서울교통공사",
      lineNo: "8",
      stationCode: `L8-${index + 1}`,
      stationName,
      sequenceNo: index + 1
    })),
    trainLayouts: [
      {
        operator: "서울교통공사",
        lineNo: "8",
        branchCode: "MAIN",
        direction: "도착",
        carCount: 1,
        doorsPerCar: 4,
        source: "test fixture",
        confidence: 0.9,
        validFrom: "2026-05-01",
        validTo: null
      }
    ],
    ridershipProfiles: [
      {
        lineNo: "8",
        stationName: "환승역",
        dayType: "WEEKDAY",
        timeSlot: "08:00",
        boardings: 100,
        alightings: 4000,
        source: "test fixture",
        observedMonth: "2026-05-01"
      }
    ],
    congestionProfiles: [],
    stationCongestionProfiles: [],
    transferDemandProfiles: [],
    doorHints: [
      {
        kind: "transfer",
        lineNo: "8",
        stationName: "환승역",
        direction: "도착",
        carNo: 1,
        doorNo: 2,
        weight: 1,
        description: "환승 동선",
        source: "test fixture",
        confidence: 0.8
      }
    ]
  };

  const result = recommendSeatPositions(
    {
      origin: "출발",
      destination: "도착",
      lineNo: "8",
      direction: "도착",
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      mode: "seat"
    },
    doorDataset
  );

  const exactDoor = result.recommendations.find((item) => item.car_no === 1 && item.door_no === 2);
  const nearbyDoor = result.recommendations.find((item) => item.car_no === 1 && item.door_no !== 2);

  assert.ok(exactDoor);
  assert.ok(nearbyDoor);
  assert.match(exactDoor!.reasons[0], /직접 맞아/);
  assert.match(nearbyDoor!.reasons[0], /한 문 거리/);
  assert.notEqual(exactDoor!.reasons[0], nearbyDoor!.reasons[0]);
  assert.doesNotMatch(JSON.stringify(result.recommendations), /좌석각이 생길/);
});

test("rounds departure time up to the next half-hour slot", () => {
  assert.equal(toTimeSlot("2026-05-07T10:00:00+09:00"), "10:00");
  assert.equal(toTimeSlot("2026-05-07T10:10:00+09:00"), "10:30");
  assert.equal(toTimeSlot("2026-05-07T10:30:00+09:00"), "10:30");
  assert.equal(toTimeSlot("2026-05-07T23:50:00+09:00"), "23:30");
});

test("uses Korea time for offset datetimes", () => {
  assert.equal(toTimeSlot("2026-05-08T01:10:00Z"), "10:30");
  assert.equal(toDayType("2026-05-08T01:10:00Z"), "WEEKDAY");
});

test("treats Korean public holidays as weekend day type", () => {
  assert.equal(currentKoreaDayType(new Date("2026-04-30T15:10:00Z")), "WEEKEND");
  assert.equal(toDayType("2026-05-01T08:00:00+09:00"), "WEEKEND");
  assert.equal(toDayType("2026-05-05T08:00:00+09:00"), "WEEKEND");
  assert.equal(toDayType("2026-07-17T08:00:00+09:00"), "WEEKEND");
});

test("derives automatic day type from Korean date input values", () => {
  assert.equal(currentKoreaDateInputValue(new Date("2026-06-28T15:10:00Z")), "2026-06-29");
  assert.equal(dayTypeForKoreaDateInputValue("2026-06-29"), "WEEKDAY");
  assert.equal(dayTypeForKoreaDateInputValue("2026-06-28"), "WEEKEND");
  assert.equal(dayTypeForKoreaDateInputValue("2026-05-01"), "WEEKEND");
});

test("supports substitute holidays for modern supplemental Korean holidays", () => {
  assert.equal(isKoreanPublicHoliday(2027, 5, 3), true);
  assert.equal(isKoreanPublicHoliday(2027, 7, 19), true);
});

test("supports non-line-3 terminal directions with fallback layout", () => {
  const lineOneDataset: SeatChanceDataset = {
    ...dataset,
    stations: ["연천", "의정부", "서울역", "신창"].map((stationName, index) => ({
      operator: "서울교통공사",
      lineNo: "1",
      stationCode: `L1-${index + 1}`,
      stationName,
      sequenceNo: index + 1
    })),
    trainLayouts: [],
    congestionProfiles: [],
    doorHints: [],
    ridershipProfiles: [
      ["의정부", 500, 1300],
      ["서울역", 800, 2100]
    ].map(([stationName, boardings, alightings]) => ({
      lineNo: "1",
      stationName: String(stationName),
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      boardings: Number(boardings),
      alightings: Number(alightings),
      source: "test fixture",
      observedMonth: "2026-05-01"
    }))
  };

  const result = recommendSeatPositions(
    {
      origin: "연천",
      destination: "신창",
      lineNo: "1",
      direction: "신창",
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      mode: "seat"
    },
    lineOneDataset
  );

  assert.equal(result.line_no, "1");
  assert.equal(result.direction, "신창");
  assert.equal(result.recommendations.length, 3);
  assert.equal(result.recommendations[0].score, 0);
  assert.equal(result.recommendations[0].expected_seat_window, "데이터 부족");
});

test("returns data-shortage recommendations when ridership data is unavailable", () => {
  const result = recommendSeatPositions(
    {
      origin: "경복궁",
      destination: "신사",
      lineNo: "3",
      direction: "오금",
      dayType: "WEEKDAY",
      timeSlot: "08:30",
      mode: "seat"
    },
    {
      ...dataset,
      ridershipProfiles: []
    }
  );

  assert.equal(result.time_slot, "08:30");
  assert.equal(result.recommendations.length, 3);
  assert.deepEqual(
    result.recommendations.map((item) => item.score),
    [0, 0, 0]
  );
  assert.equal(result.recommendations[0].expected_seat_window, "데이터 부족");
  assert.match(result.recommendations[0].reasons[0], /승하차 시간대 데이터가 없어/);
});

test("uses transfer passenger demand when transfer alightings are low", () => {
  const transferDataset: SeatChanceDataset = {
    stations: ["출발", "일반역", "환승역", "도착"].map((stationName, index) => ({
      operator: "서울교통공사",
      lineNo: "5",
      stationCode: `L5-${index + 1}`,
      stationName,
      sequenceNo: index + 1
    })),
    trainLayouts: [
      {
        operator: "서울교통공사",
        lineNo: "5",
        branchCode: "MAIN",
        direction: "도착",
        carCount: 2,
        doorsPerCar: 4,
        source: "test fixture",
        confidence: 0.9,
        validFrom: "2026-05-01",
        validTo: null
      }
    ],
    ridershipProfiles: [
      ["일반역", 400, 5000],
      ["환승역", 900, 120]
    ].map(([stationName, boardings, alightings]) => ({
      lineNo: "5",
      stationName: String(stationName),
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      boardings: Number(boardings),
      alightings: Number(alightings),
      source: "test fixture",
      observedMonth: "2026-05-01"
    })),
    congestionProfiles: [],
    stationCongestionProfiles: [],
    transferDemandProfiles: [
      {
        lineNo: "5",
        stationName: "환승역",
        dayType: "WEEKDAY",
        transferPassengers: 180000,
        source: "test fixture",
        observedOn: "2026-03-31"
      }
    ],
    doorHints: [
      {
        kind: "transfer",
        lineNo: "5",
        stationName: "환승역",
        direction: "도착",
        carNo: 2,
        doorNo: 3,
        weight: 1,
        description: "환승 동선",
        source: "test fixture",
        confidence: 0.8
      }
    ]
  };

  const result = recommendSeatPositions(
    {
      origin: "출발",
      destination: "도착",
      lineNo: "5",
      direction: "도착",
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      mode: "seat"
    },
    transferDataset
  );

  assert.equal(result.recommendations[0].car_no, 2);
  assert.equal(result.recommendations[0].door_no, 3);
  assert.ok(result.recommendations[0].reasons.some((reason) => reason.includes("환승인원")));
});

test("discounts seat turnover at highly crowded intermediate stations", () => {
  const crowdingDataset: SeatChanceDataset = {
    stations: ["출발", "혼잡역", "한산역", "도착"].map((stationName, index) => ({
      operator: "서울교통공사",
      lineNo: "6",
      stationCode: `L6-${index + 1}`,
      stationName,
      sequenceNo: index + 1
    })),
    trainLayouts: [
      {
        operator: "서울교통공사",
        lineNo: "6",
        branchCode: "MAIN",
        direction: "도착",
        carCount: 2,
        doorsPerCar: 4,
        source: "test fixture",
        confidence: 0.9,
        validFrom: "2026-05-01",
        validTo: null
      }
    ],
    ridershipProfiles: ["혼잡역", "한산역"].map((stationName) => ({
      lineNo: "6",
      stationName,
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      boardings: 100,
      alightings: 4000,
      source: "test fixture",
      observedMonth: "2026-05-01"
    })),
    congestionProfiles: [],
    stationCongestionProfiles: [
      {
        lineNo: "6",
        stationName: "혼잡역",
        direction: "도착",
        dayType: "WEEKDAY",
        timeSlot: "08:00",
        congestionPct: 190,
        source: "test fixture"
      },
      {
        lineNo: "6",
        stationName: "한산역",
        direction: "도착",
        dayType: "WEEKDAY",
        timeSlot: "08:00",
        congestionPct: 70,
        source: "test fixture"
      }
    ],
    transferDemandProfiles: [],
    doorHints: [
      {
        kind: "facility",
        lineNo: "6",
        stationName: "혼잡역",
        direction: "도착",
        carNo: 1,
        doorNo: 2,
        weight: 1,
        description: "빠른하차 동선",
        source: "test fixture",
        confidence: 0.8
      },
      {
        kind: "facility",
        lineNo: "6",
        stationName: "한산역",
        direction: "도착",
        carNo: 2,
        doorNo: 3,
        weight: 1,
        description: "빠른하차 동선",
        source: "test fixture",
        confidence: 0.8
      }
    ]
  };

  const result = recommendSeatPositions(
    {
      origin: "출발",
      destination: "도착",
      lineNo: "6",
      direction: "도착",
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      mode: "seat"
    },
    crowdingDataset
  );

  assert.equal(result.recommendations[0].car_no, 2);
  assert.equal(result.recommendations[0].door_no, 3);
  assert.ok(result.recommendations[0].reasons.some((reason) => reason.includes("혼잡도")));
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
          dayType: "WEEKDAY",
          timeSlot: "08:30",
          mode: "seat"
        },
        dataset
      ),
    /방향/
  );
});

test("supports line 2 circular routes across the sequence boundary", () => {
  const lineTwoDataset: SeatChanceDataset = {
    stations: ["시청", "을지로입구", "을지로3가", "신당", "충정로"].map((stationName, index) => ({
      operator: "서울교통공사",
      lineNo: "2",
      stationCode: `L2-${index + 1}`,
      stationName,
      sequenceNo: index + 1
    })),
    trainLayouts: [
      {
        operator: "서울교통공사",
        lineNo: "2",
        branchCode: "MAIN",
        direction: "내선",
        carCount: 1,
        doorsPerCar: 4,
        source: "test fixture",
        confidence: 0.9,
        validFrom: "2026-05-01",
        validTo: null
      }
    ],
    ridershipProfiles: [
      {
        lineNo: "2",
        stationName: "시청",
        dayType: "WEEKDAY",
        timeSlot: "08:00",
        boardings: 200,
        alightings: 1200,
        source: "test fixture",
        observedMonth: "2026-05-01"
      }
    ],
    congestionProfiles: [
      {
        lineNo: "2",
        direction: "내선",
        dayType: "WEEKDAY",
        timeSlot: "08:00",
        congestionPct: 120,
        source: "test fixture"
      }
    ],
    stationCongestionProfiles: [],
    transferDemandProfiles: [],
    doorHints: []
  };

  const result = recommendSeatPositions(
    {
      origin: "충정로",
      destination: "을지로입구",
      lineNo: "2",
      direction: "내선",
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      mode: "seat"
    },
    lineTwoDataset
  );

  assert.equal(result.direction, "내선");
  assert.equal(result.recommendations.length, 3);
});

test("caps line 2 recommendations when seat signals are only near the destination", () => {
  const stations = [
    "신도림",
    "대림",
    "구로디지털단지",
    "신대방",
    "신림",
    "봉천",
    "서울대입구",
    "낙성대",
    "사당",
    "방배",
    "서초",
    "교대",
    "강남",
    "역삼",
    "선릉"
  ];
  const lineTwoDataset: SeatChanceDataset = {
    stations: stations.map((stationName, index) => ({
      operator: "서울교통공사",
      lineNo: "2",
      stationCode: `L2-${index + 1}`,
      stationName,
      sequenceNo: index + 1
    })),
    trainLayouts: [
      {
        operator: "서울교통공사",
        lineNo: "2",
        branchCode: "MAIN",
        direction: "내선",
        carCount: 2,
        doorsPerCar: 4,
        source: "test fixture",
        confidence: 0.9,
        validFrom: "2026-05-01",
        validTo: null
      }
    ],
    ridershipProfiles: [
      ["강남", 1200, 8000],
      ["역삼", 600, 6000]
    ].map(([stationName, boardings, alightings]) => ({
      lineNo: "2",
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
        lineNo: "2",
        direction: "내선",
        dayType: "WEEKDAY",
        timeSlot: "08:00",
        congestionPct: 120,
        source: "test fixture"
      }
    ],
    stationCongestionProfiles: [],
    transferDemandProfiles: [],
    doorHints: [
      {
        kind: "transfer",
        lineNo: "2",
        stationName: "강남",
        direction: "내선",
        carNo: 1,
        doorNo: 2,
        weight: 1,
        description: "환승 동선",
        source: "test fixture",
        confidence: 0.8
      }
    ]
  };

  const result = recommendSeatPositions(
    {
      origin: "신도림",
      destination: "선릉",
      lineNo: "2",
      direction: "내선",
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      mode: "seat"
    },
    lineTwoDataset
  );

  assert.equal(result.recommendations[0].grade, "LOW");
  assert.ok(result.recommendations[0].score <= 50);
  assert.equal(result.recommendations[0].expected_seat_window, "도착 임박 구간");
  assert.ok(result.recommendations[0].reasons.some((reason) => reason.includes("목적지 직전")));
});

test("ignores arrival-imminent line 2 hints on longer routes", () => {
  const stations = [
    "시청",
    "을지로입구",
    "을지로3가",
    "신당",
    "성수",
    "건대입구",
    "잠실",
    "선릉",
    "역삼",
    "강남",
    "교대",
    "서초",
    "방배",
    "사당",
    "낙성대",
    "서울대입구",
    "봉천",
    "신림",
    "신대방",
    "구로디지털단지",
    "대림",
    "신도림"
  ];
  const lineTwoDataset: SeatChanceDataset = {
    stations: stations.map((stationName, index) => ({
      operator: "서울교통공사",
      lineNo: "2",
      stationCode: `L2-${index + 1}`,
      stationName,
      sequenceNo: index + 1
    })),
    trainLayouts: [
      {
        operator: "서울교통공사",
        lineNo: "2",
        branchCode: "MAIN",
        direction: "외선",
        carCount: 2,
        doorsPerCar: 4,
        source: "test fixture",
        confidence: 0.9,
        validFrom: "2026-05-01",
        validTo: null
      }
    ],
    ridershipProfiles: [
      ["사당", 500, 2500],
      ["강남", 100, 9000],
      ["역삼", 100, 10000]
    ].map(([stationName, boardings, alightings]) => ({
      lineNo: "2",
      stationName: String(stationName),
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      boardings: Number(boardings),
      alightings: Number(alightings),
      source: "test fixture",
      observedMonth: "2026-05-01"
    })),
    congestionProfiles: [],
    stationCongestionProfiles: [],
    transferDemandProfiles: [],
    doorHints: [
      {
        kind: "transfer",
        lineNo: "2",
        stationName: "사당",
        direction: "외선",
        carNo: 2,
        doorNo: 3,
        weight: 0.8,
        description: "환승 동선",
        source: "test fixture",
        confidence: 0.8
      },
      {
        kind: "transfer",
        lineNo: "2",
        stationName: "강남",
        direction: "외선",
        carNo: 1,
        doorNo: 1,
        weight: 1,
        description: "환승 동선",
        source: "test fixture",
        confidence: 0.8
      },
      {
        kind: "transfer",
        lineNo: "2",
        stationName: "역삼",
        direction: "외선",
        carNo: 1,
        doorNo: 1,
        weight: 1,
        description: "환승 동선",
        source: "test fixture",
        confidence: 0.8
      }
    ]
  };

  const result = recommendSeatPositions(
    {
      origin: "신도림",
      destination: "선릉",
      lineNo: "2",
      direction: "외선",
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      mode: "seat"
    },
    lineTwoDataset
  );

  assert.equal(result.recommendations[0].car_no, 2);
  assert.equal(result.recommendations[0].door_no, 3);
  assert.equal(result.recommendations[0].expected_seat_window, "사당");
  assert.doesNotMatch(result.recommendations[0].expected_seat_window, /강남|역삼/);
});

test("orders expected seat window by travel order on reverse routes", () => {
  const reverseDataset: SeatChanceDataset = {
    stations: ["A", "B", "C", "D", "E", "F"].map((stationName, index) => ({
      operator: "test",
      lineNo: "9",
      stationCode: `L9-${index + 1}`,
      stationName,
      sequenceNo: index + 1
    })),
    trainLayouts: [
      {
        operator: "test",
        lineNo: "9",
        branchCode: "MAIN",
        direction: "A",
        carCount: 3,
        doorsPerCar: 4,
        source: "test fixture",
        confidence: 0.9,
        validFrom: "2026-05-01",
        validTo: null
      }
    ],
    ridershipProfiles: [
      ["E", 100, 6000],
      ["D", 100, 5000],
      ["C", 100, 2000]
    ].map(([stationName, boardings, alightings]) => ({
      lineNo: "9",
      stationName: String(stationName),
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      boardings: Number(boardings),
      alightings: Number(alightings),
      source: "test fixture",
      observedMonth: "2026-05-01"
    })),
    congestionProfiles: [],
    stationCongestionProfiles: [],
    transferDemandProfiles: [],
    doorHints: [
      {
        kind: "transfer",
        lineNo: "9",
        stationName: "E",
        direction: "A",
        carNo: 2,
        doorNo: 2,
        weight: 1,
        description: "환승 동선",
        source: "test fixture",
        confidence: 0.8
      },
      {
        kind: "transfer",
        lineNo: "9",
        stationName: "D",
        direction: "A",
        carNo: 2,
        doorNo: 3,
        weight: 1,
        description: "환승 동선",
        source: "test fixture",
        confidence: 0.8
      }
    ]
  };

  const result = recommendSeatPositions(
    {
      origin: "F",
      destination: "A",
      lineNo: "9",
      direction: "A",
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      mode: "seat"
    },
    reverseDataset
  );

  assert.equal(result.recommendations[0].expected_seat_window, "E → D");
});

test("does not advertise weak early signals when arrival-imminent demand dominates", () => {
  const mixedSignalDataset: SeatChanceDataset = {
    stations: ["O", "A", "B", "C", "D", "E", "F", "G", "H"].map((stationName, index) => ({
      operator: "test",
      lineNo: "9",
      stationCode: `L9-${index + 1}`,
      stationName,
      sequenceNo: index + 1
    })),
    trainLayouts: [
      {
        operator: "test",
        lineNo: "9",
        branchCode: "MAIN",
        direction: "H",
        carCount: 3,
        doorsPerCar: 4,
        source: "test fixture",
        confidence: 0.9,
        validFrom: "2026-05-01",
        validTo: null
      }
    ],
    ridershipProfiles: [
      ["B", 10, 50],
      ["G", 100, 10000]
    ].map(([stationName, boardings, alightings]) => ({
      lineNo: "9",
      stationName: String(stationName),
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      boardings: Number(boardings),
      alightings: Number(alightings),
      source: "test fixture",
      observedMonth: "2026-05-01"
    })),
    congestionProfiles: [],
    stationCongestionProfiles: [],
    transferDemandProfiles: [],
    doorHints: [
      {
        kind: "transfer",
        lineNo: "9",
        stationName: "G",
        direction: "H",
        carNo: 1,
        doorNo: 1,
        weight: 1,
        description: "환승 동선",
        source: "test fixture",
        confidence: 0.8
      }
    ]
  };

  const result = recommendSeatPositions(
    {
      origin: "O",
      destination: "H",
      lineNo: "9",
      direction: "H",
      dayType: "WEEKDAY",
      timeSlot: "08:00",
      mode: "seat"
    },
    mixedSignalDataset
  );

  assert.equal(result.recommendations[0].grade, "LOW");
  assert.equal(result.recommendations[0].expected_seat_window, "도착 임박 구간");
  assert.ok(result.recommendations.every((recommendation) => recommendation.expected_seat_window !== "B"));
  assert.ok(result.recommendations[0].reasons.some((reason) => reason.includes("목적지 직전")));
});
