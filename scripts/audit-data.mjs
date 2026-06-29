import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
await loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to audit data.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 30000),
  idleTimeoutMillis: 10000,
  ssl: databaseUrl.includes("sslmode=") ? true : undefined
});

try {
  const [tableCounts, lineCoverage, lineTwoRows, freshness, recentFailures] = await Promise.all([
    readTableCounts(),
    readLineCoverage(),
    readLineTwoRows(),
    readFreshness(),
    readRecentFailures()
  ]);
  const staticTransitLines = JSON.parse(await readFile(join(rootDir, "public", "transit-lines.json"), "utf8"));
  const staticLineTwo = staticTransitLines.lines?.find((line) => line.line_no === "2");
  const dbLineTwoPollutedRows = lineTwoRows.filter((row) => !isSeoulLineTwoMainLoopStationCode(row.station_code));
  const dbLineTwoMainLoopRows = lineTwoRows.filter((row) => isSeoulLineTwoMainLoopStationCode(row.station_code));
  const staticLineTwoPollutedRows = (staticLineTwo?.stations ?? []).filter(
    (station) => !isSeoulLineTwoMainLoopStationCode(station.station_code)
  );
  const issues = [];
  const warnings = [];

  if (dbLineTwoPollutedRows.length > 0) {
    issues.push({
      code: "DB_LINE_2_POLLUTED",
      message: "DB line 2 station order contains non-main-loop or non-Seoul line 2 station codes.",
      sample: dbLineTwoPollutedRows.slice(0, 5)
    });
  }
  if (dbLineTwoMainLoopRows.length !== 43) {
    issues.push({
      code: "DB_LINE_2_COUNT",
      message: `DB line 2 main loop should have 43 stations, got ${dbLineTwoMainLoopRows.length}.`
    });
  }
  if (staticLineTwoPollutedRows.length > 0) {
    issues.push({
      code: "STATIC_LINE_2_POLLUTED",
      message: "public/transit-lines.json line 2 contains non-main-loop or non-Seoul line 2 station codes.",
      sample: staticLineTwoPollutedRows.slice(0, 5)
    });
  }
  if ((staticLineTwo?.stations?.length ?? 0) !== 43) {
    issues.push({
      code: "STATIC_LINE_2_COUNT",
      message: `Static line 2 main loop should have 43 stations, got ${staticLineTwo?.stations?.length ?? 0}.`
    });
  }

  const recommendableLines = lineCoverage.filter((line) => line.recommendable).map((line) => line.line_no);
  if (recommendableLines.length === 0) {
    issues.push({
      code: "NO_RECOMMENDABLE_LINES",
      message: "No lines satisfy the minimum recommendation data coverage gate."
    });
  }
  const staticLineNos = (staticTransitLines.lines ?? []).map((line) => line.line_no);
  const unrecommendablePublicLines = lineCoverage
    .filter((line) => staticLineNos.includes(line.line_no) && !line.recommendable)
    .map((line) => ({
      line_no: line.line_no,
      missing_recommendation_inputs: line.missing_recommendation_inputs
    }));
  if (unrecommendablePublicLines.length > 0) {
    warnings.push({
      code: "UNRECOMMENDABLE_PUBLIC_LINES",
      message: "Some public transit lines are listed but do not satisfy the minimum recommendation data coverage gate.",
      lines: unrecommendablePublicLines
    });
  }
  if (recentFailures.length > 0) {
    warnings.push({
      code: "RECENT_INGESTION_FAILURES",
      message: "Recent ingestion failures are present. They may be optional sources, but should be reviewed before declaring data healthy.",
      count: recentFailures.length
    });
  }

  const payload = {
    ok: issues.length === 0,
    table_counts: tableCounts,
    static_line_count: staticTransitLines.lines?.length ?? 0,
    recommendable_lines: recommendableLines,
    line_coverage: lineCoverage,
    freshness,
    recent_failures: recentFailures,
    warnings,
    issues
  };

  console.log(JSON.stringify(payload, null, 2));
  if (issues.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}

async function readTableCounts() {
  const tableNames = [
    "station_line_order",
    "ridership_profile",
    "train_layout",
    "congestion_profile",
    "station_congestion_profile",
    "transfer_demand_profile",
    "transfer_door",
    "exit_or_facility_door",
    "ingestion_run"
  ];
  const entries = await Promise.all(
    tableNames.map(async (tableName) => {
      const result = await pool.query(`select count(*)::text as count from ${tableName}`);
      return [tableName, Number(result.rows[0]?.count ?? 0)];
    })
  );
  return Object.fromEntries(entries);
}

async function readLineCoverage() {
  const result = await pool.query(`
    with lines as (
      select line_no from station_line_order
      union select line_no from ridership_profile
      union select line_no from train_layout
      union select line_no from congestion_profile
      union select line_no from transfer_door
      union select line_no from exit_or_facility_door
      union select line_no from station_congestion_profile
      union select line_no from transfer_demand_profile
    )
    select
      lines.line_no,
      coalesce(stations.row_count, 0)::int as station_rows,
      coalesce(raw_stations.row_count, 0)::int as raw_station_rows,
      coalesce(ridership.row_count, 0)::int as ridership_rows,
      coalesce(layouts.row_count, 0)::int as train_layout_rows,
      coalesce(congestion.row_count, 0)::int as congestion_rows,
      coalesce(station_congestion.row_count, 0)::int as station_congestion_rows,
      coalesce(transfer_demand.row_count, 0)::int as transfer_demand_rows,
      coalesce(transfer_doors.row_count, 0)::int as transfer_door_rows,
      coalesce(facility_doors.row_count, 0)::int as facility_door_rows
    from lines
    left join (
      select line_no, count(*) as row_count
      from station_line_order
      where line_no <> '2' or station_code ~ '^02(0[1-9]|[1-3][0-9]|4[0-3])$'
      group by line_no
    ) stations using(line_no)
    left join (select line_no, count(*) as row_count from station_line_order group by line_no) raw_stations using(line_no)
    left join (select line_no, count(*) as row_count from ridership_profile group by line_no) ridership using(line_no)
    left join (select line_no, count(*) as row_count from train_layout group by line_no) layouts using(line_no)
    left join (select line_no, count(*) as row_count from congestion_profile group by line_no) congestion using(line_no)
    left join (select line_no, count(*) as row_count from station_congestion_profile group by line_no) station_congestion using(line_no)
    left join (select line_no, count(*) as row_count from transfer_demand_profile group by line_no) transfer_demand using(line_no)
    left join (select line_no, count(*) as row_count from transfer_door group by line_no) transfer_doors using(line_no)
    left join (select line_no, count(*) as row_count from exit_or_facility_door group by line_no) facility_doors using(line_no)
    order by
      case when lines.line_no ~ '^[0-9]+$' then lines.line_no::int else 999999 end,
      lines.line_no
  `);

  return result.rows.map((row) => {
    const coverage = {
      ...row,
      estimated_train_layout: row.train_layout_rows <= 0 && hasFallbackTrainLayout(row.line_no),
      door_hint_rows: row.transfer_door_rows + row.facility_door_rows
    };
    const missingRecommendationInputs = missingRecommendationInputsForCoverage(coverage);
    const qualityWarnings = qualityWarningsForCoverage(coverage);
    return {
      ...coverage,
      missing_recommendation_inputs: missingRecommendationInputs,
      quality_warnings: qualityWarnings,
      recommendable: missingRecommendationInputs.length === 0
    };
  });
}

function missingRecommendationInputsForCoverage(coverage) {
  const missingInputs = [];
  if (coverage.station_rows <= 1) {
    missingInputs.push("station_order");
  }
  if (coverage.ridership_rows <= 0) {
    missingInputs.push("ridership");
  }
  if (coverage.train_layout_rows <= 0 && !coverage.estimated_train_layout) {
    missingInputs.push("train_layout");
  }
  if (coverage.door_hint_rows <= 0) {
    missingInputs.push("door_hints");
  }
  return missingInputs;
}

function qualityWarningsForCoverage(coverage) {
  const warnings = [];
  if (coverage.train_layout_rows <= 0 && coverage.estimated_train_layout) {
    warnings.push("estimated_train_layout");
  }
  if (coverage.congestion_rows <= 0) {
    warnings.push("missing_congestion");
  }
  return warnings;
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

async function readLineTwoRows() {
  const result = await pool.query(`
    select station_code, station_name, sequence_no
    from station_line_order
    where line_no = '2'
    order by sequence_no
  `);
  return result.rows;
}

async function readFreshness() {
  const result = await pool.query(`
    select
      (select max(observed_month)::text from ridership_profile) as latest_ridership_month,
      (select max(observed_on)::text from congestion_profile) as latest_congestion_observed_on,
      (select max(observed_on)::text from transfer_demand_profile) as latest_transfer_demand_observed_on,
      (select max(finished_at)::text from ingestion_run where status = 'SUCCESS') as last_successful_ingestion_finished_at
  `);
  return result.rows[0];
}

async function readRecentFailures() {
  const result = await pool.query(`
    select source_name, row_count, finished_at::text as finished_at, message
    from ingestion_run
    where status = 'FAILED'
    order by started_at desc
    limit 10
  `);
  return result.rows;
}

function isSeoulLineTwoMainLoopStationCode(value) {
  const code = String(value ?? "").trim().padStart(4, "0");
  return /^02(0[1-9]|[1-3][0-9]|4[0-3])$/.test(code);
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
