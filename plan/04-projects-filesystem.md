# 04 — Projects and filesystem

Status: In progress — native folder-picker integration, canonical project/recent records, bounded read-only explorer, and 1 MiB UTF-8 preview are implemented. Native picker smoke, cross-platform path cases, and remaining filesystem features are open.
Depends on: [03](03-ui-shell.md)
Next: [05 — Editor and TypeScript](05-editor-typescript.md)

## Outcome

Open a real local project and navigate its files safely. Repository trust and path boundaries precede automatic development tooling.

## Tasks

- [x] Add native folder selection, recent projects, canonical project identities, and unavailable-path errors. Recent paths are only opened after explicit user selection; automatic project restore is not implemented.
- [ ] Add trust/authorization UX before project tooling or setup is executed; opening files remains available without running code.
- [x] Detect Git/project roots, including an already-open worktree with a `.git` file; do not assume every folder is a Git repository.
- [x] Implement lazy one-directory-at-a-time explorer loading and keyboard-operable directory expansion.
- [ ] Add `.gitignore`/user ignore policy, refresh, and selected-file navigation; current static exclusions are `.git`, `.rook`, `node_modules`, `target`, and `dist`.
- [ ] Add file creation/rename/delete with confirmations appropriate to risk; protect open dirty documents.
- [x] Implement bounded read-only file previews (1 MiB limit), binary/large-file detection, and explicit fallback states.
- [ ] Centralize cross-platform URI/path conversion; backend path-component, canonical-path, and symlink root-boundary checks are implemented for directory listing.
- [ ] Integrate notify with debounce/coalescing, ignore rules, overflow/full-rescan recovery.
- [ ] Expose external create/rename/delete/edit events without silently overwriting unsaved buffers.
- [ ] Add file quick-open; implement bounded/cancellable text search with explicit ignored-file behavior.
- [ ] Remember open project and basic view state without executing anything on restore.

## UI reference

Use Editor explorer/project selector/status bar. Replace atlas/api sample labels with real project identity. Keep the explorer and active workspace legible when panes collapse; do not simply hide navigation at reference breakpoints.

## Checks and exit gate

- [ ] Manually open/reopen a real repository with the native picker; empty/non-Git/missing folders behave predictably. Rust tests cover temporary Git/non-Git fixtures, Unicode/spaces, missing paths, and already-open worktree metadata on macOS only.
- [ ] Test symlinks, Unicode, spaces, unusual filenames, case-only rename, Windows drives, and workspace escapes.
- [ ] External edits/renames/deletes appear correctly; watcher overflow recovers.
- [x] Folder opening and listing do not run package scripts, project executables, or agent tools; no trust decision is needed to read folder names, and no project tooling is exposed in this slice.
- [ ] Search cancellation/large directories do not freeze the interface.
- [ ] User work and the mockup remain intact.

Record supported file encodings/layout limitations, trust behavior, and OS filesystem checks.

Current limitations: the explorer shows at most 1,000 entries per directory and reports truncation; it does not follow symlinks or apply repository `.gitignore` rules. File preview reads at most 1 MiB, classifies NUL/invalid-UTF-8 data as binary, and does not edit or save. Project identity is the canonical Unicode path; non-Unicode filesystem paths are reported unsupported. The native folder picker, Windows drive/case behavior, Linux portals, and OS accessibility behavior still require native checks.
