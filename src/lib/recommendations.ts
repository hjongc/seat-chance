import { RecommendationInputError, toDayType, toTimeSlot } from "./time";
import type {
  CongestionProfile,
  DoorHint,
  Recommendation,
  RecommendationRequest,
  RecommendationResponse,
  SeatChanceDataset,
  Station,
  TrainLayout
} from "./types";

interface Candidate {
  carNo: number;
  doorNo: number;
  rawScore: number;
  contributions: Contribution[];
}

interface Contribution {
  stationName: string;
  sequenceNo: number;
  remainingStops: number;
  score: number;
  hint: DoorHint | null;
  stationDemand: number;
}

export function recommendSeatPositions(
  request: RecommendationRequest,
  dataset: SeatChanceDataset
): RecommendationResponse {
  if (request.mode !== "seat") {
    throw new RecommendationInputError("mode는 seat만 지원합니다.");
  }

  const timeSlot = toTimeSlot(request.datetime);
  const dayType = toDayType(request.datetime);
  const layout = findTrainLayout(dataset.trainLayouts, request.lineNo, request.direction);
  const routeStations = findRouteStations(
    dataset.stations,
    request.lineNo,
    request.direction,
    request.origin,
    request.destination
  );
  const intermediateStations = routeStations.slice(1, -1);

  if (intermediateStations.length === 0) {
    throw new RecommendationInputError("출발역과 도착역 사이에 추천할 중간역이 없습니다.");
  }

  const profiles = dataset.ridershipProfiles.filter(
    (profile) =>
      profile.lineNo === request.lineNo &&
      profile.dayType === dayType &&
      profile.timeSlot === timeSlot
  );

  const maxAlightings = Math.max(1, ...profiles.map((profile) => profile.alightings));
  const maxBoardings = Math.max(1, ...profiles.map((profile) => profile.boardings));
  const congestion = dataset.congestionProfiles.find(
    (profile) =>
      profile.lineNo === request.lineNo &&
      profile.direction === request.direction &&
      profile.dayType === dayType &&
      profile.timeSlot === timeSlot
  );
  const congestionPenalty = getCongestionPenalty(congestion);
  const candidates = buildDoorCandidates(layout).map((candidate) =>
    scoreCandidate({
      candidate,
      intermediateStations,
      totalStops: routeStations.length - 1,
      profiles,
      maxAlightings,
      maxBoardings,
      doorHints: dataset.doorHints.filter(
        (hint) => hint.lineNo === request.lineNo && hint.direction === request.direction
      )
    })
  );

  const minRaw = Math.min(...candidates.map((candidate) => candidate.rawScore));
  const maxRaw = Math.max(...candidates.map((candidate) => candidate.rawScore));
  const recommendations = candidates
    .map((candidate) => toRecommendation(candidate, minRaw, maxRaw, congestionPenalty))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));

  return {
    origin: request.origin,
    destination: request.destination,
    line_no: request.lineNo,
    direction: request.direction,
    time_slot: timeSlot,
    recommendations,
    cautions: [
      "점수는 실제 착석 확률이 아니라 동일 경로 내 상대 추천 점수입니다.",
      "실제 열차 혼잡, 지연, 행사, 날씨 등은 반영되지 않을 수 있습니다."
    ]
  };
}

function findTrainLayout(
  layouts: TrainLayout[],
  lineNo: string,
  direction: string
): TrainLayout {
  const layout = layouts.find(
    (candidate) => candidate.lineNo === lineNo && candidate.direction === direction
  );
  if (!layout) {
    throw new RecommendationInputError("해당 노선/방향의 열차 레이아웃을 찾을 수 없습니다.");
  }
  return layout;
}

function findRouteStations(
  stations: Station[],
  lineNo: string,
  direction: string,
  origin: string,
  destination: string
): Station[] {
  const lineStations = stations
    .filter((station) => station.lineNo === lineNo)
    .sort((left, right) => left.sequenceNo - right.sequenceNo);
  const originStation = lineStations.find((station) => station.stationName === origin);
  const destinationStation = lineStations.find((station) => station.stationName === destination);

  if (!originStation || !destinationStation) {
    throw new RecommendationInputError("출발역 또는 도착역이 3호선 MVP 범위에 없습니다.");
  }

  const isOgeumBound = direction === "오금";
  const isValidDirection = isOgeumBound
    ? originStation.sequenceNo < destinationStation.sequenceNo
    : originStation.sequenceNo > destinationStation.sequenceNo;

  if (!isValidDirection) {
    throw new RecommendationInputError("선택한 방향과 출발/도착역 순서가 맞지 않습니다.");
  }

  const [start, end] = [originStation.sequenceNo, destinationStation.sequenceNo].sort(
    (left, right) => left - right
  );
  const route = lineStations.filter(
    (station) => station.sequenceNo >= start && station.sequenceNo <= end
  );

  return isOgeumBound ? route : route.reverse();
}

function buildDoorCandidates(layout: TrainLayout): Candidate[] {
  const candidates: Candidate[] = [];
  for (let carNo = 1; carNo <= layout.carCount; carNo += 1) {
    for (let doorNo = 1; doorNo <= layout.doorsPerCar; doorNo += 1) {
      candidates.push({ carNo, doorNo, rawScore: 0, contributions: [] });
    }
  }
  return candidates;
}

