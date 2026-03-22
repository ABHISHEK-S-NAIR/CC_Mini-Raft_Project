# Project Status Report
## Distributed Real-Time Drawing Board with Mini-RAFT Consensus

**Date:** March 22, 2026  
**Prepared for:** Project Team  
**Status:** Partially Complete (Core Consensus Flow Working; Requirement Gaps Remaining)

---

## 1) Executive Summary

The project has a **functional mini distributed system** with:
- A working Gateway service (WebSocket client ingress + commit broadcast)
- Three Replica services with Mini-RAFT election, heartbeat, and log replication
- A browser frontend canvas with optimistic drawing and pending/committed visual behavior
- Docker Compose orchestration for all major runtime services

The system currently demonstrates the main happy-path behavior expected for a Mini-RAFT drawing board. However, it does **not yet fully satisfy all SRS/SAD requirements** for failover robustness, observability, hot-reload workflow, and requirement-grade reliability guarantees.

---

## 2) Current Implementation Scope (Done)

### 2.1 Architecture and Runtime

✅ Implemented
- Monorepo workspace with shared types package and separate gateway/replica services
- 1 gateway + 3 replicas + 1 frontend container topology
- Shared Docker network for inter-service communication

### 2.2 Frontend

✅ Implemented
- HTML5 canvas drawing with pointer support
- Optimistic local rendering of new strokes
- Distinct pending stroke visualization
- WebSocket reconnect behavior to gateway
- Initial state sync from gateway (`init`) and commit updates (`committed`)

### 2.3 Gateway Service

✅ Implemented
- Maintains active WebSocket client pool
- Receives strokes from clients and forwards to current leader over HTTP (`/stroke`)
- Receives leader commit notifications (`/commit-notify`)
- Broadcasts committed strokes to all connected clients
- Accepts explicit leader updates (`/leader-change`)
- Health/state endpoints are available for inspection

### 2.4 Replica / Mini-RAFT

✅ Implemented
- RAFT roles: `follower`, `candidate`, `leader`
- Election timeout randomization (configured defaults: 500–800 ms)
- Vote RPC flow (`/request-vote`) and majority election
- Leader heartbeat loop (`/heartbeat`, default 150 ms)
- AppendEntries replication (`/append-entries`) with quorum commit logic
- Sync endpoint (`/sync-log`) for lagging follower catch-up
- Gateway notifications on leader change and entry commit

### 2.5 Shared Protocol Contract

✅ Implemented
- Shared TypeScript contracts for all RPC/WS payloads
- Typed event model for client/server websocket messages

---

## 3) Requirement Alignment Snapshot (SRS + SAD)

### 3.1 Overall Compliance Score (Qualitative)

- **Core distributed workflow:** Strong
- **Fault-tolerant behavior under realistic failures:** Moderate
- **Operational readiness / observability / reproducibility:** Moderate to Low
- **Strict SRS conformance:** Partial

### 3.2 Functional Requirement Status

| Area | Status | Notes |
|---|---|---|
| Frontend freehand drawing and optimistic rendering | ✅ Met | Core behavior implemented |
| Pending vs committed visualization | ✅ Met | Pending overlay is visible |
| Gateway WS client management | ✅ Met | Client pool and broadcast implemented |
| Gateway forwards to leader | ✅ Met | Uses leader map and `/stroke` |
| Explicit leader change handling | ✅ Met | `/leader-change` updates leader id |
| Replica state machine and elections | ✅ Met | Candidate election + quorum vote |
| Heartbeats and follower suppression | ✅ Met | Leader sends periodic heartbeats |
| Majority-based commit | ✅ Met | Commit after quorum ACK |
| Catch-up synchronization path | 🟡 Partial | Exists, but semantics are simplified |
| Leader failover with uninterrupted UX guarantees | 🟡 Partial | Re-routing exists, but transient stroke failures can occur |
| Dockerized 1+3 topology with distinct IDs | ✅ Met | Compose defines all services and env IDs |
| Bind-mounted hot reload via nodemon | ❌ Not Met | Current compose/docker setup does not provide this mode |

---

## 4) Detailed Gaps and Missing Items

### 4.1 Gateway Failover Behavior Is Simpler Than Spec Narrative

**Observed:**
- Gateway updates leader primarily through explicit `/leader-change` notifications.
- No active heartbeat-timeout-based probing/discovery mechanism is implemented in gateway.

