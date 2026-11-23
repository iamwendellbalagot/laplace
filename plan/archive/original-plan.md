# Laplace — Implementation Plan

Status: proposed implementation baseline  
Platforms: macOS, Windows, Linux  
Initial language ecosystem: TypeScript / Node.js  
Agent harness: Rook, independently maintained  
Repository baseline: LICENSE only; no application implementation exists yet

## 1. Product objective

Build a code-first desktop engineering workspace that connects understanding, editing, delegation, verification, review, and integration without forcing developers to reconstruct context between tools.

> Code when you want. Delegate when you need. Understand and verify every meaningful change.

Laplace owns the workspace and engineering record. Rook owns agent execution. A Change is a durable record of intent, implementation, evidence, and decisions, not a chat session.

### Product priorities

1. Reliable, responsive manual editing.
2. Contextual delegation without losing the developer's place.
3. Reviewable, isolated agent implementations.
4. Actual verification evidence tied to the tested source state.
5. Explicit, recoverable integration.
6. Project understanding grounded in navigable source relationships.

### Initial target user

An individual developer working in an existing local TypeScript/Node.js Git repository. Start with single-package projects, then validate npm, pnpm, and Yarn workspaces before claiming monorepo support.

### Deferred scope

- Mobile applications and PWAs.
- PLYTH integration.
- Cloud-hosted execution and remote-host connectivity.
- Multi-agent orchestration and real-time collaboration.
- Extension marketplace and VS Code extension compatibility.
- A custom editor engine.
- Universal architecture inference or proof of behavioral equivalence.
- Generalized autonomous integration without developer review.

## 2. Decisions and unresolved dependencies

### Adopted direction

- Tauri 2 desktop shell with a Rust application backend.
- React/TypeScript interface with Monaco for desktop editing.
- Local-first persistence and local process execution.
- System Git CLI for repository operations and worktrees.
- Rook behind a typed adapter, running independently of the UI.
- Persistent Changes and verification in the first end-to-end milestone.
- Keyboard-complete workflows, dark and light themes, accessible focus behavior.

### Discovery gates before deep implementation

1. Locate Rook's repository or executable and document its supported API, deployment requirements, licensing, and event model.
2. Verify Rook session reconnect, cancellation, permissions, skills, MCP, and read-only enforcement. Do not invent protocol support.
3. Evaluate ACP against actual required interactions; document any adapter extensions.
4. Validate Monaco, xterm.js, clipboard, IME input, keyboard shortcuts, and workers under all three Tauri webviews.
5. Validate Monaco-to-LSP integration and select a maintained compatible bridge.
6. Define the execution threat model and platform sandbox capabilities. Do not describe worktrees or Tauri capabilities as command sandboxes.
7. Define supported Linux distributions, display environments, and native dependencies.
8. Decide how application-owned Node tooling and Rook are distributed and updated.

If Tauri webview behavior blocks a dependable editing experience, evaluate Electron before building substantial desktop-specific UI infrastructure. Record evidence for the decision rather than maintaining two shells.

## 3. Technology stack

| Area | Selection | Implementation notes |
| --- | --- | --- |
| Desktop | Tauri 2 | Native menus, dialogs, windows, lifecycle, installers, updater |
| Backend | Rust, Tokio | Application services, async I/O, process supervision; blocking Git/hash work off the UI path |
| Frontend | React, TypeScript, Vite | Strict TypeScript; production UI does not require Node |
| Package management | pnpm, Cargo | Pin supported toolchain versions and commit lockfiles |
| Editing | Monaco Editor | File URI identities, model lifecycle, diff editor, worker configuration |
| UI primitives | Radix UI | Accessible menus, dialogs, tooltips, focus management |
| Styling | CSS custom properties, Tailwind CSS | Semantic tokens; avoid a collection of unrelated component styles |
| Fonts | IBM Plex Sans, JetBrains Mono | Bundle permitted font assets and license notices |
| Transient UI state | Zustand | Tabs, panels, selection, layout; backend remains authoritative for durable records |
| Terminal | xterm.js, portable-pty | Platform shells, resize, bounded output, process lifecycle |
| Git | Installed Git CLI | Argument arrays, machine-readable output, credential handling, worktrees |
| Persistence | SQLite, SQLx | Versioned migrations, transactional writes, application-managed DB |
| Artifacts | Application-managed files | Large logs and artifacts referenced by SQLite records |
| Language services | LSP, typescript-language-server, TypeScript | Project-aware intelligence; bridge selected during feasibility work |
| Syntax indexing | Tree-sitter, later | Add only for relationships not adequately supplied by language services |
| File watching | notify | Debouncing, ignore rules, event coalescing, full-rescan fallback |
| Agent harness | Rook | Providers, tools, sessions, skills, MCP; confirm actual supported deployment |
| Agent protocol | Typed adapter, ACP where practical | Versioned capabilities and explicit extensions |
| Frontend tests | Vitest, React Testing Library | Behavior and state transitions rather than implementation mirroring |
| Backend tests | Rust unit/integration tests | Temporary real repositories, processes, SQLite migrations |
| UI integration | Playwright against web test harness | Useful for shared UI; does not validate native webviews or IPC |
| Native validation | Platform-specific smoke harness/manual checks initially | Verify supported automation per OS before selecting one universal runner |
| CI/releases | GitHub Actions, Tauri tooling | Native OS matrix, signed release artifacts, update manifests |

