# Failover Fix Report — Mini-RAFT Cluster

This document explains the series of bugs that prevented the Mini-RAFT cluster from operating correctly during single-node failover, and the changes that fixed them.

---

## The Problem

When a node was killed via `docker stop`, the remaining 2-node cluster entered various broken states:
- Strokes would commit on the replica but never appear on the canvas
- The gateway would endlessly probe and requeue strokes
- Elections would cascade between the two surviving replicas
- The system would only recover when the dead node was restarted

---

## Bug 1 — `forEach(async ...)` in replicateEntry and beginElection

**What was wrong:**
Both `replicateEntry` and `beginElection` used `peers.forEach(async ...)` to send parallel requests. The `forEach` callback does not await async functions — the `finally` block (which tracked `completedCount`) could fire before the `try` block's awaited HTTP call resolved. This made vote/ACK counting unreliable.

**The fix:**
Replaced with `Promise.allSettled(peers.map(async ...))` wrapped in an early-resolve promise. Each peer's async function returns `true`/`false`. When quorum is reached, the outer promise resolves immediately without waiting for dead peers to timeout. The `Promise.allSettled` still runs in the background to cleanly settle all promises.

**Files changed:** `services/replica/src/raftNode.ts` — `beginElection()`, `replicateEntry()`

---

## Bug 2 — Election timer not cleared in becomeLeader

**What was wrong:**
When a node won an election, `becomeLeader()` started the heartbeat timer but never cleared the election timer. The lingering election timer would fire during normal leadership, causing the leader to call `beginElection()` on itself — a phantom election that destabilized the cluster.

**The fix:**
Added explicit `clearTimeout(this.electionTimer); this.electionTimer = null;` at the top of `becomeLeader()`.

**Files changed:** `services/replica/src/raftNode.ts` — `becomeLeader()`

---

## Bug 3 — Global heartbeat lock causing 500ms blackouts

**What was wrong:**
An initial fix added a global `isHeartbeating` boolean lock to prevent overlapping heartbeat cycles. But `sendHeartbeats()` used `Promise.all` across ALL peers — including dead ones with 500ms timeouts. The lock would hold for 500ms every cycle, during which `setInterval` ticks were silently skipped. Live peers received one heartbeat, then went dark for 500ms. Their election timers (500–800ms) would fire, stealing leadership and creating an election storm.

**The fix:**
Replaced the global lock with a per-peer `heartbeatingPeers: Set<string>`. Each peer gets its own independent fire-and-forget heartbeat. If a peer's previous heartbeat is still in-flight (e.g., waiting for a dead node timeout), only that specific peer is skipped. Live peers always receive heartbeats on schedule.

**Files changed:** `services/replica/src/raftNode.ts` — `sendHeartbeats()`

---

## Bug 4 — Followers always 1 commit behind the leader

**What was wrong:**
Followers only updated their `commitIndex` when receiving `AppendEntries` (which carries `leaderCommit`). Between strokes, heartbeats carried no commit information. Followers appeared permanently 1 index behind.

**The fix:**
Added `leaderCommit: number` to the `HeartbeatRequest` interface. The leader now embeds `this.commitIndex` in every heartbeat. The follower's `onHeartbeat()` advances its `commitIndex` to `Math.min(req.leaderCommit, this.log.length)`. Additionally, `appendStroke()` fires an immediate heartbeat after each commit to push the update without waiting for the next interval.

**Files changed:** `packages/shared/src/index.ts` — `HeartbeatRequest`, `services/replica/src/raftNode.ts` — `sendHeartbeats()`, `onHeartbeat()`, `appendStroke()`

---

## Bug 5 — Gateway relied on async callback for WebSocket broadcast

**What was wrong:**
After the replica committed a stroke, it would respond to the gateway's `POST /stroke` with `{ committed: true, logIndex }`, then separately fire `POST /commit-notify` to the gateway in the background. The gateway only broadcast to WebSocket clients when the commit-notify arrived. Under network congestion (especially with dead-node timeout traffic), this callback frequently got lost — strokes were committed but never appeared on the canvas.

**The fix:**
The gateway now reads the `committed: true` and `logIndex` directly from the `POST /stroke` response. If committed, it immediately pushes the stroke to all WebSocket clients right there in `forwardStroke()`. The existing `/commit-notify` endpoint remains as a dedup-safe fallback.

**Files changed:** `services/gateway/src/index.ts` — `forwardStroke()`, `services/replica/src/raftNode.ts` — `appendStroke()` (changed `await` to `void` on `notifyGatewayCommit`)

---

## Bug 6 — Gateway re-probed dead nodes it already failed on

**What was wrong:**
After `tryPost(replica1)` timed out at 800ms (because replica1 was dead), the gateway's `doProbeStr()` would probe ALL replicas including replica1 again. That added another 500ms timeout just for the dead node, making each retry cycle take ~1300ms and flooding the event loop with dead connections.

**The fix:**
`doProbeStr()` now accepts an optional `skipId` parameter. After a failed `tryPost`, the gateway passes the failed leader's ID: `doProbeStr(attemptLeaderId)`. The probe filters out that node, returning results from only live replicas in milliseconds.

**Files changed:** `services/gateway/src/index.ts` — `doProbeStr()`

---

## Bug 7 — Duplicate stroke processing during retries

**What was wrong:**
When the gateway's `tryPost` timed out, the stroke would be requeued via `setTimeout`. But if the original request was still in-flight (the replica might have actually committed it), a second invocation of `forwardStroke` could fire simultaneously, causing the same stroke to be committed as two separate log entries.

**The fix:**
Added a `pendingStrokes: Set<string>` at the gateway level. The first call to `forwardStroke` locks the `localId`. Requeue retries pass `isRetry = true` to bypass the lock (since the ID is already in the set). On success or final failure, the ID is removed. This guarantees at-most-once processing per stroke.

**Files changed:** `services/gateway/src/index.ts` — `forwardStroke()`

---

## Summary of All Files Changed

| File | Changes |
|---|---|
| `packages/shared/src/index.ts` | Added `leaderCommit` to `HeartbeatRequest` |
| `services/replica/src/raftNode.ts` | Quorum-based early resolve, election timer clearing, per-peer heartbeats, heartbeat commit sync, async commit-notify, immediate post-commit heartbeat |
| `services/replica/src/index.ts` | `leaderHint` in 409 response for non-leader `/stroke` |
| `services/gateway/src/index.ts` | Inline broadcast, probe skip, in-flight dedup, `handleCommitted` helper |
