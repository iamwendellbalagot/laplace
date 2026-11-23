# Architecture, stack, and shared invariants

Read with [the roadmap](plan.md) and [UI reference](ui-reference.md). This is the shared specification; numbered files are implementation checkpoints.

## Technology stack

| Layer | Selection | Ownership / caveat |
| --- | --- | --- |
| Desktop | Tauri 2 | Native menus, windows, lifecycle, installers, updater |
| Frontend | React, strict TypeScript, Vite | Presentation; no production Node runtime needed for UI |
| Backend | Rust, Tokio | Application services, OS operations, supervision |
| Toolchains | pnpm, Cargo | Pin versions and commit lockfiles |
| Editor | Monaco | Buffers, diff UI, workers; not VS Code extension support |
| UI | Radix UI, Tailwind CSS, CSS custom properties | Accessible primitives and mockup-derived semantic tokens |
| Typography | IBM Plex Sans, JetBrains Mono; reference serif stack | Bundle licensed primary fonts; retain editorial serif treatments |
| UI state | Zustand | Transient state only; no competing durable database |
| Terminal | xterm.js, portable-pty | Workspace-bound shells and process cleanup |
| Git | System Git CLI | Machine-readable output; credential and cancellation support |
| Persistence | SQLite through SQLx | Versioned transactional migrations |
| Artifacts | App-managed files referenced by SQLite | Bounded logs, quotas, retention, digests |
| TypeScript intelligence | LSP, typescript-language-server, TypeScript | Select maintained Monaco bridge during feasibility |
| Syntax indexing | Tree-sitter, later | Only where LSP does not meet demonstrated needs |
| Watchers | Rust notify | Debouncing, ignore policy, rescan fallback |
| Agent | Independent Rook process | Confirm actual protocol, runtimes, licensing, packaging |
| Agent transport | Typed adapter; ACP where supported | Capability negotiation; explicit extensions |
| Tests | Vitest, React Testing Library, Rust tests | Real Git/SQLite fixtures and controlled fake harness |
| UI automation | Playwright web harness | Does not substitute for native webview/IPC testing |
| CI/release | GitHub Actions, Tauri tooling | macOS/Windows/Linux builds and qualification |

## Architecture and repository shape

```text
React features -> typed service interfaces -> Tauri IPC
                                                |
Rust domain/application services -> filesystem, SQLite, Git, PTY, LSP
                                                |
                                           Rook adapter
                                                |
                                      independent Rook process
```

Start with one frontend package and one Rust application crate:

```text
src/app/                      shell, navigation, command registry
src/components/               reusable accessible UI
src/features/                 editor, explorer, terminal, git, changes,
                              review, run, context, capabilities, settings
src/services/                 typed interfaces and Tauri implementation
src/state/                    transient workspace/layout state
src/styles/                   semantic themes and typography
src-tauri/src/commands/       thin IPC endpoints
src-tauri/src/domain/         IDs, state transitions, invariants
src-tauri/src/services/       application workflows
src-tauri/src/infrastructure/ SQLite, Git, filesystem, PTY, LSP, Rook
src-tauri/migrations/
src-tauri/tests/
tests/fixtures/
tests/ui/
docs/architecture/
docs/development/
plan/                         intended home of this plan package
laplace-html-mockup/          preserved design reference, not production code
```

Do not introduce a monorepo, generic plugin framework, remote API, or multiple crates without a concrete need.

## Data ownership and contracts

- Rust owns persistent state, filesystem writes, process supervision, and Git workflows.
- Monaco owns unsaved text; saves and patches require source-version checks.
- React owns selections, tabs, panels, and other transient UI state.
- Rook owns agent sessions/execution; Laplace persists linked engineering records.
- IPC uses generated or automatically checked Rust/TypeScript contracts, typed errors, operation IDs, and schema versions.
- Events include workspace/Change IDs, sequence, and timestamp. Recover from a state snapshot plus resumable events.
- Use idempotency where retrying a mutation could repeat an effect. Duplicate/reordered events must not duplicate executions.
- Bound logs, queues, and progress updates; move blocking work off UI-critical paths.

## Domain model

Project; Workspace; Change; AgentSessionLink; SourceSnapshot; Execution; Artifact; EvidenceLink; ReviewDecision; IntegrationAttempt; ProjectRecipe.

Separate lifecycle dimensions:
- Change: Draft → Active → In review → Approved → Integrated; Abandoned before integration.
- Agent: Idle, Running, Waiting for permission, Pausing, Paused, Failed, Interrupted.
- Verification: Not run, Running, Passed, Failed, Inconclusive, Stale.

Evidence and approval bind to a source snapshot, not only HEAD. Source changes invalidate approval and make earlier evidence stale. A failed harness connection is not a failed engineering Change.

## Trust and execution

- Repository content, project recipes, skills, MCP output, and agent suggestions are untrusted.
- Opening a repository does not execute setup commands or project tooling before trust/authorization.
- Plan mode requires tool-level enforcement, not just a prompt or hidden button.
- Build authorization is scoped; external side effects still require applicable permission.
- Rook and Laplace policies must not bypass one another; effective authorization is their intersection.
- Worktrees separate files, not security. Tauri capabilities restrict app IPC, not arbitrary subprocesses.
- Explicitly report unsupported sandbox policies; do not silently weaken isolation.
- Canonicalize paths, guard workspace boundaries, and test symlinks, Unicode, case sensitivity, Windows paths, and unusual filenames.
- Prefer executable/argument arrays; use intentional shell syntax only for visible terminal/recipe semantics.
- Application credentials go in the OS credential store; respect Rook credential ownership.
- Do not capture raw secret environments. Redact stored output where practical; document limitations.

## Source, integration, and recovery invariants

- Snapshots include relevant tracked/untracked content, configuration, and lockfiles; exclude ignored caches and secrets by explicit policy.
- Unsaved buffers are not tested on disk. Offer Save and Run or identify the saved source being tested.
- Detect mutations during checks; use Inconclusive when the tested state cannot be established.
- Review the exact proposed integration tree against a known target state; recheck when either changes.
- Expected-state checks alone do not atomically protect index and working-tree writes. Define operation locking, editor coordination, preconditions, and recovery together.
- Never reset/discard user work to complete integration or cleanup.
- Reconcile sessions/processes/worktrees on restart; do not silently replay commands.
- Large logs/artifacts live outside UI state with retention and cleanup policies.

## Performance and validation

Provisional targets on declared hardware/fixtures: p95 typing-to-paint below 50 ms during background activity, warm ordinary-file opening below 150 ms, bounded output memory, lazy/virtualized large views. Establish startup/idle-memory/large-repository baselines before promising thresholds.

Run native CI from the start: macOS Apple Silicon/Intel verification, Windows x64, and declared Linux distributions/WebKitGTK environments. Native editor input, terminal, clipboard, filesystem, and process tests cannot be replaced by browser UI tests.
