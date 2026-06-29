import { Pool } from "pg";
import { hasFallbackTrainLayout } from "./train-layout";
import type {
  DayType,
  DirectionCode,
  DoorHint,
  RecommendationResponse,
  SeatChanceDataset,
  TrainLayout
} from "./types";

export type DataStatusCode =
  | "READY"
  | "MISSING_DATABASE_URL"
  | "DATABASE_ERROR"
  | "SCHEMA_MISSING"
  | "DATA_MISSING";

export interface DataStatus {
  ready: boolean;
  status: DataStatusCode;
  message: string;
  counts: Record<string, number>;
  lineCoverage: LineDataCoverage[];
  lastIngestion: {
    sourceName: string;
    status: string;
    rowCount: number;
    finishedAt: string | null;
    message: string | null;
  } | null;
  lastSuccessfulIngestion: {
    sourceName: string;
    rowCount: number;
    finishedAt: string | null;
  } | null;
}

export interface LineDataCoverage {
  lineNo: string;
  stationRows: number;
  rawStationRows: number;
  ridershipRows: number;
  trainLayoutRows: number;
  estimatedTrainLayout: boolean;
  congestionRows: number;
  doorHintRows: number;
  stationCongestionRows: number;
  transferDemandRows: number;
  missingRecommendationInputs: string[];
  qualityWarnings: string[];
  recommendable: boolean;
}

export interface SeatChanceRepository {
  getTrainLayout(lineNo: string, direction: DirectionCode): Promise<TrainLayout | null>;
  getStations(lineNo: string): Promise<SeatChanceDataset["stations"]>;
  getLines(): Promise<Array<{ lineNo: string; stationCount: number }>>;
  getCachedRecommendation(cacheKey: string, ttlSeconds: number): Promise<unknown | null>;
  setCachedRecommendation(input: {
    cacheKey: string;
    origin: string;
    destination: string;
    lineNo: string;
    direction: DirectionCode;
    dayType: DayType;
    timeSlot: string;
    payload: RecommendationResponse & { train_layout: unknown };
  }): Promise<void>;
  getDataset(input: {
    lineNo: string;
    direction: DirectionCode;
    dayType: DayType;
    timeSlot: string;
  }): Promise<SeatChanceDataset>;
}

const requiredTables = [
  "station_line_order",
  "train_layout",
  "ridership_profile",
  "congestion_profile",
  "transfer_door",
  "exit_or_facility_door"
] as const;

const optionalTables = ["station_congestion_profile", "transfer_demand_profile"] as const;
const statusTables = [...requiredTables, ...optionalTables] as const;

class PostgresSeatChanceRepository implements SeatChanceRepository {
  constructor(private readonly pool: Pool) {}

  async getStations(lineNo: string) {
    const result = await this.pool.query<SeatChanceDataset["stations"][number]>(
      `
        select
          operator,
          line_no as "lineNo",
          station_code as "stationCode",
          station_name as "stationName",
          sequence_no as "sequenceNo"
        from station_line_order
        where line_no = $1
          and (${lineTwoMainLoopStationSql("$1")})
        order by sequence_no
      `,
      [lineNo]
    );

    return result.rows;
  }

  async getLines() {
    const result = await this.pool.query<{ lineNo: string; stationCount: string }>(`
      select
        line_no as "lineNo",
        count(*)::text as "stationCount"
      from station_line_order
      where ${lineTwoMainLoopStationSql("line_no")}
      group by line_no
      order by
        case when line_no ~ '^[0-9]+$' then line_no::int else 999999 end,
        line_no
    `);

    return result.rows.map((row) => ({
      lineNo: row.lineNo,
      stationCount: Number(row.stationCount)
    }));
  }

  async getTrainLayout(lineNo: string, direction: DirectionCode) {
    const result = await this.pool.query<TrainLayout>(
      `
        select
          operator,
          line_no as "lineNo",
          branch_code as "branchCode",
          direction_code as "direction",
          car_count as "carCount",
          doors_per_car as "doorsPerCar",
          source,
          confidence::float as confidence,
          valid_from::text as "validFrom",
          valid_to::text as "validTo"
        from train_layout
        where line_no = $1
          and direction_code = $2
          and valid_from <= current_date
          and (valid_to is null or valid_to >= current_date)
        order by valid_from desc
        limit 1
      `,
      [lineNo, direction]
    );

    return result.rows[0] ?? null;
  }

