-- The server now issues each siege's RNG seed and re-plays the submitted input
-- log to compute the score, so a run row has to remember its seed. Runs created
-- before this migration have no seed and can no longer be redeemed.
ALTER TABLE caerbannog_runs ADD COLUMN seed INTEGER;
