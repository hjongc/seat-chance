import { forwardDirectionName, reverseDirectionName } from "./directions";
import { RecommendationInputError, toDayType, toTimeSlot } from "./time";
import { fallbackTrainLayout } from "./train-layout";
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
    throw new RecommendationInputError("승차역과 하차역 사이에 추천할 중간역이 없습니다.");
  }

  const profiles = nearestTimeSlotItems(
    dataset.ridershipProfiles.filter(
      (profile) => profile.lineNo === request.lineNo && profile.dayType === dayType
    ),
    timeSlot
  );
  const usedTimeSlot = profiles[0]?.timeSlot ?? timeSlot;

  if (profiles.length === 0) {
    throw new RecommendationInputError("선택한 시간대 주변의 승하차 데이터가 없어 추천할 수 없습니다.");
  }

  const maxAlightings = Math.max(1, ...profiles.map((profile) => profile.alightings));
  const maxBoardings = Math.max(1, ...profiles.map((profile) => profile.boardings));
  const congestion = nearestTimeSlotItems(
    dataset.congestionProfiles.filter(
      (profile) =>
        profile.lineNo === request.lineNo &&
        profile.direction === request.direction &&
        profile.dayType === dayType
    ),
    usedTimeSlot
  )[0];
  const congestionPenalty = getCongestionPenalty(congestion);
  const profileByStation = new Map(profiles.map((profile) => [profile.stationName, profile]));
  const doorHintsByStationAndCar = indexDoorHints(
    dataset.doorHints.filter(
      (hint) => hint.lineNo === request.lineNo && hint.direction === request.direction
    )
  );
  const candidates = buildDoorCandidates(layout).map((candidate) =>
    scoreCandidate({
      candidate,
      intermediateStations,
      totalStops: routeStations.length - 1,
      profileByStation,
      maxAlightings,
      maxBoardings,
      doorHintsByStationAndCar
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
    time_slot: usedTimeSlot,
    recommendations,
    cautions: [
      "좌석각 점수는 실제 착석 확률이 아니라 동일 경로 내 상대 추천 점수입니다.",
      "실제 열차 혼잡, 지연, 행사, 날씨 등은 반영되지 않을 수 있습니다."
    ]
  };
}

function nearestTimeSlotItems<T extends { timeSlot: string }>(items: T[], requestedTimeSlot: string): T[] {
  if (items.length === 0) {
    return [];
  }

  const nearest = items.reduce<{ timeSlot: string; distance: number } | null>((best, item) => {
    const distance = timeSlotDistanceMinutes(item.timeSlot, requestedTimeSlot);
    if (!best || distance < best.distance) {
      return { timeSlot: item.timeSlot, distance };
    }
    return best;
  }, null);

  return nearest ? items.filter((item) => item.timeSlot === nearest.timeSlot) : [];
}

function timeSlotDistanceMinutes(left: string, right: string) {
  const leftMinutes = timeSlotToMinutes(left);
  const rightMinutes = timeSlotToMinutes(right);
  return Math.abs(leftMinutes - rightMinutes);
}

function timeSlotToMinutes(value: string) {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function findTrainLayout(
  layouts: TrainLayout[],
  lineNo: string,
  direction: string
): TrainLayout {
  const layout = layouts.find(
    (candidate) => candidate.lineNo === lineNo && candidate.direction === direction
  );
  return layout ?? fallbackTrainLayout(lineNo, direction);
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
    throw new RecommendationInputError("선택한 노선의 역 목록 내에 승차역/하차역이 없습니다.");
  }

  const forwardDirection = forwardDirectionName(lineNo, lineStations.at(-1)?.stationName ?? "");
  const reverseDirection = reverseDirectionName(lineNo, lineStations[0]?.stationName ?? "");
  const isForwardBound = direction === forwardDirection;
  const isReverseBound = direction === reverseDirection;
  const isValidDirection = isForwardBound
    ? originStation.sequenceNo < destinationStation.sequenceNo
    : isReverseBound && originStation.sequenceNo > destinationStation.sequenceNo;

  if (!isValidDirection) {
    throw new RecommendationInputError("선택한 방향과 승차역/하차역 순서가 맞지 않습니다.");
  }

  const [start, end] = [originStation.sequenceNo, destinationStation.sequenceNo].sort(
    (left, right) => left - right
  );
  const route = lineStations.filter(
    (station) => station.sequenceNo >= start && station.sequenceNo <= end
  );

  return isForwardBound ? route : route.reverse();
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
  profileByStation,
  maxAlightings,
  maxBoardings,
  doorHintsByStationAndCar
}: {
  candidate: Candidate;
  intermediateStations: Station[];
  totalStops: number;
  profileByStation: Map<string, SeatChanceDataset["ridershipProfiles"][number]>;
  maxAlightings: number;
  maxBoardings: number;
  doorHintsByStationAndCar: Map<string, DoorHint[]>;
}): Candidate {
  const scored: Candidate = { ...candidate, rawScore: 0, contributions: [] };

  for (const [index, station] of intermediateStations.entries()) {
    const profile = profileByStation.get(station.stationName);
    if (!profile) {
      continue;
    }

    const progress = (index + 1) / totalStops;
    const stationsAfter = totalStops - index - 1;
    const remainingStopsPenalty = stationsAfter <= 1 ? 0.38 : stationsAfter <= 2 ? 0.22 : stationsAfter <= 3 ? 0.1 : 0;
    const arrivalPenalty = progress > 0.64 ? (progress - 0.64) * 0.88 : 0;
    const distanceWeight = clamp(1 - Math.max(remainingStopsPenalty, arrivalPenalty), 0.25, 1);
    const alightingScore = profile.alightings / maxAlightings;
    const boardingScore = profile.boardings / maxBoardings;
    const stationDemand = clamp(alightingScore - boardingScore * 0.55, 0, 1);
    const matchingHint = (doorHintsByStationAndCar.get(hintIndexKey(station.stationName, candidate.carNo)) ?? []).reduce<{
      hint: DoorHint;
      distance: number;
    } | null>(
      (best, hint) => {
        const distance = Math.abs(hint.doorNo - candidate.doorNo);
        if (distance > 1) {
          return best;
        }
        if (!best || distance < best.distance || (distance === best.distance && hint.weight > best.hint.weight)) {
          return { hint, distance };
        }
        return best;
      },
      null
    );
    const hintDistanceFactor = matchingHint
      ? matchingHint.distance === 0
        ? 1
        : 0.9
      : 0;
    const baseline = (alightingScore * 7.2 + stationDemand * 5.6) * distanceWeight;
    const hintBonus = matchingHint
      ? stationDemand * matchingHint.hint.weight * (matchingHint.hint.kind === "transfer" ? 34 : 22) * distanceWeight * hintDistanceFactor
      : 0;
    const hintBoost = matchingHint
      ? (matchingHint.hint.kind === "transfer" ? 1.25 : 0.75)
      : 0;
    const contributionScore = baseline + hintBonus * hintBoost;

    scored.rawScore += contributionScore;
    if (contributionScore > 0) {
      scored.contributions.push({
        stationName: station.stationName,
        sequenceNo: station.sequenceNo,
        remainingStops: intermediateStations.length - index,
        score: contributionScore,
        hint: matchingHint ? matchingHint.hint : null,
        stationDemand
      });
    }
  }

  return scored;
}