## 4. Architecture

```text
React desktop interface
  Editor / contextual commands / Changes / Context Lens / terminal
                         |
               typed commands + events
                         |
Rust application services
  Workspace | Documents | Changes | Evidence | Review | Integration
                         |
  Filesystem | SQLite | Git CLI | PTY/processes | Language servers
                         |
                   Rook adapter
                         |
              independent Rook process
```

### Ownership rules

- Rust owns persistent state, filesystem mutations, process supervision, and Git operations.
- Monaco owns unsaved text buffers; backend writes require document-version checks.
- React owns presentation and transient interaction state.
- Rook owns its agent execution state; Laplace records correlated engineering events and observations.
- Laplace must not introduce a permission path that bypasses Rook policy, or vice versa. Effective authorization is the intersection of applicable policies.
- Frontend components access typed services, not scattered direct Tauri calls.
- Keep the application-service boundary transport-independent, but do not build remote access in this scope.

### Suggested repository structure

```text
src/
  app/                 # shell, navigation, routing, startup
  components/          # shared accessible primitives
  features/
    editor/
    explorer/
    terminal/
    git/
    changes/
    review/
    run/
    context/
    capabilities/
    settings/
  services/            # typed frontend service interfaces and Tauri adapter
  state/               # transient state only
  styles/              # theme tokens and global styles
src-tauri/
  src/
    commands/          # thin IPC endpoints
    domain/            # IDs, states, invariants
    services/          # application workflows
    infrastructure/    # SQLite, Git, filesystem, PTY, LSP, Rook
  migrations/
  tests/
tests/
  fixtures/
  ui/
docs/
  architecture/
  development/
```

Start with one frontend package and one Rust application crate. Split packages only when a concrete ownership or build need emerges.

### IPC and execution contracts

- Use generated or automatically checked Rust/TypeScript contracts; select tooling during scaffold work.
- Commands have typed inputs, typed errors, and operation IDs for long-running work.
- Events include a schema version, workspace/Change correlation, sequence, and timestamp.
- UI recovery uses a state snapshot followed by resumable events; events alone are not the database.
- Mutating operations use idempotency keys where retries could duplicate effects.
- Coalesce progress events and apply backpressure to logs.
- Run subprocesses using explicit executable/argument arrays and working directories. Shell execution is reserved for intentional terminal/recipe commands with visible semantics.

## 5. Developer experience contracts

### Contextual action entry point

A consistent keyboard action opens a small composer from a selection, diagnostic, test failure, terminal output, diff, symbol, or empty workspace. Attached context is visible and removable.

Support three levels:

1. Ask: read-only investigation with source-linked answers.
2. Patch: preview a localized edit and explicitly accept or reject it.
3. Change: delegate substantial implementation into an isolated workspace.

Escalation preserves context and conversation. Inline patches apply only when the source version still matches; otherwise refresh or resolve the conflict.

### Workspace continuity

- Preserve cursor, selection, tabs, splits, scroll, and navigation history.
- Associate every document, terminal, run process, and language server with a workspace ID.
- Always identify the active primary or Change workspace.
- Open supporting evidence without destroying the review layout.
- Allow editing candidate files during review; invalidate affected approval/evidence appropriately.
- Background agents must not steal focus.
- Notify primarily for blocked decisions, actionable failures, and review readiness.

