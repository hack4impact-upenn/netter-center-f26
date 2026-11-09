# Clearance Tracker — Database Schema

## Overview

Tracks student clearance/compliance status for the Netter Center. Students are placed with partner sites through courses and programs, and must complete background clearances before working with youth.

**Database:** Cloudflare D1 (SQLite)
**Documents stay in Box** — this database only tracks statuses, never stores files.

## Tables

| Table | Purpose |
|---|---|
| `users` | Admins and TAs who log in (role: `admin` or `ta`) |
| `sessions` | Auth session tokens |
| `students` | One row per student with attributes that drive requirement rules |
| `courses` | Lookup table (e.g. "PSYC 4460", "NURS 3130") |
| `programs` | Lookup table (e.g. "Pipeline", "HAIP", "PEACH") |
| `student_courses` | Many-to-many join (student_id, course_id) |
| `student_programs` | Many-to-many join (student_id, program_id) |
| `clearance_types` | 6 seeded clearance types |
| `student_clearances` | One row per student per clearance type, tracks status |

### Student attributes that affect requirements

| Column | Type | What it controls |
|---|---|---|
| `school` | `SON`, `PSOM`, `other` | SON/PSOM volunteers are exempt from the 3 main clearances |
| `position_type` | `volunteer`, `paid` | Paid overrides the SON/PSOM exemption |
| `works_in_partner_afterschool` | boolean | Mandated Reporter + SDP Code of Conduct required if true |
| `is_international` | boolean | 3 main clearances not required; International Affidavit required |
| `in_sdp` | boolean | Currently has no effect on requirements (provisional) |

### Clearance statuses

`not_issued` → `not_started` → `in_progress` → `complete`

Special: `affidavit` (only valid for FBI_OR_AFFIDAVIT), `not_applicable`

### Constraints

- `students.email` is unique (one row per student)
- `student_courses` and `student_programs` are unique on the pair
- CHECK constraint prevents `affidavit` status on any clearance other than FBI_OR_AFFIDAVIT

## Requirement Rules

All requirement logic lives in **`src/clearance-rules.ts`** — one file, one place to change.

| Clearance | Required when... | N/A label |
|---|---|---|
| PA Child Abuse, PATCH, FBI/Affidavit | Default required. NOT required if (SON or PSOM) AND volunteer. NOT required if international. | "N/A (SON/PSOM student)" or "N/A (international)" |
| Mandated Reporter, SDP Code of Conduct | Only if `works_in_partner_afterschool` is true | "N/A (not in partner afterschool program)" |
| International Affidavit | Only if `is_international` is true | "N/A" |

Rules marked `TODO(provisional)` in the code haven't been confirmed by the client yet.

### Compliance

A student is **compliant** when every *required* clearance has status `complete` or `affidavit`. Calculated at query time, never stored.

## Auth & Roles

| Role | Can do |
|---|---|
| `admin` | See all progress, approve/reject documents, manage students |
| `ta` | See upload status for their courses only. Cannot approve/reject. |

The `requireAuth` middleware sets `userId` and `userRole` on the Hono context. Use `requireAdmin` middleware after `requireAuth` to restrict routes to admins.

## Commands

```bash
cd apps/api

# Create tables, indexes, and views
bun run setup

# Seed clearance types, courses, and programs
bun run seed

# Drop clearance tracker tables (keeps users/sessions)
bun run reset

# Run tests (includes clearance rule tests)
bun test

# Run only clearance rule tests
bun test src/__tests__/clearance-rules.test.ts
```

## Overview View

The SQL view `student_clearance_overview` joins students with their clearances, courses, and programs in one row per student. Query it via `getClearanceOverview()` in `src/clearance-overview.ts`, which applies the requirement rules to produce human-readable display labels and compliance status.

## File Map

| File | What |
|---|---|
| `src/schema.sql` | DDL: tables, indexes, constraints |
| `src/clearance-overview.sql` | The overview view |
| `src/clearance-rules.ts` | Requirement rules (isRequired, isCompliant, displayStatus) |
| `src/clearance-overview.ts` | TypeScript wrapper for querying the overview view |
| `src/types.ts` | AppEnv with userId + userRole |
| `src/middleware/auth.ts` | requireAuth + requireAdmin middleware |
| `src/routes/auth.ts` | Register/login/logout/me with role support |
| `scripts/setup.ts` | Creates all tables and views |
| `scripts/seed.ts` | Seeds clearance types, courses, and programs |
| `scripts/reset.ts` | Drops clearance tracker tables (not users/sessions) |
| `src/__tests__/clearance-rules.test.ts` | 22 unit tests for requirement rules |
