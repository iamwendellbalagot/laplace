# 03 — Reference UI shell

Status: Shell implementation in place; exit gate remains open for deterministic visual comparison, zoom/minimum-window review, and native accessibility checks.
Depends on: [02](02-bootstrap.md)
Next: [04 — Projects and filesystem](04-projects-filesystem.md)

## Outcome

A faithful, accessible React translation of the user-provided visual reference. This checkpoint establishes the desktop identity, not a fake working IDE.

## UI reference

Read index.html, styles.css, README.md and preview-overview.png, preview-editor.png, preview-settings.png. Apply [ui-reference.md](ui-reference.md), including its serif typography and intentional native/accessibility differences.

## Tasks

- [x] Extract semantic dark/light color, typography, spacing, density, and status tokens from the reference.
- [x] Bundle licensed primary fonts; define an editorial serif fallback stack. OS-specific serif rendering still needs visual review.
- [x] Build top bar, orbit/wordmark, project/branch slots, command access, rail, status bar.
- [x] Use the platform-provided native title bar/window controls (no mock traffic lights); platform drag-region validation remains open.
- [x] Add Home, Editor, Changes, Context, Verify, Rook, Tools, and Settings navigation matching the reference vocabulary.
- [x] Unimplemented views show honest empty/unavailable states, not fabricated activity.
- [ ] Add reusable buttons, pills, rows, tabs, separators, menus, dialogs, inspectors, and tool drawers. This shell has reusable buttons, rows, separators, a dialog, and inspector; tabs and tool drawers are deferred until their owning features.
- [x] Implement command registry and Cmd/Ctrl+K palette with search, arrows, Enter, Escape, and focus return using Radix Dialog.
- [x] Persist theme, density, font-size preferences through the backend's small JSON settings facility.
- [x] Introduce resizable/collapsible inspector behavior with keyboard alternatives and saved layout; navigation collapse is also persisted.
- [x] Preserve view/layout state during navigation; background updates do not intentionally steal focus.
- [x] Provide initial loading/error, empty, disabled, and disconnected visual patterns.

## Checks and exit gate

- [ ] Compare shell and Home/Editor composition to deterministic reference screenshots; visual/native screenshot comparison was not available in this implementation session.
- [ ] Both themes and densities are implemented through semantic tokens; visual leak/contrast review remains outstanding.
- [ ] Zoom/minimum window size retains access to important actions via drawers or commands; not verified.
- [x] Cmd/Ctrl labels and shortcuts reflect the detected platform and the global shortcut avoids text-entry controls.
- [ ] Keyboard behavior has targeted UI coverage, but native screen-reader and focus verification remains outstanding.
- [x] No hardcoded check counts, connected Rook status, or fake terminal output appears as live state.

Deliberate deviations: project/branch are explicitly empty, Editor is a non-editable placeholder pending Plans 04–05, and right-side Context is an empty inspector. Review/Changes/Verify/Rook/Tools are honest unavailable states. The default native title bar replaces mock platform chrome. Native screenshot comparison and assistive-technology verification remain required before closing this checkpoint.

Focused verification on macOS: UI tests cover shell honesty/navigation, palette keyboard behavior and focus return, theme/density persistence, inspector keyboard resizing, and explicit native smoke interaction. The frontend and Rust check results are recorded in `status.md`.
