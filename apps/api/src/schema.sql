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

-- Every email the app sends (one row per send action, e.g. one "remind everyone" click)
CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  recipients TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  sent_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at);

-- Reminders scheduled to go out at a set time
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  message TEXT,
  item TEXT,
  deadline TEXT,
  send_at TEXT NOT NULL,
  send_to_all INTEGER NOT NULL DEFAULT 0,
  recipients TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, send_at);

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

-- Box OAuth and folder grants
-- Supports a composite foreign key that binds OAuth attempts to session owners.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_user ON sessions(token, user_id);

-- Box timestamps are integer Unix milliseconds. Existing auth timestamps stay DATETIME.
CREATE TABLE IF NOT EXISTS box_connections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  box_user_id TEXT NOT NULL CHECK (
    length(box_user_id) BETWEEN 1 AND 64 AND
    box_user_id GLOB '[1-9]*' AND box_user_id NOT GLOB '*[^0-9]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'refreshing', 'reconnect_required')),
  tokens_ciphertext TEXT,
  access_expires_at INTEGER,
  token_version INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(token_version) = 'integer' AND token_version >= 0
  ),
  refresh_lock_id TEXT,
  refresh_expires_at INTEGER,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
  UNIQUE (id, user_id),
  CHECK (
    (status IN ('active', 'refreshing') AND tokens_ciphertext LIKE 'v1.%' AND
      tokens_ciphertext IS NOT NULL AND typeof(access_expires_at) = 'integer' AND
      access_expires_at > 0) OR
    (status = 'reconnect_required' AND tokens_ciphertext IS NULL AND access_expires_at IS NULL)
  ),
  CHECK (
    (status = 'refreshing' AND refresh_lock_id IS NOT NULL AND
      typeof(refresh_expires_at) = 'integer' AND refresh_expires_at > updated_at) OR
    (status != 'refreshing' AND refresh_lock_id IS NULL AND refresh_expires_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS box_oauth_attempts (
  state_hash TEXT PRIMARY KEY NOT NULL CHECK (
    length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'
  ),
  browser_nonce_hash TEXT NOT NULL CHECK (
    length(browser_nonce_hash) = 64 AND browser_nonce_hash NOT GLOB '*[^0-9a-f]*'
  ),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (
    typeof(expires_at) = 'integer' AND expires_at > created_at AND
    expires_at <= created_at + 600000
  ),
  FOREIGN KEY (session_token, user_id) REFERENCES sessions(token, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_box_oauth_attempts_expires ON box_oauth_attempts(expires_at);
CREATE INDEX IF NOT EXISTS idx_box_oauth_attempts_session ON box_oauth_attempts(session_token, user_id);

CREATE TABLE IF NOT EXISTS box_folder_access (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  box_folder_id TEXT NOT NULL CHECK (
    length(box_folder_id) BETWEEN 1 AND 64 AND
    box_folder_id GLOB '[1-9]*' AND box_folder_id NOT GLOB '*[^0-9]*'
  ),
  connection_id TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  PRIMARY KEY (user_id, box_folder_id),
  FOREIGN KEY (connection_id, user_id) REFERENCES box_connections(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_box_folder_access_connection ON box_folder_access(connection_id, user_id);
