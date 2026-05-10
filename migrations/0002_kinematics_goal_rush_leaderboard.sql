CREATE TABLE IF NOT EXISTS kinematics_goal_rush_runs (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_kinematics_goal_rush_runs_ip_created
  ON kinematics_goal_rush_runs (ip_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_kinematics_goal_rush_runs_expires
  ON kinematics_goal_rush_runs (expires_at);

CREATE TABLE IF NOT EXISTS kinematics_goal_rush_scores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  golden_hits INTEGER NOT NULL,
  normal_hits INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES kinematics_goal_rush_runs (id)
);

CREATE INDEX IF NOT EXISTS idx_kinematics_goal_rush_scores_top
  ON kinematics_goal_rush_scores (score DESC, duration_ms ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_kinematics_goal_rush_scores_ip_created
  ON kinematics_goal_rush_scores (ip_hash, created_at);
