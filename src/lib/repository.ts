import { Pool } from "pg";
import type {
  DayType,
  DirectionCode,
  DoorHint,
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
  lastIngestion: {
    sourceName: string;
    status: string;
    rowCount: number;
    finishedAt: string | null;
    message: string | null;
  } | null;
}

export interface SeatChanceRepository {
  getTrainLayout(lineNo: string, direction: DirectionCode): Promise<TrainLayout | null>;
  getStations(lineNo: string): Promise<SeatChanceDataset["stations"]>;
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
        order by sequence_no
      `,
      [lineNo]
    );

    return result.rows;
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

  async getDataset({ lineNo, direction, dayType, timeSlot }: Parameters<SeatChanceRepository["getDataset"]>[0]) {
    const [stations, trainLayouts, ridershipProfiles, congestionProfiles, doorHints] =
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
              and time_slot = $3
            order by line_no, station_name, day_type, time_slot, observed_month desc
          `,
          [lineNo, dayType, timeSlot]
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
              and time_slot = $4
          `,
          [lineNo, direction, dayType, timeSlot]
        ),
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
      doorHints: doorHints.rows
    };
  }
}

let repository: SeatChanceRepository | null = null;
let statusPool: Pool | null = null;

export function getSeatChanceRepository(): SeatChanceRepository {
  if (repository) {
    return repository;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Run the public-data ingestion job before serving APIs.");
  }

  repository = new PostgresSeatChanceRepository(
    new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
    })
  );

  return repository;
}

export async function getDataStatus(): Promise<DataStatus> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      ready: false,
      status: "MISSING_DATABASE_URL",
      message: "DATABASE_URL이 없어 DB에서 데이터를 읽을 수 없습니다.",
      counts: {},
      lastIngestion: null
    };
  }

  statusPool ??= new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
  });

  try {
    const tableCheck = await statusPool.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1)
      `,
      [requiredTables]
    );
    const existingTables = new Set(tableCheck.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((tableName) => !existingTables.has(tableName));

    if (missingTables.length > 0) {
      return {
        ready: false,
        status: "SCHEMA_MISSING",
        message: `DB는 연결됐지만 스키마가 없습니다: ${missingTables.join(", ")}`,
        counts: {},
        lastIngestion: null
      };
    }

    const counts = await readTableCounts(statusPool);
    const lastIngestion = await readLastIngestion(statusPool);
    const emptyTables = requiredTables.filter((tableName) => counts[tableName] === 0);

    if (emptyTables.length > 0) {
      return {
        ready: false,
        status: "DATA_MISSING",
        message: `DB는 연결됐지만 추천에 필요한 데이터가 비어 있습니다: ${emptyTables.join(", ")}`,
        counts,
        lastIngestion
      };
    }

    return {
      ready: true,
      status: "READY",
      message: "DB 연결과 필수 데이터 적재가 완료됐습니다.",
      counts,
      lastIngestion
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
      lastIngestion: null
    };
  }
}

async function readTableCounts(pool: Pool): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const tableName of requiredTables) {
    const result = await pool.query<{ count: string }>(`select count(*) from ${tableName}`);
    counts[tableName] = Number(result.rows[0]?.count ?? 0);
  }

  return counts;
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
