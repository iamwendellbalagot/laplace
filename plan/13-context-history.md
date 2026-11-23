# 13 — Context Lens, System explorer, and history

Status: Not started  
Depends on: [12](12-daily-workflow.md)  
Next: [14 — Behavior comparison](14-behavior-comparison.md)

## Outcome

Navigate from selected source to real relationships and historical intent without losing editor context. Prefer useful observed relationships to decorative or speculative architecture.

## Tasks

- [ ] Populate Editor Context Lens with active symbol, definitions, references, diagnostics, and related files.
- [ ] Link related tests only through declared/observed relationships or clearly labeled inference.
- [ ] Populate History from durable Changes, source snapshots, reviews, and decisions.
- [ ] Add peek-and-return navigation and expand Lens into the Context/System perspective.
- [ ] Introduce a navigable component/capability explorer with source provenance.
- [ ] Label relationships Observed, Inferred, or Developer-confirmed; do not present these categories as numeric confidence guarantees.
- [ ] Let developers correct/pin useful descriptions and persist confirmation provenance.
- [ ] Invalidate stale inferred relationships when their underlying source changes.
- [ ] Add Tree-sitter indexing only where a documented need is not met by LSP.
- [ ] Keep indexing incremental, cancellable, bounded, and isolated from editor responsiveness.

## UI reference

Use preview-context.png and Editor Context/History inspector. Preserve the restrained source-linked map/detail treatment, but do not hardcode the three authentication nodes or their inferred architecture. A useful list with source links is preferable to a misleading diagram.

## Checks and exit gate

- [ ] Selected symbol → references/tests where supported → related Change → return to source works without losing position.
- [ ] Every observed relationship has navigable source provenance.
- [ ] Inferred and developer-confirmed relationships remain visually distinguishable.
- [ ] Corrections survive restart and stale data is marked appropriately.
- [ ] Large/index-changing fixtures do not freeze editing; cancellation stops unnecessary work.
