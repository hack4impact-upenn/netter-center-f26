-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
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
