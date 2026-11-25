# 12 — Daily development and continuity

Status: Implemented (direct-in-repo adaptation); manual multi-hour native smoke open
Depends on: [11](11-review-integration.md)
Next: [13 — Context and history](13-context-history.md)

## Outcome

Make the complete loop comfortable for sustained work: small edits need little ceremony, runs are workspace-aware, revisions are incremental, and interruption is recoverable.

## Tasks

- [x] Add localized inline patch previews, accept/reject, source-version checks, and promotion to Change without context loss (`InlinePatchOverlay.tsx`, `EditorContextInspector.tsx`, Rook fenced-code preview bridge).
- [x] Let developers preview selected existing edits and continue them as a Change; preserve unrelated tracked/untracked/dirty work (`GitPanel.tsx` checkboxes + **Continue as Change** → `ChangeReviewScreen` `initialSelectedPaths`).
- [x] Add split editors (`Cmd+\` / toolbar toggle) and Quick Open (`Cmd+P`, `QuickOpenDialog.tsx`, `list_project_files`). Optional Monaco Vim integration is explicitly deferred because `monaco-vim` targets older Monaco internals incompatible with `monaco-editor@0.57.0` / React 19; native shortcuts remain intact.
- [x] Add named Run configurations with start/stop/restart, process state, output, local URL, and workspace identity (`src-tauri/src/runs.rs`, `RunPanel.tsx`, `.laplace/recipes.toml` `[runs.*]` + `package.json` script discovery).
- [x] Adapted to direct-in-repo Run configurations (no hidden candidate worktrees per scope decision): pre-flight TCP port-collision detection (`port_in_use` with suggested open port), workspace ownership verification on stop, and explicit `shared_services` disclosure.
- [x] Make stack traces and runtime failures navigable and attachable to contextual investigation (`stack-trace.ts`, `LinkedStackOutput` in `RunPanel` and `VerifyScreen`, **Investigate in Rook** removable context chips).
- [x] Show revisions since the last reviewed snapshot, not only the complete accumulated diff (`0005_daily_workflow.sql` `review_snapshots`, `review.rs` checkpoints + `baseline: "last_review"`, `ChangeReviewScreen` **`vs HEAD` | `Since last review`** toggle).
- [x] Improve steering received/applied feedback and pause/cancel distinctions (`Cancelling…`, `Cancelled` turn badge, **Stop & steer** / **Queue** composer actions with `Steered · applied` feedback).
- [x] Validate npm/pnpm/Yarn single-package and representative workspace layouts; document unsupported cases (`detect_workspace_layout_at` + `runs_tests` covering npm/pnpm single, pnpm workspaces, npm/Yarn workspaces, and explicit Yarn PnP `.pnp.cjs` unsupported warning).
- [x] Add robust artifact retention/export, orphan cleanup, missing-path, disk-full, and process/session recovery flows (`workspace_state.rs` crash-safe `editor_drafts` + `workspace_layout_state`, execution auto-pruning & manual prune, Markdown bundle copy, Unix process-group kill + `RunEvent::Exit` cleanup, `disk_full` / `file_not_found` non-destructive save errors).
- [x] Assess minimal Node debugging/DAP scope: **Documented beta gap** — full DAP breakpoint stepping is deferred past beta rather than simulated; developers can run Node `--inspect` via `[runs.*]` configurations alongside navigable stack traces and Verify/Rook failure investigation.
- [x] Tune focus, notifications, navigation history (`Alt+Left` / `Alt+Right` + topbar `‹`/`›`), persistent mounted `EditorScreen` / `WorkspaceTools`, and restored layouts (`workspace_layout_state`) to avoid repeated context entry.

## UI reference

Extend the existing Editor, review, and Rook compositions rather than adding unrelated dashboards. Run controls live in the bottom `WorkspaceTools` drawer (`Terminal | Run | Git changes`). Contextual actions live in `EditorContextInspector`, `GitPanel`, `RunPanel`, `VerifyScreen`, and Rook's composer.

## Checks and exit gate

- [ ] Complete a multi-hour real project session with manual editing and a background Change.
- [ ] Manual macOS desktop smoke in `pnpm tauri dev`: small patch escalation, manual Change import, Run port-collision/URL, incremental revision, stop & steer, and forced restart draft recovery.
- [x] Existing terminals/processes keep workspace ownership when navigation changes (persistent mounted `EditorScreen`/`WorkspaceTools` + Rust workspace-ID checks in `stop_terminal` and `stop_run_config`).
- [x] Automated unit/integration checks verified: Rust `fmt`/`clippy` (0 warnings), `runs_tests` (4 passed), `workspace_state_tests` (3 passed), `review_tests` (4 passed); frontend `vitest` (29 passed across `stack-trace.test.ts`, `workspace-sync.test.ts`, `app-service.test.ts`, `contracts.test.ts`), `tsc --noEmit`, `vite build`, Prettier, `git diff --check`.
- [ ] Compare review effort and repeated context entry against the previous milestone in live use.
- [ ] Validate performance targets under agent logs, checks, and multiple open files.
