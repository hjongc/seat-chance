"use client";

import {
  AlertCircle,
  CalendarDays,
  Clock3,
  MapPin,
  Search,
  TrainFront
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { directionLabel, inferDirectionName } from "@/lib/directions";

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

type DayType = "WEEKDAY" | "WEEKEND";

const dayTypeOptions: Array<{ value: DayType; label: string }> = [
  { value: "WEEKDAY", label: "평일" },
  { value: "WEEKEND", label: "주말·공휴일" }
];

export function HomeClient() {
  const [lineOptions, setLineOptions] = useState<LineOption[]>([]);
  const [lineNo, setLineNo] = useState("");
  const [stations, setStations] = useState<StationOption[]>([]);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [dayType, setDayType] = useState<DayType>("WEEKDAY");
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
      <header className="topbar" aria-label="서비스 요약">
        <a className="brand-lockup" href="#seat-search" aria-label="앉을각 검색으로 이동">
          <span className="brand-mark">
            <TrainFront size={22} aria-hidden="true" />
          </span>
          <span>
            <strong>앉을각</strong>
            <span>Seat Chance</span>
          </span>
        </a>
        <a className="topbar-cta" href="#seat-search">
          추천 시작
        </a>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="hero-copy">
          <p className="hero-eyebrow">Seoul Metro Seat Planner</p>
          <h1 id="landing-title">앉을각</h1>
          <p className="hero-lede">
            승차역, 하차역, 출발 시간을 바탕으로 어느 칸의 어느 문 앞에 서야 할지 바로 정합니다.
          </p>
          <div className="hero-actions" role="group" aria-label="주요 동작">
            <a className="hero-primary" href="#seat-search">
              <Search size={18} aria-hidden="true" />
              좌석각 찾기
            </a>
            <span className="hero-secondary">칸·문 단위 추천</span>
          </div>
          <dl className="hero-metrics" aria-label="서비스 범위">
            <div>
              <dt>지원 노선</dt>
              <dd>{lineLoading ? "확인 중" : `${lineOptions.length}개`}</dd>
            </div>
            <div>
              <dt>추천 단위</dt>
              <dd>칸·문</dd>
            </div>
            <div>
              <dt>출발 기준</dt>
              <dd>30분</dd>
            </div>
          </dl>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="visual-route">
            <span />
            <span />
            <span />
          </div>
          <div className="visual-card">
            <span>추천 1순위</span>
            <strong>3-2 문</strong>
            <p>하차 수요와 환승 흐름이 만나는 구간</p>
          </div>
          <div className="visual-train">
            {["2-1", "2-2", "3-1", "3-2", "4-1", "4-2"].map((door) => (
              <span className={door === "3-2" ? "visual-door visual-door-active" : "visual-door"} key={door}>
                {door}
              </span>
            ))}
          </div>
        </div>
      </section>

      <form className="search-panel" id="seat-search" onSubmit={handleSubmit}>
        <div className="search-panel-header">
          <div>
            <p className="section-eyebrow">추천 조건</p>
            <h2>출발 전에 위치를 정하세요</h2>
          </div>
          <span className="search-status">
            {direction ? `${lineNo}호선 ${directionLabel(lineNo, direction)}` : "경로 입력"}
          </span>
        </div>

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

        <button className="primary-action" type="submit" disabled={!canSubmit}>
          <Search size={18} aria-hidden="true" />
          {loading ? "계산 중" : "좌석각 추천 받기"}
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
          {recommendation.line_no}호선 {directionLabel(recommendation.line_no, recommendation.direction)} ·{" "}
          {formatDayType(recommendation.day_type)} {recommendation.time_slot}
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
              <div className="door-row">
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

function ComboBox({
  value,
  options,
  placeholder,
  disabled,
  onChange
}: {
  value: string;
  options: ComboOption[];
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
    const matches = options.filter((option) => matchesSearch(option.label, query) || matchesSearch(option.value, query));
    return matches.slice(0, 24);
  }, [options, query]);
  const activeOption = filteredOptions[activeIndex];

  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, options]);

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
      setActiveIndex((index) => Math.min(index + 1, Math.max(filteredOptions.length - 1, 0)));
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
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => (
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
                key={option.value}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
                role="option"
                tabIndex={-1}
                type="button"
              >
                {option.label}
              </button>
            ))
          ) : (
            <div className="combo-empty">검색 결과 없음</div>
          )}
        </div>
      ) : null}
    </div>
  );
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