  async getCachedRecommendation(cacheKey: string, ttlSeconds: number) {
    try {
      const result = await this.pool.query<{ payload: unknown }>(
        `
          select payload
          from recommendation_cache
          where cache_key = $1
            and generated_at >= now() - ($2::text || ' seconds')::interval
          limit 1
        `,
        [cacheKey, ttlSeconds]
      );

      return result.rows[0]?.payload ?? null;
    } catch (error) {
      if (isUndefinedTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async setCachedRecommendation({
    cacheKey,
    origin,
    destination,
    lineNo,
    direction,
    dayType,
    timeSlot,
    payload
  }: Parameters<SeatChanceRepository["setCachedRecommendation"]>[0]) {
    try {
      await this.pool.query(
        `
          insert into recommendation_cache (
            cache_key, origin, destination, line_no, direction_code, day_type, time_slot, payload, generated_at
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, now())
          on conflict (cache_key) do update set
            payload = excluded.payload,
            generated_at = excluded.generated_at
        `,
        [cacheKey, origin, destination, lineNo, direction, dayType, timeSlot, JSON.stringify(payload)]
      );
    } catch (error) {
      if (isUndefinedTableError(error)) {
        return;
      }
      throw error;
    }
  }

  async getDataset({ lineNo, direction, dayType, timeSlot }: Parameters<SeatChanceRepository["getDataset"]>[0]) {
    const [
      stations,
      trainLayouts,
      ridershipProfiles,
      congestionProfiles,
      stationCongestionProfiles,
      transferDemandProfiles,
      doorHints
    ] =
      await Promise.all([
        this.pool.query<SeatChanceDataset["stations"][number]>(
          `
            select
              operator,
              line_no as "lineNo",
              station_code as "stationCode",
              station_name as "stationName",
              sequence_no as "sequenceNo"
            from station_line_order
            where line_no = $1
              and (${lineTwoMainLoopStationSql("$1")})
            order by sequence_no
          `,
          [lineNo]
        ),
        this.pool.query<TrainLayout>(
          `
            select
              operator,
              line_no as "lineNo",
              branch_code as "branchCode",
              direction_code as "direction",
              car_count as "carCount",
              doors_per_car as "doorsPerCar",
              source,
              confidence::float as confidence,
              valid_from::text as "validFrom",
              valid_to::text as "validTo"
            from train_layout
            where line_no = $1 and direction_code = $2
          `,
          [lineNo, direction]
        ),
        this.pool.query<SeatChanceDataset["ridershipProfiles"][number]>(
          `
            select distinct on (line_no, station_name, day_type, time_slot)
              line_no as "lineNo",
              station_name as "stationName",
              day_type as "dayType",
              time_slot as "timeSlot",
              boardings,
              alightings,
              source,
              observed_month::text as "observedMonth"
            from ridership_profile
            where line_no = $1
              and day_type = $2
            order by line_no, station_name, day_type, time_slot, observed_month desc
          `,
          [lineNo, dayType]
        ),
        this.pool.query<SeatChanceDataset["congestionProfiles"][number]>(
          `
            select
              line_no as "lineNo",
              direction_code as "direction",
              day_type as "dayType",
              time_slot as "timeSlot",
              congestion_pct::float as "congestionPct",
              source
            from congestion_profile
            where line_no = $1
              and direction_code = $2
              and day_type = $3
          `,
          [lineNo, direction, dayType]
        ),
        this.getStationCongestionProfiles(lineNo, direction, dayType),
        this.getTransferDemandProfiles(lineNo, dayType),
        this.pool.query<DoorHint>(
          `
            select
              'transfer' as kind,
              line_no as "lineNo",
              station_name as "stationName",
              direction_code as "direction",
              car_no as "carNo",
              door_no as "doorNo",
              weight::float as weight,
              description,
              source,
              confidence::float as confidence
            from transfer_door
            where line_no = $1 and direction_code = $2
            union all
            select
              'facility' as kind,
              line_no as "lineNo",
              station_name as "stationName",
              direction_code as "direction",
              car_no as "carNo",
              door_no as "doorNo",
              weight::float as weight,
              description,
              source,
              confidence::float as confidence
            from exit_or_facility_door
            where line_no = $1 and direction_code = $2
          `,
          [lineNo, direction]
        )
      ]);

    return {
      stations: stations.rows,
      trainLayouts: trainLayouts.rows,
      ridershipProfiles: ridershipProfiles.rows,
      congestionProfiles: congestionProfiles.rows,
      stationCongestionProfiles,
      transferDemandProfiles,
      doorHints: doorHints.rows
    };
  }

  private async getStationCongestionProfiles(
    lineNo: string,
    direction: DirectionCode,
    dayType: DayType
  ): Promise<SeatChanceDataset["stationCongestionProfiles"]> {
    try {
      const result = await this.pool.query<SeatChanceDataset["stationCongestionProfiles"][number]>(
        `
          select
            line_no as "lineNo",
            station_name as "stationName",
            direction_code as "direction",
            day_type as "dayType",
            time_slot as "timeSlot",
            congestion_pct::float as "congestionPct",
            source
          from station_congestion_profile
          where line_no = $1
            and direction_code = $2
            and day_type = $3
        `,
        [lineNo, direction, dayType]
      );

      return result.rows;
    } catch (error) {
      if (isUndefinedTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  private async getTransferDemandProfiles(
    lineNo: string,
    dayType: DayType
  ): Promise<SeatChanceDataset["transferDemandProfiles"]> {
    try {
      const result = await this.pool.query<SeatChanceDataset["transferDemandProfiles"][number]>(
        `
          select distinct on (line_no, station_name, day_type)
            line_no as "lineNo",
            station_name as "stationName",
            day_type as "dayType",
            transfer_passengers as "transferPassengers",
            source,
            observed_on::text as "observedOn"
          from transfer_demand_profile
          where line_no = $1
            and day_type = $2
          order by line_no, station_name, day_type, observed_on desc
        `,
        [lineNo, dayType]
      );

      return result.rows;
    } catch (error) {
      if (isUndefinedTableError(error)) {
        return [];
      }
      throw error;
    }
  }
}

let repository: SeatChanceRepository | null = null;
let statusPool: Pool | null = null;

function createPool(databaseUrl: string) {
  return new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PG_POOL_MAX ?? 3),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 30000),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 10000),
    ssl: databaseUrl.includes("sslmode=") ? true : undefined
  });
}

export function getSeatChanceRepository(): SeatChanceRepository {
  if (repository) {
    return repository;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new DataUnavailableError("DB 연결 설정이 없어 추천 데이터를 읽을 수 없습니다.");
  }

  repository = new PostgresSeatChanceRepository(createPool(databaseUrl));

  return repository;
}

class DataUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataUnavailableError";
  }
}

