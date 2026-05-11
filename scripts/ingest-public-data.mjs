import { mkdir, rename, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
await loadLocalEnv();

const operator = "서울교통공사";
let targetLineNo = "3";
const targetMonth = process.env.TARGET_MONTH || previousKstMonth();
const seoulApiKey = requiredEnv("SEOUL_OPEN_API_KEY");
const dataGoKrApiKey = process.env.DATA_GO_KR_API_KEY ?? "";
const databaseUrl = requiredEnv("DATABASE_URL");
const configuredTargetLineNos = parseTargetLineNos(process.env.TARGET_LINE_NO);
const ingestFetchTimeoutMs = toPositiveInt(process.env.INGEST_REQUEST_TIMEOUT_MS, 60000);
const ingestFetchAttempts = Math.min(Math.max(toPositiveInt(process.env.INGEST_FETCH_ATTEMPTS, 3), 1), 8);
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
  max: 1,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  ssl: databaseUrl.includes("sslmode=") ? true : undefined
});

const client = await pool.connect();
let stationSequenceByName = null;
let stationTerminalNames = null;

try {
  await client.query(await readFile(join(rootDir, "db", "schema.sql"), "utf8"));

  const targetLineNos = await resolveTargetLines();
  const failedLines = [];

  for (const lineNo of targetLineNos) {
    targetLineNo = lineNo;
    stationSequenceByName = null;
    stationTerminalNames = null;
    console.log(`\nStart ingest for line ${targetLineNo}`);

    try {
      await ingestWithLog("서울 열린데이터광장 SearchSTNBySubwayLineInfo", null, ingestStationOrder);
      await ingestWithLog("서울 열린데이터광장 CardSubwayTime", null, ingestRidershipProfiles);
      await ingestWithLog("서울교통공사 환승역 환승인원정보", sourceUrl("TRANSFER_DEMAND"), ingestTransferDemandProfiles, { optional: true });
      await ingestWithLog("서울교통공사 도시철도 환승정보", sourceUrl("TRANSFER"), ingestTransferDoors, { optional: true });
      await ingestWithLog("서울교통공사 빠른하차정보", sourceUrl("FAST_EXIT"), ingestFastExitDoors, { optional: true });
      await ingestWithLog("서울교통공사 열차운행현황", sourceUrl("TRAIN_OPERATION"), ingestTrainLayout, { optional: true });
      await ingestWithLog("서울교통공사 지하철혼잡도정보", sourceUrl("CONGESTION"), ingestCongestionProfiles, { optional: true });
      console.log(`Completed ingest for line ${targetLineNo}`);
    } catch (error) {
      failedLines.push({ lineNo: targetLineNo, reason: error instanceof Error ? error.message : String(error) });
      console.error(`Line ${targetLineNo} failed: ${failedLines.at(-1).reason}`);
    }
  }

  if (failedLines.length > 0) {
    throw new Error(
      `Ingest failed for ${failedLines.length} line(s): ${failedLines
        .map((item) => `${item.lineNo}(${item.reason})`)
        .join(", ")}`
    );
  }

  await exportTransitLines();
} finally {
  client.release();
  await pool.end();
}

async function resolveTargetLines() {
  if (configuredTargetLineNos.length > 0) {
    return configuredTargetLineNos;
  }

  const rows = await fetchSeoulRows("SearchSTNBySubwayLineInfo", []);
  const discovered = new Set();

  for (const row of rows) {
    const lineNo = normalizeLineNo(pick(row, ["LINE_NUM", "호선", "LINE"]));
    if (lineNo) {
      discovered.add(lineNo);
    }
  }

  const discoveredLines = Array.from(discovered).sort((a, b) => Number(a) - Number(b));
  return discoveredLines.length > 0 ? discoveredLines : ["3"];
}

function parseTargetLineNos(raw) {
  if (!raw) {
    return [];
  }

  const explicitLines = raw
    .split(/[,\s;]+/)
    .map((line) => stringValue(line))
    .filter(Boolean)
    .map((line) => normalizeLineNo(line))
    .filter(Boolean);

  return [...new Set(explicitLines)].sort((a, b) => Number(a) - Number(b));
}