**Impact:**
- During leader transitions, stroke forwarding can fail until new leader is known or stabilized.
- This weakens strict interpretation of “automatic failover with zero user disruption.”

### 4.2 In-Memory State Only (Durability Gap)

**Observed:**
- Replica log and gateway committed list are in-memory.
- Restarting containers can lose local state.

**Impact:**
- Limits compliance with strong fault-tolerance/data-loss claims in non-functional requirements.
- Recovery behavior depends on current leader state and runtime conditions.

### 4.3 Committed-Entry Safety Is Not Fully Guarded

**Observed:**
- Conflict handling and truncation logic exist.
- There is no explicit invariant enforcement preventing truncation of already committed entries.

**Impact:**
- Under edge conflict patterns, safety assumptions rely on control flow rather than hard guards.

### 4.4 Limited Observability vs SRS Expectation

**Observed:**
- Minimal logging only; no structured audit logs for elections/terms/heartbeats/commits.

**Impact:**
- Harder to verify NFR behavior and debug distributed edge cases.

### 4.5 Hot-Reload Requirement Not Fully Satisfied

**Observed:**
- Dockerfiles run dev scripts with `tsx`.
- Compose does not include replica bind mounts for live edit reload workflow described in SRS/SAD.

**Impact:**
- Developer workflow and demo behavior do not fully align with FR-D02 and associated expectations.

### 4.6 Strict Performance/Recovery NFRs Are Unverified

**Observed:**
- No benchmark, load, or automated failover timing tests currently embedded.

**Impact:**
- NFR claims such as ≤300 ms propagation and ≤3 s recoverability remain unproven.

---

## 5) Risk Assessment (Current)

| Risk | Severity | Likelihood | Why It Matters |
|---|---|---|---|
| Stroke forwarding failure during leader turnover | High | Medium | Affects perceived reliability during failover |
| Data loss on full process/container restarts | High | Medium | In-memory-only state limits resilience |
| Difficult production debugging due to low observability | Medium | High | Distributed bugs become expensive to diagnose |
| Requirement mismatch in hot-reload workflow | Medium | High | Impacts evaluation against SRS/SAD deliverables |
| Unverified latency/recovery targets | Medium | Medium | Hard to claim readiness without evidence |

---

## 6) Suggested Action Plan (Prioritized)

### Priority 1 — Reliability and Failover
1. Add gateway-side retry/fallback behavior when `/stroke` to leader fails.
2. Add gateway leader discovery fallback (probe replicas for current leader state) when forwarding fails.
3. Improve non-leader response to provide actionable `leaderHint` if known.

### Priority 2 — Safety and Correctness
4. Add explicit commit safety guards so committed entries cannot be truncated.
5. Tighten sync semantics to ensure catch-up is aligned with committed-prefix safety.

### Priority 3 — Operational Readiness
6. Add structured logs for election start/win/loss, term changes, heartbeats, append ACKs, commits, and sync events.
7. Add simple health/diagnostic endpoints that expose leader view and replication lag per node.

### Priority 4 — SRS Workflow Compliance
8. Update Docker Compose for bind-mount + live reload workflow if required by grading rubric.
9. Document developer run modes (demo mode vs hot-reload mode).

### Priority 5 — Verification
10. Add targeted scenario tests/checklists for:
   - Leader crash and election recovery
   - Follower restart and sync catch-up
   - Commit quorum behavior with one node down
   - End-to-end latency sampling

---

## 7) Definition of “Done” for Next Milestone

The next milestone should be considered complete when all of the following are true:
- Failover forwarding and leader discovery are resilient enough to avoid user-facing stroke loss in single-node failure cases.
- Safety invariants are explicit and test-backed for committed-prefix behavior.
- Hot-reload/developer workflow matches documented SRS expectations (or the SRS is formally revised).
- Observability and diagnostics are sufficient to demonstrate RAFT state transitions clearly.
- NFR claims (latency and recovery) are validated with repeatable measurements.

---

## 8) Final Project Status Statement

**Current project status:**
- **Functionally viable demo:** Yes
- **Core Mini-RAFT logic operational:** Yes
- **Fully compliant with attached SAD/SRS:** No (partial)
- **Ready for final acceptance without further work:** Not yet

The project is in a strong intermediate state with core distributed behavior implemented. The remaining work is primarily around **robustness, formal requirement conformance, and verification depth** rather than basic feature construction.
