# 09 — Worktrees and reproducible environments

Status: Authorized Rook Build implemented directly in the active repository per explicit user decision (no mandatory candidate worktree creation); optional worktree creation and bounded recipes remain in place, while live provider-backed Build smoke and durable cleanup reconciliation remain open
Depends on: [08](08-rook-delegation.md)  
Next: [10 — Verification](10-verification-evidence.md)

## Outcome

Authorized Build operates in an identifiable isolated Git workspace while the developer retains the primary workspace. Setup is repeatable and inspectable, not hidden agent improvisation.

## Tasks

- [x] Allocate app-owned worktree directories/branches in the Laplace app-data directory, separated by project hash and Change ID; do not copy the primary working tree. Durable ownership metadata and startup reconciliation remain open.
- [x] Record HEAD base revision and create clean candidate worktrees using Git CLI.
- [ ] Show workspace readiness/preparing/failed states and preserve unrelated user worktrees.
- [x] Add versioned named setup/check/run recipe schema in `.laplace/recipes.toml`, explicit argv, bounded cwd and timeout, gated by saved workspace trust. Recipe authoring/approval UI remains open.
- [ ] Resolve package manager/runtime from supported project configuration; detect missing tools with useful guidance. Recipes specify exact executable/argv and missing executables produce explicit failures; discovery remains open.
- [ ] Do not copy node_modules blindly; define dependency setup behavior and dependency-lockfile handling.
- [ ] Reference secrets securely; do not copy sensitive ignored files into history or all worktrees automatically.
- [ ] Document external database/service sharing and filesystem-versus-security isolation.
- [x] Launch Rook Build with explicit authorized scope and effective execution policy (process-pinned `--mode build` in `../rook`, trust-gated in Rust, running directly in the active repository per user decision, surfacing OS sandbox status and blocking conflicting Monaco saves during active Build runs).
- [ ] Enforce handoff: block new agent writes, settle active mutations, then permit manual editing.
- [ ] Associate tabs, terminals, language servers, processes, and agent events with their workspace.
- [ ] Add safe cleanup eligibility; dirty/unintegrated work requires explicit preservation/discard decisions.
- [ ] Handle or reject submodules, Git LFS, nested repos, and unsupported layouts explicitly.

## UI reference

Use top branch, status workspace indicator, Change register workspace column, and Rook permission inspector. Opening a Change restores its own context; background preparation must not steal focus or retarget existing terminals.

## Checks and exit gate

- [ ] Complete a real agent-driven isolated implementation while the primary checkout is untouched; Rook protocol v1 cannot Build.
- [x] A dirty primary workspace does not prevent clean-base candidate creation; its uncommitted edits are not included (temporary Git fixture).
- [ ] Setup failure/denial/cancellation is recoverable and accurately displayed.
- [ ] Pause-and-edit prevents silent colliding writes; test an in-flight mutation.
- [ ] Crash/restart reconciles orphaned preparation/worktrees without deleting user data.
- [ ] Explicitly document enforced sandbox capabilities and unsupported isolation policies per OS.
