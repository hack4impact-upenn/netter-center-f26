/**
 * Seed script — populates clearance types, courses, and programs.
 *
 * Usage: cd apps/api && bun scripts/seed.ts
 *
 * Safe to run multiple times (uses INSERT OR IGNORE).
 */

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
      `\n✗ Missing required environment variables:\n${missing.map((v) => `  - ${v}`).join("\n")}\n`
    );
    process.exit(1);
  }
}

// ─── Clearance Types ───────────────────────────────────────────

const CLEARANCE_TYPES = [
  { id: 1, code: "PA_CHILD_ABUSE", name: "PA Child Abuse", sort_order: 1 },
  { id: 2, code: "PATCH", name: "PATCH", sort_order: 2 },
  { id: 3, code: "FBI_OR_AFFIDAVIT", name: "FBI Fingerprint / PA Resident Affidavit", sort_order: 3 },
  { id: 4, code: "MANDATED_REPORTER", name: "Mandated Reporter", sort_order: 4 },
  { id: 5, code: "SDP_CODE_OF_CONDUCT", name: "SDP Code of Conduct", sort_order: 5 },
  { id: 6, code: "INTL_AFFIDAVIT", name: "International Affidavit", sort_order: 6 },
];

// ─── Courses ───────────────────────────────────────────────────

const COURSES = [
  "NPLD 5980",
  "MGMT 3530",
  "NRSC 4660",
  "LALS 3020",
  "EAS 2020",
  "NURS 3130",
  "PSYC 4460",
  "CSSP",
];

// ─── Programs ──────────────────────────────────────────────────

const PROGRAMS = [
  "Pipeline",
  "Crochet",
  "HAIP",
  "PEACH",
  "English Together Project",
  "MAS",
  "Beekeeping",
  "PRI",
  "YQ",
];

// ─── Seeding ──────────────────────────────────────────────────

async function seed() {
  checkEnv();
  console.log("Seeding database...\n");

  // 1. Clearance types
  for (const ct of CLEARANCE_TYPES) {
    await execute(
      "INSERT OR IGNORE INTO clearance_types (id, code, name, sort_order) VALUES (?, ?, ?, ?)",
      [ct.id, ct.code, ct.name, ct.sort_order]
    );
  }
  console.log(`  ✓ ${CLEARANCE_TYPES.length} clearance types`);

  // 2. Courses
  for (const code of COURSES) {
    await execute("INSERT OR IGNORE INTO courses (code) VALUES (?)", [code]);
  }
  console.log(`  ✓ ${COURSES.length} courses`);

  // 3. Programs
  for (const name of PROGRAMS) {
    await execute("INSERT OR IGNORE INTO programs (name) VALUES (?)", [name]);
  }
  console.log(`  ✓ ${PROGRAMS.length} programs`);

  console.log("\n✓ Seed complete.");
}

seed();
