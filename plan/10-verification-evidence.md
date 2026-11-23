# 10 — Verification and source-bound evidence

Status: Not started  
Depends on: [09](09-worktrees-environments.md)  
Next: [11 — Review and integration](11-review-integration.md)

## Outcome

Recorded checks demonstrate what actually executed against a known source state. Agent claims and terminal transcripts are not substitutes for execution records.

## Tasks

- [ ] Capture content-addressed source manifests including relevant tracked/untracked files, lockfiles/configuration, and runtime descriptors.
- [ ] Define visible include/exclude rules; omit secrets and ignored caches rather than indiscriminately serializing the environment.
- [ ] Require Save and Run or explicitly identify checks against saved disk source when buffers are dirty.
- [ ] Detect source mutation during execution; mark inconclusive if tested source identity is unreliable.
- [ ] Run approved recipes through a structured runner that records executable/args or explicit shell recipe, cwd, origin, start/end, exit, source ID, and artifacts.
- [ ] Record Failed, Cancelled, Timed out, Start failed, and Interrupted distinctly at execution level; aggregate verification honestly.
- [ ] Persist logs/artifacts with digests, bounded streaming, quotas, retention, and missing-artifact handling.
- [ ] Mark evidence Stale on relevant source changes; start conservatively rather than guessing dependency coverage.
- [ ] Link acceptance criteria to supporting checks/manual review while preserving Not verified.
- [ ] Build Verify ledger, filters, execution details, output/artifact navigation, and rerun controls.
- [ ] Build concise check summaries in Change review and bottom drawer from the same records.
- [ ] Correlate harness-triggered verification where protocol permits; mark imported agent assertions unverified unless independently recorded.

## UI reference

Use preview-verify.png and Review verification inspector. Preserve source identity, ledger, compact status vocabulary, and detailed record panel. Never display a whole Change as universally verified simply because a subset of checks passed.

## Checks and exit gate

- [ ] A real successful check has command, exit status, output, and source manifest.
- [ ] Editing source makes earlier evidence stale; dirty buffers never masquerade as tested source.
- [ ] Failed, cancelled, missing-tool, timeout, disk-full, and source-changing checks produce truthful records.
- [ ] Test runner output floods remain bounded and do not freeze Monaco.
- [ ] Restart recovers interrupted status without rerunning the command automatically.
- [ ] Acceptance-criterion evidence links navigate to actual executions/artifacts.
