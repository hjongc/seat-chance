import { routeStationsForDirection } from "./directions";
import { RecommendationInputError } from "./time";
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
  hintDistance: number | null;
  stationDemand: number;
  competitionDemand: number;
  stationCongestionPct: number | null;
}

export function recommendSeatPositions(
  request: RecommendationRequest,
  dataset: SeatChanceDataset
): RecommendationResponse {
  if (request.mode !== "seat") {
    throw new RecommendationInputError("mode는 seat만 지원합니다.");
  }

  const timeSlot = request.timeSlot;
  const dayType = request.dayType;
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
    return {
      origin: request.origin,
      destination: request.destination,
      line_no: request.lineNo,
      direction: request.direction,
      day_type: dayType,
      time_slot: usedTimeSlot,
      recommendations: toDataShortageRecommendations(
        layout,
        "선택한 노선의 승하차 시간대 데이터가 없어 앉을각을 계산하지 못했습니다."
      ),
      cautions: [
        "앉을각 점수는 실제 착석 확률이 아니라 동일 경로 내 상대 추천 점수입니다.",
        "이 노선은 현재 승하차 시간대 데이터가 부족해 위치별 차이를 계산하지 못했습니다."
      ]
    };
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
  const stationCongestionProfiles = nearestTimeSlotItems(
    dataset.stationCongestionProfiles.filter(
      (profile) =>
        profile.lineNo === request.lineNo &&
        profile.direction === request.direction &&
        profile.dayType === dayType
    ),
    usedTimeSlot
  );
  const stationCongestionByStation = new Map(
    stationCongestionProfiles.map((profile) => [profile.stationName, profile])
  );
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
      stationCongestionByStation,
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
    day_type: dayType,
    time_slot: usedTimeSlot,
    recommendations,
    cautions: [
      "앉을각 점수는 실제 착석 확률이 아니라 동일 경로 내 상대 추천 점수입니다.",
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
  const lineStations = stations.filter((station) => station.lineNo === lineNo);
  return routeStationsForDirection(lineNo, lineStations, direction, origin, destination);
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
  stationCongestionByStation,
  doorHintsByStationAndCar
}: {
  candidate: Candidate;
  intermediateStations: Station[];
  totalStops: number;
  profileByStation: Map<string, SeatChanceDataset["ridershipProfiles"][number]>;
  maxAlightings: number;
  maxBoardings: number;
  stationCongestionByStation: Map<string, SeatChanceDataset["stationCongestionProfiles"][number]>;
  doorHintsByStationAndCar: Map<string, DoorHint[]>;
}): Candidate {
  const scored: Candidate = { ...candidate, rawScore: 0, contributions: [] };
  let competitionDemand = 0;

  for (const [index, station] of intermediateStations.entries()) {
    const profile = profileByStation.get(station.stationName);
    if (!profile) {
      continue;
    }

    const stationsAfter = totalStops - index - 1;
    const distanceWeight = opportunityDistanceWeight(stationsAfter, totalStops);
    const alightingScore = profile ? profile.alightings / maxAlightings : 0;
    const boardingScore = profile ? profile.boardings / maxBoardings : 0;
    const stationDemand = clamp(alightingScore - boardingScore * 0.55, 0, 1);
    const competitionFactor = transferCompetitionFactor(competitionDemand);
    const stationCongestion = stationCongestionByStation.get(station.stationName);
    const stationCongestionPct = stationCongestion?.congestionPct ?? null;
    const crowdingFactor = stationCongestionPct === null ? 1 : stationCrowdingFactor(stationCongestionPct);
    const stationCarHints = doorHintsByStationAndCar.get(hintIndexKey(station.stationName, candidate.carNo)) ?? [];
    const matchingHint = nearestDoorHint(
      stationCarHints,
      candidate,
      (kind) => kind === "transfer" || kind === "facility"
    );
    const matchingBoardingHint = nearestDoorHint(
      stationCarHints,
      candidate,
      (kind) => kind === "transfer_boarding"
    );
    const hintDistanceFactor = matchingHint
      ? matchingHint.distance === 0
        ? 1
        : 0.8
      : 0;
    const baseline = (alightingScore * 7.2 + stationDemand * 5.6) * distanceWeight * crowdingFactor;
    const hintDemand = stationDemand;
    const hintBonus = matchingHint
      ? hintDemand *
        matchingHint.hint.weight *
        (matchingHint.hint.kind === "transfer" ? 34 : 22) *
        distanceWeight *
        hintDistanceFactor *
        crowdingFactor
      : 0;
    const hintBoost = matchingHint
      ? (matchingHint.hint.kind === "transfer" ? 1.25 : 0.75)
      : 0;
    const contributionScore = (baseline + hintBonus * hintBoost) * competitionFactor;

    scored.rawScore += contributionScore;
    if (contributionScore > 0) {
      scored.contributions.push({
        stationName: station.stationName,
        sequenceNo: station.sequenceNo,
        remainingStops: intermediateStations.length - index,
        score: contributionScore,
        hint: matchingHint ? matchingHint.hint : null,
        hintDistance: matchingHint ? matchingHint.distance : null,
        stationDemand,
        competitionDemand,
        stationCongestionPct
      });
    }

    competitionDemand = clamp(
      competitionDemand + boardingScore * transferBoardingProximity(matchingBoardingHint),
      0,
      1
    );
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

function nearestDoorHint(
  hints: DoorHint[],
  candidate: Candidate,
  includesKind: (kind: DoorHint["kind"]) => boolean
): { hint: DoorHint; distance: number } | null {
  return hints.reduce<{ hint: DoorHint; distance: number } | null>((best, hint) => {
    if (!includesKind(hint.kind)) {
      return best;
    }

    const distance = Math.abs(hint.doorNo - candidate.doorNo);
    if (distance > 1) {
      return best;
    }
    if (!best || distance < best.distance || (distance === best.distance && hint.weight > best.hint.weight)) {
      return { hint, distance };
    }
    return best;
  }, null);
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
      reasons: ["호차별 위치를 구분할 출입문 데이터가 부족해 앉을각을 계산하지 못했습니다."]
    };
  }

  const range = Math.max(1, maxRaw - minRaw);
  const normalizedScore = (candidate.rawScore - minRaw) / range;
  const relativeScore = 28 + normalizedScore * 52;
  const score = clamp(roundToTenth(relativeScore - congestionPenalty), 0, 100);
  const sortedContributions = [...candidate.contributions].sort((left, right) => right.score - left.score);

  return {
    rank: 0,
    car_no: candidate.carNo,
    door_no: candidate.doorNo,
    score,
    grade: toGrade(score),
    expected_seat_window: toExpectedSeatWindow(sortedContributions),
    reasons: toReasons(sortedContributions, candidate)
  };
}

