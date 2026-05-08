"use client";

import {
  AlertCircle,
  Clock3,
  MapPin,
  Search,
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
  train_layout: TrainLayoutResponse | null;
}

interface TrainLayoutResponse {
  line_no: string;
  direction: string;
  car_count: number;
  doors_per_car: number;
  source: string;
  confidence: number;
}

interface LineOption {
  line_no: string;
  label: string;
  stations: StationOption[];
}

interface TransitLinesResponse {
  generated_at: string | null;
  lines: LineOption[];
}

export function HomeClient() {
  const [lineOptions, setLineOptions] = useState<LineOption[]>([]);
  const [lineNo, setLineNo] = useState("");
  const [stations, setStations] = useState<StationOption[]>([]);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [datetime, setDatetime] = useState(defaultDatetime());
  const [recommendation, setRecommendation] = useState<RecommendationResponse | null>(null);
  const [layout, setLayout] = useState<TrainLayoutResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [stationLoading, setStationLoading] = useState(false);
  const [error, setError] = useState("");
  const [lineLoading, setLineLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadTransitLines() {
      try {
        const response = await fetch("/transit-lines.json", { cache: "force-cache" });
        const payload = (await response.json()) as TransitLinesResponse;
        if (!response.ok) {
          throw new Error("노선 데이터를 불러오지 못했습니다.");
        }
        if (ignore) {
          return;
        }

        const nextLines = sortLines(payload.lines ?? []);
        setLineOptions(nextLines);
        if (nextLines.length === 0) {
          setError("배포된 노선 데이터가 비어 있습니다. 데이터 수집과 정적 노선 파일 생성을 확인해주세요.");
        }
      } catch (nextError) {
        if (!ignore) {
          setError(nextError instanceof Error ? nextError.message : "노선 데이터를 불러오지 못했습니다.");
        }
      } finally {
        if (!ignore) {
          setLineLoading(false);
        }
      }
    }

    loadTransitLines();

    return () => {
      ignore = true;
    };
  }, []);

  const originOrder = useMemo(
    () => stations.find((station) => station.station_name === origin)?.sequence_no ?? 0,
    [origin, stations]
  );
  const destinationOrder = useMemo(
    () => stations.find((station) => station.station_name === destination)?.sequence_no ?? 0,
    [destination, stations]
  );

  const direction = useMemo(
    () =>
      originOrder > 0 && destinationOrder > 0 && origin !== destination
        ? originOrder < destinationOrder
          ? "오금"
          : "대화"
        : "",
    [destinationOrder, origin, originOrder]
  );
  const canSubmit = Boolean(
    !lineLoading &&
      lineNo &&
      origin &&
      destination &&
      datetime &&
      direction &&
      !loading &&
      !stationLoading
  );

  function applyStations(nextStations: StationOption[]) {
    setStations(nextStations);
    setOrigin("");
    setDestination("");
    setRecommendation(null);
    setLayout(null);
  }

  function handleLineChange(nextLineNo: string) {
    setLineNo(nextLineNo);
    setError("");

    if (!nextLineNo) {
      applyStations([]);
      return;
    }

    setStationLoading(true);
    const selectedLine = lineOptions.find((line) => line.line_no === nextLineNo);
    applyStations(selectedLine?.stations ?? []);
    setStationLoading(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!direction) {
      setError("승차역과 하차역을 같은 노선 내에서 순서가 다른 방향으로 선택해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    setRecommendation(null);
    setLayout(null);

    try {
      const query = new URLSearchParams({
        origin,
        destination,
        line_no: lineNo,
        direction,
        datetime: toApiDatetime(datetime),
        mode: "seat"
      });
      const recommendationResponse = await fetch(`/api/v1/recommendations?${query.toString()}`);
      const recommendationPayload = await recommendationResponse.json();

      if (!recommendationResponse.ok) {
        throw new Error(recommendationPayload.error?.message ?? "추천을 계산하지 못했습니다.");
      }
      if (!recommendationPayload.train_layout) {
        throw new Error("열차 레이아웃을 불러오지 못했습니다.");
      }

      setRecommendation(recommendationPayload);
      setLayout(recommendationPayload.train_layout);
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
          <p>호선별 좌석각 위치 추천</p>
        </div>
      </section>

      <form className="search-panel" onSubmit={handleSubmit}>
        <label className="field">
          <span>
            <TrainFront size={16} aria-hidden="true" />
            호선
          </span>
          <select
            value={lineNo}
            onChange={(event) => handleLineChange(event.target.value)}
            disabled={lineLoading}
          >
            <option value="">호선 선택</option>
            {lineOptions.map((line) => (
              <option key={line.line_no} value={line.line_no}>
                {line.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>
            <MapPin size={16} aria-hidden="true" />
            승차역
          </span>
          <select
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            disabled={!lineNo || stationLoading || stations.length === 0}
          >
            <option value="">승차역 선택</option>
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
            하차역
          </span>
          <select
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            disabled={!lineNo || stationLoading || stations.length === 0}
          >
            <option value="">하차역 선택</option>
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
              step="1800"
              value={datetime}
              onChange={(event) => setDatetime(event.target.value)}
            />
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

      {recommendation && layout ? (
        <ResultView recommendation={recommendation} layout={layout} />
      ) : lineOptions.length > 0 ? (
        <section className="empty-state">
          <TrainFront size={20} aria-hidden="true" />
          <p>호선을 먼저 선택한 뒤 승차역과 하차역을 고르세요.</p>
        </section>
      ) : null}
    </main>
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
        <span className="line-chip">
          {recommendation.line_no}호선 {recommendation.direction} 방면
        </span>
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
              <p className="score-text">좌석각 점수 {Math.round(item.score)}점</p>
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
              <div
                className="door-row"
                style={{ gridTemplateColumns: `repeat(${layout.doors_per_car}, minmax(0, 1fr))` }}
              >
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
            </div>
          );
        })}
      </div>
      <p className="source-text">레이아웃 출처: {layout.source}</p>
    </section>
  );
}

function sortLines(lines: LineOption[]) {
  const nextLines = [...lines];
  nextLines.sort((left, right) => {
    const leftNo = Number(left.line_no);
    const rightNo = Number(right.line_no);
    if (Number.isFinite(leftNo) && Number.isFinite(rightNo) && leftNo !== rightNo) {
      return leftNo - rightNo;
    }
    return left.line_no.localeCompare(right.line_no);
  });
  return nextLines;
}

function defaultDatetime() {
  const now = new Date();
  now.setMinutes(Math.ceil((now.getMinutes() + 5) / 30) * 30, 0, 0);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function toApiDatetime(value: string) {
  return value.length === 16 ? `${value}:00+09:00` : `${value}+09:00`;
}
