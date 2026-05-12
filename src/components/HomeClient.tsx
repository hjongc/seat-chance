"use client";

import {
  AlertCircle,
  CalendarDays,
  ChevronRight,
  Clock3,
  MapPin,
  Search,
  TrainFront
} from "lucide-react";
import { FormEvent, KeyboardEvent, ReactNode, useEffect, useId, useMemo, useState } from "react";
import { currentKoreaDayType } from "@/lib/day-type";
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

interface ComboOption {
  value: string;
  label: string;
}

interface ScoredStationOption {
  option: ComboOption;
  score: number;
  sequenceNo: number;
}

interface MetricItem {
  label: string;
  value: string;
  detail: string;
  tone?: "accent" | "success";
}

const featuredStationNames = new Set([
  "가락시장",
  "강남",
  "건대입구",
  "고속터미널",
  "공덕",
  "광화문",
  "교대",
  "김포공항",
  "노원",
  "대림",
  "동대문",
  "동대문역사문화공원",
  "명동",
  "사당",
  "삼성",
  "서울역",
  "선릉",
  "수서",
  "시청",
  "신도림",
  "신림",
  "신촌",
  "압구정",
  "여의도",
  "영등포구청",
  "오금",
  "올림픽공원",
  "왕십리",
  "을지로3가",
  "잠실",
  "종로3가",
  "충무로",
  "합정",
  "혜화",
  "홍대입구"
]);

const dayTypeOptions: Array<{ value: DayType; label: string }> = [
  { value: "WEEKDAY", label: "평일" },
  { value: "WEEKEND", label: "주말·공휴일" }
];
const emptyComboOptions: ComboOption[] = [];
const previewDoors = ["1-2", "2-2", "3-2", "4-2", "5-2"];