### Agent handoff

- Steering requests have visible received/applied status.
- Pause-and-edit blocks new agent writes, settles active mutations, then grants manual control.
- Do not infer that requesting cancellation means a subprocess has stopped.
- Distinguish stopping a command, pausing an agent, stopping a server, and abandoning a Change.
- Do not permit silent simultaneous writes to the same document.

### Visual system

Use graphite surfaces, warm off-white text, restrained bronze accents, compact navigation, subtle borders, and clear typography. Ship light mode using the same semantic tokens. Avoid chat-dominated layouts, oversized cards, and decorative activity animations.

## 6. Domain model and invariants

### Core records

- Project: repository identity, trusted configuration, runtime preferences.
- Workspace: primary/worktree identity, canonical root, branch, lifecycle.
- Change: objective, base revision, constraints, criteria, lifecycle, workspace.
- Agent session link: harness session ID, Change ID, protocol/capability version.
- Source snapshot: immutable source identity and capture metadata.
- Execution: command, arguments, cwd, origin, timestamps, exit status, source snapshot, environment descriptors.
- Artifact: output/log location, media type, size, digest, retention state.
- Evidence link: execution/artifact associated with a criterion or review claim.
- Review decision: reviewer, source snapshot, decision, comments, timestamp.
- Integration attempt: target state, candidate state, strategy, conflicts, outcome commit.
- Project recipe: setup/run/check commands, inputs, permissions, configuration version.

### Independent state dimensions

- Change lifecycle: Draft → Active → In review → Approved → Integrated; Abandoned is available before integration.
- Agent execution: Idle, Running, Waiting for permission, Pausing, Paused, Failed, Interrupted.
- Verification: Not run, Running, Passed, Failed, Inconclusive, Stale.

Revisions reopen review. Source mutations invalidate source-bound approval. Failed execution does not automatically abandon a Change.

### Source identity and evidence freshness

- HEAD alone is insufficient: uncommitted and relevant untracked files must be represented.
- Capture a content-addressed manifest for the tested source, plus relevant configuration/lockfile hashes and runtime versions.
- Define included/excluded paths visibly; do not hash all ignored caches or serialize secrets.
- Serialize verification against known writes where practical and detect file changes during execution. Mark results inconclusive if the tested source cannot be determined reliably.
- Unsaved buffers are not on-disk verification input. Offer Save and Run, or clearly state the saved source is being tested.
- MVP policy: any relevant source modification makes earlier evidence stale. Fine-grained invalidation comes later.
- Record start failures, cancellation, and timeouts separately from successful exits.
- Passing a check supports only the observed result, not general correctness.

### Persistence and recovery

- Store durable transitions transactionally and retain a compact activity journal.
- Use bounded log streams, disk quotas, retention settings, and explicit cleanup.
- On restart, reconcile processes and sessions before marking anything running.
- Restore documents and review context; never silently replay interrupted commands.
- Reconcile database/worktree state after partial failures.
- Provide export of Change metadata and evidence without secrets.

## 7. Security and trust boundaries

- Repository content, instructions, skill files, MCP responses, and generated commands are untrusted inputs.
- Opening a repository must not automatically execute setup commands or project-provided tooling.
- Plan mode must be enforced through available tools and command policy, not only a prompt. Read-only Git commands still require care around configuration and external helpers.
- Build mode authorizes only the approved scope; external side effects retain their own permissions.
- Tauri capabilities restrict frontend access; arbitrary child processes require separate controls.
- Canonicalize paths and account for symlinks, case sensitivity, Windows paths, and workspace boundaries.
- Store application-owned credentials in the OS credential store; respect Rook ownership of provider credentials.
- Do not persist raw secrets in environment snapshots or approval records. Redact logs where practical and document limitations.
- Validate sandbox support per OS. If a requested isolation policy cannot be enforced, surface that explicitly rather than silently weakening it.
- Document outbound network behavior and make product telemetry opt-in if introduced.

## 8. Implementation phases

Phases are dependency gates, not calendar promises. Phase 0 determines realistic estimates and the exact Rook integration path.

### Phase 0 — Feasibility and contracts

