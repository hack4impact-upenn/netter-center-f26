/**
 * Reset script — drops tables/views created by setup. 
 *
 * Usage: cd apps/api && bun scripts/reset.ts
 *
 * Only touches clearance tracker tables. Does NOT drop users or sessions.
 */

import { execute } from "../src/integrations/database";

const REQUIRED_VARS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "D1_DATABASE_ID",
];

function checkEnv() {
  const missing = REQUIRED_VARS.filter((v) => !Bun.env[v]);
  if (missing.length > 0) {
    console.error(
      `\n✗ Missing required environment variables:\n${missing.map((v) => `  - ${v}`).join("\n")}\n`
    );
    throw new Error("Missing env vars");
  }
}

// Drop in reverse dependency order
const TO_DROP = [
  { type: "VIEW", name: "student_clearance_overview" },
  { type: "TABLE", name: "student_clearances" },
  { type: "TABLE", name: "student_courses" },
  { type: "TABLE", name: "student_programs" },
  { type: "TABLE", name: "clearance_types" },
  { type: "TABLE", name: "courses" },
  { type: "TABLE", name: "programs" },
  { type: "TABLE", name: "students" },
];

async function reset() {
  checkEnv();
  console.log("Resetting clearance tracker tables...\n");

  for (const obj of TO_DROP) {
    await execute(`DROP ${obj.type} IF EXISTS ${obj.name}`);
    console.log(`  ✓ Dropped ${obj.type.toLowerCase()} ${obj.name}`);
  }

  console.log("\n✓ Done. Run 'bun run setup' and 'bun run seed' to recreate.");
}

reset();
