# 11 — Editable review and guarded integration

Status: Not started  
Depends on: [10](10-verification-evidence.md)  
Next: [12 — Daily workflow](12-daily-workflow.md)

## Outcome

Review the actual candidate, revise it directly, inspect evidence, and integrate only a known approved state without overwriting unrelated work. This completes the first differentiated product milestone.

## Tasks

- [ ] Implement Change review with real file list/diffs, objective, criteria, risks/unknowns, and source-linked summary.
- [ ] Use Monaco diff with candidate editing or direct open-in-editor and preserved review position.
- [ ] Add file/line comments, revision requests, and links back to Rook with precise source context.
- [ ] Bind approvals to candidate snapshot and invalidate them on edits; make stale checks visible beside decisions.
- [ ] Define check requirements and explicit override reasons; never silently imply unrun checks passed.
- [ ] Start with one documented squash strategy into a clean checked-out destination.
- [ ] Record destination baseline, approved candidate, and exact proposed integrated tree.
- [ ] Prepare/review integration result separately; reverify and reapprove when the proposed tree differs from the reviewed/tested state.
- [ ] Coordinate app editing and Git operations; recheck destination branch/index/worktree before applying.
- [ ] Stop on changed target, conflicts, active mutation, or failed preconditions. Provide resolution/retry, not destructive reset.
- [ ] Persist integration intent/progress/outcome and Git commit identity for partial-failure recovery.
- [ ] Handle hooks/signing/identity/credential requirements explicitly; do not silently bypass them.
- [ ] Preserve dirty/unintegrated worktrees and offer explicit cleanup only when safe.

## UI reference

Use preview-review.png and its Change header, file selector, diff, criteria/check inspector, revision/approve/prepare-integration controls. Critical actions remain reachable when the inspector collapses. The production integration flow is intentionally stricter than the mock's local boolean toggle.

## Checks and exit gate

- [ ] Complete investigation → isolated implementation → checks → developer revision → recheck → approved integration in a real fixture repository.
- [ ] Candidate edits invalidate approval; approval of an older source cannot authorize a newer candidate.
- [ ] Test dirty target, advancing branch, conflicted result, failing hook, external filesystem change, and application interruption mid-integration.
- [ ] No failure path discards user edits, claims a missing commit succeeded, or silently integrates a different tree.
- [ ] Recover an interrupted attempt using durable records and actual Git state.
- [ ] Confirm produced commit/tree and evidence references independently with Git.

Record the end-to-end demonstration, remaining platform gaps, and known unsupported repository cases before adding broader features.
