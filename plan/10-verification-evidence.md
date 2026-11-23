# 10 — Verification and source-bound evidence

Status: Structured execution/source-manifest foundation implemented; artifact ledger UI, recipes, cancellation integration and native acceptance remain open
Depends on: [09](09-worktrees-environments.md)  
Next: [11 — Review and integration](11-review-integration.md)

## Outcome

Recorded checks demonstrate what actually executed against a known source state. Agent claims and terminal transcripts are not substitutes for execution records.

## Tasks

- [x] Capture content-addressed manifests of Git-listed tracked and nonignored untracked files with per-file digests.
- [x] Omit Git-ignored files, symlinks, common secret/key filenames, and cap manifests at 5,000 files / 256 MiB. Broader secret-content detection and configurable policy remain open.
- [ ] Require Save and Run or explicitly identify checks against saved disk source when buffers are dirty.
- [x] Detect source mutation during execution and mark results inconclusive.
- [x] Run explicitly entered executable/argument arrays through a structured runner; record command, cwd, times, exit, source digest, and per-file manifest. Approved recipe definitions remain open.
- [x] Record Passed, Failed, Cancelled, Timed out, Start failed, Interrupted (startup migration), and Inconclusive distinctly. Aggregated verification remains unimplemented.
- [x] Persist bounded output (1 MiB) and manifests transactionally in SQLite. Separate artifact files and quotas/retention remain open.
- [x] Mark recorded Passed/Failed evidence Stale when current source digest changes, using the complete manifest.
- [ ] Link acceptance criteria to supporting checks/manual review while preserving Not verified.
- [x] Build basic Verify ledger, execution details/output, and rerun controls. Filters and artifact navigation remain open.
- [ ] Build concise check summaries in Change review and bottom drawer from the same records.
- [ ] Correlate harness-triggered verification where protocol permits; mark imported agent assertions unverified unless independently recorded.

## UI reference

Use preview-verify.png and Review verification inspector. Preserve source identity, ledger, compact status vocabulary, and detailed record panel. Never display a whole Change as universally verified simply because a subset of checks passed.

## Checks and exit gate

- [x] Unit fixtures verify successful command, exit status, output, source manifest, source-changing Inconclusive, timeout, and bounded output.
- [x] Editing source causes evidence to be marked stale on next ledger load; dirty buffers are not presented as tested.
- [x] Failed, missing-tool, timeout, and source-changing checks produce distinct results. Cancellation plumbing exists; disk-full and desktop restart cases remain unverified.
- [ ] Test runner output floods remain bounded and do not freeze Monaco.
- [ ] Restart recovers interrupted status without rerunning the command automatically.
- [ ] Acceptance-criterion evidence links navigate to actual executions/artifacts.
