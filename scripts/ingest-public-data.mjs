import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const operator = "서울교통공사";
const targetLineNo = process.env.TARGET_LINE_NO ?? "3";
const targetMonth = process.env.TARGET_MONTH || previousKstMonth();
const seoulApiKey = requiredEnv("SEOUL_OPEN_API_KEY");
const dataGoKrApiKey = process.env.DATA_GO_KR_API_KEY ?? "";
const databaseUrl = requiredEnv("DATABASE_URL");
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

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
});

const client = await pool.connect();
let stationSequenceByName = null;

try {
  await client.query(await readFile(join(rootDir, "db", "schema.sql"), "utf8"));

  await ingestWithLog("서울 열린데이터광장 SearchSTNBySubwayLineInfo", null, ingestStationOrder);
  await ingestWithLog("서울 열린데이터광장 CardSubwayTime", null, ingestRidershipProfiles);
  await ingestWithLog("서울교통공사 도시철도 환승정보", sourceUrl("TRANSFER"), ingestTransferDoors);
  await ingestWithLog("서울교통공사 빠른하차정보", sourceUrl("FAST_EXIT"), ingestFastExitDoors);
  await ingestWithLog("서울교통공사 열차운행현황", sourceUrl("TRAIN_OPERATION"), ingestTrainLayout);
  await ingestWithLog("서울교통공사 지하철혼잡도정보", sourceUrl("CONGESTION"), ingestCongestionProfiles);
} finally {
  client.release();
  await pool.end();
}

async function ingestStationOrder() {
  const rows = await fetchSeoulRows("SearchSTNBySubwayLineInfo", ["", "", targetLineNo]);
  const lineRows = rows
    .filter((row) => normalizeLineNo(pick(row, ["LINE_NUM", "호선"])) === targetLineNo)
    .sort((left, right) => stationOrder(left) - stationOrder(right));

  if (lineRows.length === 0) {
    throw new Error(`No station rows returned for line ${targetLineNo}.`);
  }

  let sequenceNo = 0;
  for (const row of lineRows) {
    sequenceNo += 1;
    await client.query(
      `
        insert into station_line_order (
          operator, line_no, station_code, station_name, sequence_no
        ) values ($1, $2, $3, $4, $5)
        on conflict (operator, line_no, station_code) do update set
          station_name = excluded.station_name,
          sequence_no = excluded.sequence_no
      `,
      [
        operator,
        targetLineNo,
        stringValue(pick(row, ["STATION_CD", "역코드", "전철역코드"])),
        normalizeStationName(pick(row, ["STATION_NM", "역명"])),
        sequenceNo
      ]
    );
  }

  return lineRows.length;
}

async function ingestRidershipProfiles() {
  const { month, lineRows } = await fetchRidershipRows();
  const hourFields = [
    ["07:00", ["SEVEN_RIDE_NUM", "HR_7_GET_ON_NOPE"], ["SEVEN_ALIGHT_NUM", "HR_7_GET_OFF_NOPE"]],
    ["08:00", ["EIGHT_RIDE_NUM", "HR_8_GET_ON_NOPE"], ["EIGHT_ALIGHT_NUM", "HR_8_GET_OFF_NOPE"]],
    ["09:00", ["NINE_RIDE_NUM", "HR_9_GET_ON_NOPE"], ["NINE_ALIGHT_NUM", "HR_9_GET_OFF_NOPE"]]
  ];
  const observedMonth = `${month.slice(0, 4)}-${month.slice(4, 6)}-01`;
  const source = `서울 열린데이터광장 CardSubwayTime ${month}`;
  let count = 0;

  for (const row of lineRows) {
    const stationName = normalizeStationName(pick(row, ["SUB_STA_NM", "역명", "STTN"]));
    for (const [timeSlot, rideKeys, alightKeys] of hourFields) {
      await client.query(
        `
          insert into ridership_profile (
            line_no, station_name, day_type, time_slot, boardings, alightings, source, observed_month
          ) values ($1, $2, 'WEEKDAY', $3, $4, $5, $6, $7)
          on conflict (line_no, station_name, day_type, time_slot, observed_month) do update set
            boardings = excluded.boardings,
            alightings = excluded.alightings,
            source = excluded.source,
            ingested_at = now()
        `,
        [
          targetLineNo,
          stationName,
          timeSlot,
          intValue(pick(row, rideKeys)),
          intValue(pick(row, alightKeys)),
          source,
          observedMonth
        ]
      );
      count += 1;
    }
  }

  if (count === 0) {
    throw new Error(`No ridership rows returned for line ${targetLineNo}.`);
  }

  return count;
}

