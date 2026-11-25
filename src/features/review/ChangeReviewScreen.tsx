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
  ChangeReviewSnapshot,
  ExecutionRecord,
  GitDiffPair,
  IntegrationAttempt,
  ProjectSummary,
  ReviewDiffBaseline,
  UiPreferences,
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

export function ChangeReviewScreen({
  service,
  project,
  changeId,
  initialSelectedPaths,
  preferences,
  executions,
  dirtyCount,
  savingFiles,
  onSaveAllDirty,
  onBack,
  onOpenInEditor,
  onOpenVerify,
  onSendRevisionToRook,
  onChangeUpdated,
}: {
  service: AppService;
  project: ProjectSummary;
  changeId: string;
  initialSelectedPaths?: string[];
  preferences: UiPreferences;
  executions: ExecutionRecord[];
  dirtyCount: number;
  savingFiles: boolean;
  onSaveAllDirty: () => Promise<boolean>;
  onBack: () => void;
  onOpenInEditor: (relativePath: string) => void;
  onOpenVerify: (changeId: string) => void;
  onSendRevisionToRook: (prompt: string) => void;
  onChangeUpdated: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<ChangeReviewSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selectedFile, setSelectedFile] = useState<string>();
  const [selectedPaths, setSelectedPaths] = useState<string[]>(
    initialSelectedPaths ?? [],
  );
  const [diffBaseline, setDiffBaseline] = useState<ReviewDiffBaseline>("head");
  const [diffPair, setDiffPair] = useState<GitDiffPair>();
  const [diffLoading, setDiffLoading] = useState(false);
  const [editedContent, setEditedContent] = useState<string>();
  const [savingInline, setSavingInline] = useState(false);
  const [sideBySide, setSideBySide] = useState(true);
  const [commentBody, setCommentBody] = useState("");
  const [commentLine, setCommentLine] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [preparedAttempt, setPreparedAttempt] = useState<IntegrationAttempt>();
  const [actionPending, setActionPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>();

  const loadReview = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await service.getChangeReview(project.id, changeId);
      setSnapshot(next);
      setCommitMessage((current) => current || next.change.objective);
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
      if (next.latestAttempt?.status === "prepared") {
        setPreparedAttempt(next.latestAttempt);
      } else {
        setPreparedAttempt(undefined);
      }
    } catch (failure) {
      setError(errorText(failure, "Change review could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [changeId, project.id, service]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

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
        changeId,
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
  }, [
    changeId,
    diffBaseline,
    project.id,
    selectedFile,
    service,
    snapshot?.sourceDigest,
  ]);

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
      setStatusMessage(`Saved ${selectedFile}. Prior approval re-checked.`);
      await onChangeUpdated();
      await loadReview();
    } catch (failure) {
      setError(errorText(failure, "Inline review edit could not be saved."));
    } finally {
      setSavingInline(false);
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
      const created = await service.addReviewComment(
        project.id,
        changeId,
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
      setError(errorText(failure, "Review comment could not be added."));
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
      setError(errorText(failure, "Comment status could not be updated."));
    }
  }

  async function handleApprove() {
    if (!snapshot) return;
    if (dirtyCount > 0 || inlineDirty) {
      setError("Save all unsaved edits before approving this source snapshot.");
      return;
    }
    setActionPending(true);
    setError(undefined);
    setStatusMessage(undefined);
    try {
      const next = await service.approveChangeReview(
        project.id,
        changeId,
        snapshot.sourceDigest,
        overrideReason.trim() || undefined,
      );
      setSnapshot(next);
      setPreparedAttempt(undefined);
      setStatusMessage(`Approved snapshot ${next.sourceDigest.slice(0, 12)}.`);
      await onChangeUpdated();
    } catch (failure) {
      setError(errorText(failure, "Change could not be approved."));
    } finally {
      setActionPending(false);
    }
  }

  async function handleRequestRevision(sendToRook: boolean) {
    if (!snapshot) return;
    const unresolved = snapshot.comments.filter((comment) => !comment.resolved);
    const note = unresolved
      .map(
        (comment) =>
          `- ${comment.filePath}${comment.lineNumber ? `:${comment.lineNumber}` : ""}: ${comment.body}`,
      )
      .join("\n");
    setActionPending(true);
    setError(undefined);
    try {
      const next = await service.requestChangeRevision(
        project.id,
        changeId,
        note || "Revision requested from Change review",
      );
      setSnapshot(next);
      setPreparedAttempt(undefined);
      await onChangeUpdated();
      if (sendToRook) {
        const prompt = [
          `Revise "${snapshot.change.objective}" based on review feedback:`,
          note || "Please review and refine the pending changes.",
        ].join("\n\n");
        onSendRevisionToRook(prompt);
      } else {
        setStatusMessage("Revision requested. Change returned to Active.");
      }
    } catch (failure) {
      setError(errorText(failure, "Revision request could not be recorded."));
    } finally {
      setActionPending(false);
    }
  }

  async function handlePrepareIntegration() {
    if (!snapshot) return;
    if (dirtyCount > 0 || inlineDirty) {
      setError("Save all unsaved edits before preparing integration.");
      return;
    }
    setActionPending(true);
    setError(undefined);
    setStatusMessage(undefined);
    try {
      const attempt = await service.prepareChangeIntegration(
        project.id,
        changeId,
        selectedPaths,
        commitMessage,
      );
      setPreparedAttempt(attempt);
      setStatusMessage(
        `Integration prepared for ${attempt.selectedPaths.length} file(s) on ${snapshot.branch ?? "HEAD"}.`,
      );
    } catch (failure) {
      setError(errorText(failure, "Integration could not be prepared."));
    } finally {
      setActionPending(false);
    }
  }

  async function handleExecuteIntegration() {
    if (!preparedAttempt) return;
    setActionPending(true);
    setError(undefined);
    setStatusMessage(undefined);
    try {
      const completed = await service.executeChangeIntegration(
        project.id,
        changeId,
        preparedAttempt.id,
      );
      setPreparedAttempt(undefined);
      setStatusMessage(
        `Committed ${completed.commitSha?.slice(0, 12) ?? ""} — Change integrated.`,
      );
      await onChangeUpdated();
      await loadReview();
    } catch (failure) {
      setError(errorText(failure, "Git commit failed; files were preserved."));
      await loadReview();
    } finally {
      setActionPending(false);
    }
  }

  const linkedChecks = useMemo(
    () =>
      executions.filter(
        (item) =>
          item.projectId === project.id &&
          (item.changeId === changeId || item.changeId === null),
      ),
    [changeId, executions, project.id],
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

  async function handleMarkCheckpoint() {
    setActionPending(true);
    setError(undefined);
    try {
      const next = await service.saveReviewCheckpoint(project.id, changeId);
      setSnapshot(next);
      setStatusMessage(
        `Marked reviewed checkpoint at ${next.sourceDigest.slice(0, 12)}.`,
      );
    } catch (failure) {
      setError(errorText(failure, "Review checkpoint could not be saved."));
    } finally {
      setActionPending(false);
    }
  }

  function handleExportBundle() {
    if (!snapshot) return;
    const lines = [
      `# Change Review: ${snapshot.change.objective}`,
      "",
      `- **ID:** ${snapshot.change.id}`,
      `- **Status:** ${snapshot.change.status}`,
      `- **Branch / HEAD:** ${snapshot.branch ?? "detached"} · ${snapshot.headRevision}`,
      `- **Source digest:** ${snapshot.sourceDigest}`,
      `- **Approval valid:** ${snapshot.approvalValid ? "yes" : "no"}`,
      "",
      "## Changed files",
      ...snapshot.changedFiles.map(
        (file) =>
          `- \`${file.indexStatus}${file.worktreeStatus}\` ${file.path}`,
      ),
      "",
      "## Verification records",
      ...(linkedChecks.length > 0
        ? linkedChecks.map(
            (check) =>
              `- **${check.status}** \`${check.program} ${check.args.join(" ")}\` (digest ${check.sourceDigest.slice(0, 12)}, exit ${check.exitCode ?? "—"})`,
          )
        : ["- None"]),
      "",
      "## Review comments",
      ...(snapshot.comments.length > 0
        ? snapshot.comments.map(
            (comment) =>
              `- [${comment.resolved ? "x" : " "}] \`${comment.filePath}${comment.lineNumber ? `:${comment.lineNumber}` : ""}\`: ${comment.body}`,
          )
        : ["- None"]),
    ];
    const markdown = `${lines.join("\n")}\n`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(markdown).then(
        () => setStatusMessage("Review evidence bundle copied to clipboard."),
        () => setStatusMessage("Clipboard unavailable in this environment."),
      );
    }
  }

  const visibleFiles = useMemo(() => {
    const all = snapshot?.changedFiles ?? [];
    if (diffBaseline === "last_review" && snapshot?.lastReviewedDigest) {
      const delta = new Set(snapshot.changedSinceLastReview);
      return all.filter((file) => delta.has(file.path));
    }
    return all;
  }, [diffBaseline, snapshot]);

  return (
    <section
      className="content-page review-page"
      aria-label="Change review and integration"
    >
      <div className="review-layout">
        <div className="review-center">
          <div className="review-top-bar">
            <button
              type="button"
              className="button button-quiet"
              onClick={onBack}
            >
              ← All Changes
            </button>
            <div className="review-inline-actions">
              {snapshot?.lastReviewedDigest && (
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
                    vs HEAD ({snapshot.changedFiles.length})
                  </button>
                  <button
                    type="button"
                    className={`button button-quiet${diffBaseline === "last_review" ? " is-active" : ""}`}
                    onClick={() => setDiffBaseline("last_review")}
                  >
                    Since last review ({snapshot.changedSinceLastReview.length})
                  </button>
                </div>
              )}
              <button
                type="button"
                className="button button-quiet"
                disabled={actionPending || loading}
                onClick={() => void handleMarkCheckpoint()}
              >
                Mark reviewed checkpoint
              </button>
              <button
                type="button"
                className="button button-quiet"
                disabled={!snapshot}
                onClick={handleExportBundle}
              >
                Copy bundle
              </button>
              <button
                type="button"
                className="button button-quiet"
                disabled={loading}
                onClick={() => void loadReview()}
              >
                {loading ? "Refreshing…" : "Refresh diff"}
              </button>
            </div>
          </div>
          {snapshot && (
            <header className="review-header">
              <span className="eyebrow">
                {snapshot.change.id} ·{" "}
                {snapshot.change.status.replaceAll("_", " ")}
              </span>
              <h1>{snapshot.change.objective}</h1>
              <div className="review-meta">
                <span>Branch: {snapshot.branch ?? "detached"}</span>
                <span>HEAD: {snapshot.headRevision.slice(0, 10)}</span>
                <span>Snapshot: {snapshot.sourceDigest.slice(0, 12)}</span>
                <span>{snapshot.changedFiles.length} changed file(s)</span>
              </div>
            </header>
          )}
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
                <strong>Unsaved edits detected.</strong> Save before approving
                or committing so the diff matches the disk snapshot.
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
                          onChange={(event) => {
                            setPreparedAttempt(undefined);
                            setSelectedPaths((current) =>
                              event.target.checked
                                ? [...new Set([...current, file.path])]
                                : current.filter((item) => item !== file.path),
                            );
                          }}
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
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => onOpenInEditor(selectedFile)}
                    >
                      Open in Editor ↗
                    </button>
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
                No uncommitted working-tree changes in this repository.
              </p>
            )
          )}

          {snapshot && (
            <section className="review-comments" aria-label="Review comments">
              <div className="review-section-head">
                <h2>
                  Review comments{" "}
                  <small>
                    ({fileComments.length}
                    {selectedFile ? ` on ${selectedFile}` : ""})
                  </small>
                </h2>
                {unresolvedCount > 0 && (
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={actionPending}
                    onClick={() => void handleRequestRevision(true)}
                  >
                    Send {unresolvedCount} comment(s) to Rook Build ↗
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
                    placeholder={`Add a review note for ${selectedFile}…`}
                    aria-label="Review comment"
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
          <aside
            className="review-aside"
            aria-label="Review decision and integration"
          >
            <section className="review-aside-card">
              <div className="review-section-head">
                <span className="eyebrow">Verification</span>
                <button
                  type="button"
                  className="workspace-tools-verify-link"
                  onClick={() => onOpenVerify(changeId)}
                >
                  Open Verify ↗
                </button>
              </div>
              {snapshot.hasFreshPassingCheck ? (
                <p className="verify-status-pill verify-status-passed">
                  Fresh passing check · {snapshot.sourceDigest.slice(0, 8)}
                </p>
              ) : (
                <p className="verify-status-pill verify-status-stale">
                  No fresh passing check for {snapshot.sourceDigest.slice(0, 8)}
                </p>
              )}
              {linkedChecks.slice(0, 4).map((check) => (
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
              <span className="eyebrow">Approval</span>
              {snapshot.approvalValid ? (
                <p className="verify-status-pill verify-status-passed">
                  Approved for {snapshot.sourceDigest.slice(0, 12)}
                </p>
              ) : snapshot.approvalStaleReason ? (
                <p className="review-stale-warning" role="status">
                  {snapshot.approvalStaleReason}
                </p>
              ) : (
                <p className="review-aside-hint">
                  Approval binds to the current source snapshot and invalidates
                  automatically on edits.
                </p>
              )}
              {!snapshot.hasFreshPassingCheck && !snapshot.approvalValid && (
                <label className="review-field">
                  <span>Override reason (required without fresh pass)</span>
                  <input
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    placeholder="Why is it safe to approve without a passing check?"
                  />
                </label>
              )}
              <div className="review-aside-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={
                    actionPending ||
                    snapshot.approvalValid ||
                    snapshot.change.status === "integrated" ||
                    snapshot.change.status === "abandoned"
                  }
                  onClick={() => void handleApprove()}
                >
                  Approve snapshot
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={
                    actionPending ||
                    snapshot.change.status === "integrated" ||
                    snapshot.change.status === "abandoned"
                  }
                  onClick={() => void handleRequestRevision(false)}
                >
                  Request revision
                </button>
              </div>
            </section>

            <section className="review-aside-card">
              <span className="eyebrow">Guarded Integration</span>
              {snapshot.gitOperationInProgress && (
                <p className="inline-error" role="alert">
                  Git merge or rebase is in progress. Resolve it before
                  committing.
                </p>
              )}
              {snapshot.latestAttempt?.status === "succeeded" &&
                snapshot.latestAttempt.commitSha && (
                  <p className="verify-status-pill verify-status-passed">
                    Integrated · {snapshot.latestAttempt.commitSha.slice(0, 12)}
                  </p>
                )}
              {snapshot.latestAttempt &&
                (snapshot.latestAttempt.status === "failed" ||
                  snapshot.latestAttempt.status === "aborted") && (
                  <p className="review-stale-warning" role="status">
                    Last attempt ({snapshot.latestAttempt.status}):{" "}
                    {snapshot.latestAttempt.errorDetail ??
                      "Working tree preserved."}
                  </p>
                )}
              <label className="review-field">
                <span>Commit message</span>
                <textarea
                  rows={3}
                  value={commitMessage}
                  onChange={(event) => {
                    setCommitMessage(event.target.value);
                    setPreparedAttempt(undefined);
                  }}
                  placeholder="Describe this Change commit…"
                />
              </label>
              <p className="review-aside-hint">
                {selectedPaths.length} of {snapshot.changedFiles.length} changed
                file(s) selected. Unchecked files remain untouched.
              </p>
              {!preparedAttempt ? (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={
                    actionPending ||
                    !snapshot.approvalValid ||
                    snapshot.gitOperationInProgress ||
                    selectedPaths.length === 0 ||
                    !commitMessage.trim()
                  }
                  onClick={() => void handlePrepareIntegration()}
                >
                  Prepare integration
                </button>
              ) : (
                <div className="review-prepared-box">
                  <p>
                    <strong>Ready to commit</strong>{" "}
                    {preparedAttempt.selectedPaths.length} file(s) onto{" "}
                    <code>{snapshot.branch ?? "HEAD"}</code> (base{" "}
                    <code>{preparedAttempt.baseHead.slice(0, 10)}</code>).
                  </p>
                  <div className="review-aside-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={actionPending}
                      onClick={() => void handleExecuteIntegration()}
                    >
                      {actionPending
                        ? "Committing…"
                        : "Commit approved changes"}
                    </button>
                    <button
                      type="button"
                      className="button button-quiet"
                      disabled={actionPending}
                      onClick={() => setPreparedAttempt(undefined)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          </aside>
        )}
      </div>
    </section>
  );
}