function indexDoorHints(doorHints: DoorHint[]) {
  const index = new Map<string, DoorHint[]>();

  for (const hint of doorHints) {
    const key = hintIndexKey(hint.stationName, hint.carNo);
    const hints = index.get(key);
    if (hints) {
      hints.push(hint);
    } else {
      index.set(key, [hint]);
    }
  }

  return index;
}

function hintIndexKey(stationName: string, carNo: number) {
  return `${stationName}\u0000${carNo}`;
}

function toRecommendation(
  candidate: Candidate,
  minRaw: number,
  maxRaw: number,
  congestionPenalty: number
): Recommendation {
  if (maxRaw <= 0 || maxRaw === minRaw) {
    return {
      rank: 0,
      car_no: candidate.carNo,
      door_no: candidate.doorNo,
      score: 0,
      grade: "LOW",
      expected_seat_window: "데이터 부족",
      reasons: ["호차별 위치를 구분할 출입문 데이터가 부족해 좌석각을 계산하지 못했습니다."]
    };
  }

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
  const hintedContributions = contributions.filter((contribution) => contribution.hint);
  const keyStations =
    hintedContributions.filter((contribution) => contribution.remainingStops >= 2).slice(0, 2).length >= 2
      ? hintedContributions.filter((contribution) => contribution.remainingStops >= 2).slice(0, 2)
      : hintedContributions.slice(0, 2);
  keyStations.sort((left, right) => left.sequenceNo - right.sequenceNo);

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

  if (primary && primary.stationDemand > 0.2) {
    reasons.push(`${primary.stationName}은(는) 하차 수요 대비 승차 수요가 낮아 좌석각에 유리합니다.`);
  }

  if (secondary?.hint?.kind === "transfer") {
    reasons.push(`${secondary.stationName} 환승 동선과도 가까운 위치입니다.`);
  } else if (secondary?.hint?.kind === "facility") {
    reasons.push(`${secondary.stationName} 빠른하차 동선과도 가깝습니다.`);
  }

  if (primary && primary.remainingStops >= 3) {
    reasons.push("목적지보다 충분히 앞선 구간에서 좌석각이 생길 가능성이 있습니다.");
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
