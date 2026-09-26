-- Stuck locks: why one record won't save while everything else does.
--
-- A save that hangs and then fails with "The server didn't answer in 30
-- seconds" (older builds: "Failed to fetch") on the SAME record every time,
-- while other records save fine, is usually a row someone else still holds:
-- a SQL editor tab that ran BEGIN without COMMIT, a table-editor session
-- that never finished, or a query that is still running. Reads keep working
-- (Postgres serves the last committed version) — only writes to that row, and
-- to rows that reference it (a vendor's people, its bills), wait on the lock.
--
-- Run each statement on its own in the Supabase SQL editor.

-- 1. Who is waiting, and on whom.
select w.pid as waiting_pid, left(w.query, 80) as waiting_query,
       b.pid as blocking_pid, b.state as blocking_state, b.application_name,
       now() - b.xact_start as blocking_for, left(b.query, 80) as blocking_query
from pg_stat_activity w
join lateral unnest(pg_blocking_pids(w.pid)) as blk(pid) on true
join pg_stat_activity b on b.pid = blk.pid;

-- 2. Transactions left open with nothing running — the usual culprit.
select pid, usename, application_name, state, now() - xact_start as open_for, left(query, 100) as last_query
from pg_stat_activity
where state = 'idle in transaction'
order by xact_start;

-- 3. End the open transactions from (2) that have been idle more than five
--    minutes. Anything they had not committed is rolled back, which is what
--    an abandoned transaction should get. Uncomment to run.
-- select pid, pg_terminate_backend(pid)
-- from pg_stat_activity
-- where state = 'idle in transaction' and xact_start < now() - interval '5 minutes';
