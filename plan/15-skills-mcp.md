# 15 — Skills, MCP, and capability provenance

Status: Not started  
Depends on: [14](14-behavior-comparison.md) in the default sequence; requires real Rook support from 08  
Next: [16 — Cross-platform beta](16-release-hardening.md)

## Outcome

Developers can inspect and configure what Rook can access, where capabilities came from, and how they were used without creating a competing tool runtime in Laplace.

## Tasks

- [ ] Present user/project SKILL.md sources, effective precedence, enablement, and trust based on actual Rook behavior.
- [ ] Support inspecting skill instructions/origin without executing them.
- [ ] Add MCP server configuration, supported transport settings, connection lifecycle, tool discovery, and actionable errors.
- [ ] Show enabled/configured/connected/authorized as distinct concepts.
- [ ] Present applicable scopes and permission requests without bypassing harness enforcement.
- [ ] Store application-owned secrets in credential storage; respect harness-owned configuration/credential boundaries.
- [ ] Warn on untrusted project capability changes; review effective config before activation.
- [ ] Link tool/skill invocations to Change activity and evidence where applicable.
- [ ] Show unsupported capabilities explicitly rather than toggles that only update UI state.
- [ ] Avoid marketplace/distribution infrastructure and generic extension APIs in this scope.

## UI reference

Use preview-capabilities.png, Skills/MCP tabs, capability rows, and the detail inspector. Preserve the principle that enabled is not authorized. Replace local demo switches with confirmed operations and pending/error states.

## Checks and exit gate

- [ ] Real supported skill/MCP configuration changes round-trip through Rook and survive restart.
- [ ] Denied operations remain denied despite tool output or skill instructions requesting broader access.
- [ ] Disconnected/invalid config/credential failures are actionable and do not masquerade as connected.
- [ ] Execution provenance links identify the actual source/configuration used.
- [ ] Secrets do not appear in ordinary logs, exported Change records, or UI screenshots.
