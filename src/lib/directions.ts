import { RecommendationInputError } from "./time";
import type { DirectionCode } from "./types";

export interface DirectionStation {
  stationName: string;
  sequenceNo: number;
}

export function forwardDirectionName(lineNo: string, terminalStationName: string) {
  return isCircularLine(lineNo) ? "내선" : terminalStationName;
}

export function reverseDirectionName(lineNo: string, terminalStationName: string) {
  return isCircularLine(lineNo) ? "외선" : terminalStationName;
}

export function directionLabel(lineNo: string, direction: DirectionCode) {
  return isCircularLine(lineNo) ? `${direction}순환` : `${direction} 방면`;
}

export function inferDirectionName(
  lineNo: string,
  stations: DirectionStation[],
  origin: string,
  destination: string
): DirectionCode {
  const { sortedStations, originIndex, destinationIndex } = routeContext(stations, origin, destination);
  const { forward, reverse } = directionNames(lineNo, sortedStations);

  if (!isCircularLine(lineNo)) {
    return sortedStations[originIndex].sequenceNo < sortedStations[destinationIndex].sequenceNo ? forward : reverse;
  }

  const stationCount = sortedStations.length;
  const forwardStops = circularDistance(originIndex, destinationIndex, stationCount, 1);
  const reverseStops = circularDistance(originIndex, destinationIndex, stationCount, -1);
  if (forwardStops === reverseStops) {
    throw new RecommendationInputError("순환선에서 방향을 자동으로 정할 수 없습니다. 방향을 직접 선택해주세요.");
  }

  return forwardStops < reverseStops ? forward : reverse;
}

export function routeStationsForDirection<T extends DirectionStation>(
  lineNo: string,
  stations: T[],
  direction: DirectionCode,
  origin: string,
  destination: string
): T[] {
  const { sortedStations, originIndex, destinationIndex } = routeContext(stations, origin, destination);
  const { forward, reverse } = directionNames(lineNo, sortedStations);
  const isForwardBound = direction === forward;
  const isReverseBound = direction === reverse;

  if (!isForwardBound && !isReverseBound) {
    throw new RecommendationInputError("선택한 방향이 해당 노선의 방향 코드와 맞지 않습니다.");
  }

  if (isCircularLine(lineNo)) {
    return circularRoute(sortedStations, originIndex, destinationIndex, isForwardBound ? 1 : -1);
  }

  const originSequence = sortedStations[originIndex].sequenceNo;
  const destinationSequence = sortedStations[destinationIndex].sequenceNo;
  const isValidDirection = isForwardBound
    ? originSequence < destinationSequence
    : originSequence > destinationSequence;

  if (!isValidDirection) {
    throw new RecommendationInputError("선택한 방향과 승차역/하차역 순서가 맞지 않습니다.");
  }

  const [start, end] = [originSequence, destinationSequence].sort((left, right) => left - right);
  const route = sortedStations.filter((station) => station.sequenceNo >= start && station.sequenceNo <= end);

  return isForwardBound ? route : route.reverse();
}

function directionNames(lineNo: string, sortedStations: DirectionStation[]) {
  return {
    forward: forwardDirectionName(lineNo, sortedStations.at(-1)?.stationName ?? ""),
    reverse: reverseDirectionName(lineNo, sortedStations[0]?.stationName ?? "")
  };
}

function routeContext<T extends DirectionStation>(stations: T[], origin: string, destination: string) {
  const sortedStations = [...stations].sort((left, right) => left.sequenceNo - right.sequenceNo);
  const originIndex = sortedStations.findIndex((station) => station.stationName === origin);
  const destinationIndex = sortedStations.findIndex((station) => station.stationName === destination);

  if (originIndex < 0 || destinationIndex < 0) {
    throw new RecommendationInputError("선택한 역이 해당 노선 데이터에 없습니다.");
  }
  if (originIndex === destinationIndex) {
    throw new RecommendationInputError("승차역과 하차역은 서로 달라야 합니다.");
  }

  return { sortedStations, originIndex, destinationIndex };
}

function circularRoute<T>(stations: T[], originIndex: number, destinationIndex: number, step: 1 | -1) {
  const route: T[] = [];
  let currentIndex = originIndex;

  while (route.length <= stations.length) {
    route.push(stations[currentIndex]);
    if (currentIndex === destinationIndex) {
      return route;
    }
    currentIndex = wrapIndex(currentIndex + step, stations.length);
  }

  throw new RecommendationInputError("순환선 경로를 계산하지 못했습니다.");
}

function circularDistance(originIndex: number, destinationIndex: number, stationCount: number, step: 1 | -1) {
  if (step === 1) {
    return (destinationIndex - originIndex + stationCount) % stationCount;
  }
  return (originIndex - destinationIndex + stationCount) % stationCount;
}

function wrapIndex(index: number, length: number) {
  return (index + length) % length;
}

function isCircularLine(lineNo: string) {
  return lineNo === "2";
}
