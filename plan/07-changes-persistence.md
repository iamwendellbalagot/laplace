# 07 — Persistent Changes and domain state

Status: Not started  
Depends on: [06](06-terminal-git.md)  
Next: [08 — Rook](08-rook-delegation.md)

## Outcome

Durable engineering records survive UI navigation, application restart, and agent-session replacement. A Change does not require an agent or a large specification.

## Tasks

- [ ] Introduce SQLx/SQLite migrations with schema/version/error handling and transactional writes.
- [ ] Persist Project, Workspace, Change, AgentSessionLink, snapshot/execution/artifact identities, reviews, integration attempts, and recipe versions as needed by subsequent steps.
- [ ] Keep early migrations focused; do not build an unrestricted generic event-sourcing platform.
- [ ] Enforce independent Change, agent, and verification state machines from architecture.md.
- [ ] Implement lightweight Change creation, objective editing, optional constraints/criteria, archive/abandon, and reopening review.
- [ ] Build Change register filters and selected Change overview using real records.
- [ ] Add a compact activity journal and snapshot/event UI synchronization with duplicate/out-of-order handling.
- [ ] Link sessions without making their transcripts the sole record of intent or decisions.
- [ ] Add artifact metadata/storage boundaries, initial quotas, and retention configuration.
- [ ] Restore navigation and reconcile interrupted durable operations on startup.
- [ ] Populate Home attention/recent-work summaries from real domain queries.

## UI reference

Use preview-changes.png, preview-overview.png and renderChanges/renderOverview as visual references. Preserve the compact register and editorial hierarchy; replace hardcoded IDs/status/counts with real data and honest empty states. New Change should start from a sentence, not a mandatory multi-section form.

## Checks and exit gate

- [ ] Create/edit/reopen/abandon a Change and recover it after restart.
- [ ] Test migrations from earlier fixtures, failed transactions, disk-full behavior, and event replay deduplication.
- [ ] Illegal state transitions fail in backend tests even if invoked outside the ordinary UI.
- [ ] Failure of a linked session does not delete or incorrectly integrate/abandon its Change.
- [ ] Home and register agree on state after navigation and restart.

Full manual-edit import is step 12. Data fields for approval/evidence are not proof those workflows are implemented yet.