async function ingestStationOrder() {
  const rows = await fetchSeoulRows("SearchSTNBySubwayLineInfo", [
    "",
    "",
    Number.isFinite(Number(targetLineNo)) ? targetLineNo : ""
  ]);
  const lineRows = rows
    .filter((row) => normalizeLineNo(pick(row, ["LINE_NUM", "호선"])) === targetLineNo)
    .sort((left, right) => stationOrder(left) - stationOrder(right));

  if (lineRows.length === 0) {
    throw new Error(`No station rows returned for line ${targetLineNo}.`);
  }

  await client.query("delete from station_line_order where operator = $1 and line_no = $2", [operator, targetLineNo]);

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
  const rows = await fetchRidershipRows();
  if (!rows) {
    await client.query("delete from ridership_profile where line_no = $1", [targetLineNo]);
    console.warn(`No ridership rows returned for line ${targetLineNo}; recommendations will use data-shortage fallback.`);
    return 0;
  }

  const { month, lineRows } = rows;
  const hourFields = ridershipHourFields();
  const observedMonth = `${month.slice(0, 4)}-${month.slice(4, 6)}-01`;
  const source = `서울 열린데이터광장 CardSubwayTime ${month} monthly day-type aggregate`;
  await client.query(
    `delete from ridership_profile where line_no = $1 and observed_month = $2`,
    [targetLineNo, observedMonth]
  );
  let count = 0;

  for (const row of lineRows) {
    const stationName = normalizeStationName(pick(row, ["SUB_STA_NM", "역명", "STTN"]));
    const dayTypes = ridershipDayTypes(row);
    for (const [timeSlot, rideKeys, alightKeys] of hourFields) {
      const boardings = intValue(pick(row, rideKeys));
      const alightings = intValue(pick(row, alightKeys));
      if (boardings <= 0 && alightings <= 0) {
        continue;
      }

      for (const dayType of dayTypes) {
        await client.query(
          `
            insert into ridership_profile (
              line_no, station_name, day_type, time_slot, boardings, alightings, source, observed_month
            ) values ($1, $2, $3, $4, $5, $6, $7, $8)
            on conflict (line_no, station_name, day_type, time_slot, observed_month) do update set
              boardings = excluded.boardings,
              alightings = excluded.alightings,
              source = excluded.source,
              ingested_at = now()
          `,
          [targetLineNo, stationName, dayType, timeSlot, boardings, alightings, source, observedMonth]
        );
        count += 1;
      }
    }
  }

  if (count === 0) {
    throw new Error(`No ridership rows returned for line ${targetLineNo}.`);
  }

  return count;
}

function ridershipHourFields() {
  return Array.from({ length: 24 }, (_, hour) => {
    const legacy = legacyHourName(hour);
    const sourceHour = hour === 0 ? 24 : hour;
    const rideKeys = [
      `HR_${sourceHour}_GET_ON_NOPE`,
      `HR_${String(sourceHour).padStart(2, "0")}_GET_ON_NOPE`,
      `HR_${hour}_GET_ON_NOPE`,
      `HR_${String(hour).padStart(2, "0")}_GET_ON_NOPE`,
      `${legacy}_RIDE_NUM`
    ];
    const alightKeys = [
      `HR_${sourceHour}_GET_OFF_NOPE`,
      `HR_${String(sourceHour).padStart(2, "0")}_GET_OFF_NOPE`,
      `HR_${hour}_GET_OFF_NOPE`,
      `HR_${String(hour).padStart(2, "0")}_GET_OFF_NOPE`,
      `${legacy}_ALIGHT_NUM`
    ];

    return [
      [`${String(hour).padStart(2, "0")}:00`, rideKeys, alightKeys],
      [`${String(hour).padStart(2, "0")}:30`, rideKeys, alightKeys]
    ];
  }).flat();
}

function legacyHourName(hour) {
  const names = {
    0: "MIDNIGHT",
    1: "ONE",
    2: "TWO",
    3: "THREE",
    4: "FOUR",
    5: "FIVE",
    6: "SIX",
    7: "SEVEN",
    8: "EIGHT",
    9: "NINE",
    10: "TEN",
    11: "ELEVEN",
    12: "TWELVE",
    13: "THIRTEEN",
    14: "FOURTEEN",
    15: "FIFTEEN",
    16: "SIXTEEN",
    17: "SEVENTEEN",
    18: "EIGHTEEN",
    19: "NINETEEN",
    20: "TWENTY",
    21: "TWENTY_ONE",
    22: "TWENTY_TWO",
    23: "TWENTY_THREE"
  };
  return names[hour] ?? "";
}