async function fetchRidershipRows() {
  for (const month of candidateMonths(targetMonth, 6)) {
    const rows = await fetchSeoulRows("CardSubwayTime", [month]);
    const lineRows = rows.filter(
      (row) => normalizeLineNo(pick(row, ["LINE_NUM", "호선명", "SBWY_ROUT_LN_NM"])) === targetLineNo
    );
    if (lineRows.length > 0) {
      return { month, lineRows };
    }
  }

  throw new Error(`No ridership rows returned for line ${targetLineNo}, month ${targetMonth} or recent fallback months.`);
}

async function ingestTransferDoors() {
  const rows = await fetchConfiguredRows("TRANSFER");
  let count = 0;

  for (const row of rows) {
    const lineNo = normalizeLineNo(pick(row, ["환승시작 호선", "LINE_NUM", "line_no"]));
    const stationName = normalizeStationName(pick(row, ["환승시작역", "station_name", "STATION_NM"]));
    const rawDirection = pick(row, ["하차 열차 방면", "direction", "DIRECTION"]);
    const direction = normalizeDirection(rawDirection) || (await inferDirectionFromStationText(stationName, rawDirection));
    const carNo = intValue(pick(row, ["하차위치(호차)", "하차위치 호차", "car_no", "CAR_NO"]));
    const doorNo = intValue(pick(row, ["하차위치(문)", "하차위치 문", "door_no", "DOOR_NO"]));

    if (lineNo !== targetLineNo || !direction || !stationName || !carNo || !doorNo) {
      continue;
    }

    await client.query(
      `
        insert into transfer_door (
          line_no, station_name, direction_code, car_no, door_no, weight, description, source, confidence
        ) values ($1, $2, $3, $4, $5, 1.000, $6, $7, 0.80)
        on conflict (line_no, station_name, direction_code, car_no, door_no) do update set
          weight = excluded.weight,
          description = excluded.description,
          source = excluded.source,
          confidence = excluded.confidence
      `,
      [
        targetLineNo,
        stationName,
        direction,
        carNo,
        doorNo,
        "공공 환승정보의 최단 환승 하차문",
        sourceUrl("TRANSFER") ?? "configured transfer source"
      ]
    );
    count += 1;
  }

  if (count === 0) {
    throw new Error("No transfer-door rows were ingested. Check TRANSFER_* source configuration.");
  }

  return count;
}

