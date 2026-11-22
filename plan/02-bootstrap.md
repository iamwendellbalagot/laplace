# 02 — Bootstrap and typed boundaries

Status: Complete for the scaffold-only exception — frontend and Rust checks pass; macOS native build and user-confirmed command/event/window-close smoke pass. Plan 01 platform gates remain open.
Depends on: [01](01-feasibility.md), or its explicitly documented scaffold-only exception
Next: [03 — UI shell](03-ui-shell.md)

## Outcome

A minimal native application with checked frontend/backend contracts, repeatable development commands, and native CI. No speculative future architecture.

## Tasks

- [x] Scaffold Tauri 2, React, Vite, strict TypeScript, and Rust using the structure in architecture.md. Tauri's async command runtime is used; no separate Tokio dependency is needed yet.
- [x] Pin pnpm, Rust, and supported build Node; commit lockfiles and document native prerequisites.
- [x] Add frontend formatting/linting/type checking and Rust fmt/clippy checks (Rust formatting and clippy pass locally).
- [x] Implement the checked IPC contract approach using shared JSON fixtures.
- [x] Define typed errors, correlation/operation IDs, workspace IDs, and event envelope.
- [x] Add a minimal command/event smoke round trip with visible error handling; native execution and clean close were confirmed by the user on macOS.
- [x] Introduce a frontend service interface with a Tauri adapter; components do not call IPC directly.
- [x] Configure a restrictive CSP without remote script permissions. Monaco and worker bundling are deferred because Monaco is not part of this bootstrap.
- [ ] Add structured, bounded diagnostics that exclude secrets (deferred; no diagnostics subsystem is introduced in the bootstrap).
- [x] Configure Vitest/Testing Library, Rust tests, and fixture conventions (the 2 Rust fixture/validation tests pass locally).
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
- [x] Typed IPC success and error cases have frontend tests and shared fixtures; both Rust fixture/validation tests pass.
- [x] CI reports frontend and OS-specific native compile outcomes separately.
- [x] No repository-open command or tool execution occurs at startup; the native ping is user-triggered.
- [x] Native window opens and closes without orphaned processes; the user confirmed the command/event interaction and clean close on macOS.

Frontend verification on macOS with Node 26.10.0 and pnpm 10.34.9: `pnpm lint`, `pnpm typecheck`, `pnpm test` (7 tests), `pnpm test:ui` (3 tests), and `pnpm build` pass. With pinned Rust 1.100.0, `cargo fmt --check`, `cargo test --locked` (2 tests), and `cargo clippy --locked --all-targets -- -D warnings` pass; `pnpm tauri:build` produces the macOS release executable without bundling. The user confirmed the native window, user-triggered command/event interaction, and clean close on macOS. Windows/Linux native builds/runtime and Plan 01 feasibility gates remain outstanding; this is not a cross-platform feasibility sign-off.