function scoreCandidate({
  candidate,
  intermediateStations,
  totalStops,
  profiles,
  maxAlightings,
  maxBoardings,
  doorHints
}: {
  candidate: Candidate;
  intermediateStations: Station[];
  totalStops: number;
  profiles: SeatChanceDataset["ridershipProfiles"];
  maxAlightings: number;
  maxBoardings: number;
  doorHints: DoorHint[];
}): Candidate {
  const scored: Candidate = { ...candidate, rawScore: 0, contributions: [] };

  for (const [index, station] of intermediateStations.entries()) {
    const profile = profiles.find((candidateProfile) => candidateProfile.stationName === station.stationName);
    if (!profile) {
      continue;
    }

    const progress = (index + 1) / totalStops;
    const arrivalPenalty = progress > 0.72 ? (progress - 0.72) * 1.8 : 0;
    const distanceWeight = clamp(1 - arrivalPenalty, 0.28, 1);
    const alightingScore = profile.alightings / maxAlightings;
    const boardingPenalty = (profile.boardings / maxBoardings) * 0.36;
    const stationDemand = clamp(alightingScore - boardingPenalty, 0, 1);
    const matchingHint = doorHints.find(
      (hint) =>
        hint.stationName === station.stationName &&
        hint.carNo === candidate.carNo &&
        hint.doorNo === candidate.doorNo
    );
    const baseline = stationDemand * 8 * distanceWeight;
    const hintBonus = matchingHint
      ? stationDemand * matchingHint.weight * (matchingHint.kind === "transfer" ? 34 : 22) * distanceWeight
      : 0;
    const contributionScore = baseline + hintBonus;

    scored.rawScore += contributionScore;
    if (contributionScore > 0) {
      scored.contributions.push({
        stationName: station.stationName,
        sequenceNo: station.sequenceNo,
        remainingStops: intermediateStations.length - index,
        score: contributionScore,
        hint: matchingHint ?? null,
        stationDemand
      });
    }
  }

  return scored;
}

function toRecommendation(
  candidate: Candidate,
  minRaw: number,
  maxRaw: number,
  congestionPenalty: number
): Recommendation {
  const range = Math.max(1, maxRaw - minRaw);
  const relativeScore = 50 + ((candidate.rawScore - minRaw) / range) * 45;
  const score = clamp(roundToTenth(relativeScore - congestionPenalty), 0, 100);
  const sortedContributions = [...candidate.contributions].sort((left, right) => right.score - left.score);

  return {
    rank: 0,
    car_no: candidate.carNo,
    door_no: candidate.doorNo,
    score,
    grade: toGrade(score),
    expected_seat_window: toExpectedSeatWindow(sortedContributions),
    reasons: toReasons(sortedContributions)
  };
}

function getCongestionPenalty(profile: CongestionProfile | undefined): number {
  if (!profile) {
    return 4;
  }
  return clamp((profile.congestionPct - 115) * 0.18, 0, 14);
}

function toGrade(score: number) {
  if (score >= 78) {
    return "HIGH";
  }
  if (score >= 62) {
    return "MEDIUM";
  }
  return "LOW";
}

function toExpectedSeatWindow(contributions: Contribution[]): string {
  const keyStations = contributions
    .filter((contribution) => contribution.hint)
    .slice(0, 2)
    .sort((left, right) => left.sequenceNo - right.sequenceNo);

  if (keyStations.length >= 2) {
    return `${keyStations[0].stationName}~${keyStations[1].stationName}`;
  }
  if (keyStations.length === 1) {
    return keyStations[0].stationName;
  }

  const fallback = contributions[0];
  return fallback ? fallback.stationName : "중간역";
}

function toReasons(contributions: Contribution[]): string[] {
  const reasons: string[] = [];
  const primary = contributions.find((contribution) => contribution.hint) ?? contributions[0];
  const secondary = contributions.find(
    (contribution) => contribution.hint && contribution.stationName !== primary?.stationName
  );

  if (primary?.hint?.kind === "transfer") {
    reasons.push(`${primary.stationName} 하차/환승 수요가 높습니다.`);
  } else if (primary?.hint?.kind === "facility") {
    reasons.push(`${primary.stationName} 출구·계단 동선과 가깝습니다.`);
  } else if (primary) {
    reasons.push(`${primary.stationName} 하차 수요가 높은 구간입니다.`);
  }

  if (secondary?.hint?.kind === "transfer") {
    reasons.push(`${secondary.stationName} 환승 동선과도 가까운 위치입니다.`);
  } else if (secondary?.hint?.kind === "facility") {
    reasons.push(`${secondary.stationName} 빠른하차 동선과도 가깝습니다.`);
  }

  if (primary && primary.remainingStops >= 3) {
    reasons.push("목적지보다 충분히 앞선 구간에서 좌석 회전 가능성이 있습니다.");
  } else {
    reasons.push("도착 임박 구간의 기회는 낮게 반영했습니다.");
  }

  return reasons;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