async function ingestFastExitDoors() {
  const rows = await fetchConfiguredRows("FAST_EXIT");
  let count = 0;

  for (const row of rows) {
    const lineNo = normalizeLineNo(
      pick(row, ["호선", "호선명", "line_no", "LINE_NUM", "SBWY_ROUT_LN", "subwayLine", "lineNm"])
    );
    const stationName = normalizeStationName(
      pick(row, ["역명", "역사명", "station_name", "STATION_NM", "SBWY_STNS_NM", "stnNm"])
    );
    const rawDirection = pick(row, ["방향", "열차방면", "하차 열차 방면", "direction", "DIRECTION", "upbdnbSe"]);
    const direction =
      normalizeDirection(rawDirection) ||
      (await inferDirectionFromStationText(stationName, pick(row, ["drtnInfo"])));
    const doorPosition = parseDoorPosition(pick(row, ["qckgffVhclDoorNo", "하차칸출입문", "하차위치"]));
    const carNo =
      intValue(pick(row, ["하차칸", "하차위치(호차)", "car_no", "CAR_NO", "exitCarNo"])) ||
      doorPosition.carNo;
    const doorNo =
      intValue(pick(row, ["출입문", "하차위치(문)", "door_no", "DOOR_NO", "exitDoorNo"])) ||
      doorPosition.doorNo;
    const facility = stringValue(
      pick(row, [
        "이동설비",
        "설비",
        "facility",
        "FACILITY_NM",
        "eqpNm",
        "exitInfo",
        "plfmCmgFac",
        "facPstnNm",
        "fwkPstnNm"
      ])
    );

    if (lineNo !== targetLineNo || !direction || !stationName || !carNo || !doorNo) {
      continue;
    }

    await client.query(
      `
        insert into exit_or_facility_door (
          line_no, station_name, direction_code, car_no, door_no, weight, description, source, confidence
        ) values ($1, $2, $3, $4, $5, 0.700, $6, $7, 0.78)
        on conflict (line_no, station_name, direction_code, car_no, door_no) do update set
          weight = excluded.weight,
          description = excluded.description,
          source = excluded.source,
          confidence = excluded.confidence
      `,
      [
        targetLineNo,
        stationName,
        direction,
        carNo,
        doorNo,
        facility ? `빠른하차 이동설비 인접 문: ${facility}` : "빠른하차 이동설비 인접 문",
        sourceUrl("FAST_EXIT") ?? "configured fast-exit source"
      ]
    );
    count += 1;
  }

  if (count === 0) {
    throw new Error("No fast-exit rows were ingested. Check FAST_EXIT_* source configuration.");
  }

  return count;
}

async function ingestTrainLayout() {
  const rows = await fetchConfiguredRows("TRAIN_OPERATION");
  const row = rows.find((candidate) => normalizeLineNo(pick(candidate, ["호선", "LINE NAME", "line_no"])) === targetLineNo);
  if (!row) {
    throw new Error(`No train-operation row found for line ${targetLineNo}.`);
  }

  const carCount = intValue(
    pick(row, [
      "편성당칸수",
      "1편성당 칸수",
      "VEHICLE ROOM COUNT BY FORMATION",
      "vehicle_room_count_by_formation"
    ])
  );
  if (!carCount) {
    throw new Error("Train-operation source did not include car count per formation.");
  }

  const doorResult = await client.query(
    `
      select max(door_no) as doors_per_car
      from (
        select door_no from transfer_door where line_no = $1
        union all
        select door_no from exit_or_facility_door where line_no = $1
      ) door_source
    `,
    [targetLineNo]
  );
  const doorsPerCar = Number(doorResult.rows[0]?.doors_per_car);
  if (!doorsPerCar) {
    throw new Error("Cannot derive doors_per_car from transfer/fast-exit door data.");
  }

  let count = 0;
  for (const direction of ["오금", "대화"]) {
    await client.query(
      `
        insert into train_layout (
          operator, line_no, branch_code, direction_code, car_count, doors_per_car,
          source, confidence, valid_from, valid_to
        ) values ($1, $2, 'MAIN', $3, $4, $5, $6, 0.90, current_date, null)
        on conflict (operator, line_no, branch_code, direction_code, valid_from) do update set
          car_count = excluded.car_count,
          doors_per_car = excluded.doors_per_car,
          source = excluded.source,
          confidence = excluded.confidence
      `,
      [
        operator,
        targetLineNo,
        direction,
        carCount,
        doorsPerCar,
        `${sourceUrl("TRAIN_OPERATION") ?? "configured train-operation source"} + door data`
      ]
    );
    count += 1;
  }

  return count;
}