export async function getDataStatus(): Promise<DataStatus> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      ready: false,
      status: "MISSING_DATABASE_URL",
      message: "DATABASE_URL이 없어 DB에서 데이터를 읽을 수 없습니다.",
      counts: {},
      lineCoverage: [],
      lastIngestion: null,
      lastSuccessfulIngestion: null
    };
  }

  statusPool ??= createPool(databaseUrl);

  try {
    const tableCheck = await statusPool.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1)
      `,
      [statusTables]
    );
    const existingTables = new Set(tableCheck.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((tableName) => !existingTables.has(tableName));

    if (missingTables.length > 0) {
      return {
        ready: false,
        status: "SCHEMA_MISSING",
        message: `DB는 연결됐지만 스키마가 없습니다: ${missingTables.join(", ")}`,
        counts: {},
        lineCoverage: [],
        lastIngestion: null,
        lastSuccessfulIngestion: null
      };
    }

    const countTables = statusTables.filter((tableName) => existingTables.has(tableName));
    const counts = await readTableCounts(statusPool, countTables);
    const lineCoverage = await readLineCoverage(statusPool, existingTables);
    const lastIngestion = await readLastIngestion(statusPool);
    const lastSuccessfulIngestion = await readLastSuccessfulIngestion(statusPool);
    const emptyTables = requiredTables.filter((tableName) => counts[tableName] === 0);

    if (emptyTables.length > 0) {
      return {
        ready: false,
        status: "DATA_MISSING",
        message: `DB는 연결됐지만 추천에 필요한 데이터가 비어 있습니다: ${emptyTables.join(", ")}`,
        counts,
        lineCoverage,
        lastIngestion,
        lastSuccessfulIngestion
      };
    }

    return {
      ready: true,
      status: "READY",
      message: "DB 연결과 필수 데이터 적재가 완료됐습니다.",
      counts,
      lineCoverage,
      lastIngestion,
      lastSuccessfulIngestion
    };
  } catch (error) {
    return {
      ready: false,
      status: "DATABASE_ERROR",
      message:
        process.env.NODE_ENV === "production"
          ? "DB 상태를 확인하는 중 오류가 발생했습니다."
          : error instanceof Error
            ? error.message
            : "DB 상태를 확인하지 못했습니다.",
      counts: {},
      lineCoverage: [],
      lastIngestion: null,
      lastSuccessfulIngestion: null
    };
  }
}

async function readTableCounts(pool: Pool, tableNames: readonly string[]): Promise<Record<string, number>> {
  const entries = await Promise.all(
    tableNames.map(async (tableName) => {
      const result = await pool.query<{ rowCount: string }>(
        `select count(*)::text as "rowCount" from ${tableName}`
      );
      return [tableName, Number(result.rows[0]?.rowCount ?? 0)] as const;
    })
  );

  return Object.fromEntries(entries);
}

async function readLineCoverage(pool: Pool, existingTables: Set<string>): Promise<LineDataCoverage[]> {
  if (!existingTables.has("station_line_order")) {
    return [];
  }

  const result = await pool.query<{
    lineNo: string;
    stationRows: string;
    rawStationRows: string;
    ridershipRows: string;
    trainLayoutRows: string;
    congestionRows: string;
    transferDoorRows: string;
    facilityDoorRows: string;
    stationCongestionRows: string;
    transferDemandRows: string;
  }>(`
    with lines as (
      select line_no from station_line_order
      union select line_no from ridership_profile
      union select line_no from train_layout
      union select line_no from congestion_profile
      union select line_no from transfer_door
      union select line_no from exit_or_facility_door
      ${
        existingTables.has("station_congestion_profile")
          ? "union select line_no from station_congestion_profile"
          : ""
      }
      ${
        existingTables.has("transfer_demand_profile")
          ? "union select line_no from transfer_demand_profile"
          : ""
      }
    )
    select
      lines.line_no as "lineNo",
      coalesce(stations.row_count, 0)::text as "stationRows",
      coalesce(raw_stations.row_count, 0)::text as "rawStationRows",
      coalesce(ridership.row_count, 0)::text as "ridershipRows",
      coalesce(layouts.row_count, 0)::text as "trainLayoutRows",
      coalesce(congestion.row_count, 0)::text as "congestionRows",
      coalesce(transfer_doors.row_count, 0)::text as "transferDoorRows",
      coalesce(facility_doors.row_count, 0)::text as "facilityDoorRows",
      coalesce(station_congestion.row_count, 0)::text as "stationCongestionRows",
      coalesce(transfer_demand.row_count, 0)::text as "transferDemandRows"
    from lines
    left join (
      select line_no, count(*) as row_count
      from station_line_order
      where ${lineTwoMainLoopStationSql("line_no")}
      group by line_no
    ) stations using (line_no)
    left join (
      select line_no, count(*) as row_count from station_line_order group by line_no
    ) raw_stations using (line_no)
    left join (
      select line_no, count(*) as row_count from ridership_profile group by line_no
    ) ridership using (line_no)
    left join (
      select line_no, count(*) as row_count from train_layout group by line_no
    ) layouts using (line_no)
    left join (
      select line_no, count(*) as row_count from congestion_profile group by line_no
    ) congestion using (line_no)
    left join (
      select line_no, count(*) as row_count from transfer_door group by line_no
    ) transfer_doors using (line_no)
    left join (
      select line_no, count(*) as row_count from exit_or_facility_door group by line_no
    ) facility_doors using (line_no)
    left join (
      ${
        existingTables.has("station_congestion_profile")
          ? "select line_no, count(*) as row_count from station_congestion_profile group by line_no"
          : "select null::text as line_no, 0::bigint as row_count where false"
      }
    ) station_congestion using (line_no)
    left join (
      ${
        existingTables.has("transfer_demand_profile")
          ? "select line_no, count(*) as row_count from transfer_demand_profile group by line_no"
          : "select null::text as line_no, 0::bigint as row_count where false"
      }
    ) transfer_demand using (line_no)
    order by
      case when lines.line_no ~ '^[0-9]+$' then lines.line_no::int else 999999 end,
      lines.line_no
  `);

  return result.rows.map((row) => {
    const transferDoorRows = Number(row.transferDoorRows);
    const facilityDoorRows = Number(row.facilityDoorRows);
    const coverage = {
      lineNo: row.lineNo,
      stationRows: Number(row.stationRows),
      rawStationRows: Number(row.rawStationRows),
      ridershipRows: Number(row.ridershipRows),
      trainLayoutRows: Number(row.trainLayoutRows),
      estimatedTrainLayout: Number(row.trainLayoutRows) <= 0 && hasFallbackTrainLayout(row.lineNo),
      congestionRows: Number(row.congestionRows),
      doorHintRows: transferDoorRows + facilityDoorRows,
      stationCongestionRows: Number(row.stationCongestionRows),
      transferDemandRows: Number(row.transferDemandRows),
      missingRecommendationInputs: [],
      qualityWarnings: [],
      recommendable: false
    };
    const missingRecommendationInputs = missingRecommendationInputsForCoverage(coverage);
    const qualityWarnings = qualityWarningsForCoverage(coverage);

    return {
      ...coverage,
      missingRecommendationInputs,
      qualityWarnings,
      recommendable: missingRecommendationInputs.length === 0
    };
  });
}

function missingRecommendationInputsForCoverage(
  coverage: Pick<LineDataCoverage, "lineNo" | "stationRows" | "ridershipRows" | "trainLayoutRows" | "estimatedTrainLayout" | "doorHintRows">
) {
  const missingInputs: string[] = [];
  if (coverage.stationRows <= 1) {
    missingInputs.push("station_order");
  }
  if (coverage.ridershipRows <= 0) {
    missingInputs.push("ridership");
  }
  if (coverage.trainLayoutRows <= 0 && !coverage.estimatedTrainLayout) {
    missingInputs.push("train_layout");
  }
  if (coverage.doorHintRows <= 0) {
    missingInputs.push("door_hints");
  }
  return missingInputs;
}

function qualityWarningsForCoverage(
  coverage: Pick<LineDataCoverage, "trainLayoutRows" | "estimatedTrainLayout" | "congestionRows">
) {
  const warnings: string[] = [];
  if (coverage.trainLayoutRows <= 0 && coverage.estimatedTrainLayout) {
    warnings.push("estimated_train_layout");
  }
  if (coverage.congestionRows <= 0) {
    warnings.push("missing_congestion");
  }
  return warnings;
}

function isUndefinedTableError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42P01"
  );
}

function lineTwoMainLoopStationSql(lineNoExpression: string) {
  return `${lineNoExpression} <> '2' or station_code ~ '^02(0[1-9]|[1-3][0-9]|4[0-3])$'`;
}

async function readLastIngestion(pool: Pool): Promise<DataStatus["lastIngestion"]> {
  const hasIngestionRun = await pool.query<{ table_name: string }>(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'ingestion_run'
      limit 1
    `
  );

  if (hasIngestionRun.rows.length === 0) {
    return null;
  }

  const result = await pool.query<{
    sourceName: string;
    status: string;
    rowCount: number;
    finishedAt: string | null;
    message: string | null;
  }>(
    `
      select
        source_name as "sourceName",
        status,
        row_count as "rowCount",
        finished_at::text as "finishedAt",
        message
      from ingestion_run
      order by started_at desc
      limit 1
    `
  );

  return result.rows[0] ?? null;
}

async function readLastSuccessfulIngestion(pool: Pool): Promise<DataStatus["lastSuccessfulIngestion"]> {
  const hasIngestionRun = await pool.query<{ table_name: string }>(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'ingestion_run'
      limit 1
    `
  );

  if (hasIngestionRun.rows.length === 0) {
    return null;
  }

  const result = await pool.query<{
    sourceName: string;
    rowCount: number;
    finishedAt: string | null;
  }>(
    `
      select
        source_name as "sourceName",
        row_count as "rowCount",
        finished_at::text as "finishedAt"
      from ingestion_run
      where status = 'SUCCESS'
      order by finished_at desc nulls last, started_at desc
      limit 1
    `
  );

  return result.rows[0] ?? null;
}