Tasks:
- [ ] Inspect Rook and write a supported-capability matrix.
- [ ] Exercise session creation, events, permission requests, cancellation, and recovery using the real harness.
- [ ] Prototype Monaco and xterm.js in Tauri on macOS, Windows, and Linux.
- [ ] Verify editor workers, IME, clipboard, selection, shortcuts, terminal resize, and process cleanup.
- [ ] Prototype one TypeScript LSP round trip: diagnostics, completion, definition.
- [ ] Create an isolated worktree in a representative Node project and run setup/checks.
- [ ] Define source snapshot semantics, execution trust boundaries, and initial integration strategy.
- [ ] Record architecture decisions and supported platform prerequisites.

Exit gate: demonstrated platform/editor viability and a real Rook connection, or explicit blockers with revised scope. A mock adapter is useful for UI development but does not satisfy this gate.

### Phase 1 — Application and editor foundation

Tasks:
- [ ] Scaffold Tauri, React, strict TypeScript, Rust, formatting, linting, CI, and typed IPC.
- [ ] Implement theme tokens, compact shell, command registry, keyboard navigation, menus, settings.
- [ ] Add open/recent projects, native file dialogs, project identity, and workspace trust prompt.
- [ ] Build explorer with lazy loading, ignore rules, file operations, search, and external-change reconciliation.
- [ ] Implement Monaco models, tabs, dirty state, save/save all, undo behavior, encoding/newline policy, and recovery.
- [ ] Add file/symbol quick-open, find/replace, and clickable diagnostics.
- [ ] Connect TypeScript language services; avoid duplicate Monaco/LSP diagnostics.
- [ ] Implement PTY terminals, shell discovery, resize, bounded scrollback, and shutdown behavior.
- [ ] Add Git status and working-tree diffs.
- [ ] Introduce SQLite migrations and backend state snapshots.

Exit gate: edit, navigate, run, and inspect a real TypeScript repository; recover unsaved work after a forced restart; pass native smoke checks on all target OS families.

### Phase 2 — First complete agent Change

Tasks:
- [ ] Integrate real Rook through the versioned adapter.
- [ ] Implement contextual Ask and promotion to Change.
- [ ] Add visible context attachments, Plan/Build controls, permission requests, cancellation, and activity.
- [ ] Persist Change records independently of harness sessions.
- [ ] Create and reconcile one worktree per substantial agent implementation.
- [ ] Add inspectable setup/check recipes and trusted execution approvals.
- [ ] Record command results and artifacts with source-state identity.
- [ ] Build Change list, overview, editable candidate diff, evidence panel, and revision comments.
- [ ] Implement pause-and-edit and approval invalidation.
- [ ] Support one explicit integration strategy: squash integration into a clean checked-out destination, subject to Phase 0 validation.
- [ ] Detect destination changes; prepare/review the exact integration result, reverify when needed, and update the destination only if its expected state still matches.
- [ ] Surface conflicts without destructive resets or silent overwrites.
- [ ] Record integration commit and safely retain/clean up the worktree.

Exit gate: complete a real task from investigation to integrated commit with source-linked evidence, a developer revision, and recovery after an interrupted session.

This is the first usable product milestone. Do not defer durable Changes and evidence until after building a general-purpose IDE.

### Phase 3 — Daily workflow and reliability

Tasks:
- [ ] Add inline patch preview with version-safe application and promotion to Change.
- [ ] Add developer-created Changes from existing edits with a preview of included content.
- [ ] Add split editors and validate an optional Monaco-compatible Vim integration.
- [ ] Implement Run configurations, process controls, local URLs, clickable stack traces, and workspace ownership.
- [ ] Handle port collisions and disclose shared external services between workspaces.
- [ ] Add incremental review: show revisions since the last reviewed snapshot.
- [ ] Link acceptance criteria to evidence or explicit manual review; retain unknown status where appropriate.
- [ ] Improve dependency setup and package-manager/runtime discovery for supported project layouts.
- [ ] Validate npm, pnpm, Yarn, and representative workspace repositories.
- [ ] Add bounded log storage, retention controls, export, orphan cleanup, and disk-full handling.
- [ ] Improve reconnect, process reconciliation, stale-event handling, and interrupted-integration recovery.
- [ ] Add minimal initial debug workflow for Node if feasibility permits; otherwise document debugging as a known beta gap and plan DAP integration before claiming full IDE parity.

