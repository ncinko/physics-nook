-- Motion Match generates its three target graphs from a seed instead of using
-- fixed curves. The seed is minted with the run token and stored here, so the
-- scoring endpoint can rebuild exactly the graphs the player was shown. It is
-- never read from the submission: that is what stops a run being scored against
-- easier curves than the ones on screen.
--
-- DEFAULT 0 covers any run row minted before this column existed; seed 0 is a
-- valid generator input, so those rows still score against a real set of graphs.
ALTER TABLE kinematics_motion_game_runs ADD COLUMN seed INTEGER NOT NULL DEFAULT 0;
