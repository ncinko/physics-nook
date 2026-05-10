-- Legacy top-10 seed for the 2D kinematics Goal Rush challenge.
-- Apply after migrations with:
--   npx wrangler d1 execute physics-nook-kinematics --remote --file seeds/kinematics_goal_rush_legacy_top10.sql

INSERT OR IGNORE INTO kinematics_goal_rush_runs (id, ip_hash, user_agent, created_at, expires_at, used_at) VALUES
  ('legacy-goal-rush-2025-09-07-ryo', 'legacy-seed', 'legacy import', 1757246400000, 1757246400000, 1757246400000),
  ('legacy-goal-rush-2025-09-07-timmy', 'legacy-seed', 'legacy import', 1757246400000, 1757246400000, 1757246400000),
  ('legacy-goal-rush-2025-09-06-tom', 'legacy-seed', 'legacy import', 1757160000000, 1757160000000, 1757160000000),
  ('legacy-goal-rush-2025-10-03-lucas-t', 'legacy-seed', 'legacy import', 1759492800000, 1759492800000, 1759492800000),
  ('legacy-goal-rush-2026-02-08-eva', 'legacy-seed', 'legacy import', 1770552000000, 1770552000000, 1770552000000),
  ('legacy-goal-rush-2026-02-08-hallo', 'legacy-seed', 'legacy import', 1770552000000, 1770552000000, 1770552000000),
  ('legacy-goal-rush-2025-09-30-aditya', 'legacy-seed', 'legacy import', 1759233600000, 1759233600000, 1759233600000),
  ('legacy-goal-rush-2025-09-30-saaz', 'legacy-seed', 'legacy import', 1759233600000, 1759233600000, 1759233600000),
  ('legacy-goal-rush-2026-02-08-zoomy', 'legacy-seed', 'legacy import', 1770552000000, 1770552000000, 1770552000000),
  ('legacy-goal-rush-2025-09-09-ivan', 'legacy-seed', 'legacy import', 1757419200000, 1757419200000, 1757419200000);

INSERT OR IGNORE INTO kinematics_goal_rush_scores
  (id, run_id, name, score, golden_hits, normal_hits, duration_ms, ip_hash, created_at)
VALUES
  ('legacy-score-goal-rush-2025-09-07-ryo', 'legacy-goal-rush-2025-09-07-ryo', 'ryo', 167, 24, 95, 30000, 'legacy-seed', 1757246400000),
  ('legacy-score-goal-rush-2025-09-07-timmy', 'legacy-goal-rush-2025-09-07-timmy', 'timmy', 58, 12, 22, 30000, 'legacy-seed', 1757246400000),
  ('legacy-score-goal-rush-2025-09-06-tom', 'legacy-goal-rush-2025-09-06-tom', 'tom', 38, 5, 23, 30000, 'legacy-seed', 1757160000000),
  ('legacy-score-goal-rush-2025-10-03-lucas-t', 'legacy-goal-rush-2025-10-03-lucas-t', 'Lucas T', 36, 5, 21, 30000, 'legacy-seed', 1759492800000),
  ('legacy-score-goal-rush-2026-02-08-eva', 'legacy-goal-rush-2026-02-08-eva', 'Eva', 30, 8, 6, 30000, 'legacy-seed', 1770552000000),
  ('legacy-score-goal-rush-2026-02-08-hallo', 'legacy-goal-rush-2026-02-08-hallo', 'hallo', 27, 7, 6, 30000, 'legacy-seed', 1770552000000),
  ('legacy-score-goal-rush-2025-09-30-aditya', 'legacy-goal-rush-2025-09-30-aditya', 'aditya', 26, 5, 11, 30000, 'legacy-seed', 1759233600000),
  ('legacy-score-goal-rush-2025-09-30-saaz', 'legacy-goal-rush-2025-09-30-saaz', 'saaz', 21, 5, 6, 30000, 'legacy-seed', 1759233600000),
  ('legacy-score-goal-rush-2026-02-08-zoomy', 'legacy-goal-rush-2026-02-08-zoomy', 'zoomy', 20, 3, 11, 30000, 'legacy-seed', 1770552000000),
  ('legacy-score-goal-rush-2025-09-09-ivan', 'legacy-goal-rush-2025-09-09-ivan', 'Ivan', 18, 2, 12, 30000, 'legacy-seed', 1757419200000);
