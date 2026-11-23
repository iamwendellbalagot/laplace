# Laplace — Implementation Roadmap

Status: Plans 06–10 foundational slices implemented; plan-specific acceptance gates remain open as recorded in each step
Targets: macOS, Windows, Linux; TypeScript/Node.js repositories first
Agent harness: Rook, architecturally independent
UI reference: `laplace-html-mockup/` in the Laplace repository

## Plan organization

This file, `plan/plan.md`, is the authoritative roadmap. Shared references define architecture and UI rules; numbered documents break implementation into sequential checkpoints. Plan 04 began under the user's explicit instruction to continue through the roadmap while Plan 03's visual/native acceptance checks remain open; those gaps remain documented and are not treated as passing.

The former root `plan.md` is preserved unchanged in [archive/original-plan.md](archive/original-plan.md) for historical reference, not as a second active plan. The [HTML UI mockup](../laplace-html-mockup/README.md) remains unchanged. Plan 02's scaffold-only gate passed on macOS; Plan 03's shell implementation is underway, with native visual/accessibility acceptance outstanding.

## Product contract

> Code when you want. Delegate when you need. Understand and verify every meaningful change.

Deliver one continuous workflow: understand → edit/delegate → run → verify → review → integrate. Changes preserve intent, implementation, execution evidence, and decisions without becoming mandatory forms for small tasks.

Prioritize reliable source editing, continuity of workspace context, explicit agent handoff, source-bound evidence, and safe integration over a broad collection of screens.

## Shared references — read before every step

- [Architecture, stack, and invariants](architecture.md).
- [UI reference and production translation](ui-reference.md).

The mockup governs visual direction and interaction composition. Actual state, accessibility, platform behavior, and safety requirements override illustrative mock behavior. Never label fabricated activity or test results as real.

## Sequential implementation steps

Each numbered document is an implementation checkpoint, not one giant commit. Break its checklist into small verified changes. Complete its exit gate before proceeding, or record the exact unmet dependency and obtain an explicit scope decision.

| Order | Document | Deliverable | Status |
| --- | --- | --- | --- |
| 01 | [Feasibility and contracts](01-feasibility.md) | Platform proofs, Rook capability matrix, decisions | In progress — Rook package verified; platform gates pending |
| 02 | [Bootstrap and typed boundaries](02-bootstrap.md) | Runnable desktop scaffold and native CI | Complete for scaffold-only exception — macOS native smoke passed; cross-platform validation remains under 01 |
| 03 | [Reference UI shell](03-ui-shell.md) | Faithful React shell, themes, commands | Implementation in place; visual/native accessibility exit checks open |
| 04 | [Projects and filesystem](04-projects-filesystem.md) | Real project opening, explorer, trust, watchers | In progress — safe folder open/recent list, bounded explorer and read-only file preview; native smoke and remaining filesystem work pending |
| 05 | [Editor and TypeScript](05-editor-typescript.md) | Real editing, recovery, language services | In progress — Monaco editing and safe saves implemented; LSP/recovery/native checks remain |
| 06 | [Terminal and Git](06-terminal-git.md) | Real shells, processes, status, diffs | Initial implementation; native and cross-platform acceptance open |
| 07 | [Persistent Changes](07-changes-persistence.md) | Durable domain, Change register, recovery | SQLite Change foundation; recovery/domain expansion open |
| 08 | [Rook and contextual delegation](08-rook-delegation.md) | Read-only Ask, permissions, session lifecycle | Experimental Rook Ask; provider-backed and context workflow open |
| 09 | [Isolated implementation](09-worktrees-environments.md) | Worktrees, setup recipes, authorized Build | Candidate worktrees and trusted recipes; Build blocked on Rook support |
| 10 | [Verification and evidence](10-verification-evidence.md) | Recorded checks and source freshness | Structured source-bound checks; artifact/workflow acceptance open |
| 11 | [Review and integration](11-review-integration.md) | Editable review, approval, guarded integration | Not started |
| 12 | [Daily workflow](12-daily-workflow.md) | Inline patches, runs, manual Changes, robustness | Not started |
| 13 | [Context and history](13-context-history.md) | Context Lens, grounded System explorer | Not started |
| 14 | [Behavior comparison](14-behavior-comparison.md) | Narrow, reproducible baseline/candidate comparisons | Not started |
| 15 | [Skills and MCP](15-skills-mcp.md) | Capability configuration, permissions, provenance | Not started |
| 16 | [Cross-platform beta](16-release-hardening.md) | Qualified, packaged, signed desktop beta | Not started |

## Milestones

1. **Feasible foundation:** steps 01–03. Native editor/process proof and approved visual foundation.
2. **Usable local workspace:** steps 04–06. Open → edit → save → run → inspect Git.
3. **Differentiated first product:** steps 07–11. Real Rook task → isolated candidate → verification → review → integrated commit.
4. **Daily usability:** step 12. Sustain real development without context loss or wrong-workspace actions.
5. **Intelligence and extensions:** steps 13–15. Expand only after the core engineering loop works.
6. **Public beta qualification:** step 16. Packaging and native testing begin earlier, not at release time.

Do not interpret later hardening work as permission to skip recovery, safety, accessibility, or native testing in earlier steps. Steps 13–15 may be explicitly deferred for an earlier beta if scope is recorded rather than represented as complete.

## Working on one document at a time

1. Read this index, the shared references, the selected step, and any repository instructions.
2. Verify prerequisites against the actual repository, not only checklist marks.
3. Identify a small user-visible slice, its failure behavior, and verification commands.
4. Implement only that slice; do not scaffold speculative later systems.
5. Run relevant checks and native smoke tests; record actual outcomes and limitations.
6. Compare affected screens against the HTML reference using deterministic fixtures.
7. Update checkboxes and handoff notes only after verification.
8. Stop at the checkpoint and summarize evidence, unresolved issues, and the next step.

## Definition of done for every step

- Acceptance criteria pass; missing capabilities are explicit, not simulated.
- Success, error, cancellation, and recovery behavior are covered where relevant.
- Persistent rules live in the backend, not UI toggles.
- Keyboard/focus behavior, light/dark themes, and relevant platform checks pass.
- Tests cover changed contracts and source/evidence/approval invariants.
- Unfamiliar user files and uncommitted work remain intact.
- Handoff notes identify what was tested, on which platforms, and what remains untested.

## Scope exclusions

Mobile/PWA, PLYTH, remote execution services, multi-agent orchestration, live collaboration, extension marketplace, VS Code extension compatibility, custom editor engines, and universal architecture inference are deferred.

## Success measures

Evaluate bug fixes, API additions, behavior-preserving refactors, pause/manual-edit handoffs, restart recovery, destination-branch advancement, and converting existing edits into Changes. Measure review effort, repeated context entry, lost navigation state, incorrect-workspace actions, missed verification gaps, and responsiveness—not generated lines or agent invocation counts.