Exit gate: developers can use Laplace for sustained work without recurring context loss, wrong-workspace execution, silent data loss, or unexplained verification states.

### Phase 4 — Context and engineering history

Tasks:
- [ ] Build Context Lens from LSP definitions, references, diagnostics, and Change links.
- [ ] Add symbol/file history backed by persistent Changes.
- [ ] Add incremental indexes only where needed; measure indexing cost and cancellation.
- [ ] Introduce a System explorer with source navigation and observed/inferred/developer-confirmed labels.
- [ ] Preserve developer corrections and invalidate stale inferred relationships.
- [ ] Add narrow baseline/candidate comparison for structured tests, CLI snapshots, or API fixtures.
- [ ] Record inputs, environment, normalization rules, and missing/inconclusive comparisons.

Exit gate: a developer can move from selected code to related references, evidence, and historical intent without losing editor context. Behavior comparisons must expose their limits.

### Phase 5 — Capability management and release hardening

Tasks:
- [ ] Present project/user skills with origin, precedence, enablement, and permissions based on Rook capabilities.
- [ ] Add MCP configuration, connection status, tool visibility, and permission management.
- [ ] Display tool/skill provenance already collected from early harness events.
- [ ] Audit accessibility, keyboard workflows, themes, IME, scaling, and reduced-motion behavior.
- [ ] Complete platform signing, notarization, installers, secure updater, and migration recovery.
- [ ] Publish supported OS/runtime requirements and troubleshooting documentation.
- [ ] Run release qualification against representative repositories and failure scenarios.

Exit gate: packaged, recoverable desktop beta with clear platform support and no critical editing, permission, integration, or evidence-integrity defects.

## 9. Integration and environment details

### Worktrees

- Use application-owned identifiable directories and branches; never delete unfamiliar user worktrees.
- Treat dependency installation, ignored configuration, credentials, submodules, and Git LFS as explicit cases.
- MVP may reject unsupported repository layouts with an actionable explanation rather than partially operating on them.
- Never assume copying node_modules is safe across platforms or package managers.
- Track worktree ownership and cleanup eligibility; preserve dirty or unintegrated work unless explicitly discarded.
- Primary-workspace dirtiness blocks integration initially but must not block read-only investigation.

### Integration invariant

The approved candidate, target baseline, and exact proposed integrated tree must be known. Use Git locking/expected-state checks and durable attempt records. If the destination advances or changes, stop and recompute. Do not run an unguarded merge into an actively edited working tree.

### Toolchain ownership

- Pin application build tooling.
- Resolve repository tooling from project configuration where possible.
- Separate the application-managed language-server runtime from the runtime used to build/run the user's project.
- Detect missing Git/Node and provide clear setup guidance.
- Do not assume a shell's PATH matches a GUI application's environment, especially on macOS.

## 10. How to work on the implementation

### Working order

1. Resolve Phase 0 gates before committing to protocol or runtime packaging details.
2. Scaffold the minimum application and native CI smoke path.
3. Build a thin vertical slice: open file → edit → save → run command → record result.
4. Extend it: request → Rook investigation → isolated Change → diff → evidence → integration.
5. Harden that workflow before broadening intelligence and capability UIs.

### Task discipline

For each task, specify:
- User-visible outcome and acceptance criteria.
- Prerequisites and owning architectural layer.
- State transitions and failure/recovery behavior.
- Security/permission implications where execution is involved.
- Appropriate automated checks and native smoke steps.

Keep changes focused and reviewable. Use architecture decision records for consequential choices, not routine implementation details. Update this plan when discovery changes scope or sequencing.

### Coding conventions

- Thin UI components and IPC endpoints; domain rules live in application/domain services.
- Explicit IDs and typed errors; avoid stringly typed lifecycle transitions.
- No synchronous heavy work on the UI thread.
- Cancellation and cleanup are required for long-running operations.
- No component-level subprocess execution or direct persistent-state mutation.
- Centralize path conversion and platform-specific behavior.
- Log operation IDs and bounded diagnostics, excluding secrets.
- Avoid dependencies without a concrete benefit; inspect maintenance, license, platform support, and bundle cost.

### Planned developer commands

After scaffolding, document and provide equivalent scripts for:

```text
pnpm install --frozen-lockfile
pnpm tauri dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:ui
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
pnpm tauri build
```

