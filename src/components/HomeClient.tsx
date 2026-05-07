"use client";

import {
  AlertCircle,
  ArrowRightLeft,
  Clock3,
  Database,
  MapPin,
  Search,
  Settings,
  TrainFront
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

interface StationOption {
  station_code: string;
  station_name: string;
  sequence_no: number;
}

interface Recommendation {
  rank: number;
  car_no: number;
  door_no: number;
  score: number;
  grade: "HIGH" | "MEDIUM" | "LOW";
  expected_seat_window: string;
  reasons: string[];
}

interface RecommendationResponse {
  origin: string;
  destination: string;
  line_no: string;
  direction: string;
  time_slot: string;
  recommendations: Recommendation[];
  cautions: string[];
}

interface TrainLayoutResponse {
  line_no: string;
  direction: string;
  car_count: number;
  doors_per_car: number;
  source: string;
  confidence: number;
}

interface DataStatusResponse {
  ready: boolean;
  status: "READY" | "MISSING_DATABASE_URL" | "DATABASE_ERROR" | "SCHEMA_MISSING" | "DATA_MISSING";
  message: string;
  last_ingestion: {
    source_name: string;
    status: string;
    finished_at: string | null;
  } | null;
}

export function HomeClient() {
  const [dataStatus, setDataStatus] = useState<DataStatusResponse | null>(null);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [direction, setDirection] = useState("오금");
  const [datetime, setDatetime] = useState(defaultDatetime());
  const [recommendation, setRecommendation] = useState<RecommendationResponse | null>(null);
  const [layout, setLayout] = useState<TrainLayoutResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [stationLoading, setStationLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadInitialData() {
      try {
        const statusResponse = await fetch("/api/v1/data-status");
        const statusPayload = (await statusResponse.json()) as DataStatusResponse;
        if (!statusResponse.ok) {
          throw new Error("서비스 데이터 상태를 확인하지 못했습니다.");
        }
        if (ignore) {
          return;
        }

        setDataStatus(statusPayload);
        if (!statusPayload.ready) {
          return;
        }

        const response = await fetch("/api/v1/stations?line_no=3");
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "역 목록을 불러오지 못했습니다.");
        }
        if (ignore) {
          return;
        }

        const nextStations = payload.stations as StationOption[];
        setStations(nextStations);
        setOrigin(preferredStation(nextStations, "경복궁", 0));
        setDestination(preferredStation(nextStations, "신사", Math.max(0, nextStations.length - 1)));
      } catch (nextError) {
        if (!ignore) {
          setError(nextError instanceof Error ? nextError.message : "역 목록을 불러오지 못했습니다.");
        }
      } finally {
        if (!ignore) {
          setStationLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      ignore = true;
    };
  }, []);

  const canSubmit = Boolean(
    dataStatus?.ready && origin && destination && datetime && !loading && !stationLoading
  );
  const originOrder = useMemo(
    () => stations.find((station) => station.station_name === origin)?.sequence_no ?? 0,
    [origin, stations]
  );
  const destinationOrder = useMemo(
    () => stations.find((station) => station.station_name === destination)?.sequence_no ?? 0,
    [destination, stations]
  );

  useEffect(() => {
    if (!originOrder || !destinationOrder) {
      return;
    }
    setDirection(originOrder < destinationOrder ? "오금" : "대화");
  }, [originOrder, destinationOrder]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setRecommendation(null);
    setLayout(null);

    try {
      const query = new URLSearchParams({
        origin,
        destination,
        line_no: "3",
        direction,
        datetime: toApiDatetime(datetime),
        mode: "seat"
      });
      const [recommendationResponse, layoutResponse] = await Promise.all([
        fetch(`/api/v1/recommendations?${query.toString()}`),
        fetch(`/api/v1/train-layout?line_no=3&direction=${encodeURIComponent(direction)}`)
      ]);
      const recommendationPayload = await recommendationResponse.json();
      const layoutPayload = await layoutResponse.json();

      if (!recommendationResponse.ok) {
        throw new Error(recommendationPayload.error?.message ?? "추천을 계산하지 못했습니다.");
      }
      if (!layoutResponse.ok) {
        throw new Error(layoutPayload.error?.message ?? "열차 레이아웃을 불러오지 못했습니다.");
      }

      setRecommendation(recommendationPayload);
      setLayout(layoutPayload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "추천을 계산하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="서비스 요약">
        <div className="brand-mark">
          <TrainFront size={22} aria-hidden="true" />
        </div>
        <div>
          <h1>앉을각</h1>
          <p>3호선 좌석 회전 위치 추천</p>
        </div>
      </section>

      <form className="search-panel" onSubmit={handleSubmit}>
        <label className="field">
          <span>
            <MapPin size={16} aria-hidden="true" />
            출발역
          </span>
          <select value={origin} onChange={(event) => setOrigin(event.target.value)} disabled={stationLoading}>
            {stations.map((station) => (
              <option key={station.station_code} value={station.station_name}>
                {station.station_name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>
            <MapPin size={16} aria-hidden="true" />
            도착역
          </span>
          <select
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            disabled={stationLoading}
          >
            {stations.map((station) => (
              <option key={station.station_code} value={station.station_name}>
                {station.station_name}
              </option>
            ))}
          </select>
        </label>

        <div className="split-fields">
          <label className="field">
            <span>
              <Clock3 size={16} aria-hidden="true" />
              출발 시간
            </span>
            <input
              type="datetime-local"
              value={datetime}
              onChange={(event) => setDatetime(event.target.value)}
            />
          </label>

          <label className="field">
            <span>
              <ArrowRightLeft size={16} aria-hidden="true" />
              방향
            </span>
            <select value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="오금">오금</option>
              <option value="대화">대화</option>
            </select>
          </label>
        </div>

        <button className="primary-action" type="submit" disabled={!canSubmit}>
          <Search size={18} aria-hidden="true" />
          {loading ? "계산 중" : "추천 보기"}
        </button>
      </form>

      {error ? (
        <section className="notice" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <p>{error}</p>
        </section>
      ) : null}

      {dataStatus && !dataStatus.ready ? <SetupState dataStatus={dataStatus} /> : null}

      {recommendation && layout ? (
        <ResultView recommendation={recommendation} layout={layout} />
      ) : dataStatus?.ready ? (
        <section className="empty-state">
          <Database size={20} aria-hidden="true" />
          <p>공공데이터 수집 배치가 DB에 적재한 값을 기준으로 추천합니다.</p>
        </section>
      ) : null}
    </main>
  );
}

function SetupState({ dataStatus }: { dataStatus: DataStatusResponse }) {
  return (
    <section className="setup-state" aria-label="서비스 데이터 준비 상태">
      <div className="setup-icon">
        <Settings size={22} aria-hidden="true" />
      </div>
      <div>
        <h2>서비스 데이터 준비가 필요합니다</h2>
        <p>{toSetupMessage(dataStatus)}</p>
        {dataStatus.last_ingestion ? (
          <p className="setup-meta">
            최근 수집: {dataStatus.last_ingestion.source_name} · {dataStatus.last_ingestion.status}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ResultView({
  recommendation,
  layout
}: {
  recommendation: RecommendationResponse;
  layout: TrainLayoutResponse;
}) {
  return (
    <section className="result-panel" aria-label="추천 결과">
      <div className="result-heading">
        <div>
          <p className="route-label">
            {recommendation.origin} → {recommendation.destination}
          </p>
          <h2>앉을 가능성이 높은 위치</h2>
        </div>
        <span className="line-chip">3호선 {recommendation.direction} 방면</span>
      </div>

      <div className="recommendation-list">
        {recommendation.recommendations.map((item) => (
          <article className="recommendation-item" key={`${item.car_no}-${item.door_no}`}>
            <div className="rank-box">{item.rank}</div>
            <div className="recommendation-copy">
              <div className="recommendation-title">
                <strong>
                  {item.car_no}-{item.door_no} 문
                </strong>
                <span className={`grade grade-${item.grade.toLowerCase()}`}>{item.grade}</span>
              </div>
              <p className="score-text">좌석 회전 점수 {Math.round(item.score)}점</p>
              <p className="window-text">예상 기회 구간: {item.expected_seat_window}</p>
              <ul>
                {item.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <TrainLayout layout={layout} recommendations={recommendation.recommendations} />

      <div className="cautions">
        {recommendation.cautions.map((caution) => (
          <p key={caution}>{caution}</p>
        ))}
      </div>
    </section>
  );
}

function TrainLayout({
  layout,
  recommendations
}: {
  layout: TrainLayoutResponse;
  recommendations: Recommendation[];
}) {
  const rankedDoors = new Map(
    recommendations.map((recommendation) => [
      `${recommendation.car_no}-${recommendation.door_no}`,
      recommendation.rank
    ])
  );

  return (
    <section className="train-layout" aria-label="열차 위치">
      <div className="layout-meta">
        <h3>열차 위치</h3>
        <span>
          {layout.car_count}량 · 칸당 {layout.doors_per_car}문
        </span>
      </div>
      <div className="train-scroll">
        {Array.from({ length: layout.car_count }, (_, carIndex) => {
          const carNo = carIndex + 1;
          return (
            <div className="car-column" key={carNo}>
              <div className="car-label">{carNo}호차</div>
              {Array.from({ length: layout.doors_per_car }, (_, doorIndex) => {
                const doorNo = doorIndex + 1;
                const rank = rankedDoors.get(`${carNo}-${doorNo}`);
                return (
                  <div className={rank ? "door-cell door-highlight" : "door-cell"} key={doorNo}>
                    <span>
                      {carNo}-{doorNo}
                    </span>
                    {rank ? <strong>{rank}위</strong> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="source-text">레이아웃 출처: {layout.source}</p>
    </section>
  );
}

function defaultDatetime() {
  const now = new Date();
  now.setHours(8, 30, 0, 0);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}T08:30`;
}

function preferredStation(stations: StationOption[], stationName: string, fallbackIndex: number) {
  return (
    stations.find((station) => station.station_name === stationName)?.station_name ??
    stations[fallbackIndex]?.station_name ??
    ""
  );
}

function toApiDatetime(value: string) {
  return value.length === 16 ? `${value}:00+09:00` : `${value}+09:00`;
}

function toSetupMessage(dataStatus: DataStatusResponse) {
  switch (dataStatus.status) {
    case "MISSING_DATABASE_URL":
      return "운영 DB 연결 정보가 아직 설정되지 않았습니다.";
    case "SCHEMA_MISSING":
      return "DB는 연결됐지만 스키마가 생성되지 않았습니다.";
    case "DATA_MISSING":
      return "DB는 연결됐지만 추천에 필요한 공공데이터 적재가 끝나지 않았습니다.";
    case "DATABASE_ERROR":
      return "DB 상태 확인 중 오류가 발생했습니다.";
    default:
      return dataStatus.message;
  }
}
