# UI reference and production translation

## Source of truth

The user-provided repository directory is **[`laplace-html-mockup/`](../laplace-html-mockup/README.md)**. Preserve it as design reference. It is a static offline HTML/CSS/JavaScript prototype, not a working backend.

Read:
- [README.md](../laplace-html-mockup/README.md): screen inventory and interaction intent.
- [index.html](../laplace-html-mockup/index.html): shell, top bar, rail, status bar, command palette.
- [styles.css](../laplace-html-mockup/styles.css): typography, spacing, color tokens, screen composition, breakpoints.
- [app.js](../laplace-html-mockup/app.js): illustrative rendering and interaction states, not production service architecture.
- [laplace-standalone.html](../laplace-html-mockup/laplace-standalone.html): single-file viewing convenience.
- `preview-*.png`: visual comparison references; behavior is clarified by source.

The planning pass inspected these source files and the editor, review, and overview previews. Implementation must inspect the additional relevant previews for each screen. Do not assume every screenshot is synchronized with every source edit; record genuine discrepancies.

## Preserve the visual identity

- Graphite/green-charcoal canvas and surfaces; warm off-white text; quiet brass accents.
- Editorial serif wordmark and headings, sans-serif interface text, monospaced engineering details.
- Orbit/constructivist brand mark, restrained borders, compact buttons, understated status pills.
- Narrow navigation rail, project/branch context, centered command access, bottom status bar.
- Editor: explorer, tabs/breadcrumbs, main code surface, optional right inspector, bottom tools.
- Review: large diff area with criteria, verification, and actions in a contextual inspector.
- Verification: compact execution ledger and source-identity details.
- Spacious editorial treatment belongs primarily to Home/summary surfaces, not source editing.

### Initial token anchors from styles.css

| Token | Reference dark value |
| --- | --- |
| Canvas | `#101211` |
| Shell | `#161817` |
| Surface | `#191b1a` |
| Raised surface | `#1d201e` |
| Border | `#30332f` |
| Text | `#eae8df` |
| Secondary text | `#c6c4ba` |
| Muted text | `#92988f` |
| Brass | `#bd9a70` |
| Brass light | `#d6b58d` |

Reference geometry: 54 px top bar, 72 px rail, 28 px status bar; editor columns around 240 px / flexible / 286 px. Treat these as initial visual anchors, not inflexible dimensions under zoom or accessibility settings. Carry over the source's light palette and comfortable/compact density, correcting contrast where necessary.

## Screen mapping and delivery

| Mockup surface | Production role | First functional step |
| --- | --- | --- |
| Home / Overview | Project state, attention, recent Changes | 03 shell; real summaries in 07 onward |
| Editor | Code-first workspace | 04–06 |
| Changes | Durable engineering register | 07 |
| Review | Candidate diff, criteria, decisions | 11 |
| Verify | Source-bound execution/evidence ledger | 10 |
| Rook | Sessions, activity, permissions, contextual composer | 08–09 |
| Context | Context Lens and System explorer | 13 |
| Tools | Skills and MCP configuration/visibility | 15 |
| Settings | Appearance, editor, workflow, privacy | 03 onward |

Use **Code, Changes, System** as conceptual perspectives, not an instruction to replace the reference rail with a new three-tab design. Keep the reference's screen vocabulary unless usability testing warrants a documented adjustment. Review remains a Change subview, not a separate disconnected workflow.

## Deliberate production improvements

1. Replace mock editor view/edit mode with continuously editable Monaco; no Edit file gate for ordinary source.
2. Replace fake macOS traffic lights with platform-correct native window controls and tested drag regions.
3. Adapt Cmd/Ctrl labels, title bars, menus, scale, and paths to the OS.
4. Replace fixed hidden inspectors at narrow widths with accessible collapse/reopen or drawer behavior; never hide approval/permission actions without another route.
5. Preserve editor/terminal state across navigation; do not port the prototype's full innerHTML re-render pattern.
6. Replace hardcoded atlas/CH-024 data, metrics, logs, and statuses with real service state. Fixtures are allowed only in explicitly labeled test/demo contexts.
7. Keep source identity, stale evidence, workspace ownership, and permission scope visible.
8. Add loading, empty, disconnected, failed, stale, blocked, and interrupted states.
9. Use production font sizes/contrast validated for prolonged use; do not blindly copy tiny metadata text.
10. Retain the desktop focus; narrow-window support is not a mobile/PWA commitment.

## Visual acceptance procedure

- Use deterministic fixture data and documented viewport, scale, OS, and font setup.
- Compare shell, Editor, Changes/Review, Verify, and Rook with relevant preview images/source.
- Check hierarchy, density, panel alignment, typography, accents, and navigation before polishing minor pixels.
- Verify both themes, both densities, keyboard focus, zoom, reduced motion, and minimum supported desktop window.
- Record intentional deviations with accessibility/platform/functionality rationale.
- Do not replace this reference with generic dashboard cards, AI gradients, or a chat-first layout.
