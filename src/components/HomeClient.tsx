"use client";

import {
  AlertCircle,
  CalendarDays,
  Clock3,
  MapPin,
  Search,
  TrainFront
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { currentKoreaDateInputValue, dayTypeForKoreaDateInputValue } from "@/lib/day-type";
import { directionLabel, inferDirectionName } from "@/lib/directions";
import type { DayType } from "@/lib/types";

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
  day_type: DayType;
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

interface LineDataCoverage {
  line_no: string;
  station_rows: number;
  raw_station_rows?: number;
  ridership_rows: number;
  train_layout_rows: number;
  estimated_train_layout?: boolean;
  congestion_rows: number;
  door_hint_rows: number;
  station_congestion_rows: number;
  transfer_demand_rows: number;
  missing_recommendation_inputs?: string[];
  quality_warnings?: string[];
  recommendable: boolean;
}

interface DataStatusResponse {
  ready: boolean;
  status: string;
  message: string;
  line_coverage?: LineDataCoverage[];
  recommendable_line_count?: number;
}

interface ComboOption {
  value: string;
  label: string;
}

const timeSlotOptions = buildTimeSlotOptions();

export function HomeClient() {
  const [lineOptions, setLineOptions] = useState<LineOption[]>([]);
  const [lineNo, setLineNo] = useState("");
  const [stations, setStations] = useState<StationOption[]>([]);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departureDate, setDepartureDate] = useState(currentKoreaDateInputValue());
  const [timeSlot, setTimeSlot] = useState(defaultTimeSlot());
  const [recommendation, setRecommendation] = useState<RecommendationResponse | null>(null);
  const [layout, setLayout] = useState<TrainLayoutResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [stationLoading, setStationLoading] = useState(false);
  const [error, setError] = useState("");
  const [lineLoading, setLineLoading] = useState(true);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [lineCoverage, setLineCoverage] = useState<LineDataCoverage[]>([]);

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

  useEffect(() => {
    let ignore = false;

    async function loadDataStatus() {
      try {
        const response = await fetch("/api/v1/data-status", { cache: "no-store" });
        const payload = (await response.json()) as DataStatusResponse;
        if (!response.ok) {
          throw new Error(payload.message || "추천 데이터 상태를 확인하지 못했습니다.");
        }
        if (!ignore) {
          setLineCoverage(payload.line_coverage ?? []);
        }
      } catch {
        if (!ignore) {
          setLineCoverage([]);
        }
      } finally {
        if (!ignore) {
          setCoverageLoading(false);
        }
      }
    }

    loadDataStatus();

    return () => {
      ignore = true;
    };
  }, []);

  const directionStations = useMemo(
    () => stations.map((station) => ({ stationName: station.station_name, sequenceNo: station.sequence_no })),
    [stations]
  );
  const direction = useMemo(() => {
    if (!lineNo || !origin || !destination || origin === destination) {
      return "";
    }

    try {
      return inferDirectionName(lineNo, directionStations, origin, destination);
    } catch {
      return "";
    }
  }, [destination, directionStations, lineNo, origin]);
  const dayType = useMemo(() => dayTypeForKoreaDateInputValue(departureDate), [departureDate]);
  const departureDateTime = `${departureDate}T${timeSlot}:00+09:00`;
  const canSubmit = Boolean(
    !lineLoading &&
      lineNo &&
      origin &&
      destination &&
      dayType &&
      timeSlot &&
      direction &&
      !loading &&
      !stationLoading
  );
  const coverageByLine = useMemo(
    () => new Map(lineCoverage.map((coverage) => [coverage.line_no, coverage])),
    [lineCoverage]
  );
  const selectedLineCoverage = lineNo ? coverageByLine.get(lineNo) : undefined;
  const heroMeta = buildHeroMeta({
    lineLoading,
    coverageLoading,
    lineCount: lineOptions.length,
    recommendableLineCount: lineCoverage.filter((coverage) => coverage.recommendable).length
  });
  const lineDataNote = buildLineDataNote({
    lineNo,
    coverageLoading,
    selectedLineCoverage
  });

  const directionSummary = direction ? `${lineDisplayLabel(lineNo)} ${directionLabel(lineNo, direction)}` : "방향 자동 계산";
  const readinessMessage = lineLoading
    ? "노선 데이터를 확인하는 중입니다."
    : !lineNo
      ? "호선을 먼저 선택하면 역 목록과 빠른 선택이 열립니다."
      : stationLoading
        ? `${lineDisplayLabel(lineNo)}의 역 목록을 준비하는 중입니다.`
        : !origin || !destination
          ? `${lineDisplayLabel(lineNo)}에서 승차역과 하차역을 고르세요.`
          : !direction
            ? "서로 다른 역을 선택하면 방향이 자동으로 계산됩니다."
            : `${directionSummary} 기준 ${formatDayType(dayType)} ${formatTimeRange(timeSlot)} 추천을 준비했습니다.`;

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

  function handleDepartureDateChange(nextDate: string) {
    if (nextDate) {
      setDepartureDate(nextDate);
    }
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
        datetime: departureDateTime,
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
      <header className="app-header" aria-label="서비스 헤더">
        <a className="brand-lockup" href="#seat-search" aria-label="앉을각 검색으로 이동">
          <span className="brand-mark">
            <TrainFront size={20} aria-hidden="true" />
          </span>
          <span className="brand-copy">
            <strong>앉을각</strong>
            <span>Seat Chance</span>
          </span>
        </a>
      </header>

      <section className="hero-shell" aria-labelledby="app-title">
        <div className="hero-copy">
          <p className="eyebrow">Seoul Metro Seat Planner</p>
          <h1 className="hero-title" id="app-title">
            <span className="hero-title-line">서서 기다리는 시간을</span>
            {" "}
            <span className="hero-title-line">앉을 가능성으로 바꿉니다.</span>
          </h1>
          <p className="hero-lede">
            승차역, 하차역, 출발 시간만 입력하면 어느 칸의 어느 문 앞에 서야 할지 빠르게 정리합니다.
          </p>

          <div className="hero-actions">
            <a className="cta-link cta-primary" href="#seat-search">
              <Search size={18} aria-hidden="true" />
              추천 시작
            </a>
          </div>

          <p className="hero-meta">
            {heroMeta}
          </p>
        </div>
      </section>

      <section className="search-shell">
        <form className="product-panel search-panel" id="seat-search" aria-labelledby="seat-search-title" onSubmit={handleSubmit}>
          <PanelHeading
            id="seat-search-title"
            eyebrow="Search"
            title="지금 탈 구간을 입력하세요"
            description="노선, 역, 시간만 고르면 칸과 문 위치를 바로 제안합니다."
          />

          <div className="search-grid">
            <div className="field field-line">
              <span>
                <TrainFront size={16} aria-hidden="true" />
                호선
              </span>
              <select
                aria-label="호선"
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
            </div>

            <div className="field field-origin">
              <span>
                <MapPin size={16} aria-hidden="true" />
                승차역
              </span>
              <select
                aria-label="승차역"
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
            </div>

            <div className="field field-destination">
              <span>
                <MapPin size={16} aria-hidden="true" />
                하차역
              </span>
              <select
                aria-label="하차역"
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
            </div>

            <div className="field field-day">
              <span>
                <CalendarDays size={16} aria-hidden="true" />
                출발일
              </span>
              <input
                aria-label="출발일"
                type="date"
                value={departureDate}
                onBlur={(event) => handleDepartureDateChange(event.currentTarget.value)}
                onChange={(event) => handleDepartureDateChange(event.target.value)}
                onInput={(event) => handleDepartureDateChange(event.currentTarget.value)}
              />
            </div>

            <div className="field field-day-type">
              <span>
                <CalendarDays size={16} aria-hidden="true" />
                자동 구분
              </span>
              <div className="auto-day-type" aria-live="polite">
                <strong>{formatDayType(dayType)}</strong>
                <small>날짜 기준 자동 적용</small>
              </div>
            </div>

            <div className="field field-time">
              <span>
                <Clock3 size={16} aria-hidden="true" />
                출발 시간
              </span>
              <select
                aria-label="출발 시간"
                value={timeSlot}
                onChange={(event) => setTimeSlot(event.target.value)}
              >
                {timeSlotOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="search-footer">
            <div className="search-meta">
              <p className="status-note" aria-live="polite">{readinessMessage}</p>
              <p className="support-note">{lineDataNote}</p>
            </div>

            <button className="primary-action" type="submit" disabled={!canSubmit}>
              <Search size={18} aria-hidden="true" />
              {loading ? "계산 중" : "앉을각 추천 받기"}
            </button>
          </div>
        </form>
      </section>

      {error ? (
        <section className="product-panel notice" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <p>{error}</p>
        </section>
      ) : null}

      {recommendation && layout ? (
        <ResultView recommendation={recommendation} layout={layout} />
      ) : lineOptions.length > 0 ? (
        <section className="product-panel empty-state" aria-label="추천 대기 상태">
          <TrainFront size={22} aria-hidden="true" />
          <div className="empty-state-copy">
            <h2>검색 결과는 여기에서 보여줍니다.</h2>
            <p>호선과 역을 먼저 선택하면 가장 유리한 칸과 문 위치를 1순위부터 정리합니다.</p>
          </div>
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
  const [leadRecommendation, ...alternativeRecommendations] = recommendation.recommendations;

  if (!leadRecommendation) {
    return null;
  }

  return (
    <section className="result-shell" aria-label="추천 결과">
      <div className="result-heading">
        <div>
          <p className="route-label">
            {recommendation.origin} → {recommendation.destination}
          </p>
          <h2 className="result-title">앉을 가능성이 높은 위치</h2>
        </div>
        <span className="result-chip">{lineDisplayLabel(recommendation.line_no)} 추천 결과</span>
      </div>

      {recommendation.cautions.length > 0 ? <CautionPanel cautions={recommendation.cautions} /> : null}

      <RecommendationCard item={leadRecommendation} lead />

      {alternativeRecommendations.length > 0 ? (
        <div className="alternatives-grid">
          {alternativeRecommendations.map((item) => (
            <RecommendationCard item={item} key={`${item.car_no}-${item.door_no}`} />
          ))}
        </div>
      ) : null}

      <details className="product-panel result-details">
        <summary>전체 열차 위치 보기</summary>
        <div className="details-body">
          <TrainLayout layout={layout} recommendations={recommendation.recommendations} />
        </div>
      </details>
    </section>
  );
}

function RecommendationCard({
  item,
  lead = false
}: {
  item: Recommendation;
  lead?: boolean;
}) {
  return (
    <article className={lead ? "product-panel recommendation-card recommendation-card-lead" : "product-panel recommendation-card"}>
      <div className="recommendation-card-top">
        <span className={lead ? "rank-badge" : "rank-badge rank-badge-subtle"}>{lead ? "1위 추천" : `${item.rank}위 대안`}</span>
        <span className={`grade grade-${item.grade.toLowerCase()}`}>{item.grade}</span>
      </div>

      <strong className={lead ? "recommendation-door recommendation-door-lead" : "recommendation-door"}>
        {item.car_no}-{item.door_no} 문
      </strong>
      <p className="recommendation-summary">예상 기회 구간 {item.expected_seat_window}</p>
      <p className="recommendation-meta">상대 점수 {Math.round(item.score)}점</p>
      <p className="recommendation-meta-subtle">같은 구간 안에서 비교한 추천 점수</p>
      <ReasonList reasons={item.reasons} />
    </article>
  );
}

function ReasonList({ reasons }: { reasons: string[] }) {
  const visibleReasons = reasons.slice(0, 2);
  const extraReasons = reasons.slice(2);

  return (
    <div className="reason-block">
      {visibleReasons.length > 0 ? <p className="reason-label">핵심 이유</p> : null}
      <ul className="reason-list">
        {visibleReasons.map((reason) => (
          <li className="reason-item" key={reason}>
            {reason}
          </li>
        ))}
      </ul>
      {extraReasons.length > 0 ? (
        <details className="reason-more">
          <summary>상세 근거 {extraReasons.length}개 보기</summary>
          <ul className="reason-list reason-list-extra">
            {extraReasons.map((reason) => (
              <li className="reason-item" key={reason}>
                {reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function CautionPanel({ cautions }: { cautions: string[] }) {
  return (
    <article className="product-panel advisory-panel">
      <p className="context-label">참고사항</p>
      <ul className="caution-list">
        {cautions.map((caution) => (
          <li key={caution}>{caution}</li>
        ))}
      </ul>
    </article>
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
        <div>
          <p className="context-label">열차 배치</p>
          <h3>
            {lineDisplayLabel(layout.line_no)} {directionLabel(layout.line_no, layout.direction)} 방향
          </h3>
        </div>
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
              <div className="door-row">
                {Array.from({ length: layout.doors_per_car }, (_, doorIndex) => {
                  const doorNo = doorIndex + 1;
                  const rank = rankedDoors.get(`${carNo}-${doorNo}`);
                  return (
                    <div className={rank ? "door-cell door-highlight" : "door-cell"} key={doorNo}>
                      <span>
                        {carNo}-{doorNo}
                      </span>
                      {rank ? <strong>{rank}위</strong> : <small>일반</small>}
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

function PanelHeading({
  id,
  eyebrow,
  title,
  description,
  aside
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div className="panel-heading-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
      {aside ? <div className="panel-trailing">{aside}</div> : null}
    </div>
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

function lineDisplayLabel(lineNo: string) {
  if (!lineNo) {
    return "노선";
  }
  return /^\d+$/.test(lineNo) ? `${lineNo}호선` : lineNo;
}

function buildHeroMeta({
  lineLoading,
  coverageLoading,
  lineCount,
  recommendableLineCount
}: {
  lineLoading: boolean;
  coverageLoading: boolean;
  lineCount: number;
  recommendableLineCount: number;
}) {
  if (lineLoading || coverageLoading) {
    return "노선 목록과 추천 데이터 확인 중";
  }

  if (recommendableLineCount > 0) {
    return `추천 데이터 확인 ${recommendableLineCount}개 노선 · 노선 목록 ${lineCount}개`;
  }

  return `노선 목록 ${lineCount}개 · 추천 데이터는 선택 후 확인`;
}

function buildLineDataNote({
  lineNo,
  coverageLoading,
  selectedLineCoverage
}: {
  lineNo: string;
  coverageLoading: boolean;
  selectedLineCoverage: LineDataCoverage | undefined;
}) {
  if (!lineNo) {
    return "호선을 고르면 승차역과 하차역 목록이 열립니다.";
  }
  if (coverageLoading) {
    return "추천 데이터 상태를 확인하는 중입니다.";
  }
  if (!selectedLineCoverage) {
    return `${lineDisplayLabel(lineNo)} 추천 데이터는 계산 시점에 확인합니다.`;
  }
  if (selectedLineCoverage.recommendable && selectedLineCoverage.quality_warnings?.length) {
    const warningLabels = formatQualityWarnings(selectedLineCoverage.quality_warnings);
    return `${lineDisplayLabel(lineNo)}은 제한적 추천 가능: ${warningLabels} 조건으로 계산합니다.`;
  }
  if (selectedLineCoverage.recommendable) {
    return `${lineDisplayLabel(lineNo)}은 승하차·혼잡도·칸문 데이터가 확인된 노선입니다.`;
  }

  const missingLabels = formatMissingRecommendationInputs(selectedLineCoverage.missing_recommendation_inputs ?? []);
  if (missingLabels) {
    return `${lineDisplayLabel(lineNo)}은 ${missingLabels} 데이터가 부족해 추천 신뢰도가 낮습니다.`;
  }

  return `${lineDisplayLabel(lineNo)}은 일부 추천 데이터가 부족해 결과 신뢰도가 낮을 수 있습니다.`;
}

function formatMissingRecommendationInputs(missingInputs: string[]) {
  const labels = missingInputs
    .map((input) => {
      switch (input) {
        case "station_order":
          return "역 순서";
        case "ridership":
          return "승하차";
        case "train_layout":
          return "열차 편성";
        case "congestion":
          return "혼잡도";
        case "door_hints":
          return "칸문";
        default:
          return "";
      }
    })
    .filter(Boolean);

  return labels.slice(0, 3).join("·");
}

function formatQualityWarnings(warnings: string[]) {
  const labels = warnings
    .map((warning) => {
      switch (warning) {
        case "estimated_train_layout":
          return "편성 추정";
        case "missing_congestion":
          return "혼잡도 미반영";
        default:
          return "";
      }
    })
    .filter(Boolean);

  return labels.join("·");
}

function defaultTimeSlot() {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  kstNow.setUTCMinutes(Math.ceil((kstNow.getUTCMinutes() + 5) / 30) * 30, 0, 0);
  return `${String(kstNow.getUTCHours()).padStart(2, "0")}:${String(kstNow.getUTCMinutes()).padStart(2, "0")}`;
}

function buildTimeSlotOptions(): ComboOption[] {
  const options: ComboOption[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 30]) {
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      options.push({ value, label: formatTimeOption(value) });
    }
  }
  return options;
}

function formatTimeOption(timeSlot: string) {
  const [hoursText, minutesText] = timeSlot.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return timeSlot;
  }

  const period = hours < 12 ? "오전" : "오후";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${period} ${displayHours}:${String(minutes).padStart(2, "0")}`;
}

function formatDayType(dayType: DayType) {
  return dayType === "WEEKDAY" ? "평일" : "주말·공휴일";
}

function formatTimeRange(timeSlot: string) {
  const [hoursText, minutesText] = timeSlot.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return timeSlot;
  }

  const totalMinutes = hours * 60 + minutes + 30;
  const nextHours = Math.floor((totalMinutes / 60) % 24);
  const nextMinutes = totalMinutes % 60;
  return `${timeSlot} ~ ${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
}
