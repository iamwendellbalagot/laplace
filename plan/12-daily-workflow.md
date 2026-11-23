# 12 — Daily development and continuity

Status: Not started  
Depends on: [11](11-review-integration.md)  
Next: [13 — Context and history](13-context-history.md)

## Outcome

Make the complete loop comfortable for sustained work: small edits need little ceremony, runs are workspace-aware, revisions are incremental, and interruption is recoverable.

## Tasks

- [ ] Add localized inline patch previews, accept/reject, source-version checks, and promotion to Change without context loss.
- [ ] Let developers preview selected existing edits and continue them as a Change; preserve unrelated tracked/untracked/dirty work.
- [ ] Add split editors and validate optional Monaco Vim integration without breaking normal shortcuts.
- [ ] Add named Run configurations with start/stop/restart, process state, output, local URL, and workspace identity.
- [ ] Implement Run candidate without accidentally connecting to the primary server; handle port collisions and disclose shared services.
- [ ] Make stack traces and runtime failures navigable and attachable to contextual investigation.
- [ ] Show revisions since the last reviewed snapshot, not only the complete accumulated diff.
- [ ] Improve steering received/applied feedback and pause/cancel distinctions.
- [ ] Validate npm/pnpm/Yarn single-package and representative workspace layouts; document unsupported cases.
- [ ] Add robust artifact retention/export, orphan cleanup, missing-path, disk-full, and process/session recovery flows.
- [ ] Assess minimal Node debugging/DAP scope. Implement a proven slice or document the beta gap; do not claim full IDE parity without debugging.
- [ ] Tune focus, notifications, navigation history, and restored layouts to avoid repeated context entry.

## UI reference

Extend the existing Editor, review, and Rook compositions rather than adding unrelated dashboards. Run controls belong with bottom tools/process output. Contextual actions stay near selected source or failure evidence.

## Checks and exit gate

- [ ] Complete a multi-hour real project session with manual editing and a background Change.
- [ ] Test small patch escalation, manual Change import, candidate run, incremental revision, pause/manual edit, and forced restart.
- [ ] Existing terminals/processes never change workspace ownership when navigation changes.
- [ ] Unsaved edits and navigation state survive expected interruptions.
- [ ] Compare review effort and repeated context entry against the previous milestone.
- [ ] Validate performance targets under agent logs, checks, and multiple open files.
