-- Legacy top-10 seed for the 1D kinematics stop-in-zones challenge.
-- Apply with:
--   npx wrangler d1 execute physics_nook_kinematics --remote --file seeds/kinematics_legacy_top10.sql

INSERT OR IGNORE INTO kinematics_runs (id, ip_hash, user_agent, created_at, expires_at, used_at) VALUES
  ('legacy-kinematics-2025-09-29-ryo', 'legacy-seed', 'legacy import', 1759147200000, 1759147200000, 1759147200000),
  ('legacy-kinematics-2025-09-29-ivan', 'legacy-seed', 'legacy import', 1759147200000, 1759147200000, 1759147200000),
  ('legacy-kinematics-2025-09-08-nick', 'legacy-seed', 'legacy import', 1757332800000, 1757332800000, 1757332800000),
  ('legacy-kinematics-2025-09-08-abc', 'legacy-seed', 'legacy import', 1757332800000, 1757332800000, 1757332800000),
  ('legacy-kinematics-2025-09-06-tom', 'legacy-seed', 'legacy import', 1757160000000, 1757160000000, 1757160000000),
  ('legacy-kinematics-2025-10-07-by', 'legacy-seed', 'legacy import', 1759838400000, 1759838400000, 1759838400000),
  ('legacy-kinematics-2025-09-27-andrew', 'legacy-seed', 'legacy import', 1758974400000, 1758974400000, 1758974400000),
  ('legacy-kinematics-2025-09-24-braden', 'legacy-seed', 'legacy import', 1758715200000, 1758715200000, 1758715200000),
  ('legacy-kinematics-2025-09-24-hi', 'legacy-seed', 'legacy import', 1758715200000, 1758715200000, 1758715200000),
  ('legacy-kinematics-2025-09-08-leo', 'legacy-seed', 'legacy import', 1757332800000, 1757332800000, 1757332800000);

INSERT OR IGNORE INTO kinematics_scores (id, run_id, name, time_ms, stops, ip_hash, created_at) VALUES
  ('legacy-score-kinematics-2025-09-29-ryo', 'legacy-kinematics-2025-09-29-ryo', 'ryo', 25489, 15, 'legacy-seed', 1759147200000),
  ('legacy-score-kinematics-2025-09-29-ivan', 'legacy-kinematics-2025-09-29-ivan', 'Ivan', 25714, 15, 'legacy-seed', 1759147200000),
  ('legacy-score-kinematics-2025-09-08-nick', 'legacy-kinematics-2025-09-08-nick', 'nick', 27828, 15, 'legacy-seed', 1757332800000),
  ('legacy-score-kinematics-2025-09-08-abc', 'legacy-kinematics-2025-09-08-abc', 'abc', 32147, 15, 'legacy-seed', 1757332800000),
  ('legacy-score-kinematics-2025-09-06-tom', 'legacy-kinematics-2025-09-06-tom', 'Tom', 32373, 15, 'legacy-seed', 1757160000000),
  ('legacy-score-kinematics-2025-10-07-by', 'legacy-kinematics-2025-10-07-by', 'by', 34211, 15, 'legacy-seed', 1759838400000),
  ('legacy-score-kinematics-2025-09-27-andrew', 'legacy-kinematics-2025-09-27-andrew', 'Andrew', 35127, 15, 'legacy-seed', 1758974400000),
  ('legacy-score-kinematics-2025-09-24-braden', 'legacy-kinematics-2025-09-24-braden', 'braden', 37254, 15, 'legacy-seed', 1758715200000),
  ('legacy-score-kinematics-2025-09-24-hi', 'legacy-kinematics-2025-09-24-hi', 'hi', 39095, 15, 'legacy-seed', 1758715200000),
  ('legacy-score-kinematics-2025-09-08-leo', 'legacy-kinematics-2025-09-08-leo', 'leo', 41421, 15, 'legacy-seed', 1757332800000);
