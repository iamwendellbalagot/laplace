import { useCallback, useEffect, useState } from "react";
import type { AppService } from "../../services/app-service";
import type {
  CapabilitiesSnapshot,
  ProjectSummary,
  SkillInspectResult,
} from "../../services/contracts";
import {
  capabilityMonogram,
  mcpStatePills,
  parityStatusLabel,
} from "./tools-helpers";

type ToolsTab = "skills" | "mcp" | "parity";

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

export function ToolsScreen({
  service,
  project,
  workspaceTrusted,
  onTrustWorkspace,
  onOpenRookWorkspace,
  onOpenRookTerminal,
}: {
  service: AppService;
  project: ProjectSummary;
  workspaceTrusted: boolean;
  onTrustWorkspace: () => Promise<void>;
  onOpenRookWorkspace: () => void;
  onOpenRookTerminal: (command?: string) => void;
}) {
  const [tab, setTab] = useState<ToolsTab>("skills");
  const [snapshot, setSnapshot] = useState<CapabilitiesSnapshot>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();

  const [selectedSkillKey, setSelectedSkillKey] = useState<string>();
  const [inspectedSkill, setInspectedSkill] = useState<SkillInspectResult>();
  const [inspectLoading, setInspectLoading] = useState(false);

  const [selectedMcpName, setSelectedMcpName] = useState<string>();
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScope, setNewScope] = useState<"global" | "project">("global");
  const [newTransport, setNewTransport] = useState<"stdio" | "http">("stdio");
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await service.getCapabilitiesSnapshot(project.id);
      setSnapshot(next);
      if (next.skills.length > 0) {
        setSelectedSkillKey((current) =>
          current && next.skills.some((s) => `${s.scope}:${s.name}` === current)
            ? current
            : `${next.skills[0].scope}:${next.skills[0].name}`,
        );
      } else {
        setSelectedSkillKey(undefined);
      }
      if (next.mcpServers.length > 0) {
        setSelectedMcpName((current) =>
          current && next.mcpServers.some((s) => s.name === current)
            ? current
            : next.mcpServers[0].name,
        );
      } else {
        setSelectedMcpName(undefined);
      }
    } catch (failure) {
      setError(errorText(failure, "Capabilities could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [project.id, service]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot, workspaceTrusted]);

  const selectedSkill = snapshot?.skills.find(
    (s) => `${s.scope}:${s.name}` === selectedSkillKey,
  );
  const selectedMcp = snapshot?.mcpServers.find(
    (s) => s.name === selectedMcpName,
  );

  useEffect(() => {
    setInspectedSkill(undefined);
  }, [selectedSkillKey]);

  async function handleInspectSkill() {
    if (!selectedSkill) return;
    setInspectLoading(true);
    setError(undefined);
    try {
      const result = await service.inspectSkillSource(
        project.id,
        selectedSkill.name,
        selectedSkill.scope === "project" ? "project" : "global",
      );
      setInspectedSkill(result);
    } catch (failure) {
      setError(errorText(failure, "SKILL.md could not be inspected."));
    } finally {
      setInspectLoading(false);
    }
  }

  async function handleToggleMcp(
    name: string,
    scope: string,
    enabled: boolean,
  ) {
    setPending(true);
    setError(undefined);
    setStatusMessage(undefined);
    try {
      const updated = await service.updateMcpServerConfig(project.id, {
        action: "toggle",
        scope: scope === "project" ? "project" : "global",
        name,
        enabled,
      });
      setSnapshot(updated);
      setStatusMessage(
        `${enabled ? "Enabled" : "Disabled"} MCP server "${name}" in ${scope} mcp.json.`,
      );
    } catch (failure) {
      setError(errorText(failure, `Could not update MCP server "${name}".`));
    } finally {
      setPending(false);
    }
  }

  async function handleAddMcp() {
    if (!newName.trim()) {
      setError("Server name is required.");
      return;
    }
    setPending(true);
    setError(undefined);
    setStatusMessage(undefined);
    try {
      const updated = await service.updateMcpServerConfig(project.id, {
        action: "add",
        scope: newScope,
        name: newName.trim(),
        transport: newTransport,
        ...(newTransport === "stdio"
          ? {
              command: newCommand.trim(),
              args: newArgs.trim().split(/\s+/).filter(Boolean),
            }
          : { url: newUrl.trim() }),
      });
      setSnapshot(updated);
      setSelectedMcpName(newName.trim());
      setShowAddMcp(false);
      setNewName("");
      setNewCommand("");
      setNewArgs("");
      setNewUrl("");
      setStatusMessage(
        `Saved "${newName.trim()}" to ${newScope} mcp.json via Rook.`,
      );
    } catch (failure) {
      setError(errorText(failure, "MCP server could not be saved."));
    } finally {
      setPending(false);
    }
  }

  async function handleRemoveMcp(name: string, scope: string) {
    if (!window.confirm(`Remove MCP server "${name}" from ${scope} mcp.json?`))
      return;
    setPending(true);
    setError(undefined);
    setStatusMessage(undefined);
    try {
      const updated = await service.updateMcpServerConfig(project.id, {
        action: "remove",
        scope: scope === "project" ? "project" : "global",
        name,
      });
      setSnapshot(updated);
      setStatusMessage(`Removed "${name}" from ${scope} mcp.json.`);
    } catch (failure) {
      setError(errorText(failure, `Could not remove MCP server "${name}".`));
    } finally {
      setPending(false);
    }
  }

  async function handleAcknowledgeProjectCaps() {
    setPending(true);
    setError(undefined);
    try {
      const updated = await service.acknowledgeWorkspaceCapabilities(
        project.id,
      );
      setSnapshot(updated);
      setStatusMessage("Recorded review of current workspace capabilities.");
    } catch (failure) {
      setError(errorText(failure, "Could not save capability review."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="content-page tools-page" aria-labelledby="screen-title">
      <header className="tools-header">
        <div>
          <span className="eyebrow">06 / Agent capabilities</span>
          <h1 id="screen-title" className="tools-title">
            Tools &amp; capabilities.
          </h1>
          <p className="tools-subtitle">
            Inspect what Rook can access, where each capability comes from, and
            what authority it carries. Enabled tools are never a substitute for
            permission.
          </p>
        </div>
        <div className="tools-header-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onOpenRookWorkspace}
          >
            Open Rook workspace ↗
          </button>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => onOpenRookTerminal("rook")}
          >
            Rook Terminal ↗
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setTab("mcp");
              setShowAddMcp((open) => !open);
            }}
          >
            + Add MCP server
          </button>
        </div>
      </header>

      {snapshot?.unreviewedProjectChanges && (
        <div
          className="tools-warning-banner"
          role="alert"
          aria-label="Unreviewed workspace capability definitions"
        >
          <div>
            <strong>
              Workspace defines or modified capabilities (
              {snapshot.changedProjectAreas.join(", ")}).
            </strong>{" "}
            Review effective configuration below before trusting or activating
            project-scoped capabilities.
          </div>
          <div className="tools-warning-actions">
            {!workspaceTrusted && (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => void onTrustWorkspace()}
              >
                Trust workspace
              </button>
            )}
            <button
              type="button"
              className="button button-primary"
              disabled={pending}
              onClick={() => void handleAcknowledgeProjectCaps()}
            >
              Mark reviewed
            </button>
          </div>
        </div>
      )}

      <div className="tools-toolbar">
        <div
          className="tools-tabs"
          role="tablist"
          aria-label="Capability categories"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "skills"}
            className={`tools-tab${tab === "skills" ? " is-active" : ""}`}
            onClick={() => setTab("skills")}
          >
            Skills{" "}
            <span>{String(snapshot?.skills.length ?? 0).padStart(2, "0")}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "mcp"}
            className={`tools-tab${tab === "mcp" ? " is-active" : ""}`}
            onClick={() => setTab("mcp")}
          >
            MCP servers{" "}
            <span>
              {String(snapshot?.mcpServers.length ?? 0).padStart(2, "0")}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "parity"}
            className={`tools-tab${tab === "parity" ? " is-active" : ""}`}
            onClick={() => setTab("parity")}
          >
            Providers &amp; Parity
          </button>
        </div>
        <div className="tools-runtime-meta">
          <span>
            {snapshot?.runtimeSource === "rook_stdio"
              ? "LIVE ROOK STDIO / MANAGED BY ROOK"
              : "READ-ONLY DISK SCAN / OPEN ROOK TO EDIT MCP"}
          </span>
          <button
            type="button"
            className="button button-quiet"
            disabled={loading}
            onClick={() => void loadSnapshot()}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {statusMessage && (
        <p className="tools-status-note" role="status">
          {statusMessage}
        </p>
      )}

      {tab === "skills" && (
        <div className="tools-grid">
          <div className="tools-list-column">
            {loading ? (
              <p className="tools-empty">Scanning Rook skill directories…</p>
            ) : (snapshot?.skills.length ?? 0) === 0 ? (
              <div className="tools-empty-box">
                <p>No Rook skills discovered in project or global scope.</p>
                <small>
                  Project: <code>{snapshot?.skillDirectories.project}</code>
                  <br />
                  Global: <code>{snapshot?.skillDirectories.global}</code>
                </small>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => onOpenRookTerminal("rook skills list")}
                >
                  Manage skills in Rook Terminal ↗
                </button>
              </div>
            ) : (
              <ul className="tools-row-list">
                {snapshot!.skills.map((skill) => {
                  const key = `${skill.scope}:${skill.name}`;
                  const active = key === selectedSkillKey;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className={`tools-row${active ? " is-selected" : ""}`}
                        onClick={() => setSelectedSkillKey(key)}
                      >
                        <span className="tools-monogram" aria-hidden="true">
                          {capabilityMonogram(skill.name)}
                        </span>
                        <span className="tools-row-main">
                          <strong>{skill.name}</strong>
                          <span className="tools-row-desc">
                            {skill.description ||
                              "Skill instructions loaded by Rook from SKILL.md"}
                          </span>
                          <span className="tools-row-meta">
                            {skill.scope === "project" ? "Project" : "Global"} /{" "}
                            {skill.precedence === "active"
                              ? "Active precedence"
                              : "Shadowed by project"}
                          </span>
                        </span>
                        <span
                          className={`verify-status-pill verify-status-${skill.precedence === "active" ? "passed" : "stale"}`}
                        >
                          {skill.precedence}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="tools-footnote">
              Skills are discovered from Rook&apos;s managed directories.
              Inspecting a skill reads <code>SKILL.md</code> as plain text
              without executing commands.
            </p>
          </div>

          <aside className="tools-inspector" aria-label="Skill details">
            {selectedSkill ? (
              <>
                <span className="eyebrow">Skill details</span>
                <h2>{selectedSkill.name}</h2>
                <p className="tools-inspector-desc">
                  {selectedSkill.description ||
                    "No description in frontmatter."}
                </p>
                <dl className="tools-dl">
                  <div>
                    <dt>Origin</dt>
                    <dd>
                      {selectedSkill.scope === "project"
                        ? "Project (.rook/skills)"
                        : "Global (~/.rook/skills)"}
                    </dd>
                  </div>
                  <div>
                    <dt>Precedence</dt>
                    <dd>{selectedSkill.precedence}</dd>
                  </div>
                  <div>
                    <dt>Authority</dt>
                    <dd>Instructions only (policy enforced)</dd>
                  </div>
                  <div>
                    <dt>Digest</dt>
                    <dd>
                      <code>{selectedSkill.digest.slice(0, 12) || "—"}</code>
                    </dd>
                  </div>
                </dl>
                <p className="tools-path-note">
                  <code>{selectedSkill.skillFilePath}</code>
                </p>
                <div className="tools-inspector-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={inspectLoading}
                    onClick={() => void handleInspectSkill()}
                  >
                    {inspectLoading
                      ? "Reading SKILL.md…"
                      : "Inspect SKILL.md (read-only)"}
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => onOpenRookTerminal("rook skills list")}
                  >
                    Install / Remove in Terminal ↗
                  </button>
                </div>
                {inspectedSkill && (
                  <div className="tools-skill-preview">
                    <span className="eyebrow">
                      Read-only SKILL.md preview
                      {inspectedSkill.truncated ? " (truncated at 64 KiB)" : ""}
                    </span>
                    <pre>{inspectedSkill.content}</pre>
                  </div>
                )}
                <div className="tools-trust-callout">
                  <span className="eyebrow">Trust boundary</span>
                  <p>
                    Skill instructions are untrusted text. Denied operations
                    remain denied even if a skill requests broader access.
                  </p>
                </div>
              </>
            ) : (
              <p className="tools-empty">
                Select a skill to inspect its origin.
              </p>
            )}
          </aside>
        </div>
      )}

      {tab === "mcp" && (
        <div className="tools-grid">
          <div className="tools-list-column">
            {showAddMcp && (
              <form
                className="tools-add-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAddMcp();
                }}
              >
                <span className="eyebrow">
                  Add MCP server (writes mcp.json via Rook)
                </span>
                <div className="tools-add-grid">
                  <label>
                    Name
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="docs"
                    />
                  </label>
                  <label>
                    Scope
                    <select
                      value={newScope}
                      onChange={(e) =>
                        setNewScope(e.target.value as "global" | "project")
                      }
                    >
                      <option value="global">
                        Global (~/.pi/agent/mcp.json)
                      </option>
                      <option value="project" disabled={!workspaceTrusted}>
                        Project (.pi/mcp.json)
                        {!workspaceTrusted ? " — trust required" : ""}
                      </option>
                    </select>
                  </label>
                  <label>
                    Transport
                    <select
                      value={newTransport}
                      onChange={(e) =>
                        setNewTransport(e.target.value as "stdio" | "http")
                      }
                    >
                      <option value="stdio">stdio (local command)</option>
                      <option value="http">HTTP(S) URL</option>
                    </select>
                  </label>
                </div>
                {newTransport === "stdio" ? (
                  <div className="tools-add-grid">
                    <label>
                      Command
                      <input
                        value={newCommand}
                        onChange={(e) => setNewCommand(e.target.value)}
                        placeholder="npx"
                      />
                    </label>
                    <label>
                      Arguments
                      <input
                        value={newArgs}
                        onChange={(e) => setNewArgs(e.target.value)}
                        placeholder="-y @modelcontextprotocol/server-filesystem ."
                      />
                    </label>
                  </div>
                ) : (
                  <label>
                    HTTP(S) endpoint URL (no embedded credentials)
                    <input
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      placeholder="https://example.com/mcp"
                    />
                  </label>
                )}
                <div className="tools-add-actions">
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={pending}
                  >
                    {pending ? "Saving…" : "Save to mcp.json"}
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => setShowAddMcp(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {(snapshot?.mcpErrors.length ?? 0) > 0 && (
              <ul
                className="compare-warning-list"
                aria-label="MCP configuration errors"
              >
                {snapshot!.mcpErrors.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
            )}

            {(snapshot?.mcpServers.length ?? 0) === 0 ? (
              <div className="tools-empty-box">
                <p>No MCP servers configured in global or project mcp.json.</p>
                <small>
                  Global: <code>{snapshot?.mcpConfigPaths.global}</code>
                  <br />
                  Project: <code>{snapshot?.mcpConfigPaths.project}</code>
                </small>
              </div>
            ) : (
              <ul className="tools-row-list">
                {snapshot!.mcpServers.map((server) => {
                  const active = server.name === selectedMcpName;
                  return (
                    <li key={`${server.scope}:${server.name}`}>
                      <div
                        className={`tools-row${active ? " is-selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedMcpName(server.name)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedMcpName(server.name);
                          }
                        }}
                      >
                        <span className="tools-monogram" aria-hidden="true">
                          {capabilityMonogram(server.name)}
                        </span>
                        <span className="tools-row-main">
                          <strong>{server.name}</strong>
                          <span className="tools-row-desc">
                            <code>{server.target}</code>
                          </span>
                          <span className="tools-row-meta">
                            {server.scope === "project" ? "Project" : "Global"}{" "}
                            / {server.transport} /{" "}
                            {server.connected ? "Connected" : "Not connected"}
                          </span>
                        </span>
                        <label
                          className="tools-switch-label"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={`Enable ${server.name} in ${server.scope} mcp.json`}
                            checked={server.configEnabled}
                            disabled={
                              pending ||
                              (server.scope === "project" && !workspaceTrusted)
                            }
                            onChange={(event) =>
                              void handleToggleMcp(
                                server.name,
                                server.scope,
                                event.target.checked,
                              )
                            }
                          />
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="tools-footnote">
              Changes write directly to Rook/Pi&apos;s <code>mcp.json</code> via
              Rook stdio and survive restart. Laplace stdio sessions keep{" "}
              <code>arbitraryMcp: false</code>; use Rook Terminal to connect and
              authorize live MCP tools.
            </p>
          </div>

          <aside className="tools-inspector" aria-label="MCP server details">
            {selectedMcp ? (
              <>
                <span className="eyebrow">MCP server details</span>
                <h2>{selectedMcp.name}</h2>
                <div className="tools-state-pills">
                  {mcpStatePills(selectedMcp).map((pill) => (
                    <div key={pill.dimension} className="tools-state-pill-row">
                      <span>{pill.dimension}</span>
                      <span
                        className={`verify-status-pill verify-status-${pill.tone}`}
                      >
                        {pill.value}
                      </span>
                    </div>
                  ))}
                </div>
                <dl className="tools-dl">
                  <div>
                    <dt>Origin</dt>
                    <dd>{selectedMcp.scope}</dd>
                  </div>
                  <div>
                    <dt>Transport</dt>
                    <dd>{selectedMcp.transport}</dd>
                  </div>
                  <div>
                    <dt>Target</dt>
                    <dd>
                      <code>{selectedMcp.target}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Exposure</dt>
                    <dd>{selectedMcp.exposure}</dd>
                  </div>
                </dl>
                <p className="tools-path-note">
                  Source: <code>{selectedMcp.sourcePath}</code>
                  {selectedMcp.overridePath && (
                    <>
                      <br />
                      Project override: <code>{selectedMcp.overridePath}</code>
                    </>
                  )}
                </p>
                {selectedMcp.redactedHeaders.length > 0 && (
                  <p className="tools-path-note">
                    Secrets redacted: {selectedMcp.redactedHeaders.join(", ")}
                  </p>
                )}
                <p className="tools-inspector-desc">
                  {selectedMcp.connectionNote}
                </p>
                {selectedMcp.errors.length > 0 && (
                  <ul className="compare-warning-list">
                    {selectedMcp.errors.map((err) => (
                      <li key={err}>{err}</li>
                    ))}
                  </ul>
                )}
                <div className="tools-inspector-actions">
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => onOpenRookTerminal("rook")}
                  >
                    Connect in Rook Terminal ↗
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={
                      pending ||
                      (selectedMcp.scope === "project" && !workspaceTrusted)
                    }
                    onClick={() =>
                      void handleRemoveMcp(selectedMcp.name, selectedMcp.scope)
                    }
                  >
                    Remove
                  </button>
                </div>
                <div className="tools-trust-callout">
                  <span className="eyebrow">Trust boundary</span>
                  <p>{selectedMcp.authorizationNote}</p>
                </div>
              </>
            ) : (
              <p className="tools-empty">
                Select an MCP server to inspect its configuration and status.
              </p>
            )}
          </aside>
        </div>
      )}

      {tab === "parity" && (
        <div className="tools-parity-layout">
          <section className="tools-parity-card">
            <div className="tools-parity-head">
              <div>
                <span className="eyebrow">
                  Rook-owned provider configuration
                </span>
                <p className="tools-inspector-desc">
                  Credentials stay in Rook/Pi storage. Laplace never stores
                  provider API keys or executes a competing provider runtime.
                </p>
              </div>
              <button
                type="button"
                className="button button-quiet"
                onClick={onOpenRookWorkspace}
              >
                Sign in / Select model in Rook ↗
              </button>
            </div>
            {(snapshot?.workspaceProviders.length ?? 0) > 0 ? (
              <ul className="tools-provider-list">
                {snapshot!.workspaceProviders.map((provider) => (
                  <li key={provider.id}>
                    <strong>{provider.id}</strong>
                    <span>
                      Workspace <code>models.json</code> ·{" "}
                      {provider.endpoint ?? "(no custom endpoint)"} ·
                      fingerprint <code>{provider.endpointFingerprint}</code>
                    </span>
                    {provider.missingEnvironmentVariables.length > 0 && (
                      <small>
                        Missing env vars:{" "}
                        {provider.missingEnvironmentVariables.join(", ")}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="tools-empty">
                No workspace-defined providers in <code>models.json</code>.
                Active providers are configured in Rook.
              </p>
            )}
          </section>

          <section className="tools-parity-card">
            <span className="eyebrow">Rook feature-parity inventory</span>
            <ul className="tools-parity-list">
              {(snapshot?.parityInventory ?? []).map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.feature}</strong>
                    <p>{item.detail}</p>
                  </div>
                  <div className="tools-parity-right">
                    <span
                      className={`verify-status-pill verify-status-${item.status === "native" ? "passed" : item.status === "terminal_handoff" ? "stale" : "inconclusive"}`}
                    >
                      {parityStatusLabel(item.status)}
                    </span>
                    {item.terminalCommand && (
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() =>
                          onOpenRookTerminal(item.terminalCommand ?? "rook")
                        }
                      >
                        Run in Terminal ↗
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {(snapshot?.recentActivity.length ?? 0) > 0 && (
            <section className="tools-parity-card">
              <span className="eyebrow">Recent capability activity</span>
              <ul className="tools-activity-list">
                {snapshot!.recentActivity.slice(0, 12).map((act) => (
                  <li key={act.id}>
                    <strong>
                      {act.capabilityKind} · {act.capabilityName}
                    </strong>
                    <span>
                      {act.sourceScope} · {act.decision} · {act.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
