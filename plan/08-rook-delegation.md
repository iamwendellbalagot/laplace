# 08 — Rook and contextual delegation

Status: Not started  
Depends on: [07](07-changes-persistence.md) and real Rook discovery from 01  
Next: [09 — Isolated implementation](09-worktrees-environments.md)

## Outcome

Use the real harness for contextual read-only investigation, visible permissions, and recoverable sessions. Do not enable repository-changing Build until step 09 provides its isolated execution boundary.

## Tasks

- [ ] Implement the selected versioned Rook transport/adapter and capability negotiation.
- [ ] Manage harness process/connection lifecycle separately from React rendering.
- [ ] Implement session creation, context attachment, streaming, cancellation, disconnect, reconnect, and correlated activity.
- [ ] Add Ask from selection, diagnostic, file, terminal excerpt, diff, or empty composer.
- [ ] Show removable context chips with source/workspace identity and refresh warnings when stale.
- [ ] Enforce genuinely read-only Plan tools/command policy through actual harness capabilities.
- [ ] Surface exact permission scope, workspace, command/tool, and requested authority with approve/deny behavior.
- [ ] Keep tool execution authority with Rook; do not duplicate or bypass permissions through Laplace.
- [ ] Promote Ask to persistent Change without losing attached context or investigation history.
- [ ] Record tool/skill/MCP provenance from available events now, even though management UI comes later.
- [ ] Implement steering acknowledgments and pause semantics where supported; otherwise expose limitations and use confirmed stop before editing.
- [ ] Build controlled fake harness fixtures for denial, duplicates, out-of-order events, dropped streams, and partial failure.

## UI reference

Use preview-agent.png and the Editor contextual Ask/Patch/Change controls. Keep Rook activity/session inspection available, but contextual requests should not require navigating away from source. Map demo statuses to real connection/execution state.

## Checks and exit gate

- [ ] Demonstrate real repository investigation with source-linked answers and no unauthorized writes.
- [ ] A permission denial actually prevents execution; a UI toggle alone is insufficient.
- [ ] Reconnect does not duplicate commands or invent completed results.
- [ ] Unsaved selection context is labeled distinctly from disk source.
- [ ] Promote Ask to Change and recover its linkage after application restart.

If enforced read-only behavior is unavailable, stop and document required Rook work rather than presenting Plan mode as safe.
