import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
await loadLocalEnv();

const targetMonth = process.env.TARGET_MONTH || previousKstMonth();
const seoulApiKey = requiredEnv("SEOUL_OPEN_API_KEY");
const dataGoKrApiKey = process.env.DATA_GO_KR_API_KEY ?? "";
const targetLineNos = parseTargetLineNos(process.env.TARGET_LINE_NO || "2,9");
const fetchTimeoutMs = toPositiveInt(process.env.PROBE_REQUEST_TIMEOUT_MS, 30000);
const fetchAttempts = Math.min(Math.max(toPositiveInt(process.env.PROBE_FETCH_ATTEMPTS, 2), 1), 5);
const defaultCsvUrls = {
  TRANSFER:
    "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003605050&fileDetailSn=1&insertDataPrcus=N",
  TRAIN_OPERATION:
    "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003215589&fileDetailSn=1&insertDataPrcus=N",
  CONGESTION:
    "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003630023&fileDetailSn=1&insertDataPrcus=N"
};
const defaultApiTemplates = {
  TRANSFER:
    "https://api.odcloud.kr/api/15098252/v1/uddi:b77326ab-5f86-48a1-bd0f-c72a1fd87e21?page={page}&perPage={perPage}&serviceKey={serviceKey}",
  FAST_EXIT:
    "https://api.seoulmetro.co.kr:21000/viewer/public/call/inout/fstExit?pageNo={page}&numOfRows={perPage}&lineNm={lineNo}%ED%98%B8%EC%84%A0",
  TRAIN_OPERATION:
    "https://api.odcloud.kr/api/3052776/v1/uddi:bccb9559-3b5b-4d4d-94ab-cb03f99fd800?page={page}&perPage={perPage}&serviceKey={serviceKey}",
  CONGESTION:
    "https://api.odcloud.kr/api/15071311/v1/uddi:93f3aca2-a46a-4e30-b797-aa1870dbfa2a?page={page}&perPage={perPage}&serviceKey={serviceKey}"
};

const sharedSources = await readSharedSources();
const lines = [];
const issues = [];

for (const lineNo of targetLineNos) {
  const report = await probeLine(lineNo);
  lines.push(report);
  issues.push(...report.issues.map((issue) => ({ line_no: lineNo, ...issue })));
}

const payload = {
  ok: issues.length === 0,
  target_month: targetMonth,
  lines,
  issues
};

console.log(JSON.stringify(payload, null, 2));
if (issues.length > 0) {
  process.exitCode = 1;
}

