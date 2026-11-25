# 14 — Narrow behavior comparison

Status: Completed (automated unit/type/build verified; manual desktop smoke pending)
Depends on: [13](13-context-history.md); technical foundations are steps 09–11  
Next: [15 — Skills and MCP](15-skills-mcp.md)

## Outcome

Compare controlled observable baseline/candidate results without implying general behavioral equivalence. Select one comparison adapter first, not a universal framework.

## Tasks

- [x] Choose an initial useful adapter: structured test results, CLI snapshots, or deterministic API fixtures.
- [x] Define recorded input, baseline/candidate source IDs, environment/toolchain, dependencies, and output artifacts.
- [x] Run both sides through the same permission and evidence recording rules; baseline code is still executable untrusted code.
- [x] Use isolated fixtures/state and explicitly identify shared services or contamination risks.
- [x] Expose normalization rules; do not hide meaningful differences under noise filtering.
- [x] Display equal/different/missing/failed/inconclusive outcomes with raw artifact navigation.
- [x] Attach comparisons to the relevant Change and acceptance criteria.
- [x] Preserve baseline failures rather than suppressing them to make the candidate look successful.
- [x] Defer screenshot and performance comparison until noise/environment controls are justified.

## UI reference

Extend Verify execution details and Change review. Reuse evidence rows, source panels, and diff hierarchy; avoid a disconnected new dashboard.

## Checks and exit gate

- [x] Demonstrate a reproducible difference and a reproducible unchanged result on known inputs.
- [x] Baseline failure, candidate failure, missing artifact, source mutation, and differing environment are visible.
- [x] Raw outputs and normalization settings explain the comparison result.
- [x] UI language states what was observed and what was not checked.
