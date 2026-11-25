import { useEffect, useState } from "react";
import type { AppService } from "../../services/app-service";
import type {
  EditorDiagnostic,
  ExecutionRecord,
  FileContextSnapshot,
  FileHistorySnapshot,
  GitStatus,
  ProjectSummary,
  RookContextChip,
  RookMode,
} from "../../services/contracts";
import {
  buildFileContextBundleChip,
  provenanceLabel,
} from "../context/context-bundle";
import type { SyncableDocument } from "./workspace-sync";

export interface EditorSelection {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface EditorCursorState {
  path: string;
  line: number;
  column: number;
  word: string | null;
}

function formatShortTime(ms: number): string {
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

export function EditorContextInspector({
  service,
  browserPreview = false,
  activeProject,
  activeDocument,
  selection,
  cursor,
  diagnostics = [],
  gitStatus,
  executions,
  syncVersion = 0,
  returnAnchor = null,
  onReturnToAnchor,
  onAttachToRook,
  onOpenInlinePatch,
  onOpenFileInReview,
  onOpenVerify,
  onJumpToLocation,
  onExpandToContextLens,
  onHide,
  embedded = false,
  forcedTab,
  tabpanelLabelledBy,
}: {
  service?: AppService;
  browserPreview?: boolean;
  activeProject?: ProjectSummary;
  activeDocument?: SyncableDocument;
  selection?: EditorSelection | null;
  cursor?: EditorCursorState | null;
  diagnostics?: EditorDiagnostic[];
  gitStatus?: GitStatus;
  executions: ExecutionRecord[];
  syncVersion?: number;
  returnAnchor?: { filePath: string; line: number; column?: number } | null;
  onReturnToAnchor?: () => void;
  onAttachToRook: (chip: RookContextChip, mode: RookMode) => void;
  onOpenInlinePatch: (document: SyncableDocument) => void;
  onOpenFileInReview: (relativePath: string) => void;
  onOpenVerify?: () => void;
  onJumpToLocation?: (
    relativePath: string,
    line: number,
    column?: number,
    recordReturnAnchor?: boolean,
  ) => void;
  onExpandToContextLens?: (focusPath?: string) => void;
  onHide: () => void;
  embedded?: boolean;
  forcedTab?: "context" | "history";
  tabpanelLabelledBy?: string;
}) {
  const [internalTab, setInternalTab] = useState<"context" | "history">(
    "context",
  );
  const tab = forcedTab ?? internalTab;
  const setTab = setInternalTab;
  const [fileContext, setFileContext] = useState<FileContextSnapshot | null>(
    null,
  );
  const [fileHistory, setFileHistory] = useState<FileHistorySnapshot | null>(
    null,
  );
  const [loadingContext, setLoadingContext] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [contextError, setContextError] = useState<string>();
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const activeCursor =
    cursor && activeDocument && cursor.path === activeDocument.path
      ? cursor
      : null;

  useEffect(() => {
    if (!service || browserPreview || !activeProject || !activeDocument) {
      setFileContext(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingContext(true);
      setContextError(undefined);
      void service
        .getFileContext(activeProject.id, activeDocument.path, {
          symbol: activeCursor?.word ?? undefined,
          cursorLine: activeCursor?.line,
        })
        .then((snapshot) => {
          if (!cancelled) {
            setFileContext(snapshot);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setContextError(
              error instanceof Error
                ? error.message
                : "Source context could not be loaded.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingContext(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    service,
    browserPreview,
    activeProject?.id,
    activeDocument?.path,
    activeCursor?.word,
    activeCursor?.line,
    syncVersion,
    refreshTick,
  ]);

  useEffect(() => {
    if (
      tab !== "history" ||
      !service ||
      browserPreview ||
      !activeProject ||
      !activeDocument
    ) {
      return;
    }
    let cancelled = false;
    setLoadingHistory(true);
    void service
      .getFileHistory(activeProject.id, activeDocument.path)
      .then((snapshot) => {
        if (!cancelled) setFileHistory(snapshot);
      })
      .catch(() => {
        if (!cancelled) setFileHistory(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    tab,
    service,
    browserPreview,
    activeProject?.id,
    activeDocument?.path,
    syncVersion,
    refreshTick,
  ]);

  useEffect(() => {
    setEditingNote(false);
    setNoteDraft(fileContext?.annotation?.summary ?? "");
  }, [activeDocument?.path, fileContext?.annotation?.summary]);

  const fileGit = activeDocument
    ? gitStatus?.files.find((item) => item.path === activeDocument.path)
    : undefined;
  const activeSelection =
    selection && activeDocument && selection.path === activeDocument.path
      ? selection
      : null;
  const latestCheck = executions[0];

  function buildChip(): RookContextChip | null {
    if (!activeDocument) return null;
    if (activeSelection && activeSelection.text.trim()) {
      return {
        id: `sel-${activeDocument.path}-${activeSelection.startLine}-${activeSelection.endLine}`,
        kind: "selection",
        label: `${activeDocument.path}:${activeSelection.startLine}-${activeSelection.endLine}`,
        filePath: activeDocument.path,
        startLine: activeSelection.startLine,
        endLine: activeSelection.endLine,
        content: activeSelection.text.slice(0, 16_000),
        sourceSnapshot: activeDocument.content,
      };
    }
    return {
      id: `file-${activeDocument.path}`,
      kind: "file",
      label: activeDocument.path,
      filePath: activeDocument.path,
      content: activeDocument.content.slice(0, 16_000),
      sourceSnapshot: activeDocument.content,
    };
  }

  async function saveDeveloperNote() {
    if (!service || !activeProject || !activeDocument || !noteDraft.trim())
      return;
    setSavingNote(true);
    try {
      await service.saveContextAnnotation(
        activeProject.id,
        "file",
        activeDocument.path,
        noteDraft.trim(),
      );
      setEditingNote(false);
      setRefreshTick((n) => n + 1);
    } catch (error) {
      setContextError(
        error instanceof Error ? error.message : "Could not save note.",
      );
    } finally {
      setSavingNote(false);
    }
  }

  async function clearDeveloperNote() {
    if (!service || !activeProject || !activeDocument) return;
    setSavingNote(true);
    try {
      await service.deleteContextAnnotation(
        activeProject.id,
        "file",
        activeDocument.path,
      );
      setEditingNote(false);
      setNoteDraft("");
      setRefreshTick((n) => n + 1);
    } finally {
      setSavingNote(false);
    }
  }

  async function confirmTestLink(targetPath: string) {
    if (!service || !activeProject || !activeDocument) return;
    try {
      await service.saveContextPinnedLink(
        activeProject.id,
        activeDocument.path,
        targetPath,
        "tests",
        "Confirmed from Editor Context Lens",
      );
      setRefreshTick((n) => n + 1);
    } catch (error) {
      setContextError(
        error instanceof Error ? error.message : "Could not confirm link.",
      );
    }
  }

  const content = (
    <>
      {!embedded && (
        <div className="inspector-heading">
          <span className="eyebrow">Context Lens</span>
          <button
            className="icon-button"
            type="button"
            aria-label="Hide editor inspector"
            onClick={onHide}
          >
            ×
          </button>
        </div>
      )}

      {!activeProject || !activeDocument ? (
        <div className="inspector-empty">
          <span aria-hidden="true">◇</span>
          <h2>No source context</h2>
          <p>
            Open a project and select a file to inspect symbols, diagnostics,
            observed callers, related tests, and file history.
          </p>
        </div>
      ) : (
        <>
          {!embedded && (
            <div
              className="inspector-tabs"
              role="tablist"
              aria-label="Editor inspector views"
            >
              <button
                type="button"
                role="tab"
                id="inspector-tab-context"
                aria-selected={tab === "context"}
                onClick={() => setTab("context")}
              >
                Context
              </button>
              <button
                type="button"
                role="tab"
                id="inspector-tab-history"
                aria-selected={tab === "history"}
                onClick={() => setTab("history")}
              >
                History
              </button>
            </div>
          )}

          <div
            className="inspector-body"
            role="tabpanel"
            aria-labelledby={
              tabpanelLabelledBy ??
              (tab === "context"
                ? "inspector-tab-context"
                : "inspector-tab-history")
            }
          >
            <section className="inspector-card">
              <span className="eyebrow">Active source</span>
              <strong className="inspector-file-path">
                {activeDocument.path}
              </strong>
              {returnAnchor &&
                returnAnchor.filePath !== activeDocument.path &&
                onReturnToAnchor && (
                  <button
                    type="button"
                    className="button button-quiet context-mini-btn"
                    onClick={onReturnToAnchor}
                  >
                    ↩ Return to {returnAnchor.filePath.split("/").at(-1)}:
                    {returnAnchor.line}
                  </button>
                )}
              <div className="inspector-pills">
                <span className="status-pill">
                  {activeDocument.content !== activeDocument.savedContent
                    ? "Unsaved"
                    : "Saved"}
                </span>
                {fileGit && (
                  <span className="status-pill">
                    Git {fileGit.indexStatus}
                    {fileGit.worktreeStatus}
                  </span>
                )}
                {activeSelection ? (
                  <span className="status-pill">
                    L{activeSelection.startLine}–L{activeSelection.endLine}
                  </span>
                ) : activeCursor ? (
                  <span className="status-pill">
                    L{activeCursor.line}:{activeCursor.column}
                  </span>
                ) : null}
              </div>
            </section>

            {contextError && (
              <p className="inline-error" role="alert">
                {contextError}
              </p>
            )}

            {tab === "context" ? (
              <>
                <section className="inspector-card">
                  <div className="inspector-card-head">
                    <span className="eyebrow">Active symbol</span>
                    {loadingContext && (
                      <span className="inspector-muted">Indexing…</span>
                    )}
                  </div>
                  {fileContext?.activeSymbol ? (
                    <div className="context-symbol-active">
                      <code>{fileContext.activeSymbol.name}</code>
                      <span className="status-pill">
                        {fileContext.activeSymbol.kind} · L
                        {fileContext.activeSymbol.line}
                      </span>
                    </div>
                  ) : (
                    <p className="inspector-hint">
                      Move cursor onto a function, type, or export to inspect
                      references.
                    </p>
                  )}

                  {fileContext && fileContext.symbols.length > 0 && (
                    <details className="context-details">
                      <summary>
                        Definitions in file ({fileContext.symbols.length})
                      </summary>
                      <ul className="context-link-list">
                        {fileContext.symbols.slice(0, 20).map((sym) => (
                          <li key={`${sym.name}-${sym.line}`}>
                            <button
                              type="button"
                              className="context-source-link"
                              onClick={() =>
                                onJumpToLocation?.(
                                  activeDocument.path,
                                  sym.line,
                                  1,
                                  true,
                                )
                              }
                            >
                              <span className="mono">{sym.name}</span>
                              <span className="inspector-muted">
                                {sym.kind} · L{sym.line}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {fileContext && fileContext.symbolReferences.length > 0 && (
                    <details className="context-details" open>
                      <summary>
                        References to {fileContext.queriedSymbol} (
                        {fileContext.symbolReferences.length})
                      </summary>
                      <ul className="context-link-list">
                        {fileContext.symbolReferences
                          .slice(0, 12)
                          .map((hit, idx) => (
                            <li key={`${hit.filePath}:${hit.line}:${idx}`}>
                              <button
                                type="button"
                                className="context-source-link"
                                title={hit.evidence}
                                onClick={() =>
                                  onJumpToLocation?.(
                                    hit.filePath,
                                    hit.line,
                                    1,
                                    true,
                                  )
                                }
                              >
                                <span className="mono truncate">
                                  {hit.filePath}:{hit.line}
                                </span>
                                <span
                                  className={`provenance-pill provenance-${hit.provenance}`}
                                >
                                  {provenanceLabel(hit.provenance)}
                                </span>
                              </button>
                            </li>
                          ))}
                      </ul>
                    </details>
                  )}
                </section>

                <section className="inspector-card">
                  <div className="inspector-card-head">
                    <span className="eyebrow">Diagnostics</span>
                    <span className="inspector-muted">
                      {diagnostics.length}
                    </span>
                  </div>
                  {diagnostics.length === 0 ? (
                    <p className="inspector-hint">
                      No editor diagnostics for this file.
                    </p>
                  ) : (
                    <ul className="context-link-list">
                      {diagnostics.slice(0, 8).map((diag, idx) => (
                        <li key={`${diag.line}:${diag.column}:${idx}`}>
                          <button
                            type="button"
                            className="context-source-link context-diag-item"
                            onClick={() =>
                              onJumpToLocation?.(
                                activeDocument.path,
                                diag.line,
                                diag.column,
                                true,
                              )
                            }
                          >
                            <span
                              className={`diag-badge diag-${diag.severity}`}
                            >
                              {diag.severity}
                            </span>
                            <span className="truncate">
                              L{diag.line}: {diag.message}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="inspector-card">
                  <div className="inspector-card-head">
                    <span className="eyebrow">Connected source</span>
                    <span className="inspector-muted">
                      {(fileContext?.importers.length ?? 0) +
                        (fileContext?.imports.length ?? 0)}
                    </span>
                  </div>
                  {fileContext &&
                  (fileContext.importers.length > 0 ||
                    fileContext.imports.length > 0) ? (
                    <div className="context-group-stack">
                      {fileContext.importers.length > 0 && (
                        <div>
                          <span className="context-sub-label">
                            Callers / Importers ({fileContext.importers.length})
                          </span>
                          <ul className="context-link-list">
                            {fileContext.importers.slice(0, 8).map((rel) => (
                              <li key={rel.id}>
                                <button
                                  type="button"
                                  className="context-source-link"
                                  title={rel.evidence}
                                  onClick={() =>
                                    onJumpToLocation?.(
                                      rel.sourcePath,
                                      rel.sourceLine ?? 1,
                                      1,
                                      true,
                                    )
                                  }
                                >
                                  <span className="mono truncate">
                                    {rel.sourcePath}
                                    {rel.sourceLine ? `:${rel.sourceLine}` : ""}
                                  </span>
                                  <span className="provenance-pill provenance-observed">
                                    Observed
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {fileContext.imports.length > 0 && (
                        <div>
                          <span className="context-sub-label">
                            Imports ({fileContext.imports.length})
                          </span>
                          <ul className="context-link-list">
                            {fileContext.imports.slice(0, 8).map((rel) => (
                              <li key={rel.id}>
                                <button
                                  type="button"
                                  className="context-source-link"
                                  title={rel.evidence}
                                  onClick={() =>
                                    onJumpToLocation?.(
                                      rel.targetPath,
                                      1,
                                      1,
                                      true,
                                    )
                                  }
                                >
                                  <span className="mono truncate">
                                    {rel.targetPath}
                                  </span>
                                  <span className="provenance-pill provenance-observed">
                                    Observed
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="inspector-hint">
                      No static workspace imports or callers observed.
                    </p>
                  )}
                </section>

                <section className="inspector-card">
                  <div className="inspector-card-head">
                    <span className="eyebrow">Related tests</span>
                    <span className="inspector-muted">
                      {fileContext?.relatedTests.length ?? 0}
                    </span>
                  </div>
                  {fileContext && fileContext.relatedTests.length > 0 ? (
                    <ul className="context-link-list">
                      {fileContext.relatedTests.map((rel) => (
                        <li key={rel.id} className="context-test-row">
                          <button
                            type="button"
                            className="context-source-link"
                            title={rel.evidence}
                            onClick={() =>
                              onJumpToLocation?.(
                                rel.targetPath,
                                rel.sourceLine ?? 1,
                                1,
                                true,
                              )
                            }
                          >
                            <span className="mono truncate">
                              {rel.targetPath}
                            </span>
                            <span className="context-pill-row">
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
                            </span>
                          </button>
                          {rel.provenance === "inferred" && service && (
                            <button
                              type="button"
                              className="button button-quiet context-mini-btn"
                              onClick={() =>
                                void confirmTestLink(rel.targetPath)
                              }
                            >
                              Confirm
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="inspector-hint">
                      No observed or stem-matched tests found.
                    </p>
                  )}
                </section>

                <section className="inspector-card">
                  <div className="inspector-card-head">
                    <span className="eyebrow">Developer note</span>
                    {fileContext?.annotation && (
                      <span className="context-pill-row">
                        <span className="provenance-pill provenance-developer_confirmed">
                          Confirmed
                        </span>
                        {fileContext.annotation.stale && (
                          <span className="provenance-pill provenance-stale">
                            Stale
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {editingNote ? (
                    <div className="context-note-editor">
                      <textarea
                        rows={3}
                        value={noteDraft}
                        placeholder="Record grounded architectural intent for this file…"
                        onChange={(e) => setNoteDraft(e.currentTarget.value)}
                      />
                      <div className="context-note-actions">
                        <button
                          type="button"
                          className="button button-primary context-mini-btn"
                          disabled={savingNote || !noteDraft.trim()}
                          onClick={() => void saveDeveloperNote()}
                        >
                          {fileContext?.annotation?.stale
                            ? "Re-confirm"
                            : "Save note"}
                        </button>
                        <button
                          type="button"
                          className="button button-quiet context-mini-btn"
                          onClick={() => setEditingNote(false)}
                        >
                          Cancel
                        </button>
                        {fileContext?.annotation && (
                          <button
                            type="button"
                            className="button button-quiet context-mini-btn"
                            onClick={() => void clearDeveloperNote()}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ) : fileContext?.annotation ? (
                    <div className="context-note-display">
                      <p className="inspector-hint">
                        {fileContext.annotation.summary}
                      </p>
                      <button
                        type="button"
                        className="button button-quiet context-mini-btn"
                        onClick={() => setEditingNote(true)}
                      >
                        {fileContext.annotation.stale
                          ? "Review & re-confirm"
                          : "Edit note"}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="button button-quiet context-mini-btn"
                      onClick={() => setEditingNote(true)}
                    >
                      + Pin developer note
                    </button>
                  )}
                </section>

                <section className="inspector-card">
                  <span className="eyebrow">Actions</span>
                  <div className="inspector-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => {
                        const chip = buildChip();
                        if (chip) onAttachToRook(chip, "ask");
                      }}
                    >
                      Ask Rook{" "}
                      {activeSelection ? "about selection" : "about file"}
                    </button>
                    {fileContext && (
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() =>
                          onAttachToRook(
                            buildFileContextBundleChip(
                              fileContext,
                              activeDocument.content,
                            ),
                            "ask",
                          )
                        }
                      >
                        Attach with callers &amp; tests
                      </button>
                    )}
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => {
                        const chip = buildChip();
                        if (chip) onAttachToRook(chip, "build");
                      }}
                    >
                      Send to Rook Build
                    </button>
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => onOpenInlinePatch(activeDocument)}
                    >
                      Quick inline patch
                    </button>
                    {activeProject.isGitRepository && (
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() => onOpenFileInReview(activeDocument.path)}
                      >
                        Open in Review ↗
                      </button>
                    )}
                    {onExpandToContextLens && (
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() =>
                          onExpandToContextLens(activeDocument.path)
                        }
                      >
                        Open Context Lens ↗
                      </button>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <>
                <section className="inspector-card">
                  <div className="inspector-card-head">
                    <span className="eyebrow">Git commits</span>
                    {loadingHistory && (
                      <span className="inspector-muted">Loading…</span>
                    )}
                  </div>
                  {fileHistory && fileHistory.commits.length > 0 ? (
                    <ul className="context-history-list">
                      {fileHistory.commits.slice(0, 12).map((commit) => (
                        <li key={commit.sha} className="context-history-item">
                          <div className="context-history-top">
                            <code className="brass-text">
                              {commit.shortSha}
                            </code>
                            <span className="inspector-muted">
                              {formatShortTime(commit.committedAt)}
                            </span>
                          </div>
                          <p className="context-history-subject">
                            {commit.subject}
                          </p>
                          <span className="inspector-muted">
                            {commit.author}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="inspector-hint">
                      No recorded Git commits for this file yet.
                    </p>
                  )}
                </section>

                <section className="inspector-card">
                  <div className="inspector-card-head">
                    <span className="eyebrow">
                      Review checkpoints &amp; notes
                    </span>
                  </div>
                  {fileHistory &&
                  (fileHistory.checkpoints.length > 0 ||
                    fileHistory.notes.length > 0) ? (
                    <div className="context-group-stack">
                      {fileHistory.checkpoints.slice(0, 6).map((cp) => (
                        <button
                          key={cp.id}
                          type="button"
                          className="context-source-link"
                          onClick={() =>
                            onOpenFileInReview(activeDocument.path)
                          }
                        >
                          <span className="truncate">{cp.label}</span>
                          <span className="inspector-muted">
                            {formatShortTime(cp.createdAt)} ↗
                          </span>
                        </button>
                      ))}
                      {fileHistory.notes.slice(0, 6).map((note) => (
                        <div key={note.id} className="context-history-note">
                          <span className="inspector-muted">
                            {note.lineNumber ? `L${note.lineNumber} · ` : ""}
                            {note.resolved ? "Resolved" : "Open note"}
                          </span>
                          <p className="inspector-hint">{note.body}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="inspector-hint">
                      No review checkpoints or notes recorded for this file.
                    </p>
                  )}
                </section>

                <section className="inspector-card">
                  <div className="inspector-card-head">
                    <span className="eyebrow">Verification history</span>
                  </div>
                  {fileHistory && fileHistory.checks.length > 0 ? (
                    <ul className="context-link-list">
                      {fileHistory.checks.slice(0, 8).map((check) => (
                        <li key={check.id}>
                          <button
                            type="button"
                            className="context-source-link"
                            onClick={() => onOpenVerify?.()}
                          >
                            <span
                              className={`verify-status-pill verify-status-${check.status}`}
                            >
                              {check.status}
                            </span>
                            <span className="mono truncate">
                              {check.command}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : latestCheck ? (
                    <p className="inspector-hint">
                      Latest workspace check:{" "}
                      <span
                        className={`verify-status-pill verify-status-${latestCheck.status}`}
                      >
                        {latestCheck.status}
                      </span>{" "}
                      {latestCheck.program} {latestCheck.args.join(" ")}
                    </p>
                  ) : (
                    <p className="inspector-hint">
                      No verification checks recorded for this file.
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
        </>
      )}
    </>
  );

  if (embedded) return content;

  return (
    <aside className="editor-inspector" aria-label="Editor context inspector">
      {content}
    </aside>
  );
}
