# 02 — Bootstrap and typed boundaries

Status: In progress — scaffold and frontend verification complete; native gates blocked by low disk space; Plan 01 native/platform gates remain open
Depends on: [01](01-feasibility.md), or its explicitly documented scaffold-only exception
Next: [03 — UI shell](03-ui-shell.md)

## Outcome

A minimal native application with checked frontend/backend contracts, repeatable development commands, and native CI. No speculative future architecture.

## Tasks

- [x] Scaffold Tauri 2, React, Vite, strict TypeScript, and Rust using the structure in architecture.md. Tauri's async command runtime is used; no separate Tokio dependency is needed yet.
- [x] Pin pnpm, Rust, and supported build Node; commit lockfiles and document native prerequisites.
- [x] Add frontend formatting/linting/type checking and Rust fmt/clippy checks (Rust formatting is run locally; clippy execution remains pending).
- [x] Implement the checked IPC contract approach using shared JSON fixtures.
- [x] Define typed errors, correlation/operation IDs, workspace IDs, and event envelope.
- [x] Add a minimal command/event smoke round trip with visible error handling; native execution remains pending.
- [x] Introduce a frontend service interface with a Tauri adapter; components do not call IPC directly.
- [x] Configure a restrictive CSP without remote script permissions. Monaco and worker bundling are deferred because Monaco is not part of this bootstrap.
- [ ] Add structured, bounded diagnostics that exclude secrets (deferred; no diagnostics subsystem is introduced in the bootstrap).
- [x] Configure Vitest/Testing Library, Rust tests, and fixture conventions (Rust tests are authored but not run locally).
- [x] Build native OS CI for macOS, Windows, and Linux; CI compile coverage does not claim native runtime checks.
- [x] Preserve LICENSE and laplace-html-mockup without treating mockup JavaScript as production code.

## Command interface

The frontend scripts are now provided:

```text
pnpm install --frozen-lockfile
pnpm tauri dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:ui
pnpm tauri build
```

Run Rust checks from the repository root, targeting `src-tauri`:

```text
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## Verification and remaining exit gate

- [x] Fresh frontend setup instructions are documented and a production bundle builds.
- [x] Typed IPC success and error cases have frontend tests and shared fixtures; Rust fixture tests are authored but unexecuted.
- [x] CI reports frontend and OS-specific native compile outcomes separately.
- [x] No repository-open command or tool execution occurs at startup; the native ping is user-triggered.
- [ ] Native window opens and closes without orphaned application processes.

Frontend verification on macOS with Node 23.4.0 and pnpm 10.34.9: `pnpm lint`, `pnpm typecheck`, `pnpm test` (7 tests), `pnpm test:ui` (3 tests), and `pnpm build` pass. `cargo fmt --check` and `cargo metadata --locked --no-deps` pass with the installed stable toolchain. Rust tests, clippy, native compile, native window/runtime, and cross-platform behavior were not run: free disk space is about 677 MiB. Rust 1.100.0 toolchain availability was not verified. Plan 01 remains open, so this is not a native-feasibility sign-off.