Rust commands run from src-tauri unless a root Cargo workspace is introduced. These commands are planned interfaces, not currently available scripts.

### Definition of done

- Acceptance criteria are demonstrably satisfied.
- Relevant success, failure, cancellation, and recovery paths are handled.
- Contracts and persistence migrations are checked.
- Keyboard/accessibility behavior is verified for new interactions.
- Appropriate tests pass; platform-sensitive changes receive native checks.
- No hidden mock results appear as real agent or verification output.
- Documentation explains meaningful limitations and configuration.

## 11. Verification strategy

### Automated coverage priorities

- State-machine invariants and approval/evidence invalidation.
- Version-safe document saves and patch application.
- Git worktree creation, dirty target handling, advancing target, conflicts, cleanup, and interrupted integration.
- Process exit, cancellation, timeout, output limits, and missing executables.
- SQLite migrations, failed writes, state recovery, and artifact retention.
- Adapter duplicate/out-of-order events, reconnect, permission denial, and unsupported capabilities.
- Path boundaries, symlinks, unusual filenames, Unicode, and Windows path behavior.
- UI workflows: context attachment, navigation continuity, editable review, source freshness, and focus management.

Use real temporary Git repositories for repository semantics. Use controlled fake harnesses for deterministic failures, plus real Rook contract/smoke tests. Browser tests complement, rather than replace, native desktop tests.

### Cross-platform release checks

- macOS Apple Silicon and Intel build verification, signing/notarization.
- Windows x64 installer and shell/process behavior; ARM64 after explicit validation.
- Linux supported distribution matrix, WebKitGTK dependencies, selected X11/Wayland checks.
- Clipboard, IME, shortcuts, terminal resize, filesystem events, Git credentials, updater, and process cleanup.

### Initial performance budgets

Treat these as provisional engineering targets, measured on declared reference hardware and fixture repositories:
- No sustained UI stalls during typing, agent output, or background indexing.
- Target p95 keystroke-to-paint below 50 ms during representative background activity.
- Target warm local-file opening below 150 ms for ordinary source files.
- Bound terminal/log memory and event queues; test output floods.
- Lazy-load large directories and diffs; virtualize long lists.
- Establish startup, idle memory, and large-repository baselines in Phase 0/1 before setting release thresholds.

## 12. Product validation

Run representative workflows throughout development:

1. Fix a bug and add a regression test.
2. Add an API endpoint with a runnable candidate.
3. Refactor existing code while checking preserved behavior.
4. Pause an agent, make a manual correction, and resume review.
5. Recover an interrupted Change after restart.
6. Integrate after the destination branch advances.
7. Continue existing manual edits as a Change.

Measure review time, repeated context entry, lost navigation state, incorrect-workspace actions, missed verification gaps, recovery success, and editor responsiveness. Do not optimize for generated lines or agent invocation counts.

## 13. Major risks and responses

| Risk | Response |
| --- | --- |
| Building an entire IDE before proving value | Deliver the end-to-end Change slice early |
| Rook lacks required lifecycle or permission capabilities | Discover immediately; version the adapter and document required harness work |
| Webview differences degrade editor quality | Native feasibility tests before deep investment; evidence-based shell decision |
| Verification looks stronger than it is | Source-bound executions, freshness, explicit unknown/inconclusive states |
| Worktrees are mistaken for security isolation | Separate execution policy and platform sandbox design |
| Agent/developer edits collide | Version checks and explicit pause-and-edit ownership |
| Environment setup dominates task time | Reusable approved recipes and clear runtime ownership |
| Integration overwrites user work | Clean-target policy, expected-state checks, recoverable integration attempts |
| Architecture maps become speculative | Prefer observed LSP relationships; label inference and preserve corrections |
| Platform support becomes nominal | Native CI and release qualification from the beginning |

## 14. First implementation batch

1. Obtain and inspect Rook's integration surface.
2. Scaffold Tauri/React/Rust and native CI.
3. Prove Monaco + TypeScript LSP + PTY behavior across the supported OS matrix.
4. Implement project open, file editing/saving, and terminal execution.
5. Add SQLite, typed Change records, execution records, and source snapshots.
6. Connect real Rook investigation and isolated implementation.
7. Finish editable diff review, verification freshness, and guarded integration.

The first success criterion is one complete, trustworthy engineering workflow—not a large set of disconnected screens.
