CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','USER')),
  created_at_utc TEXT NOT NULL,
  last_login_at_utc TEXT,
  disabled_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS invitation_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at_utc TEXT NOT NULL,
  expires_at_utc TEXT,
  max_uses INTEGER NOT NULL CHECK(max_uses > 0),
  uses INTEGER NOT NULL DEFAULT 0 CHECK(uses >= 0),
  revoked_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at_utc TEXT NOT NULL,
  expires_at_utc TEXT NOT NULL,
  last_seen_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON user_sessions(expires_at_utc);
CREATE INDEX IF NOT EXISTS idx_invitation_validity ON invitation_codes(revoked_at_utc,expires_at_utc);
