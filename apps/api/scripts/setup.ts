import { execute } from "../src/integrations/database";

const REQUIRED_VARS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "D1_DATABASE_ID",
];

function checkEnv() {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(
      `\n✗ Missing required environment variables:\n${missing.map((v) => `  - ${v}`).join("\n")}\n\nCopy .env.example to .env and fill in the values before running setup.\n`
    );
    process.exit(1);
  }
}

async function runSqlFile(label: string, path: URL) {
  console.log(`\n${label}...\n`);

  const sql = await Bun.file(path).text();

  // Remove comment-only lines
  const cleaned = sql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("--"))
    .join("\n");

  const statements = cleaned
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await execute(stmt);
      const match = stmt.match(
        /(?:CREATE\s+(?:TABLE|INDEX|VIEW|TRIGGER)\s+IF\s+NOT\s+EXISTS\s+)(\w+)/i
      );
      const name = match ? match[1] : stmt.slice(0, 50);
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ Failed: ${stmt.slice(0, 80)}...`);
      console.error(`    ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }
}

async function setup() {
  checkEnv();

  console.log("Setting up database...");

  // 1. Core schema (tables, indexes, triggers)
  await runSqlFile(
    "Creating tables",
    new URL("../src/schema.sql", import.meta.url)
  );

  // 2. Overview view
  await runSqlFile(
    "Creating views",
    new URL("../src/clearance-overview.sql", import.meta.url)
  );

  console.log("\n✓ Database setup complete.");
}

setup();
