CREATE TABLE IF NOT EXISTS measurement_chicken_count_runs (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_measurement_chicken_count_runs_ip_created
  ON measurement_chicken_count_runs (ip_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_measurement_chicken_count_runs_expires
  ON measurement_chicken_count_runs (expires_at);

CREATE TABLE IF NOT EXISTS measurement_chicken_count_scores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  total_error REAL NOT NULL,
  total_elapsed_seconds REAL NOT NULL,
  round1_count INTEGER NOT NULL,
  round2_count INTEGER NOT NULL,
  round3_count INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES measurement_chicken_count_runs (id)
);

CREATE INDEX IF NOT EXISTS idx_measurement_chicken_count_scores_top
  ON measurement_chicken_count_scores (score DESC, total_error ASC, total_elapsed_seconds ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_measurement_chicken_count_scores_ip_created
  ON measurement_chicken_count_scores (ip_hash, created_at);
