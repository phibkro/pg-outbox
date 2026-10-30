# Recorded run through Cloudflare Hyperdrive: pg-outbox, spec 0004

| | |
| --- | --- |
| Date (UTC) | 2026-10-30 |
| Commit | 497b900aea479247c2db24f5e7b5af52afe7a973 |
| What ran | the conformance suite of pg-outbox (spec 0001), unchanged, through the `pg` adapter over a client whose statements run in a Worker deployed on Cloudflare; the Worker's only database address is a Hyperdrive binding, in front of a disposable Neon branch (PostgreSQL) |
| Worker compatibility | date `2026-10-01`, flags `nodejs_compat`, `enable_request_signal` |
| Hyperdrive caching | **enabled** (Hyperdrive's default) |
| Rounds of a race | 20 |
| Note | the second run, a minute after the first: 43 of 43 passed; this is the run that docs measurements cite |
| Left out | the Worker's address, the Hyperdrive and Neon identifiers, the host, the token |

Hyperdrive caching: enabled

```text
RUN  v5.0.4 /srv/share/projects/pg-outbox/apps/hyperdrive-probe

the origin: PostgreSQL 18.6 (4e5fd08)
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F1 holds: a rolled-back business transaction leaves no row; a committed one leaves one 951ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F1 control enqueue-own-connection fails: enqueue on a connection of its own: the row survives the rollback (the dual-write gap) 729ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F2 holds: one live claim per row: of N claimers exactly one holds it 15103ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F2 control claimById-no-live-check fails: claimById without the live-claim condition takes a row that another claim holds 566ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F2 control claimBatch-no-live-check fails: claimBatch without the live-claim condition hands one row to two claimers 10903ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F2 control claimBatch-no-skip-locked fails: claimBatch without SKIP LOCKED waits for a locked row 15025ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F3 holds: a stale token changes nothing and says ClaimLost 1470ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F3 control ack-no-token fails: ack without the token condition lets a stale worker deliver 746ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F3 control release-no-token fails: release without the token condition lets a stale worker release 799ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F3 control bury-no-token fails: bury without the token condition lets a stale worker end the row 863ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F4 holds: holdClaim keeps the row locked to the end of the transaction; a stale hold says ClaimLost 2862ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F4 control hold-locks-nothing fails: a hold that locks nothing (a plain SELECT) lets a competing claim through 1306ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F4 control hold-no-token fails: a hold without the token condition holds whoever's claim it is: a stale hold says Holding 2830ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F5 holds: ack joins the caller's transaction: rolled back with it, committed with it 1396ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F5 control ack-own-connection fails: ack on a connection of its own: it survives the caller's rollback 814ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F6 holds: a worker that claims and never acks does not lose the row: it is claimed again after the lease 1535ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F6 control mark-at-claim fails: a claim that marks the row delivered (the old relay): the crash loses the message 655ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F6 control no-lease fails: a claim that never lapses: nothing reclaims the row of a dead worker 761ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F7 holds: a class is recorded and the retry date honoured; a row ends only after a class and the declared attempts 3077ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F7 control release-no-class-rule fails: ending a row by attempt count alone: an outage with no class burns it 1469ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F7 control release-no-attempts-rule fails: ending a row by the class alone: the first failure with a class burns it before the declared attempts are used 605ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F7 control release-no-delay fails: a release that ignores the retry delay makes the row due at once 2919ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F7 control claimById-no-due-date fails: claimById without the retry date takes a row that is not due 2924ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F7 control claimBatch-no-due-date fails: claimBatch without the retry date takes a row that is not due 3034ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F8 holds: no statement uses a session feature: the journey's log and every text pass the lint in every mode 1777ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F8 control statement-listens fails: a LISTEN in a statement: no transaction pooler honours it 1641ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F8 control statement-advisory-lock fails: a session advisory lock in a statement 1622ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F9 holds: the sweep lists a pending row once per threshold: no live claim, no recent receipt 1247ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F9 control stale-no-receipt fails: a sweep that ignores the receipt lists the row again at once after it was queued 1196ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F10 holds: cleanup deletes only terminal rows older than the TTL, a bounded batch at a time 2950ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F10 control cleanup-no-status-filter fails: a cleanup that keys on creation time deletes pending rows 2843ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F12 holds: the mode check: PgBouncer and direct accept every operation, Hyperdrive and Supavisor refuse every one as unverified, every read calls an uncached function 9ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F12 control stale-cacheable-read fails: a read that calls no uncached function would be served stale by Hyperdrive 10ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F13 holds: last_error holds only a class of the closed set 612ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F13 control no-class-check fails: a table without the CHECK on last_error stores whatever text a caller sends 551ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F14 holds: a duplicate (kind, dedupe key) stores one row and answers Duplicate 1824ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F14 control no-dedupe-arbiter fails: no unique index and no conflict target: nothing arbitrates a duplicate 600ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F14 control dedupe-pending-only fails: a unique index over pending rows only: a delivered row frees its key before cleanup, against the stated window 1615ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F15 holds: the answers of a miss are the truth: Held, NotDue, Settled; the report of open rows agrees 1569ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F15 control classify-always-held fails: a classifier that calls every miss Held 1408ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F15 control open-lists-settled fails: a report of open rows that lists settled rows too (the status filter replaced by a true condition that keeps its parameter) 1567ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F19 holds: concurrent enqueues of one (kind, dedupe key) store one row: exactly one wins, the rest are Duplicate 1333ms
 ✓ test/hyperdrive.test.ts > conformance of the pg adapter through the probe Worker > F19 control no-dedupe-arbiter-race fails: no unique index and no conflict target: concurrent enqueues of one key all store a row 469ms
statements sent today: 12029

 Test Files  1 passed (1)
      Tests  43 passed (43)
   Start at  03:33:51
   Duration  98.72s (tests 100%)


control F1/enqueue-own-connection on the pg adapter through the probe Worker: the outbox row: expected 1 to be +0 // Object.is equality
control F2/claimById-no-live-check on the pg adapter through the probe Worker: round 1: 20 claimers of row 1 gave ["Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed","Claimed"]: expected [ 20, +0 ] to strictly equal [ 1, 19 ]
control F2/claimBatch-no-live-check on the pg adapter through the probe Worker: a claim of 7 rows never came back empty
control F2/claimBatch-no-skip-locked on the pg adapter through the probe Worker: a claim of a locked row must take the next row, not wait: expected false to be true // Object.is equality
control F3/ack-no-token on the pg adapter through the probe Worker: expected { _tag: 'Delivered' } to strictly equal { _tag: 'ClaimLost' }
control F3/release-no-token on the pg adapter through the probe Worker: expected { _tag: 'Released' } to strictly equal { _tag: 'ClaimLost' }
control F3/bury-no-token on the pg adapter through the probe Worker: expected { _tag: 'Buried' } to strictly equal { _tag: 'ClaimLost' }
control F4/hold-locks-nothing on the pg adapter through the probe Worker: a claim of a held row must wait for the holder's transaction: expected true to be false // Object.is equality
control F4/hold-no-token on the pg adapter through the probe Worker: expected { _tag: 'Holding' } to strictly equal { _tag: 'ClaimLost' }
control F5/ack-own-connection on the pg adapter through the probe Worker: the ack must roll back with the caller's writes: expected [ 'delivered', null ] to strictly equal [ 'pending', …(1) ]
control F6/mark-at-claim on the pg adapter through the probe Worker: while the lease is live nobody else gets the row: expected 'Settled' to be 'Held' // Object.is equality
control F6/no-lease on the pg adapter through the probe Worker: the claim of 1 at 1000 ms: expected 'Held' to be 'Claimed' // Object.is equality
control F7/release-no-class-rule on the pg adapter through the probe Worker: new row for relation "outbox" violates check constraint "outbox_dead_class"
control F7/release-no-attempts-rule on the pg adapter through the probe Worker: expected { _tag: 'Buried' } to strictly equal { _tag: 'Released' }
control F7/release-no-delay on the pg adapter through the probe Worker: expected { _tag: 'Claimed', attempts: 2, …(4) } to strictly equal { _tag: 'NotDue', dueInMs: 500 }
control F7/claimById-no-due-date on the pg adapter through the probe Worker: expected { _tag: 'Claimed', attempts: 2, …(4) } to strictly equal { _tag: 'NotDue', dueInMs: 500 }
control F7/claimBatch-no-due-date on the pg adapter through the probe Worker: claimBatch before the retry date: expected [ { _tag: 'Claimed', …(5) } ] to strictly equal []
control F8/statement-listens on the pg adapter through the probe Worker: errors of the lint in {"kind":"TransactionPooled","pooler":"hyperdrive"}: expected [ Array(1) ] to strictly equal []
control F8/statement-advisory-lock on the pg adapter through the probe Worker: errors of the lint in {"kind":"TransactionPooled","pooler":"hyperdrive"}: expected [ Array(1) ] to strictly equal []
control F9/stale-no-receipt on the pg adapter through the probe Worker: right after the receipt the sweep stays quiet: expected [ '1' ] to strictly equal []
control F10/cleanup-no-status-filter on the pg adapter through the probe Worker: the rest of the old terminal rows: expected 3 to be 2 // Object.is equality
control F12/stale-cacheable-read on the pg adapter through the probe Worker: every read calls a function that makes Hyperdrive skip its cache: expected [ 'stale' ] to strictly equal []
control F13/no-class-check on the pg adapter through the probe Worker: an address stored as a failure class: expected undefined to be '23514' // Object.is equality
control F14/no-dedupe-arbiter on the pg adapter through the probe Worker: expected { _tag: 'Enqueued', id: '2' } to strictly equal { _tag: 'Duplicate' }
control F14/dedupe-pending-only on the pg adapter through the probe Worker: a delivered row still holds its key: expected { _tag: 'Enqueued', id: '7' } to strictly equal { _tag: 'Duplicate' }
control F15/classify-always-held on the pg adapter through the probe Worker: row 3: expected { _tag: 'Held', remainingMs: +0 } to strictly equal { _tag: 'Settled' }
control F15/open-lists-settled on the pg adapter through the probe Worker: open rows, newest first: expected [ '3', '2', '1' ] to strictly equal [ '2', '1' ]
control F19/no-dedupe-arbiter-race on the pg adapter through the probe Worker: round 1: 10 concurrent enqueues of one key: expected [ 'Enqueued', 'Enqueued', …(8) ] to strictly equal [ 'Duplicate', 'Duplicate', …(8) ]
```
