"use client";

import {
  AlertCircle,
  CalendarDays,
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

const dayTypeOptions: Array<{ value: DayType; label: string; ariaLabel: string }> = [
  { value: "WEEKDAY", label: "평일", ariaLabel: "평일" },
  { value: "WEEKEND", label: "주말/휴일", ariaLabel: "주말 및 공휴일" }
];
const emptyComboOptions: ComboOption[] = [];
const FEATURED_STATION_LIMIT = 10;

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
      </header>

      <section className="hero-shell" aria-labelledby="app-title">
        <div className="hero-copy">
          <p className="eyebrow">Seoul Metro Seat Planner</p>
          <h1 className="hero-title" id="app-title">
            <span className="hero-title-line">서서 기다리는 시간을</span>
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
            {lineLoading ? "노선 데이터 준비 중입니다." : `${lineOptions.length}개 노선 지원`}
            {" · "}
            입력 후 바로 추천
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
            <label className="field field-line">
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

            <label className="field field-origin">
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

            <label className="field field-destination">
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

            <label className="field field-day">
              <span>
                <CalendarDays size={16} aria-hidden="true" />
                요일 유형
              </span>
              <div className="segmented-control" role="group" aria-label="요일 유형">
                {dayTypeOptions.map((option) => (
                  <button
                    aria-label={option.ariaLabel}
                    aria-pressed={dayType === option.value}
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

            <label className="field field-time">
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
            <div className="search-meta">
              <p className="status-note" aria-live="polite">{readinessMessage}</p>
              <p className="support-note">역 검색을 열면 환승역과 주요 역을 먼저 보여줍니다.</p>
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
  return (
    <ul className="reason-list">
      {reasons.map((reason) => (
        <li className="reason-item" key={reason}>
          {reason}
        </li>
      ))}
    </ul>
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
    <div className={open ? "combo-box combo-box-open" : "combo-box"}>
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
                  추천 역
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

  const rankedStations = [...scoredStations].sort(
    (left, right) => right.score - left.score || left.sequenceNo - right.sequenceNo
  );

  return rankedStations
    .slice(0, FEATURED_STATION_LIMIT)
    .concat(pickSupplementaryStations(stations, rankedStations, FEATURED_STATION_LIMIT))
    .sort((left, right) => left.sequenceNo - right.sequenceNo)
    .filter((station, index, items) => items.findIndex((item) => item.option.value === station.option.value) === index)
    .slice(0, FEATURED_STATION_LIMIT)
    .map((station) => station.option);
}

function pickSupplementaryStations(
  stations: StationOption[],
  scoredStations: ScoredStationOption[],
  limit: number
): ScoredStationOption[] {
  const selectedValues = new Set(scoredStations.slice(0, limit).map((station) => station.option.value));
  const remainingStations = stations.filter((station) => !selectedValues.has(station.station_name));
  const slots = Math.min(limit - selectedValues.size, remainingStations.length);

  if (slots <= 0) {
    return [];
  }

  const pickedIndices = new Set<number>();
  const supplementaryStations: ScoredStationOption[] = [];

  for (let index = 0; index < slots; index += 1) {
    const candidateIndex = Math.min(
      remainingStations.length - 1,
      Math.floor(((index + 0.5) * remainingStations.length) / slots)
    );
    const resolvedIndex = resolveUnusedIndex(candidateIndex, remainingStations.length, pickedIndices);
    if (resolvedIndex === null) {
      continue;
    }

    pickedIndices.add(resolvedIndex);
    const station = remainingStations[resolvedIndex];
    supplementaryStations.push({
      option: { value: station.station_name, label: station.station_name },
      score: 0,
      sequenceNo: station.sequence_no
    });
  }

  return supplementaryStations;
}

function resolveUnusedIndex(startIndex: number, total: number, used: Set<number>) {
  if (!used.has(startIndex)) {
    return startIndex;
  }

  for (let offset = 1; offset < total; offset += 1) {
    const nextIndex = startIndex + offset;
    if (nextIndex < total && !used.has(nextIndex)) {
      return nextIndex;
    }

    const previousIndex = startIndex - offset;
    if (previousIndex >= 0 && !used.has(previousIndex)) {
      return previousIndex;
    }
  }

  return null;
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