function ridershipDayTypes(row) {
  const explicitDayType = normalizeDayType(pick(row, ["요일구분", "요일", "day_type", "DAY_TYPE"]));
  return explicitDayType ? [explicitDayType] : ["WEEKDAY", "WEEKEND"];
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

  return null;
}

async function ingestTransferDemandProfiles() {
  const rows = await fetchConfiguredRows("TRANSFER_DEMAND");
  const targetStationNames = await getTargetLineStationNames();
  const observedOn = transferDemandObservedOn();
  const source = sourceUrl("TRANSFER_DEMAND") ?? "configured transfer-demand source";
  await client.query("delete from transfer_demand_profile where line_no = $1 and observed_on = $2", [
    targetLineNo,
    observedOn
  ]);
  let count = 0;

  for (const row of rows) {
    const stationName = normalizeStationName(
      pick(row, ["역명", "출발역명", "환승역사 역명", "환승역사", "station_name", "STATION_NM", "stationName"])
    );
    if (!stationName || !targetStationNames.has(stationName)) {
      continue;
    }

    const weekdayPassengers = intValue(
      pick(row, [
        "평일 일평균 환승인원",
        "평일(일평균)",
        "평일일평균",
        "평일",
        "weekday",
        "WEEKDAY"
      ])
    );
    const saturdayPassengers = intValue(
      pick(row, ["토요일 환승인원", "토요일", "saturday", "SATURDAY", "SAT"])
    );
    const sundayPassengers = intValue(
      pick(row, ["일요일 환승인원", "일요일", "sunday", "SUNDAY", "SUN"])
    );
    const weekendPassengers = averagePositive([saturdayPassengers, sundayPassengers]);

    for (const [dayType, passengers] of [
      ["WEEKDAY", weekdayPassengers],
      ["WEEKEND", weekendPassengers]
    ]) {
      if (passengers <= 0) {
        continue;
      }

      await client.query(
        `
          insert into transfer_demand_profile (
            line_no, station_name, day_type, transfer_passengers, source, observed_on
          ) values ($1, $2, $3, $4, $5, $6)
          on conflict (line_no, station_name, day_type, observed_on) do update set
            transfer_passengers = excluded.transfer_passengers,
            source = excluded.source,
            ingested_at = now()
        `,
        [targetLineNo, stationName, dayType, passengers, source, observedOn]
      );
      count += 1;
    }
  }

  if (count === 0) {
    console.warn(`No transfer-demand rows were ingested for line ${targetLineNo}.`);
  }

  return count;
}

async function ingestTransferDoors() {
  const rows = await fetchConfiguredRows("TRANSFER");
  let count = 0;

  for (const row of rows) {
    const lineNo = normalizeLineNo(pick(row, ["환승시작 호선", "LINE_NUM", "line_no"]));
    const stationName = normalizeStationName(pick(row, ["환승시작역", "station_name", "STATION_NM"]));
    const rawDirection = pick(row, ["하차 열차 방면", "direction", "DIRECTION"]);
    const direction = (await normalizeDirection(rawDirection)) || (await inferDirectionFromStationText(stationName, rawDirection));
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
    console.warn(`No transfer-door rows were ingested for line ${targetLineNo}.`);
  }

  return count;
}

async function ingestFastExitDoors() {
  const rows = await fetchConfiguredRows("FAST_EXIT");
  await client.query("delete from exit_or_facility_door where line_no = $1", [targetLineNo]);
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
      (await normalizeDirection(rawDirection)) ||
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
    console.warn(
      `No fast-exit rows were ingested for line ${targetLineNo}. Data source may not cover this line yet.`
    );
    return 0;
  }

  return count;
}

