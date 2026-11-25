# 11 — Editable review and guarded integration

Status: Core editable review and guarded direct-in-repo integration implemented (migration 0004, `src-tauri/src/review.rs`, editable Monaco `DiffEditor`, persistent comments, snapshot-bound approvals, two-step guarded `git commit --only`, and crash reconciliation); manual macOS end-to-end smoke remains open
Depends on: [10](10-verification-evidence.md)  
Next: [12 — Daily workflow](12-daily-workflow.md)

## Outcome

Review the actual candidate, revise it directly, inspect evidence, and integrate only a known approved state without overwriting unrelated work. This completes the first differentiated product milestone.

## Tasks

- [x] Implement Change review with real file list/diffs, objective, verification freshness, and source-linked summary (adapted for direct-in-repo editing).
- [x] Use Monaco DiffEditor with inline working-tree editing, save, and direct open-in-editor.
- [x] Add durable file/line comments, revision requests, and handoff back to Rook with precise file/line context.
- [x] Bind approvals to source snapshot (`source_digest` + `HEAD`) and invalidate them automatically on edits; make stale checks visible beside decisions.
- [x] Define check requirements and explicit override reasons; never silently imply unrun checks passed.
- [x] Implement guarded direct-in-repo integration (`git commit --only -- <selected_paths>`) into the checked-out branch while preserving unselected edits.
- [x] Record base HEAD, approved source digest, and exact selected file paths in SQLite (`integration_attempts`).
- [x] Prepare and confirm integration separately; reverify live `HEAD` and `source_digest` before committing.
- [x] Coordinate app editing and Git operations; block approval/integration while Rook Build is active or Monaco tabs have unsaved edits.
- [x] Stop on changed target (`destination_branch_advanced`), active merge/rebase (`git_operation_in_progress`), active mutation, or failed hooks without destructive reset.
- [x] Persist integration intent/progress/outcome and Git commit SHA for partial-failure recovery (`committing` reconciliation against real Git state).
- [x] Handle hooks/signing/identity/credential requirements explicitly; never bypass with `--no-verify`.
- [x] Preserve unselected/unintegrated edits safely (no worktree cleanup needed under direct-in-repo workflow).

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
