# 09 — Worktrees and reproducible environments

Status: Not started  
Depends on: [08](08-rook-delegation.md)  
Next: [10 — Verification](10-verification-evidence.md)

## Outcome

Authorized Build operates in an identifiable isolated Git workspace while the developer retains the primary workspace. Setup is repeatable and inspectable, not hidden agent improvisation.

## Tasks

- [ ] Allocate app-owned worktree directories/branches with durable ownership and reconciliation records.
- [ ] Record requested base revision and create clean candidate worktrees using Git CLI.
- [ ] Show workspace readiness/preparing/failed states and preserve unrelated user worktrees.
- [ ] Add approved setup/check/run recipe schema with version, command semantics, cwd, inputs, and permission requirements.
- [ ] Resolve package manager/runtime from supported project configuration; detect missing tools with useful guidance.
- [ ] Do not copy node_modules blindly; define dependency setup behavior and dependency-lockfile handling.
- [ ] Reference secrets securely; do not copy sensitive ignored files into history or all worktrees automatically.
- [ ] Document external database/service sharing and filesystem-versus-security isolation.
- [ ] Launch Rook Build with explicit authorized candidate scope and effective execution policy.
- [ ] Enforce handoff: block new agent writes, settle active mutations, then permit manual editing.
- [ ] Associate tabs, terminals, language servers, processes, and agent events with their workspace.
- [ ] Add safe cleanup eligibility; dirty/unintegrated work requires explicit preservation/discard decisions.
- [ ] Handle or reject submodules, Git LFS, nested repos, and unsupported layouts explicitly.

## UI reference

Use top branch, status workspace indicator, Change register workspace column, and Rook permission inspector. Opening a Change restores its own context; background preparation must not steal focus or retarget existing terminals.

## Checks and exit gate

- [ ] Complete a real isolated implementation while the primary checkout is untouched.
- [ ] A dirty primary workspace does not prevent read-only investigation or clean-base candidate creation; its uncommitted edits are not implicitly included.
- [ ] Setup failure/denial/cancellation is recoverable and accurately displayed.
- [ ] Pause-and-edit prevents silent colliding writes; test an in-flight mutation.
- [ ] Crash/restart reconciles orphaned preparation/worktrees without deleting user data.
- [ ] Explicitly document enforced sandbox capabilities and unsupported isolation policies per OS.