export function HomeClient() {
  const [lineOptions, setLineOptions] = useState<LineOption[]>([]);
  const [lineNo, setLineNo] = useState("");
  const [stations, setStations] = useState<StationOption[]>([]);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [dayType, setDayType] = useState<DayType>(currentKoreaDayType());
  const [timeSlot, setTimeSlot] = useState(defaultTimeSlot());
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
  const lineComboOptions = useMemo(
    () => lineOptions.map((line) => ({ value: line.line_no, label: line.label })),
    [lineOptions]
  );
  const stationComboOptions = useMemo(
    () => stations.map((station) => ({ value: station.station_name, label: station.station_name })),
    [stations]
  );
  const stationLineCounts = useMemo(() => countStationLineAppearances(lineOptions), [lineOptions]);
  const featuredStationComboOptions = useMemo(
    () => buildFeaturedStationOptions(stations, stationLineCounts),
    [stationLineCounts, stations]
  );

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

  const heroMetrics: MetricItem[] = [
    {
      label: "추천 단위",
      value: "칸·문",
      detail: "열차 안에서 바로 찾을 수 있는 수준까지 안내",
      tone: "accent"
    },
    {
      label: "빠른 선택",
      value: lineNo ? `${featuredStationComboOptions.length}개` : "대표 역",
      detail: lineNo ? "환승역과 종점 우선" : "노선을 고르면 주요 역을 먼저 노출",
      tone: "success"
    },
    {
      label: "시간 해상도",
      value: "30분",
      detail: `${formatDayType(dayType)} ${formatTimeRange(timeSlot)} 기준`
    }
  ];

  const supportMetrics: MetricItem[] = [
    {
      label: "지원 노선",
      value: lineLoading ? "확인 중" : `${lineOptions.length}개`,
      detail: "배포된 정적 노선 데이터 기준"
    },
    {
      label: "현재 선택",
      value: lineNo ? lineDisplayLabel(lineNo) : "대기 중",
      detail: lineNo ? `${stations.length}개 역` : "호선을 고르면 역 검색이 열립니다.",
      tone: lineNo ? "accent" : undefined
    },
    {
      label: "탑승 방향",
      value: direction ? directionLabel(lineNo, direction) : "자동 계산 대기",
      detail: direction ? `${origin} → ${destination}` : "승차역과 하차역 선택 후 계산"
    }
  ];

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
        day_type: dayType,
        time_slot: timeSlot,
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

        <div className="header-actions">
          <span className="status-chip status-chip-muted">{lineLoading ? "노선 동기화 중" : `${lineOptions.length}개 노선 준비`}</span>
          <a className="text-link" href="#seat-search">
            검색 열기
            <ChevronRight size={14} aria-hidden="true" />
          </a>
        </div>
      </header>

      <section className="hero-grid" aria-labelledby="app-title">
        <div className="hero-copy">
          <p className="eyebrow">Seoul Metro Seat Planner</p>
          <h1 className="hero-title" id="app-title">
            서서 기다리는 시간을
            <br />
            앉을 가능성으로 바꿉니다.
          </h1>
          <p className="hero-lede">
            승차역, 하차역, 출발 시간만 입력하면 어느 칸의 어느 문 앞에 서야 할지 빠르게 정리합니다.
          </p>

          <div className="hero-actions">
            <a className="cta-link cta-primary" href="#seat-search">
              <Search size={18} aria-hidden="true" />
              추천 시작
            </a>
            <p className="hero-caption">{readinessMessage}</p>
          </div>

          <MetricGrid compact items={heroMetrics} />
        </div>

        <aside className="hero-panel product-panel" aria-label="서비스 미리보기">
          <div className="hero-panel-top">
            <div>
              <p className="eyebrow">How It Works</p>
              <h2>탑승 전에 보는 승차 전략</h2>
              <p>노선 선택부터 결과 비교까지, 이동 중에도 읽기 쉽게 정리합니다.</p>
            </div>
            <span className="status-chip">칸·문 단위 추천</span>
          </div>

          <div className="hero-preview" aria-hidden="true">
            <div className="preview-line" />
            <div className="preview-rail">
              {previewDoors.map((door, index) => (
                <div className={index === 2 ? "preview-car preview-car-active" : "preview-car"} key={door}>
                  <span>{door}</span>
                  <strong>{index === 2 ? "1순위" : `${index + 2}순위`}</strong>
                </div>
              ))}
            </div>
            <div className="preview-card">
              <p>예시 결과</p>
              <strong>3-2 문</strong>
              <span>하차 흐름과 승차 분산이 만나는 구간</span>
            </div>
          </div>

          <ul className="signal-list">
            <li>승차역과 하차역 순서를 읽어 방향을 자동 계산합니다.</li>
            <li>추천 결과는 1순위와 대안 위치를 함께 보여줍니다.</li>
            <li>열차 배치를 펼쳐 칸별 위치를 다시 확인할 수 있습니다.</li>
          </ul>
        </aside>
      </section>

      <section className="workspace-grid">
        <form className="product-panel search-panel" id="seat-search" aria-labelledby="seat-search-title" onSubmit={handleSubmit}>
          <PanelHeading
            eyebrow="Search"
            title="지금 탈 구간을 입력하세요"
            description="노선, 역, 시간만 고르면 칸과 문 위치를 바로 제안합니다."
            aside={direction ? <span className="status-chip">{directionSummary}</span> : null}
          />

          <div className="search-grid">
            <label className="field">
              <span>
                <TrainFront size={16} aria-hidden="true" />
                호선
              </span>
              <ComboBox
                placeholder="호선 선택 또는 검색"
                value={lineNo}
                options={lineComboOptions}
                onChange={handleLineChange}
                disabled={lineLoading}
              />
            </label>

            <label className="field">
              <span>
                <MapPin size={16} aria-hidden="true" />
                승차역
              </span>
              <ComboBox
                placeholder="승차역 선택 또는 검색"
                value={origin}
                options={stationComboOptions}
                featuredOptions={featuredStationComboOptions}
                onChange={setOrigin}
                disabled={!lineNo || stationLoading || stations.length === 0}
              />
            </label>

            <label className="field">
              <span>
                <MapPin size={16} aria-hidden="true" />
                하차역
              </span>
              <ComboBox
                placeholder="하차역 선택 또는 검색"
                value={destination}
                options={stationComboOptions}
                featuredOptions={featuredStationComboOptions}
                onChange={setDestination}
                disabled={!lineNo || stationLoading || stations.length === 0}
              />
            </label>

            <label className="field">
              <span>
                <CalendarDays size={16} aria-hidden="true" />
                요일 유형
              </span>
              <div className="segmented-control" role="group" aria-label="요일 유형">
                {dayTypeOptions.map((option) => (
                  <button
                    className={dayType === option.value ? "segment-option segment-option-active" : "segment-option"}
                    key={option.value}
                    onClick={() => setDayType(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </label>

            <label className="field">
              <span>
                <Clock3 size={16} aria-hidden="true" />
                출발 시간
              </span>
              <input
                type="time"
                step="1800"
                value={timeSlot}
                onChange={(event) => setTimeSlot(event.target.value)}
              />
            </label>
          </div>

          <div className="search-footer">
            <div className="status-note" aria-live="polite">
              <span className="status-note-label">현재 상태</span>
              <p>{readinessMessage}</p>
            </div>

            <button className="primary-action" type="submit" disabled={!canSubmit}>
              <Search size={18} aria-hidden="true" />
              {loading ? "계산 중" : "앉을각 추천 받기"}
            </button>
          </div>
        </form>

        <aside className="product-panel context-panel" aria-label="추천 기준 안내">
          <PanelHeading
            eyebrow="Guide"
            title="추천 기준"
            description="정보를 덜 보여주는 대신, 검색 직전에 필요한 기준만 남겼습니다."
          />

          <MetricGrid items={supportMetrics} />

          <div className="support-stack">
            <article className="context-card">
              <p className="context-label">빠른 선택</p>
              <strong>{lineNo ? `${featuredStationComboOptions.length}개 후보` : "노선 선택 대기"}</strong>
              <p>
                {lineNo
                  ? "환승역, 종점, 주요 역을 먼저 보여줘 모바일 검색 시간을 줄입니다."
                  : "노선을 선택하면 추천 가능성이 높은 대표 역을 먼저 노출합니다."}
              </p>
            </article>

            <article className="context-card">
              <p className="context-label">검색 흐름</p>
              <ul className="context-list">
                <li>1. 호선을 선택합니다.</li>
                <li>2. 승차역과 하차역을 고릅니다.</li>
                <li>3. 요일 유형과 출발 시간을 맞춘 뒤 결과를 확인합니다.</li>
              </ul>
            </article>
          </div>
        </aside>
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
            <p>호선과 역을 먼저 선택하면, 가장 유리한 칸과 문 위치를 1순위부터 정리합니다.</p>
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

  const resultMetrics: MetricItem[] = [
    {
      label: "1순위 위치",
      value: `${leadRecommendation.car_no}-${leadRecommendation.door_no} 문`,
      detail: `앉을각 ${Math.round(leadRecommendation.score)}점`,
      tone: "accent"
    },
    {
      label: "요일 유형",
      value: formatDayType(recommendation.day_type),
      detail: formatTimeRange(recommendation.time_slot)
    },
    {
      label: "방향",
      value: directionLabel(recommendation.line_no, recommendation.direction),
      detail: `${recommendation.origin} → ${recommendation.destination}`,
      tone: "success"
    }
  ];

  return (
    <section className="result-shell" aria-label="추천 결과">
      <div className="result-heading">
        <div>
          <p className="route-label">
            {recommendation.origin} → {recommendation.destination}
          </p>
          <h2 className="result-title">앉을 가능성이 높은 위치</h2>
        </div>
        <span className="result-chip">
          {lineDisplayLabel(recommendation.line_no)} · {formatDayType(recommendation.day_type)} {recommendation.time_slot}
        </span>
      </div>

      <div className="result-hero-grid">
        <article className="product-panel spotlight-panel">
          <div className="spotlight-top">
            <span className="rank-badge">1위 추천</span>
            <span className={`grade grade-${leadRecommendation.grade.toLowerCase()}`}>{leadRecommendation.grade}</span>
          </div>
          <p className="spotlight-route">{directionLabel(recommendation.line_no, recommendation.direction)} 방향</p>
          <h3 className="spotlight-door">
            {leadRecommendation.car_no}-{leadRecommendation.door_no} 문
          </h3>
          <p className="spotlight-summary">예상 기회 구간 {leadRecommendation.expected_seat_window}</p>

          <MetricGrid compact items={resultMetrics} />

          <div className="reason-pills">
            {leadRecommendation.reasons.map((reason) => (
              <span className="reason-pill" key={reason}>
                {reason}
              </span>
            ))}
          </div>
        </article>

        <aside className="product-panel summary-panel">
          <PanelHeading
            eyebrow="Summary"
            title="이번 검색 요약"
            description="탑승 직전 판단할 수 있게 핵심 정보만 다시 묶었습니다."
          />

          <MetricGrid items={resultMetrics} />

          {recommendation.cautions.length > 0 ? (
            <div className="caution-block">
              <p className="context-label">참고사항</p>
              <ul className="caution-list">
                {recommendation.cautions.map((caution) => (
                  <li key={caution}>{caution}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>

      {alternativeRecommendations.length > 0 ? (
        <div className="alternatives-grid">
          {alternativeRecommendations.map((item) => (
            <RecommendationCard item={item} key={`${item.car_no}-${item.door_no}`} />
          ))}
        </div>
      ) : null}

      <details className="product-panel result-details" open>
        <summary>열차 위치와 칸별 추천 펼쳐 보기</summary>
        <div className="details-body">
          <TrainLayout layout={layout} recommendations={recommendation.recommendations} />
        </div>
      </details>
    </section>
  );
}

function RecommendationCard({ item }: { item: Recommendation }) {
  return (
    <article className="product-panel recommendation-card">
      <div className="recommendation-card-top">
        <span className="rank-badge rank-badge-subtle">{item.rank}위</span>
        <span className={`grade grade-${item.grade.toLowerCase()}`}>{item.grade}</span>
      </div>

      <p className="recommendation-card-route">대안 위치</p>
      <strong>
        {item.car_no}-{item.door_no} 문
      </strong>
      <p className="spotlight-summary">예상 기회 구간 {item.expected_seat_window}</p>
      <p className="recommendation-meta">앉을각 점수 {Math.round(item.score)}점</p>

      <ul className="reason-list">
        {item.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
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
  eyebrow,
  title,
  description,
  aside
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div className="panel-heading-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {aside ? <div className="panel-trailing">{aside}</div> : null}
    </div>
  );
}

function MetricGrid({ compact = false, items }: { compact?: boolean; items: MetricItem[] }) {
  return (
    <dl className={compact ? "metric-grid metric-grid-compact" : "metric-grid"}>
      {items.map((item) => (
        <div className={item.tone ? `metric-card metric-card-${item.tone}` : "metric-card"} key={`${item.label}-${item.value}`}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          <p>{item.detail}</p>
        </div>
      ))}
    </dl>
  );
}

function ComboBox({
  value,
  options,
  featuredOptions = emptyComboOptions,
  placeholder,
  disabled,
  onChange
}: {
  value: string;
  options: ComboOption[];
  featuredOptions?: ComboOption[];
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? "";
  const filteredOptions = useMemo(() => {
    return options.filter((option) => matchesSearch(option.label, query) || matchesSearch(option.value, query));
  }, [options, query]);
  const showFeaturedOptions = !normalizeSearchText(query) && featuredOptions.length > 0;
  const featuredValues = useMemo(() => new Set(featuredOptions.map((option) => option.value)), [featuredOptions]);
  const regularOptions = useMemo(
    () => (showFeaturedOptions ? filteredOptions.filter((option) => !featuredValues.has(option.value)) : filteredOptions),
    [featuredValues, filteredOptions, showFeaturedOptions]
  );
  const displayedOptions = showFeaturedOptions ? [...featuredOptions, ...regularOptions] : filteredOptions;
  const activeOption = displayedOptions[activeIndex];

  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  useEffect(() => {
    setActiveIndex(0);
  }, [featuredOptions, options, query]);

  function handleQueryChange(nextQuery: string) {
    setQuery(nextQuery);
    setOpen(true);
    if (value && nextQuery !== selectedLabel) {
      onChange("");
    }
  }

  function selectOption(option: ComboOption) {
    setQuery(option.label);
    setOpen(false);
    onChange(option.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(displayedOptions.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter" && open && activeOption) {
      event.preventDefault();
      selectOption(activeOption);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="combo-box">
      <input
        aria-activedescendant={open && activeOption ? optionId(inputId, activeOption.value) : undefined}
        aria-autocomplete="list"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open && !disabled}
        aria-haspopup="listbox"
        autoComplete="off"
        disabled={disabled}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => handleQueryChange(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role="combobox"
        value={query}
      />
      {open && !disabled ? (
        <div className="combo-menu" id={listboxId} role="listbox">
          {displayedOptions.length > 0 ? (
            showFeaturedOptions ? (
              <>
                <div className="combo-section-label" role="presentation">
                  빠른 선택
                </div>
                {featuredOptions.map((option, index) => renderComboOption(option, index))}
                {regularOptions.length > 0 ? (
                  <div className="combo-section-label" role="presentation">
                    전체 역
                  </div>
                ) : null}
                {regularOptions.map((option, index) => renderComboOption(option, featuredOptions.length + index))}
              </>
            ) : (
              filteredOptions.map((option, index) => renderComboOption(option, index))
            )
          ) : (
            <div className="combo-empty">검색 결과 없음</div>
          )}
        </div>
      ) : null}
    </div>
  );

  function renderComboOption(option: ComboOption, index: number) {
    return (
      <button
        aria-selected={option.value === value}
        className={[
          "combo-option",
          option.value === value ? "combo-option-selected" : "",
          index === activeIndex ? "combo-option-active" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        id={optionId(inputId, option.value)}
        key={`${index}-${option.value}`}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => selectOption(option)}
        role="option"
        tabIndex={-1}
        type="button"
      >
        {option.label}
      </button>
    );
  }
}

function optionId(inputId: string, value: string) {
  return `${inputId}-option-${value.replace(/\s+/g, "-")}`;
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

function buildFeaturedStationOptions(
  stations: StationOption[],
  stationLineCounts: Map<string, number>
): ComboOption[] {
  const scoredStations = stations
    .map<ScoredStationOption | null>((station, index) => {
      const normalizedName = normalizeStationName(station.station_name);
      const transferLineCount = stationLineCounts.get(normalizedName) ?? 1;
      const isTerminal = index === 0 || index === stations.length - 1;
      const isTransfer = transferLineCount > 1;
      const isFeaturedByName = featuredStationNames.has(normalizedName);
      const score = (isTransfer ? transferLineCount * 10 : 0) + (isFeaturedByName ? 7 : 0) + (isTerminal ? 4 : 0);

      if (score === 0) {
        return null;
      }

      return {
        option: { value: station.station_name, label: station.station_name },
        score,
        sequenceNo: station.sequence_no
      };
    })
    .filter((station): station is ScoredStationOption => station !== null);

  return scoredStations
    .sort((left, right) => right.score - left.score || left.sequenceNo - right.sequenceNo)
    .slice(0, 6)
    .sort((left, right) => left.sequenceNo - right.sequenceNo)
    .map((station) => station.option);
}

function countStationLineAppearances(lines: LineOption[]) {
  const counts = new Map<string, number>();

  for (const line of lines) {
    const lineStationNames = new Set(line.stations.map((station) => normalizeStationName(station.station_name)));
    for (const stationName of lineStationNames) {
      counts.set(stationName, (counts.get(stationName) ?? 0) + 1);
    }
  }

  return counts;
}

function normalizeStationName(value: string) {
  return value.replace(/\([^)]*\)/g, "").trim();
}

function lineDisplayLabel(lineNo: string) {
  if (!lineNo) {
    return "노선";
  }
  return /^\d+$/.test(lineNo) ? `${lineNo}호선` : lineNo;
}

function matchesSearch(label: string, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }
  const normalizedLabel = normalizeSearchText(label);
  return normalizedLabel.includes(normalizedQuery) || chosung(label).includes(normalizedQuery);
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s/g, "");
}

function chosung(value: string) {
  const initials = [
    "ㄱ",
    "ㄲ",
    "ㄴ",
    "ㄷ",
    "ㄸ",
    "ㄹ",
    "ㅁ",
    "ㅂ",
    "ㅃ",
    "ㅅ",
    "ㅆ",
    "ㅇ",
    "ㅈ",
    "ㅉ",
    "ㅊ",
    "ㅋ",
    "ㅌ",
    "ㅍ",
    "ㅎ"
  ];
  return Array.from(value)
    .map((char) => {
      const code = char.charCodeAt(0) - 0xac00;
      if (code < 0 || code > 11171) {
        return char.toLowerCase();
      }
      return initials[Math.floor(code / 588)] ?? "";
    })
    .join("");
}

function defaultTimeSlot() {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  kstNow.setUTCMinutes(Math.ceil((kstNow.getUTCMinutes() + 5) / 30) * 30, 0, 0);
  return `${String(kstNow.getUTCHours()).padStart(2, "0")}:${String(kstNow.getUTCMinutes()).padStart(2, "0")}`;
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
