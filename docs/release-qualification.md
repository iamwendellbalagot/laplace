# Release qualification (beta)

Honest status of what has and has not been verified. Nothing here is a support promise beyond the "Verified" column.

## Platform matrix

| Platform                       | Status                                        | Evidence                                                                       |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------ |
| macOS Apple Silicon (14+)      | Developed and unit/build checked on this host | Rust/TS checks per `status.md`; native smoke is manual                         |
| macOS Intel                    | **Unverified**                                | CI template builds it (`release-matrix.yml`, `macos-13`); no test run recorded |
| Windows x64                    | **Unverified**                                | CI template only; Authenticode signing not configured                          |
| Linux x64 (Ubuntu 22.04 class) | **Unverified**                                | CI template only; X11/Wayland behavior untested                                |
| Windows ARM64                  | **Deferred**                                  | Not tested                                                                     |

## Packaging

- `pnpm stage:rook -- --rook-version <exact>` (release) or `--local-rook ../rook` (pre-publish beta) stages `src-tauri/resources/rook-runtime/` with a pinned `rook-agent`, its production dependencies, a Node >=22.19 binary, notices, and `manifest.json` (versions, platform/arch, SHA-256).
- The script loads `better-sqlite3` and runs `rook --version` under the staged Node before finishing.
- `pnpm tauri:bundle` builds installers using `src-tauri/tauri.bundle.conf.json`. Run `pnpm tauri icon src-tauri/icons/icon.png` first to generate platform icons.
- `pnpm tauri:build` stays `--no-bundle` for fast compile checks.
- Release builds launch **only** the bundled payload. `LAPLACE_ROOK_BIN`, the Settings → Developer checkout, and global `rook`/`node` on `PATH` are ignored. A missing or mismatched bundle yields `rook_bundle_corrupt` / `rook_bundle_incompatible` with a reinstall/repair message.
- No developer `models.json`, provider credentials, or auth data are staged (the script strips them).

## Not done (requires target hardware, accounts, or secrets)

- macOS signing and notarization; Windows signing; Linux package signing.
- Signed updater endpoint, update-compatibility policy, failed-update recovery.
- Clean-machine acceptance on each OS (no Node/npm/Rook/checkout): first launch, offline startup, provider sign-in, model selection, streamed Ask.
- Licence review of the staged bundle beyond copying Rook's notices into `NOTICES/`.
- Large-repo, typing-latency, output-flood, and idle-memory benchmarks.
- Full screen-reader, IME, zoom, and contrast audit. Motion is globally reduced under `prefers-reduced-motion`.

## Data safety

- Before applying pending migrations Laplace runs `PRAGMA quick_check`, refuses to open a database whose schema is **newer** than the app (no downgrade promise), and copies the database to `backups/laplace-v<from>-<timestamp>.sqlite3` (latest 3 kept).
- Check output is passed through a pattern redactor (bearer tokens, `sk-`/`ghp_`/`github_pat_`/`xox*-`/`AIza` keys, `KEY=value` secrets, URL credentials) before it is stored. This is best-effort pattern matching, not a guarantee.
- Capability snapshots redact MCP headers/env/args/URL credentials.

## Network behavior

Laplace itself sends no telemetry and checks no update endpoint. Network traffic comes from Rook provider requests you initiate and from commands you run. Settings → Runtime & diagnostics states this and exports a credential-free report.

## Known limitations

- Live MCP tool execution is not available in Laplace stdio sessions (`arbitraryMcp: false`); use Rook Terminal.
- Node DAP step debugging and `monaco-vim` remain deferred.
- Sandbox: macOS Seatbelt verified in Rook; Linux Bubblewrap not live-tested.

## Manual qualification checklist

- [ ] Bug fix with regression test and source-linked evidence
- [ ] API addition with runnable candidate
- [ ] Refactor with explicit preserved-behavior checks
- [ ] Pause agent, edit manually, rerun checks
- [ ] Recover interrupted session/check after restart
- [ ] Dirty or advancing HEAD during commit
- [ ] Installed bundle on a machine with no Node/npm/Rook
