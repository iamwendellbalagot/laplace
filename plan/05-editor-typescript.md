# 05 — Editor and TypeScript intelligence

Status: In progress — Monaco editing, per-project/file tabs, dirty tracking, explicit saves, and backend compare-before-write are implemented. TypeScript language-server integration, recovery, and deeper native acceptance remain open.
Depends on: [04](04-projects-filesystem.md), validated bridge from 01  
Next: [06 — Terminal and Git](06-terminal-git.md)

## Outcome

Real, continuously editable source with safe saves, restart recovery, and project-aware TypeScript navigation. Keep the first slice narrow: single-package projects and essential language features.

## Tasks

- [x] Integrate Monaco workers, semantic themes, fonts, tabs, and workspace/file URI identities. Editor lifetime and native URI behavior still need full smoke coverage.
- [x] Bind model identity to workspace plus file; identical relative paths in different worktrees do not share buffers.
- [x] Add dirty indicators, save/save all, dirty-tab close prompts, and Monaco undo/redo. Cursor restoration across editor teardown remains open.
- [x] Define initial text support: UTF-8 text up to 1 MiB, written as UTF-8; binary and oversized files stay read-only. Existing LF/CRLF/CR newline style is retained.
- [x] Implement expected-content-checked saves, external-change conflict errors, and temporary-file replacement.
- [ ] Persist unsaved-buffer recovery data and offer restore after crash; do not overwrite changed disk files automatically.
- [ ] Connect TypeScript LSP with diagnostics, completion, hover, definitions, references, document symbols, and rename where validated.
- [ ] Synchronize open document versions to language services and isolate language servers per workspace.
- [ ] Avoid duplicate built-in Monaco/LSP diagnostics for the same files.
- [ ] Resolve app-owned language-server runtime separately from repository Node/package manager.
- [ ] Add find/replace, quick-open/source locations, diagnostics navigation, and breadcrumbs.
- [ ] Add an editor context attachment model for later Ask/Patch/Change actions without running an agent yet.

## UI reference

Follow preview-editor.png: tabs, breadcrumb/symbol bar, editor, bottom tools, optional Context/History inspector. Replace the textarea/highlighted mock and Edit file button with Monaco. Inspector content remains empty or unavailable until backed by real relationships.

## Checks and exit gate

- [ ] Edit/save/reopen a real project in the native editor; the focused UI test exercises edit and save through a service fixture. Completion, diagnostics, and definition navigation await validated LSP integration.
- [ ] Detect stale-save conflicts and protect unsaved data through file changes and forced restart.
- [ ] Switching views retains cursor, scroll, tabs, and undo expectations.
- [ ] Test typing/IME/clipboard/shortcuts/zoom on target native webviews.
- [ ] Verify model and language-server cleanup; repeated file opening does not leak unbounded memory.
- [ ] Record typing/file-open performance against declared fixtures.

Split editors and optional Vim are deliberately completed in step 12, not prerequisites to proving the first Change loop.

Implementation note: This slice intentionally uses Monaco's built-in language support only. No project code or language server is started. Browser tests and production bundling pass; Rust tests and native editor/save smoke require an environment with the pinned Rust toolchain and desktop dependencies.
