-- =============================================================
-- Clearance Tracker Schema
-- Database: Cloudflare D1 (SQLite)
-- =============================================================

-- Users (admins and TAs who log in to the app)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'ta' CHECK (role IN ('admin', 'ta')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sessions (auth tokens)
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- =============================================================
-- Students
-- =============================================================

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT NOT NULL UNIQUE,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  school TEXT NOT NULL DEFAULT 'other' CHECK (school IN ('SON', 'PSOM', 'other')),
  position_type TEXT NOT NULL DEFAULT 'volunteer' CHECK (position_type IN ('volunteer', 'paid')),
  works_in_partner_afterschool INTEGER NOT NULL DEFAULT 0,
  is_international INTEGER NOT NULL DEFAULT 0,
  in_sdp INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);

-- =============================================================
-- Courses & Programs
-- =============================================================

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS programs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE
);

-- Join tables
CREATE TABLE IF NOT EXISTS student_courses (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, course_id)
);

CREATE TABLE IF NOT EXISTS student_programs (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, program_id)
);

CREATE INDEX IF NOT EXISTS idx_student_courses_course ON student_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_student_programs_program ON student_programs(program_id);

-- =============================================================
-- Clearance Types (lookup, seeded)
-- =============================================================

CREATE TABLE IF NOT EXISTS clearance_types (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

-- =============================================================
-- Student Clearances (one row per student per clearance type)
-- =============================================================

CREATE TABLE IF NOT EXISTS student_clearances (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  clearance_type_id INTEGER NOT NULL REFERENCES clearance_types(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_issued' CHECK (status IN ('not_issued', 'not_started', 'in_progress', 'complete', 'affidavit', 'not_applicable')),
  status_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, clearance_type_id),
  -- "affidavit" status is only valid for FBI_OR_AFFIDAVIT (clearance_type_id = 3)
  CHECK (status != 'affidavit' OR clearance_type_id = 3)
);

CREATE INDEX IF NOT EXISTS idx_student_clearances_student ON student_clearances(student_id);
CREATE INDEX IF NOT EXISTS idx_student_clearances_status ON student_clearances(status);
