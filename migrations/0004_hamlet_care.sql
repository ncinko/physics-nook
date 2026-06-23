-- Global care log for Hamlet the hamster (the /hamlet power-source scene).
-- Append-only: each feed/water/pet is one row. "Last fed" is MAX(created_at)
-- for action = 'feed'; tallies come from GROUP BY action. Reuses the existing
-- KINEMATICS_DB binding rather than standing up a new database.
CREATE TABLE IF NOT EXISTS hamlet_care_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hamlet_care_action_created
  ON hamlet_care_events (action, created_at);

CREATE INDEX IF NOT EXISTS idx_hamlet_care_ip_created
  ON hamlet_care_events (ip_hash, created_at);