async function ingestCongestionProfiles() {
  const rows = await fetchConfiguredRows("CONGESTION");
  const aggregated = new Map();

  for (const row of rows) {
    const lineNo = normalizeLineNo(pick(row, ["호선", "호선명", "LINE_NUM", "line_no"]));
    if (lineNo !== targetLineNo) {
      continue;
    }

    const direction = normalizeDirection(pick(row, ["상하선구분", "상하구분", "방향", "direction", "DIRECTION"]));
    const dayType = normalizeDayType(pick(row, ["요일구분", "요일", "day_type", "DAY_TYPE"]));
    if (!direction || !dayType) {
      continue;
    }

    for (const [key, value] of Object.entries(row)) {
      const timeSlot = normalizeCongestionTimeSlot(key);
      const congestionPct = numberValue(value);
      if (!timeSlot || congestionPct <= 0) {
        continue;
      }

      const aggregateKey = `${direction}:${dayType}:${timeSlot}`;
      const current = aggregated.get(aggregateKey) ?? { direction, dayType, timeSlot, total: 0, count: 0 };
      current.total += congestionPct;
      current.count += 1;
      aggregated.set(aggregateKey, current);
    }
  }

  let count = 0;
  for (const aggregate of aggregated.values()) {
    await client.query(
      `
        insert into congestion_profile (
          line_no, direction_code, day_type, time_slot, congestion_pct, source, observed_on
        ) values ($1, $2, $3, $4, $5, $6, current_date)
        on conflict (line_no, direction_code, day_type, time_slot) do update set
          congestion_pct = excluded.congestion_pct,
          source = excluded.source,
          observed_on = excluded.observed_on,
          ingested_at = now()
      `,
      [
        targetLineNo,
        aggregate.direction,
        aggregate.dayType,
        aggregate.timeSlot,
        Math.round((aggregate.total / aggregate.count) * 100) / 100,
        sourceUrl("CONGESTION") ?? "configured congestion source"
      ]
    );
    count += 1;
  }

  if (count === 0) {
    throw new Error("No congestion rows were ingested. Check CONGESTION_* source configuration.");
  }

  return count;
}

async function ingestWithLog(sourceName, sourceUrlValue, fn) {
  const run = await client.query(
    `
      insert into ingestion_run (source_name, source_url, status)
      values ($1, $2, 'STARTED')
      returning id
    `,
    [sourceName, sourceUrlValue]
  );
  const runId = run.rows[0].id;

  try {
    const rowCount = await fn();
    await client.query(
      `
        update ingestion_run
        set status = 'SUCCESS', row_count = $2, finished_at = now()
        where id = $1
      `,
      [runId, rowCount]
    );
    console.log(`${sourceName}: ${rowCount} rows`);
  } catch (error) {
    await client.query(
      `
        update ingestion_run
        set status = 'FAILED', message = $2, finished_at = now()
        where id = $1
      `,
      [runId, error instanceof Error ? error.message : String(error)]
    );
    throw error;
  }
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

async function fetchConfiguredRows(prefix) {
  const csvUrl = process.env[`${prefix}_CSV_URL`] || defaultCsvUrls[prefix];
  const template = process.env[`${prefix}_API_URL_TEMPLATE`] || (csvUrl ? "" : defaultApiTemplates[prefix]);

  if (template) {
    const pageSize = Number(process.env[`${prefix}_PAGE_SIZE`] ?? 1000);
    const rows = [];

    for (let page = 1; page <= 100; page += 1) {
      const start = (page - 1) * pageSize + 1;
      const end = page * pageSize;
      const url = fillTemplate(template, {
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
    ...tailSegments.map((segment) => encodeURIComponent(segment))
  ].join("/");
}

function fillTemplate(template, values) {
  return template
    .replaceAll("{key}", dataGoKrApiKey || seoulApiKey)
    .replaceAll("{serviceKey}", dataGoKrApiKey || seoulApiKey)
    .replaceAll("{start}", values.start)
    .replaceAll("{end}", values.end)
    .replaceAll("{page}", values.page)
    .replaceAll("{perPage}", values.perPage)
    .replaceAll("{lineNo}", encodeURIComponent(targetLineNo))
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
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(url, {
        headers: {
          accept: "application/json,text/csv,text/plain,*/*",
          "user-agent": "seat-chance-ingest/0.1"
        }
      });
    } catch (error) {
      if (canRetryWithoutCertificateVerification(url, error)) {
        return fetchWithHttpsRequest(url, {
          accept: "application/json,text/csv,text/plain,*/*",
          "user-agent": "seat-chance-ingest/0.1"
        });
      }
      lastError = error;
      await wait(250 * attempt);
    }
  }

  throw lastError;
}

function canRetryWithoutCertificateVerification(url, error) {
  return (
    url.includes("api.seoulmetro.co.kr:21000") &&
    error instanceof Error &&
    error.cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
  );
}

function fetchWithHttpsRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        headers,
        rejectUnauthorized: false
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: {
              get(name) {
                const value = response.headers[name.toLowerCase()];
                return Array.isArray(value) ? value.join(",") : value ?? null;
              }
            },
            async text() {
              return body.toString("utf8");
            },
            async arrayBuffer() {
              return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
            }
          });
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
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

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
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
  const match = text.match(/\d+/);
  if (!match) {
    return "";
  }
  return String(Number(match[0]));
}

