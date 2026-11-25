import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AppService } from "../../services/app-service";
import type {
  ExecutionRecord,
  GitDiffPair,
  ProjectRecipeSummary,
  ProjectSummary,
  RevertTarget,
  ReviewDiffBaseline,
  UiPreferences,
  WorkspaceReviewSnapshot,
} from "../../services/contracts";

const ReviewDiffEditor = lazy(() =>
  import("./ReviewDiffEditor").then((module) => ({
    default: module.ReviewDiffEditor,
  })),
);

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

function fileBadge(indexStatus: string, worktreeStatus: string): string {
  if (indexStatus === "?" && worktreeStatus === "?") return "NEW";
  if (indexStatus === "D" || worktreeStatus === "D") return "DEL";
  if (indexStatus === "A") return "ADD";
  return "MOD";
}

export function WorkspaceReviewScreen({
  service,
  project,
  initialSelectedPaths,
  initialBaseline = "head",
  preferences,
  executions,
  recipes,
  workspaceTrusted,
  dirtyCount,
  savingFiles,
  syncVersion,
  onSaveAllDirty,
  onOpenInEditor,
  onOpenVerify,
  onRunQuickRecipe,
  onSendNotesToRook,
  onWorkspaceMutated,
}: {
  service: AppService;
  project: ProjectSummary;
  initialSelectedPaths?: string[];
  initialBaseline?: ReviewDiffBaseline;
  preferences: UiPreferences;
  executions: ExecutionRecord[];
  recipes: ProjectRecipeSummary[];
  workspaceTrusted: boolean;
  dirtyCount: number;
  savingFiles: boolean;
  syncVersion: number;
  onSaveAllDirty: () => Promise<boolean>;
  onOpenInEditor: (relativePath: string) => void;
  onOpenVerify: () => void;
  onRunQuickRecipe?: (recipeName: string) => Promise<void>;
  onSendNotesToRook: (prompt: string) => void;
  onWorkspaceMutated: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<WorkspaceReviewSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [selectedFile, setSelectedFile] = useState<string>();
  const [selectedPaths, setSelectedPaths] = useState<string[]>(
    initialSelectedPaths ?? [],
  );
  const [diffBaseline, setDiffBaseline] =
    useState<ReviewDiffBaseline>(initialBaseline);
  const [diffPair, setDiffPair] = useState<GitDiffPair>();
  const [diffLoading, setDiffLoading] = useState(false);
  const [editedContent, setEditedContent] = useState<string>();
  const [savingInline, setSavingInline] = useState(false);
  const [sideBySide, setSideBySide] = useState(true);
  const [commentBody, setCommentBody] = useState("");
  const [commentLine, setCommentLine] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [allowUnverified, setAllowUnverified] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  useEffect(() => {
    setDiffBaseline(initialBaseline);
  }, [initialBaseline]);

  useEffect(() => {
    if (initialSelectedPaths && initialSelectedPaths.length > 0) {
      setSelectedPaths(initialSelectedPaths);
      setSelectedFile(initialSelectedPaths[0]);
    }
  }, [initialSelectedPaths]);

  const loadReview = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await service.getWorkspaceReview(project.id);
      setSnapshot(next);
      const changedList = next.changedFiles.map((file) => file.path);
      setSelectedPaths((current) => {
        if (current.length === 0) return changedList;
        const stillPresent = current.filter((path) =>
          changedList.includes(path),
        );
        return stillPresent.length > 0 ? stillPresent : changedList;
      });
      setSelectedFile((current) =>
        current && changedList.includes(current) ? current : changedList[0],
      );
      if (diffBaseline === "last_review" && !next.lastCheckpointDigest) {
        setDiffBaseline("head");
      }
    } catch (failure) {
      setError(errorText(failure, "Working-tree review could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [diffBaseline, project.id, service]);

  useEffect(() => {
    void loadReview();
  }, [loadReview, syncVersion]);

  const visibleFiles = useMemo(() => {
    const all = snapshot?.changedFiles ?? [];
    if (diffBaseline === "last_review" && snapshot?.lastCheckpointDigest) {
      const delta = new Set(snapshot.changedSinceCheckpoint);
      return all.filter((file) => delta.has(file.path));
    }
    return all;
  }, [diffBaseline, snapshot]);

  useEffect(() => {
    if (visibleFiles.length === 0) {
      setSelectedFile(undefined);
      return;
    }
    if (!selectedFile || !visibleFiles.some((f) => f.path === selectedFile)) {
      setSelectedFile(visibleFiles[0].path);
    }
  }, [selectedFile, visibleFiles]);

  useEffect(() => {
    if (!selectedFile) {
      setDiffPair(undefined);
      setEditedContent(undefined);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    void service
      .readGitFileDiffPair(project.id, selectedFile, {
        baseline: diffBaseline,
      })
      .then((pair) => {
        if (cancelled) return;
        setDiffPair(pair);
        setEditedContent(pair.modified ?? undefined);
      })
      .catch((failure) => {
        if (!cancelled) {
          setError(errorText(failure, "File diff could not be loaded."));
        }
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [diffBaseline, project.id, selectedFile, service, snapshot?.sourceDigest]);

  const inlineDirty =
    diffPair?.kind === "text" &&
    diffPair.status !== "deleted" &&
    editedContent !== undefined &&
    editedContent !== (diffPair.modified ?? "");

  async function saveInlineEdit() {
    if (!selectedFile || !diffPair || editedContent === undefined) return;
    setSavingInline(true);
    setError(undefined);
    try {
      await service.saveProjectFile(
        project.id,
        selectedFile,
        diffPair.modified ?? "",
        editedContent,
      );
      setStatusMessage(`Saved ${selectedFile}.`);
      await onWorkspaceMutated();
      await loadReview();
    } catch (failure) {
      setError(errorText(failure, "Inline edit could not be saved."));
    } finally {
      setSavingInline(false);
    }
  }

  async function handleSaveCheckpoint() {
    setActionPending(true);
    setError(undefined);
    try {
      const next = await service.saveWorkspaceCheckpoint(
        project.id,
        "Manual checkpoint",
      );
      setSnapshot(next);
      setStatusMessage(
        `Saved checkpoint at ${next.sourceDigest.slice(0, 10)}.`,
      );
    } catch (failure) {
      setError(errorText(failure, "Checkpoint could not be saved."));
    } finally {
      setActionPending(false);
    }
  }

  async function handleRevertFile(relativePath: string, target: RevertTarget) {
    const label =
      target === "checkpoint"
        ? `Revert "${relativePath}" back to the last checkpoint?`
        : `Discard all uncommitted edits to "${relativePath}" (revert to HEAD)?`;
    if (!window.confirm(label)) return;
    setActionPending(true);
    setError(undefined);
    setStatusMessage(undefined);
    try {
      const next = await service.revertWorkspaceFile(
        project.id,
        relativePath,
        target,
      );
      setSnapshot(next);
      setStatusMessage(
        target === "checkpoint"
          ? `Reverted ${relativePath} to last checkpoint.`
          : `Reverted ${relativePath} to HEAD.`,
      );
      await onWorkspaceMutated();
      await loadReview();
    } catch (failure) {
      setError(errorText(failure, `Could not revert ${relativePath}.`));
    } finally {
      setActionPending(false);
    }
  }

  async function handleAddComment() {
    if (!selectedFile || !commentBody.trim()) return;
    const parsedLine = commentLine.trim()
      ? Number.parseInt(commentLine.trim(), 10)
      : undefined;
    if (
      commentLine.trim() &&
      (!Number.isInteger(parsedLine) || (parsedLine ?? 0) < 1)
    ) {
      setError("Line number must be a positive whole number.");
      return;
    }
    setActionPending(true);
    setError(undefined);
    try {
      const created = await service.addWorkspaceReviewComment(
        project.id,
        selectedFile,
        commentBody.trim(),
        parsedLine,
      );
      setSnapshot((current) =>
        current
          ? { ...current, comments: [...current.comments, created] }
          : current,
      );
      setCommentBody("");
      setCommentLine("");
    } catch (failure) {
      setError(errorText(failure, "Review note could not be added."));
    } finally {
      setActionPending(false);
    }
  }

  async function handleToggleComment(commentId: string, resolved: boolean) {
    setError(undefined);
    try {
      const updated = await service.toggleReviewCommentResolved(
        project.id,
        commentId,
        resolved,
      );
      setSnapshot((current) =>
        current
          ? {
              ...current,
              comments: current.comments.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
    } catch (failure) {
      setError(errorText(failure, "Note status could not be updated."));
    }
  }

  function handleSendNotesToRook() {
    if (!snapshot) return;
    const unresolved = snapshot.comments.filter((c) => !c.resolved);
    if (unresolved.length === 0) return;
    const prompt = [
      "Please address these review notes in the current working tree:",
      ...unresolved.map(
        (c) =>
          `- ${c.filePath}${c.lineNumber ? `:${c.lineNumber}` : ""}: ${c.body}`,
      ),
    ].join("\n");
    onSendNotesToRook(prompt);
  }

  async function handleCommit() {
    if (!snapshot) return;
    if (dirtyCount > 0 || inlineDirty) {
      setError("Save all unsaved edits before committing.");
      return;
    }
    setActionPending(true);
    setError(undefined);
    setStatusMessage(undefined);
    try {
      const completed = await service.commitWorkspaceReview(
        project.id,
        selectedPaths,
        commitMessage,
        snapshot.sourceDigest,
        allowUnverified,
      );
      setCommitMessage("");
      setAllowUnverified(false);
      setStatusMessage(
        `Committed ${completed.selectedPaths.length} file(s) · ${completed.commitSha?.slice(0, 10) ?? ""}`,
      );
      await onWorkspaceMutated();
      await loadReview();
    } catch (failure) {
      setError(
        errorText(failure, "Git commit failed; your files were preserved."),
      );
      await loadReview();
    } finally {
      setActionPending(false);
    }
  }

  function handleCopyBundle() {
    if (!snapshot) return;
    const lines = [
      `# Working Tree Review (${snapshot.branch ?? "HEAD"})`,
      "",
      `- **HEAD:** ${snapshot.headRevision}`,
      `- **Source digest:** ${snapshot.sourceDigest}`,
      `- **Fresh passing check:** ${snapshot.hasFreshPassingCheck ? "yes" : "no"}`,
      "",
      "## Changed files",
      ...snapshot.changedFiles.map(
        (f) => `- \`${f.indexStatus}${f.worktreeStatus}\` ${f.path}`,
      ),
      "",
      "## Notes",
      ...(snapshot.comments.length > 0
        ? snapshot.comments.map(
            (c) =>
              `- [${c.resolved ? "x" : " "}] \`${c.filePath}${c.lineNumber ? `:${c.lineNumber}` : ""}\`: ${c.body}`,
          )
        : ["- None"]),
    ];
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(`${lines.join("\n")}\n`).then(
        () => setStatusMessage("Review summary copied to clipboard."),
        () => setStatusMessage("Clipboard unavailable."),
      );
    }
  }

  const projectChecks = useMemo(
    () => executions.filter((item) => item.projectId === project.id),
    [executions, project.id],
  );
  const fileComments = useMemo(
    () =>
      (snapshot?.comments ?? []).filter(
        (comment) => !selectedFile || comment.filePath === selectedFile,
      ),
    [selectedFile, snapshot?.comments],
  );
  const unresolvedCount = (snapshot?.comments ?? []).filter(
    (comment) => !comment.resolved,
  ).length;
  const selectedIsChangedSinceCheckpoint = Boolean(
    selectedFile &&
      snapshot?.lastCheckpointDigest &&
      snapshot.changedSinceCheckpoint.includes(selectedFile),
  );

  return (
    <section
      className="content-page review-page"
      aria-label="Working tree review and commit"
    >
      <div className="review-layout">
        <div className="review-center">
          <div className="review-top-bar">
            <div className="review-inline-actions">
              <h1 id="screen-title" className="review-compact-title">
                Review
              </h1>
              {snapshot && (
                <div className="review-meta">
                  <span>{snapshot.branch ?? "detached"}</span>
                  <span>HEAD {snapshot.headRevision.slice(0, 8)}</span>
                  <span>{snapshot.changedFiles.length} changed</span>
                </div>
              )}
            </div>
            <div className="review-inline-actions">
              {snapshot?.lastCheckpointDigest && (
                <div
                  className="review-baseline-toggle"
                  role="group"
                  aria-label="Diff baseline"
                >
                  <button
                    type="button"
                    className={`button button-quiet${diffBaseline === "head" ? " is-active" : ""}`}
                    onClick={() => setDiffBaseline("head")}
                  >
                    All uncommitted ({snapshot.changedFiles.length})
                  </button>
                  <button
                    type="button"
                    className={`button button-quiet${diffBaseline === "last_review" ? " is-active" : ""}`}
                    title={snapshot.lastCheckpointLabel ?? "Last checkpoint"}
                    onClick={() => setDiffBaseline("last_review")}
                  >
                    Since {snapshot.lastCheckpointLabel ?? "checkpoint"} (
                    {snapshot.changedSinceCheckpoint.length})
                  </button>
                </div>
              )}
              <button
                type="button"
                className="button button-quiet"
                disabled={actionPending || loading}
                onClick={() => void handleSaveCheckpoint()}
              >
                Save checkpoint
              </button>
              <button
                type="button"
                className="button button-quiet"
                disabled={!snapshot}
                onClick={handleCopyBundle}
              >
                Copy summary
              </button>
              <button
                type="button"
                className="button button-quiet"
                disabled={loading}
                onClick={() => void loadReview()}
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {statusMessage && (
            <p className="review-status-note" role="status">
              {statusMessage}
            </p>
          )}
          {(dirtyCount > 0 || inlineDirty) && (
            <div className="verify-dirty-banner" role="status">
              <p>
                <strong>Unsaved edits detected.</strong> Save so the diff and
                commit match disk.
              </p>
              <div className="review-inline-actions">
                {inlineDirty && (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={savingInline}
                    onClick={() => void saveInlineEdit()}
                  >
                    {savingInline ? "Saving…" : "Save diff edit"}
                  </button>
                )}
                {dirtyCount > 0 && (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={savingFiles}
                    onClick={() =>
                      void onSaveAllDirty().then((ok) => {
                        if (ok) void loadReview();
                      })
                    }
                  >
                    {savingFiles
                      ? "Saving…"
                      : `Save ${dirtyCount} editor tab(s)`}
                  </button>
                )}
              </div>
            </div>
          )}

          {snapshot && visibleFiles.length > 0 ? (
            <>
              <div className="review-files-bar">
                <div
                  className="review-file-tabs"
                  role="list"
                  aria-label="Changed files"
                >
                  {visibleFiles.map((file) => {
                    const checked = selectedPaths.includes(file.path);
                    const active = selectedFile === file.path;
                    return (
                      <div
                        key={file.path}
                        className={`review-file-chip${active ? " is-active" : ""}`}
                        role="listitem"
                      >
                        <input
                          type="checkbox"
                          aria-label={`Include ${file.path} in commit`}
                          checked={checked}
                          onChange={(event) =>
                            setSelectedPaths((current) =>
                              event.target.checked
                                ? [...new Set([...current, file.path])]
                                : current.filter((item) => item !== file.path),
                            )
                          }
                        />
                        <button
                          type="button"
                          onClick={() => setSelectedFile(file.path)}
                        >
                          <span className="review-file-badge">
                            {fileBadge(file.indexStatus, file.worktreeStatus)}
                          </span>
                          <span>{file.path}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="review-diff-controls">
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => setSideBySide((value) => !value)}
                  >
                    {sideBySide ? "Inline diff" : "Side-by-side"}
                  </button>
                  {selectedFile && (
                    <>
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() => onOpenInEditor(selectedFile)}
                      >
                        Editor ↗
                      </button>
                      {selectedIsChangedSinceCheckpoint && (
                        <button
                          type="button"
                          className="button button-quiet"
                          disabled={actionPending}
                          title="Undo only edits made since the last checkpoint"
                          onClick={() =>
                            void handleRevertFile(selectedFile, "checkpoint")
                          }
                        >
                          Undo since checkpoint
                        </button>
                      )}
                      <button
                        type="button"
                        className="button button-quiet"
                        disabled={actionPending}
                        title="Discard all uncommitted changes in this file"
                        onClick={() =>
                          void handleRevertFile(selectedFile, "head")
                        }
                      >
                        Revert file
                      </button>
                    </>
                  )}
                  {inlineDirty && (
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={savingInline}
                      onClick={() => void saveInlineEdit()}
                    >
                      {savingInline ? "Saving…" : "Save"}
                    </button>
                  )}
                </div>
              </div>
              <div className="review-diff-surface">
                {diffLoading ? (
                  <p className="editor-loading">Loading diff…</p>
                ) : diffPair?.kind === "text" ? (
                  <Suspense
                    fallback={
                      <p className="editor-loading">Loading diff editor…</p>
                    }
                  >
                    <ReviewDiffEditor
                      path={diffPair.path}
                      original={diffPair.original ?? ""}
                      modified={editedContent ?? diffPair.modified ?? ""}
                      theme={preferences.theme}
                      fontSize={preferences.editorFontSize}
                      sideBySide={sideBySide}
                      readOnly={diffPair.status === "deleted"}
                      onChange={setEditedContent}
                    />
                  </Suspense>
                ) : diffPair ? (
                  <p className="review-binary-note">
                    {diffPair.kind === "binary"
                      ? "Binary file diff cannot be edited inline."
                      : "File exceeds the 1 MiB inline diff limit."}
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            !loading && (
              <p className="review-empty-diff">
                {diffBaseline === "last_review" &&
                (snapshot?.changedFiles.length ?? 0) > 0
                  ? "No edits since the last checkpoint. Switch to 'All uncommitted' to inspect earlier working-tree changes."
                  : "Working tree is clean — no uncommitted changes to review."}
              </p>
            )
          )}

          {snapshot && (
            <section className="review-comments" aria-label="Review notes">
              <div className="review-section-head">
                <h2>
                  Review notes{" "}
                  <small>
                    ({fileComments.length}
                    {selectedFile ? ` on ${selectedFile}` : ""})
                  </small>
                </h2>
                {unresolvedCount > 0 && (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={actionPending}
                    onClick={handleSendNotesToRook}
                  >
                    Send {unresolvedCount} note(s) to Rook Build ↗
                  </button>
                )}
              </div>
              {selectedFile && (
                <form
                  className="review-comment-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleAddComment();
                  }}
                >
                  <input
                    className="review-line-input"
                    inputMode="numeric"
                    placeholder="Line #"
                    aria-label="Line number (optional)"
                    value={commentLine}
                    onChange={(event) => setCommentLine(event.target.value)}
                  />
                  <input
                    className="review-body-input"
                    placeholder={`Leave a note for ${selectedFile} (send to Rook Build to fix)…`}
                    aria-label="Review note"
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="button button-quiet"
                    disabled={actionPending || !commentBody.trim()}
                  >
                    Add note
                  </button>
                </form>
              )}
              <ul className="review-comment-list">
                {fileComments.map((comment) => (
                  <li
                    key={comment.id}
                    className={comment.resolved ? "is-resolved" : ""}
                  >
                    <div>
                      <strong>
                        {comment.filePath}
                        {comment.lineNumber ? `:${comment.lineNumber}` : ""}
                      </strong>
                      <p>{comment.body}</p>
                    </div>
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() =>
                        void handleToggleComment(comment.id, !comment.resolved)
                      }
                    >
                      {comment.resolved ? "Reopen" : "Resolve"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {snapshot && (
          <aside className="review-aside" aria-label="Verify and commit">
            <section className="review-aside-card">
              <div className="review-section-head">
                <span className="eyebrow">Verification</span>
                <button
                  type="button"
                  className="workspace-tools-verify-link"
                  onClick={onOpenVerify}
                >
                  Open Verify ↗
                </button>
              </div>
              {snapshot.hasFreshPassingCheck ? (
                <p className="verify-status-pill verify-status-passed">
                  Fresh pass · {snapshot.sourceDigest.slice(0, 8)}
                </p>
              ) : (
                <p className="verify-status-pill verify-status-stale">
                  No fresh pass for {snapshot.sourceDigest.slice(0, 8)}
                </p>
              )}
              {recipes.length > 0 && workspaceTrusted && onRunQuickRecipe && (
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={actionPending}
                  onClick={() => {
                    setActionPending(true);
                    void onRunQuickRecipe(recipes[0].name)
                      .then(() => loadReview())
                      .catch((failure) =>
                        setError(errorText(failure, "Check failed to run.")),
                      )
                      .finally(() => setActionPending(false));
                  }}
                >
                  Run {recipes[0].name}
                </button>
              )}
              {projectChecks.slice(0, 4).map((check) => (
                <div className="review-check-row" key={check.id}>
                  <span>
                    {check.program} {check.args.join(" ")}
                  </span>
                  <span
                    className={`verify-status-pill verify-status-${check.status}`}
                  >
                    {check.status}
                  </span>
                </div>
              ))}
            </section>

            <section className="review-aside-card">
              <span className="eyebrow">Commit selected files</span>
              {snapshot.gitOperationInProgress && (
                <p className="inline-error" role="alert">
                  Git merge or rebase is in progress. Resolve it before
                  committing.
                </p>
              )}
              {snapshot.lastCommitSha && (
                <p className="review-aside-hint">
                  Last commit:{" "}
                  <code>{snapshot.lastCommitSha.slice(0, 10)}</code>
                </p>
              )}
              <label className="review-field">
                <span>Commit message</span>
                <textarea
                  rows={3}
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Describe what you're committing…"
                />
              </label>
              <p className="review-aside-hint">
                {selectedPaths.length} of {snapshot.changedFiles.length} file(s)
                selected. Unchecked files remain untouched.
              </p>
              {!snapshot.hasFreshPassingCheck && (
                <label className="review-unverified-toggle">
                  <input
                    type="checkbox"
                    checked={allowUnverified}
                    onChange={(event) =>
                      setAllowUnverified(event.target.checked)
                    }
                  />
                  <span>Commit without fresh passing check</span>
                </label>
              )}
              <button
                type="button"
                className="button button-primary"
                disabled={
                  actionPending ||
                  snapshot.gitOperationInProgress ||
                  selectedPaths.length === 0 ||
                  !commitMessage.trim() ||
                  (!snapshot.hasFreshPassingCheck && !allowUnverified)
                }
                onClick={() => void handleCommit()}
              >
                {actionPending
                  ? "Committing…"
                  : `Commit ${selectedPaths.length} file(s)`}
              </button>
            </section>
          </aside>
        )}
      </div>
    </section>
  );
}
