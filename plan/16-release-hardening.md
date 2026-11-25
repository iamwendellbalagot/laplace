# 16 — Cross-platform release qualification

Status: Partially complete (code, tests, docs, CI template done; signing, cross-OS runs, clean-machine and benchmark gates open — see docs/release-qualification.md)
Depends on: [15](15-skills-mcp.md), or explicitly documented reduced-beta scope after step 12  
Next: beta feedback and scoped follow-up roadmap

## Outcome

A packaged, recoverable desktop beta with honest platform support and no critical editing, permission, source/evidence, or integration defects. Native checks and packaging should already have run during earlier steps.

## Tasks

- [ ] Define minimum supported macOS/Windows/Linux versions and dependencies from actual testing.
- [ ] Qualify macOS Apple Silicon/Intel, Windows x64, and declared Linux distributions; Windows ARM64 remains deferred until tested.
- [ ] Verify macOS signing/notarization, Windows signing/installers, and chosen Linux package formats.
- [ ] Configure signed updates, trusted update endpoints, version compatibility, and failed-update recovery policy.
- [ ] Validate database upgrade/backup/recovery behavior; do not promise downgrade compatibility without evidence.
- [ ] Review Rook/language-server/runtime bundling and updates, licensing, notices, and offline/missing-runtime behavior.
- [ ] Enable Tauri release bundling and include an exact, pinned published `rook-agent` npm release plus its locked runtime dependencies and a compatible Node runtime in each supported installer. Developer builds may use the dev-only local-checkout setting; release builds must not expose it.
- [ ] Launch only the Rook payload inside the Laplace app bundle in release builds. Ignore developer overrides, `LAPLACE_ROOK_BIN`, global Rook/Node on `PATH`, and network downloads; ship Rook updates through Laplace releases. Do not include developer `models.json`, provider credentials, or user auth data.
- [ ] Verify bundled Node and Rook's native `better-sqlite3` module are compatible for every OS/architecture, and include their licenses/notices in signing and packaging review.
- [ ] Test installed Laplace on clean supported systems without Node, npm, Rook, or a checkout: first-launch/offline protocol startup, then provider sign-in, model selection, and streamed Ask. Missing or incompatible bundle components must produce an actionable Laplace repair/reinstall error, not an instruction to install Rook separately.
- [ ] Audit trust, capability scopes, path handling, process cleanup, credential storage, and artifact redaction/retention.
- [ ] Audit themes, density, contrast, screen-reader semantics, keyboard-only operation, zoom, IME, and reduced motion.
- [ ] Benchmark startup, idle memory, large repositories/diffs, typing latency, and output floods on declared fixtures/hardware.
- [ ] Publish setup, troubleshooting, supported layouts, security limitations, recovery, and evidence semantics.
- [ ] Make telemetry opt-in if introduced; document outbound network behavior.

## Native release matrix

Test editor input/clipboard/IME, terminal resize/cancel/process trees, filesystem events, Git credentials, worktree setup, Rook local-checkout dev override, bundled-runtime startup, sign-in/model selection, reconnect/permissions, check recording, candidate review, guarded integration, restart, installer, and updater. Include relevant Linux X11/Wayland environments. Browser UI tests do not substitute for these checks.

## Product qualification scenarios

- [ ] Bug fix with regression test and source-linked evidence.
- [ ] API addition with a runnable candidate.
- [ ] Refactor with explicit preserved-behavior checks and unknowns.
- [ ] Pause agent, edit manually, rerun checks, resume review.
- [ ] Recover interrupted session/check/integration after restart.
- [ ] Handle advancing or dirty destination without losing work.
- [ ] Import existing edits into a manual Change.

## Release gate

- [ ] Every shipped feature has functional acceptance evidence, not only matching screenshots.
- [ ] Screens compare to the supplied mockup or have documented intentional deviations.
- [ ] No critical data loss, wrong-workspace execution, permission bypass, false evidence freshness, or unsafe integration issue remains open.
- [ ] Unsupported/deferred features are identified in UI and release notes.
- [ ] Beta feedback measures review effort, context continuity, defect discovery, recovery, and responsiveness.

Record tested OS/architecture/package versions, actual outcomes, known limitations, release artifact provenance, and the final scope decision.