function normalizeStationName(value) {
  return stringValue(value).replace(/역$/, "").trim();
}

function normalizeDirection(value) {
  const text = stringValue(value);
  const upperText = text.toUpperCase();
  if (text.includes("오금")) {
    return "오금";
  }
  if (text.includes("대화")) {
    return "대화";
  }
  if (text === "하선" || text.includes("하행") || upperText === "DOWN" || upperText === "DN") {
    return process.env.LINE3_DOWN_DIRECTION ?? defaultDirection("DOWN");
  }
  if (text === "상선" || text.includes("상행") || upperText === "UP") {
    return process.env.LINE3_UP_DIRECTION ?? defaultDirection("UP");
  }
  return "";
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
  if (hour < 7 || hour > 9) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:00`;
}

function stationOrder(row) {
  const frCode = stringValue(pick(row, ["FR_CODE", "외부코드"]));
  const frMatch = frCode.match(/\d+/);
  if (frMatch) {
    return Number(frMatch[0]);
  }
  return Number(stringValue(pick(row, ["STATION_CD", "역코드", "전철역코드"])).replace(/\D/g, ""));
}

async function inferDirectionFromStationText(stationName, directionText) {
  const text = stringValue(directionText);
  if (!stationName || !text) {
    return "";
  }

  const stationSequences = await getStationSequenceByName();
  const currentSequence = stationSequences.get(stationName);
  if (!currentSequence) {
    return "";
  }

  for (const [candidateName, candidateSequence] of stationSequences.entries()) {
    if (candidateName === stationName || !text.includes(candidateName)) {
      continue;
    }
    return candidateSequence > currentSequence ? "오금" : "대화";
  }

  return "";
}

async function getStationSequenceByName() {
  if (stationSequenceByName) {
    return stationSequenceByName;
  }

  const result = await client.query(
    `
      select station_name, sequence_no
      from station_line_order
      where operator = $1 and line_no = $2
    `,
    [operator, targetLineNo]
  );
  stationSequenceByName = new Map(result.rows.map((row) => [row.station_name, Number(row.sequence_no)]));
  return stationSequenceByName;
}

function parseDoorPosition(value) {
  const text = stringValue(value);
  if (!text) {
    return { carNo: 0, doorNo: 0 };
  }

  const separated = text.match(/(\d+)\s*[-_]\s*(\d+)/);
  if (separated) {
    return { carNo: Number(separated[1]), doorNo: Number(separated[2]) };
  }

  const labeled = text.match(/(\d+)\s*(?:호차|칸|량)[^\d]+(\d+)\s*(?:문|출입문)/);
  if (labeled) {
    return { carNo: Number(labeled[1]), doorNo: Number(labeled[2]) };
  }

  const numbers = text.match(/\d+/g) ?? [];
  if (numbers.length >= 2) {
    return { carNo: Number(numbers[0]), doorNo: Number(numbers[1]) };
  }

  return { carNo: 0, doorNo: 0 };
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
  const numeric = Number(stringValue(value).replace(/,/g, ""));
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

function defaultDirection(bound) {
  if (targetLineNo !== "3") {
    return "";
  }
  return bound === "DOWN" ? "오금" : "대화";
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function previousKstMonth() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(1);
  kst.setUTCMonth(kst.getUTCMonth() - 1);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}
