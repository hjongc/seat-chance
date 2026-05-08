import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(rootDir, "public", "transit-lines.json");
const optional = process.argv.includes("--optional");
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
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
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
        label: `${row.line_no}호선`,
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
