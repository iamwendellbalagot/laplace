# Laplace

Laplace is a local-first desktop workspace for understanding, changing, and
verifying software. The current application is the minimal Tauri/React
bootstrap used to validate the Rust↔TypeScript boundary; it is not yet the
planned editor or project shell. Opening the app does not scan a repository or
start tools. The native smoke command runs only after the button is clicked.

## Prerequisites

- Node.js 22.19.0 (pinned in `.node-version`).
- pnpm 10.34.9 (pinned in `package.json`). If the installed Corepack has stale
  signing keys, install the exact pnpm version through npm or the official pnpm
  installer rather than changing the project pin.
- Rust 1.100.0 with `rustfmt` and `clippy` (pinned in `rust-toolchain.toml`).
- Tauri's platform prerequisites: Xcode Command Line Tools on macOS; WebView2
  and the MSVC C++ build tools on Windows; GTK/WebKitGTK and the listed system
  libraries for the selected Linux distribution.

For Ubuntu 22.04 CI, the native dependencies are installed by
`.github/workflows/ci.yml`.

## Development

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:ui
pnpm build
pnpm tauri dev
```

`pnpm tauri dev` launches the native window. `pnpm tauri build` compiles the
desktop executable without producing an installer bundle yet. Rust checks:

For a browser-only visual preview from the shared `ai_dev_workspace` opencode
container, run `pnpm dev:web-preview` and open <http://localhost:5173> on the
host Mac. The preview deliberately disables native project/filesystem and IPC
actions; use `pnpm tauri dev` on the host for those features.

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

The IPC contract is currently checked through shared JSON fixtures in
`contracts/ipc-fixtures.json`: TypeScript tests type-check those fixtures and
Rust tests compare serialized command/event values against the same data. It
covers schema version, operation ID, typed errors, workspace identity, event
sequence, and timestamp shape. It does not yet represent workspace services or
Rook integration.

## Verification status

Plan 02 is being implemented under a scaffold-only exception while Plan 01's
cross-platform feasibility gates remain open. Browser checks do not prove
native IPC or platform behavior. This host has critically low free disk space;
native compilation must wait until capacity is restored. CI is configured to
report frontend checks separately from macOS, Windows, and Linux native builds.
