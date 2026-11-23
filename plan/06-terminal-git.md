# 06 — Terminal, processes, and Git basics

Status: Initial Linux implementation in place; native interaction and cross-platform acceptance remain open
Depends on: [05](05-editor-typescript.md)  
Next: [07 — Persistent Changes](07-changes-persistence.md)

## Outcome

Run real workspace shells and inspect real Git changes without blocking the editor or confusing workspace ownership.

## Tasks

- [x] Connect xterm.js to portable-pty with shell discovery, explicit cwd, resize, input, and Unicode support. UI/service wiring and Linux compilation are verified; native interactive smoke remains open.
- [ ] Handle GUI PATH differences, particularly macOS, with explicit/documented environment resolution. Uses configured `$SHELL` or platform fallback; macOS GUI environment behavior remains unverified.
- [x] Give terminal sessions workspace identity, shell lifecycle, and visible ownership.
- [ ] Handle process exit, start failure, cancellation, timeout, bounded output, and process-tree cleanup per OS. Bounded terminal output/session shutdown and explicit close are implemented; timeout/restart reconciliation and OS process-tree verification remain open.
- [ ] Separate interactive terminal execution from application-run structured commands.
- [ ] Respect project trust and authorization; do not open shells that trigger unreviewed project setup automatically.
- [x] Detect missing Git and provide actionable service errors.
- [x] Parse NUL-delimited machine-readable Git status, including paths with spaces and rename entries.
- [x] Show current branch, tracked/untracked status and tracked diff in the editor drawer.
- [ ] Handle credential prompts and Git external-helper/configuration behavior explicitly; do not classify every Git read as harmless by name alone.
- [ ] Add process shutdown/restart reconciliation without blindly resuming old commands.

## UI reference

Use the Editor bottom drawer, Terminal/Problems/Evidence tabs, explorer Git status, top branch, and status workspace marker. Only Terminal and implemented tabs are functional; unavailable tabs must not contain fictional output.

## Checks and exit gate

- [ ] Run native project tests manually, resize terminal, interrupt long-running command, and close without orphaned managed children. Linux unit/service checks pass; no native display in this environment.
- [ ] Test native shells and PTY behavior on macOS, Windows, Linux.
- [x] Output floods are capped at 4 MiB per terminal and the process is stopped when the cap is exceeded; responsiveness baseline remains unmeasured.
- [ ] Changing active workspace does not silently retarget an existing terminal.
- [x] Git tracked diffs match expected independent fixture output; untracked names are listed, but untracked content previews are explicitly not yet supported.
- [ ] Missing executables, credentials, and failed commands have actionable states.

Checkpoint milestone: open → edit → save → run → inspect Git is usable. Formal verification records arrive in step 10; terminal text alone is not recorded verification.