async function ingestTrainLayout() {
  const rows = await fetchConfiguredRows("TRAIN_OPERATION");
  await client.query("delete from train_layout where operator = $1 and line_no = $2", [operator, targetLineNo]);
  const row = rows.find((candidate) => normalizeLineNo(pick(candidate, ["호선", "LINE NAME", "line_no"])) === targetLineNo);
  if (!row) {
    console.warn(`No train-operation row found for line ${targetLineNo}.`);
    return 0;
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
    console.warn(`Train-operation source did not include car count per formation for line ${targetLineNo}.`);
    return 0;
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
    console.warn(`Cannot derive doors_per_car from transfer/fast-exit door data for line ${targetLineNo}.`);
    return 0;
  }

  let count = 0;
  for (const direction of [await defaultDirection("DOWN"), await defaultDirection("UP")]) {
    if (!direction) {
      continue;
    }
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
  await client.query("delete from congestion_profile where line_no = $1", [targetLineNo]);
  await client.query("delete from station_congestion_profile where line_no = $1", [targetLineNo]);
  const aggregated = new Map();
  let stationCount = 0;

  for (const row of rows) {
    const lineNo = normalizeLineNo(pick(row, ["호선", "호선명", "LINE_NUM", "line_no"]));
    if (lineNo !== targetLineNo) {
      continue;
    }

    const stationName = normalizeStationName(pick(row, ["역명", "역사명", "station_name", "STATION_NM"]));
    const direction = await normalizeDirection(pick(row, ["상하선구분", "상하구분", "방향", "direction", "DIRECTION"]));
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

      if (!stationName) {
        continue;
      }
      await client.query(
        `
          insert into station_congestion_profile (
            line_no, station_name, direction_code, day_type, time_slot, congestion_pct, source, observed_on
          ) values ($1, $2, $3, $4, $5, $6, $7, current_date)
          on conflict (line_no, station_name, direction_code, day_type, time_slot) do update set
            congestion_pct = excluded.congestion_pct,
            source = excluded.source,
            observed_on = excluded.observed_on,
            ingested_at = now()
        `,
        [
          targetLineNo,
          stationName,
          direction,
          dayType,
          timeSlot,
          congestionPct,
          sourceUrl("CONGESTION") ?? "configured congestion source"
        ]
      );
      stationCount += 1;
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
    console.warn(`No congestion rows were ingested for line ${targetLineNo}.`);
    return 0;
  }

  return count + stationCount;
}

async function ingestWithLog(sourceName, sourceUrlValue, fn, options = {}) {
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
    const message = error instanceof Error ? error.message : String(error);
    await client.query(
      `
        update ingestion_run
        set status = 'FAILED', message = $2, finished_at = now()
        where id = $1
      `,
      [runId, message]
    );
    if (options.optional) {
      console.warn(`${sourceName}: skipped optional source: ${message}`);
      return 0;
    }
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
    const nextUrl = seoulUrl(service, start, Math.min(start + 999, total), safeTailSegments);
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
    ...(tailSegments ?? []).map((segment) => encodeURIComponent(String(segment ?? "")))
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
  for (let attempt = 1; attempt <= ingestFetchAttempts; attempt += 1) {
    const requestId = `${targetLineNo || "unknown"}-${attempt}`;
    console.log(`[fetch:${requestId}] ${redactUrl(url)} (timeout: ${ingestFetchTimeoutMs}ms)`);
    try {
      return await fetchWithTimeout(url, {
        headers: {
          accept: "application/json,text/csv,text/plain,*/*",
          "user-agent": "seat-chance-ingest/0.1"
        },
        timeoutMs: ingestFetchTimeoutMs
      });
    } catch (error) {
      lastError = error;
      if (attempt < ingestFetchAttempts) {
        await wait(250 * attempt);
      }
    }
  }

  throw new Error(
    `Failed to fetch ${redactUrl(url)} after ${ingestFetchAttempts} attempts (${ingestFetchTimeoutMs}ms timeout): ${
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
  const compact = text.replace(/\s/g, "");
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

function lineLabel(lineNo) {
  if (/^\d+$/.test(lineNo)) {
    return `${lineNo}호선`;
  }
  return lineNo.endsWith("철도") ? lineNo : `${lineNo}선`;
}

function normalizeStationName(value) {
  return stringValue(value)
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/역$/, "")
    .trim();
}

async function normalizeDirection(value) {
  const text = stringValue(value);
  const compact = text.replace(/\s+/g, "");
  const upperText = text.toUpperCase();
  const terminals = await getStationTerminalNames();
  if (targetLineNo === "2" && compact.includes("내선")) {
    return "내선";
  }
  if (targetLineNo === "2" && compact.includes("외선")) {
    return "외선";
  }
  if (terminals.forward && text.includes(terminals.forward)) {
    return terminals.forward;
  }
  if (terminals.reverse && text.includes(terminals.reverse)) {
    return terminals.reverse;
  }
  if (text === "하선" || text.includes("하행") || upperText === "DOWN" || upperText === "DN") {
    return configuredDirection("DOWN");
  }
  if (text === "상선" || text.includes("상행") || upperText === "UP") {
    return configuredDirection("UP");
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

async function exportTransitLines() {
  const result = await client.query(
    `
      select line_no, station_code, station_name, sequence_no
      from station_line_order
      order by
        case when line_no ~ '^[0-9]+$' then line_no::int else 999999 end,
        line_no,
        sequence_no
    `
  );
  const lines = [];

  for (const row of result.rows) {
    let line = lines.find((candidate) => candidate.line_no === row.line_no);
    if (!line) {
      line = {
        line_no: row.line_no,
        label: lineLabel(row.line_no),
        stations: []
      };
      lines.push(line);
    }

    line.stations.push({
      station_code: row.station_code,
      station_name: row.station_name,
      sequence_no: Number(row.sequence_no)
    });
  }

  const outputPath = join(rootDir, "public", "transit-lines.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(`${outputPath}.tmp`, `${JSON.stringify({ generated_at: new Date().toISOString(), lines }, null, 2)}\n`);
  await rename(`${outputPath}.tmp`, outputPath);
  console.log(`transit-lines.json: ${lines.length} lines`);
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
    return await inferDirectionFromSequences(currentSequence, candidateSequence, stationSequences.size);
  }

  return "";
}

async function inferDirectionFromSequences(currentSequence, candidateSequence, stationCount) {
  if (currentSequence === candidateSequence) {
    return "";
  }
  if (targetLineNo !== "2") {
    return candidateSequence > currentSequence ? await defaultDirection("DOWN") : await defaultDirection("UP");
  }

  const forwardStops = (candidateSequence - currentSequence + stationCount) % stationCount;
  const reverseStops = (currentSequence - candidateSequence + stationCount) % stationCount;
  if (forwardStops === reverseStops) {
    return "";
  }

  return forwardStops < reverseStops ? await defaultDirection("DOWN") : await defaultDirection("UP");
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

async function getTargetLineStationNames() {
  const stationSequences = await getStationSequenceByName();
  return new Set(stationSequences.keys());
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

function averagePositive(values) {
  const positiveValues = values.filter((value) => value > 0);
  if (positiveValues.length === 0) {
    return 0;
  }
  return Math.round(positiveValues.reduce((sum, value) => sum + value, 0) / positiveValues.length);
}

function transferDemandObservedOn() {
  const configured = stringValue(process.env.TRANSFER_DEMAND_OBSERVED_ON);
  if (configured) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(configured)) {
      throw new Error("TRANSFER_DEMAND_OBSERVED_ON must be YYYY-MM-DD.");
    }
    return configured;
  }

  const source = sourceUrl("TRANSFER_DEMAND") ?? "";
  const match = source.match(/(20\d{2})(\d{2})(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  return new Date().toISOString().slice(0, 10);
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

async function defaultDirection(bound) {
  const terminals = await getStationTerminalNames();
  if (targetLineNo === "2") {
    return bound === "DOWN" ? "내선" : "외선";
  }
  return bound === "DOWN" ? terminals.forward : terminals.reverse;
}

async function getStationTerminalNames() {
  if (stationTerminalNames) {
    return stationTerminalNames;
  }

  const result = await client.query(
    `
      select station_name, sequence_no
      from station_line_order
      where operator = $1 and line_no = $2
      order by sequence_no
    `,
    [operator, targetLineNo]
  );
  stationTerminalNames = {
    reverse: result.rows[0]?.station_name ?? "",
    forward: result.rows.at(-1)?.station_name ?? ""
  };
  return stationTerminalNames;
}

async function configuredDirection(bound) {
  const lineSpecificUp = process.env[`LINE${targetLineNo}_UP_DIRECTION`];
  const lineSpecificDown = process.env[`LINE${targetLineNo}_DOWN_DIRECTION`];
  if (bound === "UP") {
    return lineSpecificUp || process.env.UP_DIRECTION || (await defaultDirection("UP"));
  }
  if (bound === "DOWN") {
    return lineSpecificDown || process.env.DOWN_DIRECTION || (await defaultDirection("DOWN"));
  }
  return "";
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
