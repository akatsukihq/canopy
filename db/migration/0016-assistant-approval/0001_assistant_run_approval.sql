BEGIN;

-- A run can stop to wait for its owner to approve tool calls. The pending calls and the state to continue
-- live in assistant_runs.continuation; abandoned approvals expire with the run's retention. Safe to re-run.
ALTER TABLE assistant_runs DROP CONSTRAINT IF EXISTS assistant_runs_status_check;
ALTER TABLE assistant_runs ADD CONSTRAINT assistant_runs_status_check
  CHECK(status IN ('queued','running','completed','failed','cancelled','unknown','awaiting-approval'));

COMMIT;
