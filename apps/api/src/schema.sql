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
