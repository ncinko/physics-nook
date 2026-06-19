CREATE TABLE IF NOT EXISTS caerbannog_runs (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_caerbannog_runs_ip_created
  ON caerbannog_runs (ip_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_caerbannog_runs_expires
  ON caerbannog_runs (expires_at);

CREATE TABLE IF NOT EXISTS caerbannog_scores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  wave INTEGER NOT NULL,
  enemies_slain INTEGER NOT NULL,
  gold_collected INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES caerbannog_runs (id)
);

CREATE INDEX IF NOT EXISTS idx_caerbannog_scores_top
  ON caerbannog_scores (score DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_caerbannog_scores_ip_created
  ON caerbannog_scores (ip_hash, created_at);
