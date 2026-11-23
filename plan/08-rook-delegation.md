# 08 — Rook and contextual delegation

Status: Experimental stdio read-only Ask adapter implemented; session/context/permission UI and provider-backed acceptance remain open
Depends on: [07](07-changes-persistence.md) and real Rook discovery from 01  
Next: [09 — Isolated implementation](09-worktrees-environments.md)

## Outcome

Use the real harness for contextual read-only investigation, visible permissions, and recoverable sessions. Do not enable repository-changing Build until step 09 provides its isolated execution boundary.

## Tasks

- [x] Implement Rook stdio v1 transport with immutable read-only tool capability negotiation. Verified against local Rook 0.1.6; package license MIT.
- [x] Manage the Rook process separately from React rendering and terminate it on session close/application shutdown.
- [x] Implement Ask session creation, bounded prompt/context, streamed event display, cancellation request, and stop. Reconnect, persisted linkage, full correlated activity taxonomy remain open.
- [ ] Add Ask from selection, diagnostic, file, terminal excerpt, diff, or empty composer.
- [ ] Show removable context chips with source/workspace identity and refresh warnings when stale.
- [x] Enforce genuinely read-only Ask through Rook's immutable `readOnlyTools`; reject capability mismatches and Build remains unavailable.
- [ ] Surface exact permission scope, workspace, command/tool, and requested authority with approve/deny behavior.
- [ ] Keep tool execution authority with Rook; do not duplicate or bypass permissions through Laplace.
- [ ] Promote Ask to persistent Change without losing attached context or investigation history.
- [ ] Record tool/skill/MCP provenance from available events now, even though management UI comes later.
- [ ] Implement steering acknowledgments and pause semantics where supported; otherwise expose limitations and use confirmed stop before editing.
- [ ] Build controlled fake harness fixtures for denial, duplicates, out-of-order events, dropped streams, and partial failure.

## UI reference

Use preview-agent.png and the Editor contextual Ask/Patch/Change controls. Keep Rook activity/session inspection available, but contextual requests should not require navigating away from source. Map demo statuses to real connection/execution state.

## Checks and exit gate

- [ ] Demonstrate provider-backed real repository investigation with source-linked answers and no unauthorized writes. Non-provider initialization and read-only capabilities verified; provider credentials were unconfigured in this environment.
- [ ] A permission denial actually prevents execution; a UI toggle alone is insufficient.
- [x] Permission requests and once/session/deny responses are routed to Rook's stdio protocol; provider-backed denial behavior still needs native test coverage.
- [ ] Reconnect does not duplicate commands or invent completed results.
- [ ] Unsaved selection context is labeled distinctly from disk source.
- [ ] Promote Ask to Change and recover its linkage after application restart.

Rook protocol v1 is experimental, has no durable event replay, Build, arbitrary MCP, or live pause. The UI labels it Ask-only and does not present Build as available. `LAPLACE_ROOK_BIN` may specify a trusted executable path; otherwise `rook` must be on the native process PATH.
