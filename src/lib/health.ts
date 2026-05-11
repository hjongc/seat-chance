import type { DataStatus } from "./repository";

export interface HealthEvaluation {
  ok: boolean;
  ingestionFresh: boolean;
  stationCoverageReady: boolean;
  maxAgeHours: number;
  minStationRows: number;
}

export function evaluateHealth({
  status,
  now = Date.now(),
  maxAgeHours = 45 * 24,
  minStationRows = 500
}: {
  status: DataStatus;
  now?: number;
  maxAgeHours?: number;
  minStationRows?: number;
}): HealthEvaluation {
  const lastFinishedAt = status.lastSuccessfulIngestion?.finishedAt
    ? new Date(status.lastSuccessfulIngestion.finishedAt).getTime()
    : 0;
  const ingestionFresh =
    lastFinishedAt > 0 && now - lastFinishedAt <= maxAgeHours * 60 * 60 * 1000;
  const stationCoverageReady = (status.counts.station_line_order ?? 0) >= minStationRows;

  return {
    ok: status.ready && ingestionFresh && stationCoverageReady,
    ingestionFresh,
    stationCoverageReady,
    maxAgeHours,
    minStationRows
  };
}

export function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
