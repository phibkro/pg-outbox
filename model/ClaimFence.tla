------------------------------ MODULE ClaimFence ------------------------------
(***************************************************************************)
(* One outbox row, a few workers and a clock: the claim, fence, hold, ack, *)
(* release and bury protocol of docs/specs/0001-core.md, one action per     *)
(* statement of packages/core/src/sql.ts.                                   *)
(*                                                                          *)
(* Each action is tagged `@operation <id>` with the operation it models;    *)
(* `bun run model` fails when an id here is not an operation of the core,   *)
(* or an operation is neither tagged nor listed as not modelled in          *)
(* model/cases.json.                                                        *)
(*                                                                          *)
(* The switches turn one rule of the protocol off each; every case in       *)
(* model/cases.json names the switch, the invariant it must break, and the  *)
(* conformance control that makes the same defect in SQL. TLC checks this   *)
(* model, not the SQL: the tie to the SQL is by operation id and by the     *)
(* digest of the covered files (model/confirmed.json).                      *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
  Workers,       \* the claimers
  MaxTime,       \* the clock runs 0 .. MaxTime
  Lease,         \* ms of a lease, in clock ticks
  Delay,         \* the declared retry delay, in ticks
  MaxAttempts,   \* the declared attempts: release ends a row after this many claims and a recorded class
  MaxClaims,     \* bound on claims, to keep the state space finite
  Fence,         \* settle statements carry the claim token
  LiveCheck,     \* a claim needs "no live claim" (claimed_until IS NULL OR <= now)
  MarkAtClaim,   \* the old relay: the claim itself marks the row delivered
  ClassRule,     \* release ends a row only when a failure class is on record
  HoldLocks,     \* holdClaim locks the row to the end of the caller's transaction (FOR NO KEY UPDATE)
  LeaseLapses    \* a claim has a finite lease

ASSUME Fence \in BOOLEAN /\ LiveCheck \in BOOLEAN /\ MarkAtClaim \in BOOLEAN
ASSUME ClassRule \in BOOLEAN /\ HoldLocks \in BOOLEAN /\ LeaseLapses \in BOOLEAN

None == 0
Forever == MaxTime + Lease + 1   \* "claimed_until = infinity": the lease of the no-lease variant

VARIABLES
  now,           \* the database clock
  status,        \* "pending" | "delivered" | "dead"
  token,         \* the row's current claim token, None when unclaimed; tokens are fresh numbers
  until,         \* claimed_until, None when unclaimed
  attempts,      \* claims so far
  nextAt,        \* next_attempt_at
  classOnRecord, \* last_error is set
  pc,            \* each worker: "idle" | "claimed" | "sent" | "crashed"
  held,          \* the token each worker holds, None when it holds none
  leaseEnd,      \* when that worker's lease ends: what it believes
  inTx,          \* the worker has a hold open in its transaction
  lockOwner,     \* the worker whose transaction holds the row lock, None when nobody
  heard,         \* the tokens whose send the provider heard
  endedBy,       \* "none" | "release" | "bury": how the row ended
  staleWrite,    \* history: a settle took effect with a token that was not current
  claimedUnderHold, \* history: a claim took effect while a worker's hold was open
  sawClaimLost,  \* history, for the reach cases
  sawHoldWait,   \* history, for the reach cases
  sawHeld        \* history, for the reach cases

vars == <<now, status, token, until, attempts, nextAt, classOnRecord, pc, held, leaseEnd,
          inTx, lockOwner, heard, endedBy, staleWrite, claimedUnderHold, sawClaimLost,
          sawHoldWait, sawHeld>>

TypeOK ==
  /\ now \in 0..MaxTime
  /\ status \in {"pending", "delivered", "dead"}
  /\ token \in Nat /\ until \in Nat /\ attempts \in Nat /\ nextAt \in Nat
  /\ classOnRecord \in BOOLEAN
  /\ pc \in [Workers -> {"idle", "claimed", "sent", "crashed"}]
  /\ endedBy \in {"none", "release", "bury"}

Init ==
  /\ now = 0 /\ status = "pending" /\ token = None /\ until = None /\ attempts = 0 /\ nextAt = 0
  /\ classOnRecord = FALSE
  /\ pc = [w \in Workers |-> "idle"] /\ held = [w \in Workers |-> None] /\ leaseEnd = [w \in Workers |-> 0]
  /\ inTx = [w \in Workers |-> FALSE] /\ lockOwner = None
  /\ heard = {} /\ endedBy = "none"
  /\ staleWrite = FALSE /\ claimedUnderHold = FALSE
  /\ sawClaimLost = FALSE /\ sawHoldWait = FALSE /\ sawHeld = FALSE

Alive(w) == pc[w] # "crashed"

\* The statement waits for the row lock of another worker's open transaction (the hold).
Blocked(w) == HoldLocks /\ lockOwner # None /\ lockOwner # w

\* "claimed_until IS NULL OR claimed_until <= now"
Free == until = None \/ until <= now

\* The token condition of the settle statements: AND claim_token = $2.
Matches(w) == ~Fence \/ token = held[w]

\* A settle that took effect with a token that is not the row's current one.
Stale(w) == token # held[w]

Finished(w) ==
  /\ pc' = [pc EXCEPT ![w] = "idle"]
  /\ held' = [held EXCEPT ![w] = None]
  /\ inTx' = [inTx EXCEPT ![w] = FALSE]

(***************************************************************************)
(* Time                                                                     *)
(***************************************************************************)

Tick ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ UNCHANGED <<status, token, until, attempts, nextAt, classOnRecord, pc, held, leaseEnd, inTx,
                 lockOwner, heard, endedBy, staleWrite, claimedUnderHold, sawClaimLost, sawHoldWait,
                 sawHeld>>

(***************************************************************************)
(* @operation claimById claimBatch                                          *)
(* One conditional UPDATE: the row is pending, due, and (LiveCheck) no live *)
(* claim holds it. A claim waits for the row lock of an open hold; the      *)
(* batch claim skips the locked row instead, which is the same on one row. *)
(***************************************************************************)
Claim(w) ==
  /\ pc[w] = "idle" /\ attempts < MaxClaims
  /\ status = "pending" /\ nextAt <= now
  /\ (~LiveCheck \/ Free)
  /\ ~Blocked(w)
  /\ attempts' = attempts + 1
  /\ token' = attempts + 1
  /\ until' = IF LeaseLapses THEN now + Lease ELSE Forever
  /\ status' = IF MarkAtClaim THEN "delivered" ELSE "pending"
  /\ pc' = [pc EXCEPT ![w] = "claimed"]
  /\ held' = [held EXCEPT ![w] = attempts + 1]
  /\ leaseEnd' = [leaseEnd EXCEPT ![w] = now + Lease]
  /\ claimedUnderHold' = (claimedUnderHold \/ \E v \in Workers : inTx[v])
  /\ UNCHANGED <<now, nextAt, classOnRecord, inTx, lockOwner, heard, endedBy, staleWrite,
                 sawClaimLost, sawHoldWait, sawHeld>>

\* A claim that would be enabled but waits for a hold: what the reach case sees.
ClaimWaits(w) ==
  /\ pc[w] = "idle" /\ attempts < MaxClaims /\ status = "pending" /\ nextAt <= now /\ Free
  /\ Blocked(w)
  /\ sawHoldWait' = TRUE
  /\ UNCHANGED <<now, status, token, until, attempts, nextAt, classOnRecord, pc, held, leaseEnd, inTx,
                 lockOwner, heard, endedBy, staleWrite, claimedUnderHold, sawClaimLost, sawHeld>>

\* A claim that finds a live claim and matches nothing: the caller is told Held.
ClaimHeld(w) ==
  /\ pc[w] = "idle" /\ attempts < MaxClaims /\ status = "pending" /\ nextAt <= now
  /\ LiveCheck /\ ~Free /\ ~Blocked(w)
  /\ sawHeld' = TRUE
  /\ UNCHANGED <<now, status, token, until, attempts, nextAt, classOnRecord, pc, held, leaseEnd, inTx,
                 lockOwner, heard, endedBy, staleWrite, claimedUnderHold, sawClaimLost, sawHoldWait>>

\* The worker sends: the provider hears the row (at least once; a crash after this and before the ack repeats it).
Send(w) ==
  /\ pc[w] = "claimed"
  /\ pc' = [pc EXCEPT ![w] = "sent"]
  /\ heard' = heard \cup {held[w]}
  /\ UNCHANGED <<now, status, token, until, attempts, nextAt, classOnRecord, held, leaseEnd, inTx,
                 lockOwner, endedBy, staleWrite, claimedUnderHold, sawClaimLost, sawHoldWait, sawHeld>>

(***************************************************************************)
(* The three settles, in autocommit or at the commit of a hold.             *)
(***************************************************************************)
SettleDelivered(w) ==
  /\ status' = "delivered" /\ token' = None /\ until' = None
  /\ staleWrite' = (staleWrite \/ Stale(w))
  /\ UNCHANGED <<attempts, nextAt, classOnRecord, endedBy>>

\* A release that records class `c` (a provider failure) or none (the worker's own outage).
SettleReleased(w, c) ==
  LET cls == classOnRecord \/ c
      ends == attempts >= MaxAttempts /\ (~ClassRule \/ cls)
  IN /\ classOnRecord' = cls
     /\ status' = IF ends THEN "dead" ELSE "pending"
     /\ endedBy' = IF ends THEN "release" ELSE endedBy
     /\ nextAt' = IF ends THEN nextAt ELSE now + Delay
     /\ token' = None /\ until' = None
     /\ staleWrite' = (staleWrite \/ Stale(w))
     /\ UNCHANGED attempts

SettleBuried(w) ==
  /\ status' = "dead" /\ classOnRecord' = TRUE /\ endedBy' = "bury"
  /\ token' = None /\ until' = None
  /\ staleWrite' = (staleWrite \/ Stale(w))
  /\ UNCHANGED <<attempts, nextAt>>

\* The statement matched no row: the token is not the current one (or the row is not pending).
ClaimLostFor(w) == ~(status = "pending" /\ Matches(w))

SettleUnchanged ==
  UNCHANGED <<status, token, until, attempts, nextAt, classOnRecord, endedBy, staleWrite>>

\* One settle of kind `k` by worker `w`: it takes effect, or the worker is told ClaimLost.
Settle(w, k, c) ==
  IF ClaimLostFor(w)
    THEN /\ SettleUnchanged /\ sawClaimLost' = TRUE
    ELSE /\ CASE k = "ack"     -> SettleDelivered(w)
              [] k = "release" -> SettleReleased(w, c)
              [] k = "bury"    -> SettleBuried(w)
         /\ sawClaimLost' = sawClaimLost

\* @operation ack
\* The worker acks after it sent: the protocol's order (claim, send, ack).
Ack(w) ==
  /\ pc[w] = "sent" /\ ~inTx[w] /\ ~Blocked(w)
  /\ Settle(w, "ack", FALSE)
  /\ Finished(w)
  /\ UNCHANGED <<now, leaseEnd, lockOwner, heard, claimedUnderHold, sawHoldWait, sawHeld>>

\* @operation release
Release(w, c) ==
  /\ pc[w] \in {"claimed", "sent"} /\ ~inTx[w] /\ ~Blocked(w)
  /\ Settle(w, "release", c)
  /\ Finished(w)
  /\ UNCHANGED <<now, leaseEnd, lockOwner, heard, claimedUnderHold, sawHoldWait, sawHeld>>

\* @operation bury
Bury(w) ==
  /\ pc[w] \in {"claimed", "sent"} /\ ~inTx[w] /\ ~Blocked(w)
  /\ Settle(w, "bury", TRUE)
  /\ Finished(w)
  /\ UNCHANGED <<now, leaseEnd, lockOwner, heard, claimedUnderHold, sawHoldWait, sawHeld>>

(***************************************************************************)
(* @operation holdClaim                                                     *)
(* SELECT ... WHERE id AND claim_token AND status = 'pending' FOR NO KEY    *)
(* UPDATE, in the caller's transaction: the row stays locked (HoldLocks) to *)
(* the end of it; a stale token gets no row.                                *)
(***************************************************************************)
Hold(w) ==
  /\ pc[w] \in {"claimed", "sent"} /\ ~inTx[w] /\ ~Blocked(w)
  /\ IF ClaimLostFor(w)
       THEN /\ sawClaimLost' = TRUE
            /\ Finished(w)
            /\ UNCHANGED <<lockOwner>>
       ELSE /\ inTx' = [inTx EXCEPT ![w] = TRUE]
            /\ lockOwner' = IF HoldLocks THEN w ELSE lockOwner
            /\ UNCHANGED <<pc, held, sawClaimLost>>
  /\ UNCHANGED <<now, status, token, until, attempts, nextAt, classOnRecord, leaseEnd, heard, endedBy,
                 staleWrite, claimedUnderHold, sawHoldWait, sawHeld>>

\* @operation ack
\* The ack in the caller's transaction, and the commit: the settle and the lock's release are one step.
CommitAck(w) ==
  /\ inTx[w] /\ pc[w] = "sent"
  /\ Settle(w, "ack", FALSE)
  /\ Finished(w)
  /\ lockOwner' = IF lockOwner = w THEN None ELSE lockOwner
  /\ UNCHANGED <<now, leaseEnd, heard, claimedUnderHold, sawHoldWait, sawHeld>>

\* The caller's transaction ends without the ack (it rolled back, or committed other writes): the lock is released.
EndTx(w) ==
  /\ inTx[w]
  /\ inTx' = [inTx EXCEPT ![w] = FALSE]
  /\ lockOwner' = IF lockOwner = w THEN None ELSE lockOwner
  /\ UNCHANGED <<now, status, token, until, attempts, nextAt, classOnRecord, pc, held, leaseEnd, heard,
                 endedBy, staleWrite, claimedUnderHold, sawClaimLost, sawHoldWait, sawHeld>>

\* The worker dies: nothing more is sent with its token; its open transaction is rolled back.
Crash(w) ==
  /\ Alive(w)
  /\ pc' = [pc EXCEPT ![w] = "crashed"]
  /\ inTx' = [inTx EXCEPT ![w] = FALSE]
  /\ lockOwner' = IF lockOwner = w THEN None ELSE lockOwner
  /\ UNCHANGED <<now, status, token, until, attempts, nextAt, classOnRecord, held, leaseEnd, heard,
                 endedBy, staleWrite, claimedUnderHold, sawClaimLost, sawHoldWait, sawHeld>>

Next ==
  \/ Tick
  \/ \E w \in Workers :
       \/ Claim(w) \/ ClaimWaits(w) \/ ClaimHeld(w) \/ Send(w) \/ Ack(w) \/ Bury(w) \/ Hold(w)
       \/ CommitAck(w) \/ EndTx(w) \/ Crash(w)
       \/ \E c \in BOOLEAN : Release(w, c)

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* Invariants. Each is the model's form of a guarantee of the spec.         *)
(***************************************************************************)

\* LS1: two workers never both hold a live lease.
LiveHolders == {w \in Workers : pc[w] \in {"claimed", "sent"} /\ leaseEnd[w] > now /\ ~(status = "delivered")}
AtMostOneLiveLease == Cardinality(LiveHolders) <= 1

\* LS2: a settle with a token that is not current never takes effect.
NoStaleSettle == ~staleWrite

\* LS2: a claim never takes effect while a worker's hold is open.
HoldExcludesClaims == ~claimedUnderHold

\* LS3: a row is delivered only after the provider heard it (a claim never marks the row delivered).
DeliveredWasHeard == status = "delivered" => heard # {}

\* LS5: a row ends dead only after a failure class was recorded.
DeadNeedsClass == status = "dead" => classOnRecord

\* LS5: release ends a row only after the declared attempts.
ReleaseEndsAfterAttempts == endedBy = "release" => attempts >= MaxAttempts

\* A lease is finite: a crashed worker cannot hold a row for ever.
LeaseIsFinite == until = None \/ until <= now + Lease

(***************************************************************************)
(* Reach: the model can do what the invariants are about. A reach case      *)
(* checks the negation and must find a counterexample.                      *)
(***************************************************************************)
NeverClaimLost == ~sawClaimLost
NeverHeld == ~sawHeld
NeverHoldWait == ~sawHoldWait
NeverDelivered == status # "delivered"
NeverDead == status # "dead"
NeverReclaimed == attempts < 2
NeverDeadByRelease == endedBy # "release"
NeverTwiceHeard == Cardinality(heard) < 2
=============================================================================