function toDataShortageRecommendations(layout: TrainLayout, reason: string): Recommendation[] {
  return buildDoorCandidates(layout)
    .slice(0, 3)
    .map((candidate, index) => ({
      rank: index + 1,
      car_no: candidate.carNo,
      door_no: candidate.doorNo,
      score: 0,
      grade: "LOW",
      expected_seat_window: "데이터 부족",
      reasons: [reason]
    }));
}

function getCongestionPenalty(profile: CongestionProfile | undefined): number {
  if (!profile) {
    return 3;
  }
  return clamp((profile.congestionPct - 100) * 0.28, 0, 22);
}

function opportunityDistanceWeight(stationsAfter: number, totalStops: number) {
  if (totalStops <= 0) {
    return 1;
  }

  const remainingRatio = stationsAfter / totalStops;
  return clamp(0.32 + Math.pow(remainingRatio, 0.65) * 0.68, 0.25, 1);
}

function transferCompetitionFactor(competitionDemand: number): number {
  return clamp(1 - competitionDemand * 0.22, 0.78, 1);
}

function transferBoardingProximity(matchingBoardingHint: { hint: DoorHint; distance: number } | null): number {
  if (!matchingBoardingHint) {
    return 0;
  }

  const distanceFactor = matchingBoardingHint.distance === 0 ? 0.55 : 0.4;
  return distanceFactor * matchingBoardingHint.hint.weight;
}

