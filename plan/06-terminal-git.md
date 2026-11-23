# 06 — Terminal, processes, and Git basics

Status: Not started  
Depends on: [05](05-editor-typescript.md)  
Next: [07 — Persistent Changes](07-changes-persistence.md)

## Outcome

Run real workspace shells and inspect real Git changes without blocking the editor or confusing workspace ownership.

## Tasks

- [ ] Connect xterm.js to portable-pty with shell discovery, explicit cwd, resize, input, and Unicode support.
- [ ] Handle GUI PATH differences, particularly macOS, with explicit/documented environment resolution.
- [ ] Give each terminal/process workspace identity, executable/args, lifecycle, and visible ownership.
- [ ] Handle process exit, start failure, cancellation, timeout, bounded output, and process-tree cleanup per OS.
- [ ] Separate interactive terminal execution from application-run structured commands.
- [ ] Respect project trust and authorization; do not open shells that trigger unreviewed project setup automatically.
- [ ] Detect installed Git and provide missing-tool guidance.
- [ ] Parse machine-readable Git status/diff output robustly, including unusual paths.
- [ ] Show current branch, working-tree changes, tracked/untracked files, and real diffs.
- [ ] Handle credential prompts and Git external-helper/configuration behavior explicitly; do not classify every Git read as harmless by name alone.
- [ ] Add process shutdown/restart reconciliation without blindly resuming old commands.

## UI reference

Use the Editor bottom drawer, Terminal/Problems/Evidence tabs, explorer Git status, top branch, and status workspace marker. Only Terminal and implemented tabs are functional; unavailable tabs must not contain fictional output.

## Checks and exit gate

- [ ] Run project tests manually, resize terminal, interrupt long-running command, and close without orphaned managed children.
- [ ] Test native shells and PTY behavior on macOS, Windows, Linux.
- [ ] Output floods have bounded memory and do not degrade editing responsiveness beyond measured targets.
- [ ] Changing active workspace does not silently retarget an existing terminal.
- [ ] Git diffs match an independent Git invocation for real fixtures, including dirty and untracked files.
- [ ] Missing executables, credentials, and failed commands have actionable states.

Checkpoint milestone: open → edit → save → run → inspect Git is usable. Formal verification records arrive in step 10; terminal text alone is not recorded verification.
