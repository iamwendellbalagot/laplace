# 13 — Context Lens, System explorer, and history

Status: Implemented (manual macOS desktop smoke pending)
Depends on: [12](12-daily-workflow.md)
Next: [14 — Behavior comparison](14-behavior-comparison.md)

## Outcome

Navigate from selected source to real relationships and historical intent without losing editor context. Prefer useful observed relationships to decorative or speculative architecture.

## Tasks

- [x] Populate Editor Context Lens with active symbol, definitions, references, diagnostics, and related files.
- [x] Link related tests only through declared/observed relationships or clearly labeled inference.
- [x] Populate History from durable Review checkpoints/notes, Git commits (`git log --follow`), and Verify executions.
- [x] Add peek-and-return navigation and expand Lens into the Context/System perspective.
- [x] Introduce a navigable component/capability explorer with source provenance.
- [x] Label relationships Observed, Inferred, or Developer-confirmed; do not present these categories as numeric confidence guarantees.
- [x] Let developers correct/pin useful descriptions and persist confirmation provenance.
- [x] Invalidate stale inferred relationships and developer confirmations when their underlying source changes.
- [x] Add Tree-sitter indexing only where a documented need is not met by LSP (intentionally deferred: Monaco TypeScript worker + bounded incremental Rust static scanner covers TS/JS/Rust/Python/Go without native grammar build overhead).
- [x] Keep indexing incremental, cancellable, bounded, and isolated from editor responsiveness.

## UI reference

Use preview-context.png and Editor Context/History inspector. Preserve the restrained source-linked map/detail treatment, but do not hardcode the three authentication nodes or their inferred architecture. A useful list with source links is preferable to a misleading diagram.

## Checks and exit gate

- [x] Selected symbol → references/tests where supported → return to source works without losing position (verified via Rust/TS unit tests; manual macOS smoke pending).
- [x] Every observed relationship has navigable source provenance.
- [x] Inferred and developer-confirmed relationships remain visually distinguishable.
- [x] Corrections survive restart and stale data is marked appropriately.
- [x] Large/index-changing fixtures do not freeze editing; cancellation stops unnecessary work (bounded 2,000-file / 256 KiB scan on `spawn_blocking` with `AtomicU64` generation cancellation).
