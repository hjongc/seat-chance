import type { DirectionCode, TrainLayout } from "./types";

const defaultCarCounts: Record<string, number> = {
  "1": 10,
  "2": 10,
  "3": 10,
  "4": 10,
  "5": 8,
  "6": 8,
  "7": 8,
  "8": 6,
  "9": 6
};

export function hasFallbackTrainLayout(lineNo: string) {
  return defaultCarCounts[lineNo] !== undefined;
}

export function fallbackTrainLayout(lineNo: string, direction: DirectionCode): TrainLayout {
  return {
    operator: "서울교통공사",
    lineNo,
    branchCode: "MAIN",
    direction,
    carCount: defaultCarCounts[lineNo] ?? 8,
    doorsPerCar: 4,
    source: "기본 열차 편성 추정값",
    confidence: 0.35,
    validFrom: "2026-01-01",
    validTo: null
  };
}