async function readSharedSources() {
  const sources = {};
  const fetches = [
    ["transfer", () => fetchOptionalConfiguredRows("TRANSFER", "")],
    ["transfer_demand", () => fetchOptionalConfiguredRows("TRANSFER_DEMAND", "")],
    ["train_operation", () => fetchOptionalConfiguredRows("TRAIN_OPERATION", "")],
    ["congestion", () => fetchOptionalConfiguredRows("CONGESTION", "")]
  ];

  for (const [key, fn] of fetches) {
    try {
      sources[key] = { rows: await fn(), error: "" };
    } catch (error) {
      sources[key] = { rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  return sources;
}

async function probeLine(lineNo) {
  const [stationOrder, ridership, fastExit] = await Promise.all([
    probeStationOrder(lineNo),
    probeRidership(lineNo),
    probeFastExit(lineNo)
  ]);
  const transfer = probeTransferRows(lineNo);
  const transferDemand = probeTransferDemandRows(lineNo);
  const trainOperation = probeTrainOperationRows(lineNo);
  const congestion = probeCongestionRows(lineNo);
  const doorHints = transfer.matching_rows + fastExit.matching_rows;
  const estimatedTrainLayout = trainOperation.usable_rows <= 0 && hasFallbackTrainLayout(lineNo);
  const missingRecommendationInputs = [];
  const qualityWarnings = [];
  const issues = [];
  const warnings = [];

  if (stationOrder.station_rows <= 1) {
    missingRecommendationInputs.push("station_order");
  }
  if (ridership.matching_rows <= 0) {
    missingRecommendationInputs.push("ridership");
  }
  if (trainOperation.usable_rows <= 0 && !estimatedTrainLayout) {
    missingRecommendationInputs.push("train_layout");
  }
  if (congestion.usable_time_slots <= 0) {
    qualityWarnings.push("missing_congestion");
  }
  if (doorHints <= 0) {
    missingRecommendationInputs.push("door_hints");
  }
  if (estimatedTrainLayout) {
    qualityWarnings.push("estimated_train_layout");
  }

  if (lineNo === "2") {
    if (stationOrder.filtered_branch_rows.length > 0) {
      warnings.push({
        code: "SOURCE_LINE_2_BRANCH_ROWS_FILTERED",
        message: "Line 2 source station order includes branch rows before filtering; ingestion keeps the 43-station main loop.",
        sample: stationOrder.filtered_branch_rows.slice(0, 5)
      });
    }
    if (stationOrder.station_rows !== 43) {
      issues.push({
        code: "SOURCE_LINE_2_COUNT",
        message: `Line 2 main loop source station count should be 43, got ${stationOrder.station_rows}.`
      });
    }
  }

  return {
    line_no: lineNo,
    station_order: stationOrder,
    ridership,
    transfer,
    transfer_demand: transferDemand,
    fast_exit: fastExit,
    train_operation: trainOperation,
    congestion,
    door_hint_rows: doorHints,
    estimated_train_layout: estimatedTrainLayout,
    missing_recommendation_inputs: missingRecommendationInputs,
    quality_warnings: qualityWarnings,
    recommendable_if_ingested: missingRecommendationInputs.length === 0,
    warnings,
    issues
  };
}

async function probeStationOrder(lineNo) {
  const rows = await fetchSeoulRows("SearchSTNBySubwayLineInfo", ["", "", Number.isFinite(Number(lineNo)) ? lineNo : ""]);
  const lineRows = rows
    .filter((row) => normalizeLineNo(pick(row, ["LINE_NUM", "호선"])) === lineNo)
    .sort((left, right) => stationOrder(left) - stationOrder(right));
  const filteredRows = lineRows.filter((row) => lineNo !== "2" || isSeoulLineTwoMainLoopStationCode(pick(row, ["STATION_CD", "역코드", "전철역코드"])));
  const filteredBranchRows = lineRows
    .filter((row) => lineNo === "2" && !isSeoulLineTwoMainLoopStationCode(pick(row, ["STATION_CD", "역코드", "전철역코드"])))
    .map((row) => ({
      station_code: stringValue(pick(row, ["STATION_CD", "역코드", "전철역코드"])),
      station_name: normalizeStationName(pick(row, ["STATION_NM", "역명"]))
    }));

  return {
    source_rows: lineRows.length,
    station_rows: filteredRows.length,
    filtered_branch_rows: filteredBranchRows,
    first_stations: filteredRows.slice(0, 5).map((row) => normalizeStationName(pick(row, ["STATION_NM", "역명"])))
  };
}

async function probeRidership(lineNo) {
  for (const month of candidateMonths(targetMonth, 6)) {
    const rows = await fetchSeoulRows("CardSubwayTime", [month]);
    const lineRows = rows.filter(
      (row) => normalizeLineNo(pick(row, ["LINE_NUM", "호선명", "SBWY_ROUT_LN_NM"])) === lineNo
    );
    if (lineRows.length > 0) {
      return { month, matching_rows: lineRows.length };
    }
  }
  return { month: "", matching_rows: 0 };
}

async function probeFastExit(lineNo) {
  try {
    const rows = await fetchOptionalConfiguredRows("FAST_EXIT", lineNo);
    return {
      matching_rows: rows.filter((row) => {
        const rowLineNo = normalizeLineNo(
          pick(row, ["호선", "호선명", "line_no", "LINE_NUM", "SBWY_ROUT_LN", "subwayLine", "lineNm"])
        );
        return rowLineNo === lineNo;
      }).length,
      error: ""
    };
  } catch (error) {
    return {
      matching_rows: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function probeTransferRows(lineNo) {
  const source = sharedSources.transfer;
  return {
    matching_rows: source.rows.filter((row) => normalizeLineNo(pick(row, ["환승시작 호선", "LINE_NUM", "line_no"])) === lineNo).length,
    error: source.error
  };
}

function probeTransferDemandRows(lineNo) {
  const source = sharedSources.transfer_demand;
  if (source.error) {
    return { matching_rows: 0, error: source.error };
  }

  return {
    matching_rows: source.rows.filter((row) => normalizeLineNo(pick(row, ["호선", "호선명", "line_no", "LINE_NUM"])) === lineNo).length,
    error: ""
  };
}

function probeTrainOperationRows(lineNo) {
  const source = sharedSources.train_operation;
  const matchingRows = source.rows.filter((row) => normalizeLineNo(pick(row, ["호선", "LINE NAME", "line_no"])) === lineNo);
  const usableRows = matchingRows.filter((row) =>
    intValue(pick(row, ["편성당칸수", "1편성당 칸수", "VEHICLE ROOM COUNT BY FORMATION", "vehicle_room_count_by_formation"]))
  );

  return {
    matching_rows: matchingRows.length,
    usable_rows: usableRows.length,
    error: source.error
  };
}

function probeCongestionRows(lineNo) {
  const source = sharedSources.congestion;
  const matchingRows = source.rows.filter((row) => normalizeLineNo(pick(row, ["호선", "호선명", "LINE_NUM", "line_no"])) === lineNo);
  const usableTimeSlots = new Set();

  for (const row of matchingRows) {
    const direction = stringValue(pick(row, ["상하선구분", "상하구분", "방향", "direction", "DIRECTION"]));
    const dayType = normalizeDayType(pick(row, ["요일구분", "요일", "day_type", "DAY_TYPE"]));
    if (!direction || !dayType) {
      continue;
    }
    for (const [key, value] of Object.entries(row)) {
      const timeSlot = normalizeCongestionTimeSlot(key);
      const congestionPct = numberValue(value);
      if (timeSlot && congestionPct > 0) {
        usableTimeSlots.add(`${direction}:${dayType}:${timeSlot}`);
      }
    }
  }

  return {
    matching_rows: matchingRows.length,
    usable_time_slots: usableTimeSlots.size,
    error: source.error
  };
}

async function fetchSeoulRows(service, tailSegments = []) {
  const firstUrl = seoulUrl(service, 1, 1000, tailSegments);
  const first = await fetchJson(firstUrl);
  const payload = first[service] ?? first[Object.keys(first)[0]];
  assertSeoulPayload(payload, firstUrl);

  const total = Number(payload.list_total_count ?? payload.ListTotalCount ?? payload.listTotalCount ?? 0);
  const rows = toArray(payload.row);
  if (total <= rows.length) {
    return rows;
  }

  for (let start = 1001; start <= total; start += 1000) {
    const nextUrl = seoulUrl(service, start, Math.min(start + 999, total), tailSegments);
    const next = await fetchJson(nextUrl);
    const nextPayload = next[service] ?? next[Object.keys(next)[0]];
    assertSeoulPayload(nextPayload, nextUrl);
    rows.push(...toArray(nextPayload.row));
  }

  return rows;
}

async function fetchOptionalConfiguredRows(prefix, lineNo) {
  if (!sourceUrl(prefix)) {
    throw new Error(`${prefix}_CSV_URL or ${prefix}_API_URL_TEMPLATE is required.`);
  }
  return await fetchConfiguredRows(prefix, lineNo);
}

async function fetchConfiguredRows(prefix, lineNo) {
  const csvUrl = process.env[`${prefix}_CSV_URL`] || defaultCsvUrls[prefix];
  const template = process.env[`${prefix}_API_URL_TEMPLATE`] || (csvUrl ? "" : defaultApiTemplates[prefix]);

  if (template) {
    const pageSize = Number(process.env[`${prefix}_PAGE_SIZE`] ?? 1000);
    const rows = [];

    for (let page = 1; page <= 100; page += 1) {
      const start = (page - 1) * pageSize + 1;
      const end = page * pageSize;
      const url = fillTemplate(template, lineNo, {
        start: String(start),
        end: String(end),
        page: String(page),
        perPage: String(pageSize)
      });
      const payload = await fetchJson(url);
      const pageRows = extractRows(payload);
      rows.push(...pageRows);

      const total = extractTotalCount(payload);
      if (!templateNeedsPaging(template) || pageRows.length === 0 || (total > 0 && rows.length >= total)) {
        break;
      }
    }

    return rows;
  }

  if (csvUrl) {
    const response = await fetchResource(csvUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${prefix}_CSV_URL: ${response.status} ${response.statusText}`);
    }
    return parseCsv(await decodeCsvResponse(response, process.env[`${prefix}_CSV_ENCODING`]));
  }

  throw new Error(`${prefix}_CSV_URL or ${prefix}_API_URL_TEMPLATE is required.`);
}

function extractRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload?.data) {
    return toArray(payload.data);
  }
  if (payload?.row) {
    return toArray(payload.row);
  }
  if (payload?.body?.items?.item) {
    return toArray(payload.body.items.item);
  }
  if (payload?.response?.body?.items?.item) {
    return toArray(payload.response.body.items.item);
  }

  for (const value of Object.values(payload ?? {})) {
    if (value && typeof value === "object") {
      const rows = extractRows(value);
      if (rows.length > 0) {
        return rows;
      }
    }
  }

  return [];
}

function extractTotalCount(payload) {
  return Number(
    payload?.totalCount ??
      payload?.body?.totalCount ??
      payload?.response?.body?.totalCount ??
      payload?.result?.totalCount ??
      0
  );
}

function seoulUrl(service, start, end, tailSegments) {
  return [
    "http://openapi.seoul.go.kr:8088",
    encodeURIComponent(seoulApiKey),
    "json",
    service,
    String(start),
    String(end),
    ...(tailSegments ?? []).map((segment) => encodeURIComponent(String(segment ?? "")))
  ].join("/");
}

function fillTemplate(template, lineNo, values) {
  return template
    .replaceAll("{key}", dataGoKrApiKey || seoulApiKey)
    .replaceAll("{serviceKey}", dataGoKrApiKey || seoulApiKey)
    .replaceAll("{start}", values.start)
    .replaceAll("{end}", values.end)
    .replaceAll("{page}", values.page)
    .replaceAll("{perPage}", values.perPage)
    .replaceAll("{lineNo}", encodeURIComponent(lineNo))
    .replaceAll("{month}", encodeURIComponent(targetMonth));
}

function templateNeedsPaging(template) {
  return template.includes("{page}") || template.includes("{start}");
}

async function fetchJson(url) {
  const response = await fetchResource(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${redactUrl(url)}: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse JSON from ${redactUrl(url)}: ${text.slice(0, 200)}`);
  }
}

async function fetchResource(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= fetchAttempts; attempt += 1) {
    try {
      return await fetchWithTimeout(url, {
        headers: {
          accept: "application/json,text/csv,text/plain,*/*",
          "user-agent": "seat-chance-probe/0.1"
        },
        timeoutMs: fetchTimeoutMs
      });
    } catch (error) {
      lastError = error;
      if (attempt < fetchAttempts) {
        await wait(250 * attempt);
      }
    }
  }

  throw new Error(
    `Failed to fetch ${redactUrl(url)} after ${fetchAttempts} attempts (${fetchTimeoutMs}ms timeout): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function fetchWithTimeout(url, { headers, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertSeoulPayload(payload, url) {
  const code = payload?.RESULT?.CODE ?? payload?.RESULT?.code;
  if (code && code !== "INFO-000") {
    const message = payload?.RESULT?.MESSAGE ?? "Seoul Open API returned an error.";
    throw new Error(`${redactUrl(url)}: ${code} ${message}`);
  }
}

function parseCsv(text) {
  const rows = [];
  let cell = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) {
    rows.push(row);
  }

  const [headers, ...records] = rows;
  if (!headers) {
    return [];
  }
  const normalizedHeaders = headers.map((header) => header.replace(/^\uFEFF/, "").trim());

  return records.map((record) =>
    Object.fromEntries(normalizedHeaders.map((header, index) => [header, record[index]?.trim() ?? ""]))
  );
}

async function decodeCsvResponse(response, configuredEncoding) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (configuredEncoding) {
    return new TextDecoder(configuredEncoding).decode(bytes);
  }

  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("\uFFFD")) {
    return utf8;
  }

  return new TextDecoder("euc-kr").decode(bytes);
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return "";
}

function normalizeLineNo(value) {
  const text = stringValue(value);
  const compact = text.replace(/\s/g, "");
  if (compact.includes("인천") && compact.includes("2")) {
    return "인천2";
  }
  if (compact.includes("인천") && compact.includes("1")) {
    return "인천";
  }
  if (compact.includes("공항")) {
    return "공항철도";
  }
  if (compact.includes("경의") || compact.includes("중앙")) {
    return "경의중앙";
  }
  if (compact.includes("경춘")) {
    return "경춘";
  }
  if (compact.includes("수인") || compact.includes("분당")) {
    return compact.includes("신분당") ? "신분당" : "수인분당";
  }
  if (compact.includes("우이") || compact.includes("신설")) {
    return "우이신설";
  }
  if (compact.includes("서해")) {
    return "서해";
  }
  if (compact.includes("김포")) {
    return "김포골드";
  }
  if (compact.includes("신림")) {
    return "신림";
  }
  const match = text.match(/\d+/);
  if (!match) {
    return compact
      .replace(/수도권|서울|도시철도|경전철|전철/g, "")
      .replace(/호선|노선|선$/g, "")
      .trim();
  }
  return String(Number(match[0]));
}

function normalizeStationName(value) {
  return stringValue(value)
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/역$/, "")
    .trim();
}

function normalizeDayType(value) {
  const text = stringValue(value);
  if (text.includes("평일") || text.toUpperCase() === "WEEKDAY") {
    return "WEEKDAY";
  }
  if (text.includes("토") || text.includes("일") || text.toUpperCase() === "WEEKEND") {
    return "WEEKEND";
  }
  return "";
}

function normalizeCongestionTimeSlot(key) {
  const text = key.replace(/\s/g, "");
  const hourMinute = text.match(/([0-2]?\d)[:시]([0-5]\d)?/);
  if (!hourMinute) {
    return "";
  }
  const hour = Number(hourMinute[1]);
  if (hour === 24) {
    return "23:30";
  }
  if (hour < 0 || hour > 23) {
    return "";
  }
  const minute = Number(hourMinute[2] ?? 0);
  const roundedMinute = minute < 15 ? 0 : minute < 45 ? 30 : 60;
  if (hour === 23 && roundedMinute === 60) {
    return "23:30";
  }
  const nextHour = (hour + (roundedMinute === 60 ? 1 : 0)) % 24;
  const nextMinute = roundedMinute === 60 ? 0 : roundedMinute;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}

function stationOrder(row) {
  const frCode = stringValue(pick(row, ["FR_CODE", "외부코드"]));
  const frMatch = frCode.match(/\d+/);
  if (frMatch) {
    return Number(frMatch[0]);
  }
  return Number(stringValue(pick(row, ["STATION_CD", "역코드", "전철역코드"])).replace(/\D/g, ""));
}

function isSeoulLineTwoMainLoopStationCode(value) {
  const code = stringValue(value).padStart(4, "0");
  return /^02(0[1-9]|[1-3][0-9]|4[0-3])$/.test(code);
}

function candidateMonths(baseMonth, count) {
  const year = Number(baseMonth.slice(0, 4));
  const monthIndex = Number(baseMonth.slice(4, 6)) - 1;
  const candidates = [];

  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(Date.UTC(year, monthIndex - offset, 1));
    candidates.push(`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  return candidates;
}

function intValue(value) {
  return Math.round(numberValue(value));
}

function numberValue(value) {
  const text = stringValue(value).replace(/,/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  const numeric = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : 0;
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function sourceUrl(prefix) {
  return (
    process.env[`${prefix}_CSV_URL`] ||
    process.env[`${prefix}_API_URL_TEMPLATE`] ||
    defaultCsvUrls[prefix] ||
    defaultApiTemplates[prefix] ||
    null
  );
}

function hasFallbackTrainLayout(lineNo) {
  return Object.hasOwn(
    {
      1: 10,
      2: 10,
      3: 10,
      4: 10,
      5: 8,
      6: 8,
      7: 8,
      8: 6,
      9: 6
    },
    String(lineNo)
  );
}

function redactUrl(url) {
  let redacted = url.replace(/(serviceKey=)[^&]+/g, "$1[REDACTED]");
  for (const secret of [seoulApiKey, dataGoKrApiKey]) {
    if (secret) {
      redacted = redacted.replaceAll(secret, "[REDACTED]");
      redacted = redacted.replaceAll(encodeURIComponent(secret), "[REDACTED]");
    }
  }
  return redacted;
}

function parseTargetLineNos(raw) {
  return [...new Set(raw.split(/[,\s;]+/).map((line) => normalizeLineNo(line)).filter(Boolean))];
}

function toPositiveInt(raw, fallback) {
  const num = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function loadLocalEnv() {
  for (const filename of [".env.local", ".env"]) {
    try {
      const content = await readFile(join(rootDir, filename), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex <= 0) {
          continue;
        }
        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
        process.env[key] ??= value;
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
}

function previousKstMonth() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(1);
  kst.setUTCMonth(kst.getUTCMonth() - 1);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}
