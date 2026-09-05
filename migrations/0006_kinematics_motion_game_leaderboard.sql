CREATE TABLE IF NOT EXISTS kinematics_motion_game_runs (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_kinematics_motion_game_runs_ip_created
  ON kinematics_motion_game_runs (ip_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_kinematics_motion_game_runs_expires
  ON kinematics_motion_game_runs (expires_at);

CREATE TABLE IF NOT EXISTS kinematics_motion_game_scores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  graph1_score INTEGER NOT NULL,
  graph2_score INTEGER NOT NULL,
  graph3_score INTEGER NOT NULL,
  retries_used INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES kinematics_motion_game_runs (id)
);

-- Fewer retries wins a tie: three clean rounds beats the same total assembled
-- from second attempts.
CREATE INDEX IF NOT EXISTS idx_kinematics_motion_game_scores_top
  ON kinematics_motion_game_scores (score DESC, retries_used ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_kinematics_motion_game_scores_ip_created
  ON kinematics_motion_game_scores (ip_hash, created_at);
