CREATE TABLE IF NOT EXISTS kinematics_runs (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_kinematics_runs_ip_created
  ON kinematics_runs (ip_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_kinematics_runs_expires
  ON kinematics_runs (expires_at);

CREATE TABLE IF NOT EXISTS kinematics_scores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  time_ms INTEGER NOT NULL,
  stops INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES kinematics_runs (id)
);

CREATE INDEX IF NOT EXISTS idx_kinematics_scores_top
  ON kinematics_scores (time_ms ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_kinematics_scores_ip_created
  ON kinematics_scores (ip_hash, created_at);
