import { useEffect, useMemo, useState } from "react";
import type { AppService } from "../../services/app-service";
import type {
  ContextRelation,
  ProjectSummary,
  RookContextChip,
  RookMode,
  SystemContextSnapshot,
} from "../../services/contracts";
import {
  buildModuleContextChip,
  filterContextRelations,
  provenanceLabel,
  type ProvenanceFilter,
} from "./context-bundle";

export interface ReturnSourceAnchor {
  filePath: string;
  line: number;
  column?: number;
}

function formatDate(ms: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function ContextLensScreen({
  service,
  project,
  initialFocusPath,
  returnAnchor,
  syncVersion,
  onReturnToSource,
  onJumpToLocation,
  onAttachToRook,
}: {
  service: AppService;
  project: ProjectSummary;
  initialFocusPath?: string;
  returnAnchor?: ReturnSourceAnchor | null;
  syncVersion: number;
  onReturnToSource: () => void;
  onJumpToLocation: (
    relativePath: string,
    line: number,
    column?: number,
  ) => void;
  onAttachToRook: (chip: RookContextChip, mode?: RookMode) => void;
}) {
  const [snapshot, setSnapshot] = useState<SystemContextSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedModuleKey, setSelectedModuleKey] = useState<string>("");
  const [query, setQuery] = useState("");
  const [provenanceFilter, setProvenanceFilter] =
    useState<ProvenanceFilter>("all");
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const [savingAction, setSavingAction] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void service
      .getSystemContext(project.id)
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setSelectedModuleKey((current) => {
          if (current && next.modules.some((m) => m.key === current)) {
            return current;
          }
          if (initialFocusPath) {
            const matched = next.modules.find((m) =>
              m.files.includes(initialFocusPath),
            );
            if (matched) return matched.key;
          }
          return next.modules[0]?.key ?? "";
        });
      })
      .catch((failure) => {
        if (!cancelled) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Context Lens could not index this workspace.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [service, project.id, initialFocusPath, syncVersion, refreshTick]);

  const filteredModules = useMemo(() => {
    if (!snapshot) return [];
    const needle = query.trim().toLowerCase();
    return snapshot.modules.filter((mod) => {
      if (provenanceFilter === "stale" && !mod.annotation?.stale) return false;
      if (provenanceFilter === "developer_confirmed" && !mod.annotation) {
        return false;
      }
      if (!needle) return true;
      return (
        mod.key.toLowerCase().includes(needle) ||
        mod.label.toLowerCase().includes(needle) ||
        mod.files.some((f) => f.toLowerCase().includes(needle)) ||
        (mod.annotation?.summary.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [snapshot, query, provenanceFilter]);

  const selectedModule = useMemo(() => {
    if (!snapshot) return undefined;
    return (
      snapshot.modules.find((m) => m.key === selectedModuleKey) ??
      filteredModules[0] ??
      snapshot.modules[0]
    );
  }, [snapshot, selectedModuleKey, filteredModules]);

  useEffect(() => {
    setEditingNote(false);
    setNoteDraft(selectedModule?.annotation?.summary ?? "");
  }, [selectedModule?.key, selectedModule?.annotation?.summary]);

  const upstreamEdges = useMemo(() => {
    if (!snapshot || !selectedModule) return [];
    return snapshot.edges.filter((e) => e.targetModule === selectedModule.key);
  }, [snapshot, selectedModule]);

  const downstreamEdges = useMemo(() => {
    if (!snapshot || !selectedModule) return [];
    return snapshot.edges.filter((e) => e.sourceModule === selectedModule.key);
  }, [snapshot, selectedModule]);

  const visibleRelations = useMemo(() => {
    if (!snapshot) return [];
    const scoped = selectedModule
      ? snapshot.relationships.filter(
          (rel) =>
            selectedModule.files.includes(rel.sourcePath) ||
            selectedModule.files.includes(rel.targetPath),
        )
      : snapshot.relationships;
    const base =
      query.trim() || provenanceFilter !== "all"
        ? snapshot.relationships
        : scoped.length > 0
          ? scoped
          : snapshot.relationships;
    return filterContextRelations(base, query, provenanceFilter);
  }, [snapshot, selectedModule, query, provenanceFilter]);

  async function handleSaveModuleNote() {
    if (!selectedModule || !noteDraft.trim()) return;
    setSavingAction(true);
    setError(undefined);
    try {
      await service.saveContextAnnotation(
        project.id,
        "module",
        selectedModule.key,
        noteDraft.trim(),
      );
      setEditingNote(false);
      setRefreshTick((n) => n + 1);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Module note could not be saved.",
      );
    } finally {
      setSavingAction(false);
    }
  }

  async function handleDeleteModuleNote() {
    if (!selectedModule) return;
    setSavingAction(true);
    try {
      await service.deleteContextAnnotation(
        project.id,
        "module",
        selectedModule.key,
      );
      setEditingNote(false);
      setNoteDraft("");
      setRefreshTick((n) => n + 1);
    } finally {
      setSavingAction(false);
    }
  }

  async function handleConfirmRelation(rel: ContextRelation) {
    setSavingAction(true);
    setError(undefined);
    const kind =
      rel.relationKind === "calls" ||
      rel.relationKind === "imports" ||
      rel.relationKind === "tests" ||
      rel.relationKind === "documents" ||
      rel.relationKind === "depends_on"
        ? rel.relationKind
        : "depends_on";
    try {
      await service.saveContextPinnedLink(
        project.id,
        rel.sourcePath,
        rel.targetPath,
        kind,
        rel.evidence,
      );
      setRefreshTick((n) => n + 1);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Relationship could not be confirmed.",
      );
    } finally {
      setSavingAction(false);
    }
  }

  async function handleUnpinRelation(linkId: string) {
    setSavingAction(true);
    try {
      await service.deleteContextPinnedLink(project.id, linkId);
      setRefreshTick((n) => n + 1);
    } finally {
      setSavingAction(false);
    }
  }

  async function handleCancelScan() {
    await service.cancelContextIndex(project.id).catch(() => false);
    setLoading(false);
  }

  return (
    <section
      className="content-page context-lens-page"
      aria-labelledby="screen-title"
    >
      <header className="context-lens-header">
        <div>
          <span className="eyebrow">System understanding</span>
          <h1 id="screen-title">Context Lens</h1>
          <p className="context-lens-subtitle">
            A navigable map from observed source imports, inferred matches, and
            developer-confirmed records. Evidence categories stay visually
            distinct.
          </p>
        </div>
        <div className="context-lens-header-actions">
          {loading ? (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => void handleCancelScan()}
            >
              Cancel scan
            </button>
          ) : (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => setRefreshTick((n) => n + 1)}
            >
              Re-index
            </button>
          )}
          <button
            type="button"
            className="button button-quiet"
            onClick={onReturnToSource}
            title={
              returnAnchor
                ? `Return to ${returnAnchor.filePath}:${returnAnchor.line}`
                : "Return to Editor"
            }
          >
            {returnAnchor
              ? `Return to ${returnAnchor.filePath.split("/").at(-1)}:${returnAnchor.line} ↗`
              : "Return to source ↗"}
          </button>
        </div>
      </header>

      <div className="context-lens-toolbar">
        <input
          type="search"
          className="context-search-input"
          aria-label="Filter modules and source relationships"
          placeholder="Filter modules, files, or relationships…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <div
          className="context-filter-pills"
          role="group"
          aria-label="Filter by evidence category"
        >
          {(
            [
              ["all", "All"],
              ["observed", "Observed"],
              ["inferred", "Inferred"],
              ["developer_confirmed", "Confirmed"],
              ["stale", "Stale"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`button button-quiet context-filter-btn${provenanceFilter === value ? " is-active" : ""}`}
              onClick={() => setProvenanceFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {snapshot && (
          <span className="context-index-meta mono">
            {snapshot.indexedFileCount} files
            {snapshot.truncated ? " (capped)" : ""}
            {snapshot.cancelled ? " · cancelled" : ""}
          </span>
        )}
      </div>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      {!snapshot && loading ? (
        <div className="empty-state">
          <h2>Indexing workspace…</h2>
          <p>
            Scanning observed imports and definitions for {project.name}. You
            can cancel at any time.
          </p>
        </div>
      ) : snapshot && snapshot.modules.length === 0 ? (
        <div className="empty-state">
          <h2>No indexable source files</h2>
          <p>
            No supported source files were found in {project.name} (skips
            node_modules, target, dist, and symlinks).
          </p>
        </div>
      ) : snapshot ? (
        <>
          <div className="context-explorer-split">
            <div className="context-explorer-canvas">
              <div className="context-canvas-bar">
                <span className="eyebrow">
                  System explorer /{" "}
                  {String(filteredModules.length).padStart(3, "0")} modules
                </span>
                <span className="eyebrow">Dependency direction →</span>
              </div>

              {selectedModule &&
                (upstreamEdges.length > 0 || downstreamEdges.length > 0) && (
                  <div
                    className="context-flow-strip"
                    aria-label="Observed module dependency flow"
                  >
                    <div className="context-flow-column">
                      <span className="context-sub-label">
                        Upstream callers ({upstreamEdges.length})
                      </span>
                      {upstreamEdges.length === 0 ? (
                        <span className="inspector-muted">
                          Entry / no observed callers
                        </span>
                      ) : (
                        upstreamEdges.slice(0, 5).map((edge) => (
                          <button
                            key={edge.id}
                            type="button"
                            className="context-flow-node"
                            title={`${edge.sampleSourcePath}:${edge.sampleSourceLine ?? 1} → ${edge.sampleTargetPath}`}
                            onClick={() =>
                              setSelectedModuleKey(edge.sourceModule)
                            }
                          >
                            <span className="mono">{edge.sourceModule}</span>
                            <span className="inspector-muted">
                              {edge.referenceCount}→
                            </span>
                          </button>
                        ))
                      )}
                    </div>

                    <div className="context-flow-focus">
                      <span className="eyebrow">Selected</span>
                      <strong>{selectedModule.label}</strong>
                      <span className="mono inspector-muted">
                        {selectedModule.key}
                      </span>
                    </div>

                    <div className="context-flow-column">
                      <span className="context-sub-label">
                        Dependencies ({downstreamEdges.length})
                      </span>
                      {downstreamEdges.length === 0 ? (
                        <span className="inspector-muted">
                          Leaf / no workspace imports
                        </span>
                      ) : (
                        downstreamEdges.slice(0, 5).map((edge) => (
                          <button
                            key={edge.id}
                            type="button"
                            className="context-flow-node"
                            title={`${edge.sampleSourcePath}:${edge.sampleSourceLine ?? 1} → ${edge.sampleTargetPath}`}
                            onClick={() =>
                              setSelectedModuleKey(edge.targetModule)
                            }
                          >
                            <span className="mono">{edge.targetModule}</span>
                            <span className="inspector-muted">
                              ←{edge.referenceCount}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

              <div
                className="context-module-grid"
                role="listbox"
                aria-label="Workspace modules"
              >
                {filteredModules.slice(0, 36).map((mod, idx) => {
                  const isSelected = selectedModule?.key === mod.key;
                  return (
                    <button
                      key={mod.key}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`context-module-card${isSelected ? " is-selected" : ""}`}
                      onClick={() => setSelectedModuleKey(mod.key)}
                    >
                      <div className="context-module-card-top">
                        <span className="eyebrow">
                          {String(idx + 1).padStart(2, "0")} / {mod.fileCount}{" "}
                          {mod.fileCount === 1 ? "file" : "files"}
                        </span>
                        <span className="context-pill-row">
                          {mod.annotation && (
                            <span className="provenance-pill provenance-developer_confirmed">
                              Confirmed
                            </span>
                          )}
                          {mod.annotation?.stale && (
                            <span className="provenance-pill provenance-stale">
                              Stale
                            </span>
                          )}
                        </span>
                      </div>
                      <strong className="context-module-title">
                        {mod.label}
                      </strong>
                      <span className="mono context-module-path">
                        {mod.key}
                      </span>
                      {mod.annotation ? (
                        <p className="context-module-note">
                          {mod.annotation.summary}
                        </p>
                      ) : (
                        <span className="inspector-muted">
                          {mod.incomingCount} in · {mod.outgoingCount} out
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedModule && (
              <aside
                className="context-detail-card"
                aria-label="Selected module details"
              >
                <span className="eyebrow">Selected module</span>
                <h2 className="context-detail-title">{selectedModule.label}</h2>
                <p className="mono inspector-muted">{selectedModule.key}</p>

                <dl className="context-detail-meta">
                  <div>
                    <dt>Provenance</dt>
                    <dd className="context-pill-row">
                      <span
                        className={`provenance-pill provenance-${selectedModule.annotation ? "developer_confirmed" : "observed"}`}
                      >
                        {selectedModule.annotation ? "Confirmed" : "Observed"}
                      </span>
                      {selectedModule.annotation?.stale && (
                        <span className="provenance-pill provenance-stale">
                          Stale
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Observed links</dt>
                    <dd className="mono">
                      {selectedModule.incomingCount} in ·{" "}
                      {selectedModule.outgoingCount} out
                    </dd>
                  </div>
                  <div>
                    <dt>Primary source</dt>
                    <dd>
                      <button
                        type="button"
                        className="text-link mono"
                        onClick={() =>
                          onJumpToLocation(selectedModule.primaryFile, 1, 1)
                        }
                      >
                        {selectedModule.primaryFile.split("/").at(-1)} ↗
                      </button>
                    </dd>
                  </div>
                </dl>

                <div className="context-detail-note-box">
                  <div className="inspector-card-head">
                    <span className="eyebrow">Developer description</span>
                    {selectedModule.annotation?.stale && (
                      <span className="inspector-muted">
                        Source changed since confirmation
                      </span>
                    )}
                  </div>
                  {editingNote ? (
                    <div className="context-note-editor">
                      <textarea
                        rows={3}
                        value={noteDraft}
                        placeholder="Describe this module's real responsibility…"
                        onChange={(e) => setNoteDraft(e.currentTarget.value)}
                      />
                      <div className="context-note-actions">
                        <button
                          type="button"
                          className="button button-primary context-mini-btn"
                          disabled={savingAction || !noteDraft.trim()}
                          onClick={() => void handleSaveModuleNote()}
                        >
                          {selectedModule.annotation?.stale
                            ? "Re-confirm"
                            : "Save"}
                        </button>
                        <button
                          type="button"
                          className="button button-quiet context-mini-btn"
                          onClick={() => setEditingNote(false)}
                        >
                          Cancel
                        </button>
                        {selectedModule.annotation && (
                          <button
                            type="button"
                            className="button button-quiet context-mini-btn"
                            onClick={() => void handleDeleteModuleNote()}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ) : selectedModule.annotation ? (
                    <>
                      <p className="inspector-hint">
                        {selectedModule.annotation.summary}
                      </p>
                      <button
                        type="button"
                        className="button button-quiet context-mini-btn"
                        onClick={() => setEditingNote(true)}
                      >
                        {selectedModule.annotation.stale
                          ? "Review & re-confirm"
                          : "Edit description"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="button button-quiet context-mini-btn"
                      onClick={() => setEditingNote(true)}
                    >
                      + Confirm module description
                    </button>
                  )}
                </div>

                <div className="context-detail-files">
                  <span className="eyebrow">
                    Files ({selectedModule.fileCount})
                  </span>
                  <ul className="context-link-list">
                    {selectedModule.files.slice(0, 14).map((path) => (
                      <li key={path}>
                        <button
                          type="button"
                          className="context-source-link"
                          onClick={() => onJumpToLocation(path, 1, 1)}
                        >
                          <span className="mono truncate">
                            {path.split("/").at(-1)}
                          </span>
                          <span className="inspector-muted">↗</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="context-detail-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() =>
                      onJumpToLocation(selectedModule.primaryFile, 1, 1)
                    }
                  >
                    Open source file ↗
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() =>
                      onAttachToRook(
                        buildModuleContextChip(selectedModule, [
                          ...upstreamEdges,
                          ...downstreamEdges,
                        ]),
                        "ask",
                      )
                    }
                  >
                    Attach module to Rook
                  </button>
                </div>
              </aside>
            )}
          </div>

          <section
            className="context-relations-section"
            aria-label="Source relationships"
          >
            <div className="context-relations-head">
              <h2>
                Source relationships /{" "}
                <span className="mono">
                  {String(visibleRelations.length).padStart(2, "0")}
                </span>
              </h2>
              <span className="eyebrow">Evidence labels are explicit</span>
            </div>
            {visibleRelations.length === 0 ? (
              <p className="inspector-hint">
                No relationships match the active filter.
              </p>
            ) : (
              <div className="context-relations-list">
                {visibleRelations.slice(0, 60).map((rel) => (
                  <div key={rel.id} className="context-relation-row">
                    <div className="context-relation-endpoints">
                      <button
                        type="button"
                        className="text-link mono"
                        onClick={() =>
                          onJumpToLocation(
                            rel.sourcePath,
                            rel.sourceLine ?? 1,
                            1,
                          )
                        }
                      >
                        {rel.sourcePath}
                        {rel.sourceLine ? `:${rel.sourceLine}` : ""}
                      </button>
                      <span className="context-relation-verb">
                        {rel.relationKind} →
                      </span>
                      <button
                        type="button"
                        className="text-link mono"
                        onClick={() => onJumpToLocation(rel.targetPath, 1, 1)}
                      >
                        {rel.targetPath}
                      </button>
                    </div>
                    <div className="context-relation-meta">
                      <span className="inspector-muted truncate">
                        {rel.evidence}
                      </span>
                      <span
                        className={`provenance-pill provenance-${rel.provenance}`}
                      >
                        {provenanceLabel(rel.provenance)}
                      </span>
                      {rel.stale && (
                        <span className="provenance-pill provenance-stale">
                          Stale
                        </span>
                      )}
                      {rel.provenance === "inferred" && (
                        <button
                          type="button"
                          className="button button-quiet context-mini-btn"
                          disabled={savingAction}
                          onClick={() => void handleConfirmRelation(rel)}
                        >
                          Confirm
                        </button>
                      )}
                      {rel.pinnedLinkId && rel.stale && (
                        <button
                          type="button"
                          className="button button-quiet context-mini-btn"
                          disabled={savingAction}
                          onClick={() => void handleConfirmRelation(rel)}
                        >
                          Re-confirm
                        </button>
                      )}
                      {rel.pinnedLinkId && (
                        <button
                          type="button"
                          className="button button-quiet context-mini-btn"
                          disabled={savingAction}
                          onClick={() =>
                            void handleUnpinRelation(rel.pinnedLinkId!)
                          }
                        >
                          Unpin
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {snapshot.recentCommits.length > 0 && (
            <section
              className="context-commits-section"
              aria-label="Recent repository history"
            >
              <div className="context-relations-head">
                <h2>Recent history</h2>
                <span className="eyebrow">Git commits</span>
              </div>
              <div className="context-commits-grid">
                {snapshot.recentCommits.slice(0, 8).map((commit) => (
                  <div key={commit.sha} className="context-commit-chip">
                    <div className="context-history-top">
                      <code className="brass-text">{commit.shortSha}</code>
                      <span className="inspector-muted">
                        {formatDate(commit.committedAt)}
                      </span>
                    </div>
                    <p className="context-history-subject">{commit.subject}</p>
                    <span className="inspector-muted">{commit.author}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : null}
    </section>
  );
}
