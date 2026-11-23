# 05 — Editor and TypeScript intelligence

Status: Not started  
Depends on: [04](04-projects-filesystem.md), validated bridge from 01  
Next: [06 — Terminal and Git](06-terminal-git.md)

## Outcome

Real, continuously editable source with safe saves, restart recovery, and project-aware TypeScript navigation. Keep the first slice narrow: single-package projects and essential language features.

## Tasks

- [ ] Integrate Monaco workers, semantic themes, fonts, tabs, model disposal, and URI identities.
- [ ] Bind model identity to workspace plus file; identical relative paths in different worktrees must never share buffers.
- [ ] Add dirty indicators, save/save all, close prompts, undo/redo, and selection/navigation restoration.
- [ ] Define supported encoding/BOM/newline behavior; prevent lossy saves of unsupported content.
- [ ] Implement version-checked saves and external-change conflict handling with safe filesystem writes.
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

- [ ] Edit/save/reopen a real TypeScript project with completion, diagnostics, and definition navigation.
- [ ] Detect stale-save conflicts and protect unsaved data through file changes and forced restart.
- [ ] Switching views retains cursor, scroll, tabs, and undo expectations.
- [ ] Test typing/IME/clipboard/shortcuts/zoom on target native webviews.
- [ ] Verify model and language-server cleanup; repeated file opening does not leak unbounded memory.
- [ ] Record typing/file-open performance against declared fixtures.

Split editors and optional Vim are deliberately completed in step 12, not prerequisites to proving the first Change loop.
