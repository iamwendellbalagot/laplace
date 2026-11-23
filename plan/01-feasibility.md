# 01 — Feasibility and contracts

Status: In progress — Rook source reviewed; CLI execution and platform feasibility experiments remain blocked  
Prerequisites: [architecture](architecture.md), [UI reference](ui-reference.md)  
Next: [02 — Bootstrap](02-bootstrap.md)

## Outcome

Prove the editor/process stack and Rook boundary before depending on unsupported capabilities. This step may use isolated, disposable prototypes; later implementation must not accidentally ship them as production features.

## Tasks

- [ ] Locate the actual Rook repository/executable with the developer; record version, license, runtime, installation, and ownership.
- [ ] Produce a capability matrix: sessions, event stream, tool activity, permissions, Plan/Build, pause/cancel, reconnect, skills, MCP, and source/workspace association.
- [ ] Exercise the real harness; distinguish supported behavior from proposed harness changes.
- [ ] Compare ACP capabilities with requirements and decide transport/extension strategy.
- [ ] Prototype Tauri-hosted Monaco and xterm.js on macOS, Windows, and Linux.
- [ ] Verify workers/CSP, typing, IME, selection, clipboard, keyboard shortcuts, resize, display scaling, and terminal cleanup.
- [ ] Test maintained Monaco/LSP bridge candidates with TypeScript diagnostics, completion, and definition navigation.
- [ ] Exercise Git worktree creation and Node setup in a representative repository.
- [ ] Define application-owned versus project-owned Node runtime resolution and distribution.
- [ ] Define supported Linux environments, installed Git prerequisites, and native test approach per OS.
- [ ] Document execution threat model and sandbox support/limitations on each OS.
- [ ] Prototype source manifests and guarded squash-integration feasibility, including partial failures.
- [ ] Establish editor/process responsiveness baselines and record consequential decisions.

## UI reference

Use the mockup's Editor, Review, and Rook compositions to ensure feasibility work tests the intended multi-panel workload, not only an empty webview. Native controls must be tested rather than copying decorative traffic lights.

## Checks and exit gate

- [ ] Preserve reproducible steps and actual results for each supported OS.
- [ ] Record chosen LSP bridge, typed IPC strategy, and runtime packaging approach.
- [ ] Demonstrate a real Rook session or identify the exact external blocker.
- [ ] Document any unavailable pause/read-only capability and its safe fallback; do not implement pretend safety.
- [ ] Decide Tauri viability before substantial shell-specific investment; evaluate Electron only if evidence warrants it.

A mock harness does not complete Rook validation. If Rook access is blocked, platform/scaffold/UI work may proceed only with that limitation explicitly recorded; real delegation milestones remain blocked.

## Rook source review

User identified `/Users/wendellbalagot/Documents/Projects/rook` as the Rook codebase. Read-only inspection of its `package.json`, `README.md`, `docs/PI_PARITY.md`, and gateway/policy sources found:

| Capability | Source evidence | Feasibility finding |
| --- | --- | --- |
| Package/runtime | `package.json`: `rook-agent@0.1.5`, `bin/rook.mjs`, Node `>=22.19.0`; README requires npm | Runtime requirement is compatible with the observed Node 26.x shell, but a runnable CLI check is still needed. |
| License | `package.json` has no `license` field; root listing has no `LICENSE` file | Unresolved; ask the Rook maintainer for the applicable license before integration/distribution. |
| Session lifecycle | `AgentGateway` exposes list/current/new/resume/fork/compact; Pi gateway uses `AgentSessionRuntime` and `SessionManager`; PI parity doc says persistence is implemented | Supported in the implementation; not exercised from Laplace. |
| Event stream/tool activity | `event-adapter.ts` maps Pi message deltas/completion, tool start/end, usage, and settlement to typed Rook events | Implemented adapter event stream; no standalone external protocol was established. |
| Permission modes | `agent-gateway.ts` defines `plan`/`build`; `pi-agent-gateway.ts` selects read-only Plan tools versus Build tools; execution policy installs a `ToolPolicy` | Plan/Build and policy-mediated tool access are implemented. |
| Pause/cancel | Gateway exposes `cancel()` but no pause API; settled events indicate aborted runs | Cancellation is exposed; pause is not exposed in the gateway examined. Session resume is not equivalent to pausing a live run. |
| Reconnect/recovery | Gateway exposes `resumeSession(path)`; PI parity describes persistent sessions | Session resume is implemented; live transport reconnection behavior remains unverified. |
| Skills/MCP | Gateway exposes skills and prompt templates; README/PI parity describe Rook-scoped skills and Pi MCP/codemode/tool-search with policy checks | Implemented through Pi integrations; exact capability behavior still needs a real-session exercise. |
| Workspace association | Gateway is created with a `cwd`; `ToolPolicy` is constructed for that workspace; README documents repository-bound tools | Workspace association is explicit in the local runtime; no external workspace-association protocol found. |
| ACP | Inspected gateway directly wraps `@earendil-works/pi-coding-agent`; no ACP adapter is exposed in the gateway or the inspected docs | No ACP support found. Keep ACP transport decision open; do not assume protocol compatibility. |
| Shell sandbox | `src/policy/sandbox.ts` selects Seatbelt on macOS and Bubblewrap on Linux; other OSes have no runtime candidate; source defaults to fail-closed | Code declares macOS/Linux sandbox backends; this is not proof of live enforcement on each OS. |

A CLI smoke was attempted with `node /Users/wendellbalagot/Documents/Projects/rook/bin/rook.mjs --version` from the Laplace shell. It failed with `MODULE_NOT_FOUND` for that absolute path (sandbox cannot resolve the sibling project), so no CLI version/smoke result is claimed. Rook's own `docs/PI_PARITY.md` records pinned Pi SDK `1.5.2` and a previously verified provider smoke, but that is project documentation, not a test run in this feasibility pass.

## Initial environment inventory

Observed in the current build sandbox:

- Host: macOS Darwin 24.6.0, ARM64.
- `node` and `git` are available on `PATH`; `rook`, `pi`, `pnpm`, `cargo`, `rustc`, and `tauri` are not. The Rook source repository is available at the user-provided sibling path, but its executable is not available within the Laplace shell sandbox.
- The shell used Node.js 26.10.0 during the failed CLI invocation. This meets Rook's declared `>=22.19.0` engine requirement, but does not validate the packaged installation.
- The Laplace repository still has only `LICENSE` tracked and no application scaffold. No Windows or Linux runtime was available in this check.
- No native editor, terminal, LSP, Git-worktree/integration, or responsiveness experiments have been run.

This is source-review evidence, not completion of the feasibility gate. Do not infer runtime/platform viability from source declarations alone.

## Handoff notes

Record decisions, prototype locations, platform evidence, unresolved capabilities, and prerequisites for step 02. No calendar estimate should assume unknown harness work is already complete. Next: run the credential-free Rook CLI smoke from its own workspace (or another authorized execution context), confirm licensing with the Rook maintainer, and obtain Windows/Linux test access before conducting the required native prototypes and experiments.