function stationCrowdingFactor(congestionPct: number): number {
  return clamp(1.08 - Math.max(congestionPct - 70, 0) * 0.003, 0.62, 1.08);
}

function toGrade(score: number) {
  if (score >= 72) {
    return "HIGH";
  }
  if (score >= 54) {
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

function toReasons(contributions: Contribution[], candidate: Candidate): string[] {
  const reasons: string[] = [];
  const primary = contributions.find((contribution) => contribution.hint) ?? contributions[0];
  const secondary = contributions.find(
    (contribution) => contribution.hint && contribution.stationName !== primary?.stationName
  );

  if (primary) {
    reasons.push(toPrimaryReason(primary, candidate));
  }

  if (primary && primary.competitionDemand > 0.2) {
    reasons.push("앞선 환승 승차 유입은 다음 구간의 좌석 경쟁 신호로 누적 반영했습니다.");
  }

  if (primary && primary.stationDemand > 0.2) {
    reasons.push(`${primary.stationName}은(는) 하차 수요 대비 승차 수요가 낮아 앉을각에 유리합니다.`);
  }

  if (primary?.stationCongestionPct !== null && primary?.stationCongestionPct !== undefined) {
    if (primary.stationCongestionPct >= 160) {
      reasons.push(`${primary.stationName} 구간 혼잡도가 높아 좌석 경쟁을 감점했습니다.`);
    } else if (primary.stationCongestionPct <= 90) {
      reasons.push(`${primary.stationName} 구간 혼잡도가 상대적으로 낮습니다.`);
    }
  }

  if (secondary) {
    reasons.push(toSecondaryReason(secondary, candidate));
  }

  if (primary && primary.remainingStops >= 3) {
    reasons.push("목적지보다 충분히 앞선 구간에서 앉을각이 생길 가능성이 있습니다.");
  } else {
    reasons.push("도착 임박 구간의 기회는 낮게 반영했습니다.");
  }

  return reasons;
}

function toPrimaryReason(contribution: Contribution, candidate: Candidate): string {
  if (!contribution.hint) {
    return `${contribution.stationName} 하차 수요가 높은 구간을 기준으로 ${formatDoor(candidate)}을 추천했습니다.`;
  }

  const hintLabel = contribution.hint.kind === "transfer" ? "환승" : "출구·계단";
  const demandLabel = "하차 수요";
  const relation = toHintRelation(contribution, candidate);

  return `${contribution.stationName} ${hintLabel} 동선${relation} ${demandLabel}를 먼저 받을 수 있습니다.`;
}

function toSecondaryReason(contribution: Contribution, candidate: Candidate): string {
  if (!contribution.hint) {
    return `${contribution.stationName} 하차 수요도 보조로 반영했습니다.`;
  }

  const hintLabel = contribution.hint.kind === "transfer" ? "환승" : "빠른하차";
  const relation = toHintRelation(contribution, candidate);

  return `${contribution.stationName} ${hintLabel} 동선${relation} 보조 기회로 반영했습니다.`;
}

function toHintRelation(contribution: Contribution, candidate: Candidate): string {
  if (!contribution.hint || contribution.hintDistance === null) {
    return "";
  }

  if (contribution.hint.carNo !== candidate.carNo) {
    return `(${formatDoor(contribution.hint)} 기준)과 같은 칸은 아니지만`;
  }

  if (contribution.hintDistance === 0) {
    return `과 ${formatDoor(candidate)}이 직접 맞아`;
  }

  return `(${formatDoor(contribution.hint)} 기준)에서 한 문 거리라`;
}

function formatDoor(position: { carNo: number; doorNo: number }): string {
  return `${position.carNo}-${position.doorNo} 문`;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
