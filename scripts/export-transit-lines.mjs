import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(rootDir, "public", "transit-lines.json");
const optional = process.argv.includes("--optional");

await loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (optional) {
    try {
      await access(outputPath);
    } catch {
      await writeTransitLines({ generated_at: null, lines: [] });
    }
    process.exit(0);
  }
  throw new Error("DATABASE_URL is required to export transit line data.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: toPositiveInt(process.env.PG_CONNECTION_TIMEOUT_MS, 30000),
  idleTimeoutMillis: 10000,
  ssl: databaseUrl.includes("sslmode=") ? true : undefined
});

try {
  const result = await pool.query(`
    select line_no, station_code, station_name, sequence_no
    from station_line_order
    order by
      case when line_no ~ '^[0-9]+$' then line_no::int else 999999 end,
      line_no,
      sequence_no
  `);

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

  await writeTransitLines({
    generated_at: new Date().toISOString(),
    lines
  });
} finally {
  await pool.end();
}

async function writeTransitLines(payload) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(`${outputPath}.tmp`, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(`${outputPath}.tmp`, outputPath);
}

function lineLabel(lineNo) {
  if (/^\d+$/.test(lineNo)) {
    return `${lineNo}호선`;
  }
  if (/^인천\d+$/.test(lineNo)) {
    return `${lineNo.replace("인천", "인천 ")}호선`;
  }
  return lineNo.endsWith("철도") ? lineNo : `${lineNo}선`;
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
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
