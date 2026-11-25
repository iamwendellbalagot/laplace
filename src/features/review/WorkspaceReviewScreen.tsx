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
  BehaviorComparisonRecord,
  ExecutionRecord,
  GitDiffPair,
  ImpactFileAnalysis,
  ProjectRecipeSummary,
  ProjectSummary,
  RevertTarget,
  ReviewDiffBaseline,
  RookContextChip,
  RookMode,
  UiPreferences,
  WalkthroughStep,
  WorkspaceImpactReport,
  WorkspaceReviewSnapshot,
  WorkspaceWalkthrough,
} from "../../services/contracts";
import {
  comparisonOutcomeLabel,
  comparisonOutcomeTone,
  formatComparisonMarkdown,
} from "../compare/comparison-helpers";
import { computeDiffHunks, impactRoleLabel, type DiffHunk } from "./diff-hunks";
import { WalkthroughSidebar } from "./WalkthroughSidebar";
import {
  findNextUnreviewedStep,
  formatWalkthroughNarrationPrompt,
  reconcileReviewedSteps,
  stepDisplayTitle,
  type WalkthroughFilter,
} from "./walkthrough-helpers";

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
  onRunQuickCheck,
  onSendNotesToRook,
  onAskRookWithContext,
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
  onRunQuickCheck?: (program: string, args: string[]) => Promise<void>;
  onSendNotesToRook: (prompt: string) => void;
  onAskRookWithContext?: (
    chip: RookContextChip,
    promptText: string,
    mode?: RookMode,
  ) => void;
  onWorkspaceMutated: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<WorkspaceReviewSnapshot>();
  const [impactReport, setImpactReport] = useState<WorkspaceImpactReport>();
  const [walkthrough, setWalkthrough] = useState<WorkspaceWalkthrough>();
  const [viewMode, setViewMode] = useState<"walkthrough" | "role" | "flat">(
    "walkthrough",
  );
  const [activeStepId, setActiveStepId] = useState<string>();
  const [reviewedStepIds, setReviewedStepIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [reviewedDigest, setReviewedDigest] = useState<string>();
  const [walkthroughFilter, setWalkthroughFilter] =
    useState<WalkthroughFilter>("all");
  const [activeHunkIndex, setActiveHunkIndex] = useState(0);
  const [revealModifiedLine, setRevealModifiedLine] = useState<number>();
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
  const [comparisons, setComparisons] = useState<BehaviorComparisonRecord[]>(
    [],
  );

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
      if (next.changedFiles.length > 0 && service.getWorkspaceImpactReport) {
        void service
          .getWorkspaceImpactReport(project.id)
          .then(setImpactReport)
          .catch(() => setImpactReport(undefined));
      } else {
        setImpactReport(undefined);
      }
      if (next.changedFiles.length > 0 && service.getWorkspaceWalkthrough) {
        const effectiveBaseline: ReviewDiffBaseline =
          diffBaseline === "last_review" && next.lastCheckpointDigest
            ? "last_review"
            : "head";
        void service
          .getWorkspaceWalkthrough(project.id, effectiveBaseline)
          .then((wt) => {
            setWalkthrough(wt);
            setReviewedStepIds((prev) =>
              reconcileReviewedSteps(
                reviewedDigest,
                wt.sourceDigest,
                prev,
                wt.steps,
              ),
            );
            setReviewedDigest(wt.sourceDigest);
            setActiveStepId((current) =>
              current && wt.steps.some((s) => s.id === current)
                ? current
                : wt.steps[0]?.id,
            );
          })
          .catch(() => setWalkthrough(undefined));
      } else {
        setWalkthrough(undefined);
        setActiveStepId(undefined);
      }
    } catch (failure) {
      setError(errorText(failure, "Working-tree review could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [diffBaseline, project.id, reviewedDigest, service]);

  useEffect(() => {
    void loadReview();
    void service
      .listBehaviorComparisons(project.id)
      .then(setComparisons)
      .catch(() => setComparisons([]));
  }, [loadReview, project.id, service, syncVersion]);

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

  const hunks = useMemo<DiffHunk[]>(() => {
    if (
      diffPair?.kind !== "text" ||
      diffPair.original === undefined ||
      diffPair.original === null
    ) {
      return [];
    }
    return computeDiffHunks(
      diffPair.original,
      editedContent ?? diffPair.modified ?? "",
    );
  }, [diffPair, editedContent]);

  useEffect(() => {
    setActiveHunkIndex(0);
    setRevealModifiedLine(undefined);
  }, [selectedFile, diffBaseline]);

  useEffect(() => {
    if (hunks.length === 0) {
      setActiveHunkIndex(0);
    } else if (activeHunkIndex >= hunks.length) {
      setActiveHunkIndex(hunks.length - 1);
    }
  }, [activeHunkIndex, hunks.length]);

  const activeHunk = hunks[activeHunkIndex];

  const hasWalkthrough = Boolean(walkthrough && walkthrough.steps.length > 0);
  const inWalkthroughMode = viewMode === "walkthrough" && hasWalkthrough;

  const activeWalkthroughStep = useMemo(() => {
    if (!inWalkthroughMode || !walkthrough) return undefined;
    return (
      walkthrough.steps.find((s) => s.id === activeStepId) ??
      walkthrough.steps[0]
    );
  }, [activeStepId, inWalkthroughMode, walkthrough]);

  const activeWalkthroughChapter = useMemo(() => {
    if (!activeWalkthroughStep || !walkthrough) return undefined;
    return walkthrough.chapters.find(
      (c) => c.id === activeWalkthroughStep.chapter,
    );
  }, [activeWalkthroughStep, walkthrough]);

  const selectWalkthroughStep = useCallback((step: WalkthroughStep) => {
    setActiveStepId(step.id);
    setSelectedFile(step.filePath);
    setActiveHunkIndex(step.hunkIndex ?? 0);
    setRevealModifiedLine(Math.max(1, step.newStart || step.oldStart || 1));
  }, []);

  // Keep selectedFile and diff scroll synced when entering Walkthrough mode or changing steps
  useEffect(() => {
    if (!inWalkthroughMode || !activeWalkthroughStep) return;
    if (selectedFile !== activeWalkthroughStep.filePath) {
      setSelectedFile(activeWalkthroughStep.filePath);
    }
    const targetHunk = activeWalkthroughStep.hunkIndex ?? 0;
    setActiveHunkIndex(targetHunk);
    setRevealModifiedLine(
      Math.max(
        1,
        activeWalkthroughStep.newStart || activeWalkthroughStep.oldStart || 1,
      ),
    );
  }, [activeWalkthroughStep, inWalkthroughMode, selectedFile]);

  const handleToggleStepReviewed = useCallback((stepId: string) => {
    setReviewedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  }, []);

  const handleMarkReviewedAndNext = useCallback(() => {
    if (!walkthrough || !activeWalkthroughStep) return;
    const nextReviewed = new Set(reviewedStepIds);
    nextReviewed.add(activeWalkthroughStep.id);
    setReviewedStepIds(nextReviewed);
    const nextStep = findNextUnreviewedStep(
      walkthrough.steps,
      nextReviewed,
      activeWalkthroughStep.id,
    );
    if (nextStep) {
      selectWalkthroughStep(nextStep);
    } else {
      const currentIdx = walkthrough.steps.findIndex(
        (s) => s.id === activeWalkthroughStep.id,
      );
      const fallbackNext = walkthrough.steps[currentIdx + 1];
      if (fallbackNext) {
        selectWalkthroughStep(fallbackNext);
      }
    }
  }, [
    activeWalkthroughStep,
    reviewedStepIds,
    selectWalkthroughStep,
    walkthrough,
  ]);

  const handleStepOffset = useCallback(
    (delta: -1 | 1) => {
      if (!walkthrough || walkthrough.steps.length === 0) return;
      const currentIdx = activeWalkthroughStep
        ? walkthrough.steps.findIndex((s) => s.id === activeWalkthroughStep.id)
        : 0;
      const nextIdx = Math.max(
        0,
        Math.min(walkthrough.steps.length - 1, currentIdx + delta),
      );
      const target = walkthrough.steps[nextIdx];
      if (target) {
        selectWalkthroughStep(target);
      }
    },
    [activeWalkthroughStep, selectWalkthroughStep, walkthrough],
  );

  useEffect(() => {
    if (!inWalkthroughMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.classList.contains("inputarea"))
      ) {
        return;
      }
      if (event.key === "n" || event.key === "]") {
        event.preventDefault();
        handleStepOffset(1);
      } else if (event.key === "p" || event.key === "[") {
        event.preventDefault();
        handleStepOffset(-1);
      } else if (event.key === "r") {
        event.preventDefault();
        handleMarkReviewedAndNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleMarkReviewedAndNext, handleStepOffset, inWalkthroughMode]);

  function handleNarrateWalkthroughInRook() {
    if (!walkthrough || walkthrough.steps.length === 0) return;
    const prompt = formatWalkthroughNarrationPrompt(walkthrough);
    if (onAskRookWithContext) {
      onAskRookWithContext(
        {
          id: `walkthrough:${walkthrough.sourceDigest.slice(0, 10)}`,
          kind: "context_bundle",
          label: `Walkthrough (${walkthrough.totalSteps} steps)`,
          content: prompt,
        },
        prompt,
        "ask",
      );
    } else {
      onSendNotesToRook(prompt);
    }
  }

  async function handleRevertHunk(hunk: DiffHunk) {
    if (!selectedFile || !diffPair || inlineDirty) return;
    if (
      !window.confirm(
        `Revert hunk ${hunk.header} in "${selectedFile}" back to ${diffBaseline === "last_review" ? "checkpoint" : "HEAD"}?`,
      )
    ) {
      return;
    }
    setActionPending(true);
    setError(undefined);
    setStatusMessage(undefined);
    try {
      const next = await service.revertWorkspaceHunk(project.id, selectedFile, {
        baseline: diffBaseline,
        oldStart: hunk.oldStart,
        oldCount: hunk.oldCount,
        newStart: hunk.newStart,
        newCount: hunk.newCount,
        expectedModified: diffPair.modified ?? "",
      });
      setSnapshot(next);
      setStatusMessage(`Reverted hunk ${hunk.header} in ${selectedFile}.`);
      await onWorkspaceMutated();
      await loadReview();
    } catch (failure) {
      setError(errorText(failure, `Could not revert hunk in ${selectedFile}.`));
    } finally {
      setActionPending(false);
    }
  }

  function handleAskRookAboutHunk(hunk: DiffHunk) {
    if (!selectedFile || !onAskRookWithContext) return;
    const startLine = Math.max(1, hunk.newStart || hunk.oldStart || 1);
    const endLine = startLine + Math.max(0, hunk.newCount - 1);
    onAskRookWithContext(
      {
        id: `hunk:${selectedFile}:${hunk.header}`,
        kind: "selection",
        label: `${selectedFile}:${startLine}`,
        filePath: selectedFile,
        startLine,
        endLine,
        content: `${selectedFile} ${hunk.header}\n${hunk.snippet}`,
      },
      `Explain why this hunk (${selectedFile}:${startLine}) was changed and whether callers or tests could break.`,
      "ask",
    );
  }

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
      "",
      "## Behavior comparisons",
      ...(comparisons.length > 0
        ? comparisons.slice(0, 5).map(formatComparisonMarkdown)
        : ["- None recorded"]),
    ];
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(`${lines.join("\n")}\n`).then(
        () => setStatusMessage("Review summary copied to clipboard."),
        () => setStatusMessage("Clipboard unavailable."),
      );
    }
  }

  const fileAnalysisByPath = useMemo(() => {
    const map = new Map<string, ImpactFileAnalysis>();
    for (const entry of impactReport?.files ?? []) {
      map.set(entry.path, entry);
    }
    return map;
  }, [impactReport]);

  const activeFileImpact = selectedFile
    ? fileAnalysisByPath.get(selectedFile)
    : undefined;

  const groupedVisibleFiles = useMemo(() => {
    if (
      viewMode !== "role" ||
      !impactReport ||
      impactReport.files.length === 0
    ) {
      return [{ role: "all", label: "Changed files", files: visibleFiles }];
    }
    const order = [
      "backend",
      "api_service",
      "state",
      "ui",
      "tests",
      "config_docs",
    ];
    const buckets = new Map<string, typeof visibleFiles>();
    for (const file of visibleFiles) {
      const role = fileAnalysisByPath.get(file.path)?.role ?? "ui";
      const list = buckets.get(role) ?? [];
      list.push(file);
      buckets.set(role, list);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
      .map(([role, files]) => ({
        role,
        label: impactRoleLabel(role),
        files,
      }));
  }, [fileAnalysisByPath, impactReport, viewMode, visibleFiles]);

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
            <strong>Unsaved edits detected.</strong> Save so the diff and commit
            match disk.
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
                {savingFiles ? "Saving…" : `Save ${dirtyCount} editor tab(s)`}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="review-layout">
        {snapshot && visibleFiles.length > 0 && (
          <aside className="review-files-sidebar" aria-label="Changed files">
            <div className="review-files-sidebar-head">
              <div className="review-files-sidebar-title">
                <input
                  type="checkbox"
                  aria-label="Select all changed files for commit"
                  checked={
                    visibleFiles.length > 0 &&
                    visibleFiles.every((f) => selectedPaths.includes(f.path))
                  }
                  onChange={(event) => {
                    if (event.target.checked) {
                      setSelectedPaths(visibleFiles.map((f) => f.path));
                    } else {
                      setSelectedPaths([]);
                    }
                  }}
                />
                <span>
                  {inWalkthroughMode
                    ? "Walkthrough"
                    : `Changed (${visibleFiles.length})`}
                </span>
              </div>
              <div
                className="review-view-switch"
                role="group"
                aria-label="Review view mode"
              >
                {hasWalkthrough && (
                  <button
                    type="button"
                    className={`review-view-btn${viewMode === "walkthrough" ? " is-active" : ""}`}
                    onClick={() => setViewMode("walkthrough")}
                  >
                    Story
                  </button>
                )}
                {impactReport && impactReport.files.length > 0 && (
                  <button
                    type="button"
                    className={`review-view-btn${viewMode === "role" ? " is-active" : ""}`}
                    onClick={() => setViewMode("role")}
                  >
                    Role
                  </button>
                )}
                <button
                  type="button"
                  className={`review-view-btn${viewMode === "flat" ? " is-active" : ""}`}
                  onClick={() => setViewMode("flat")}
                >
                  Flat
                </button>
              </div>
            </div>
            {inWalkthroughMode && walkthrough ? (
              <WalkthroughSidebar
                walkthrough={walkthrough}
                activeStepId={activeWalkthroughStep?.id}
                reviewedIds={reviewedStepIds}
                filter={walkthroughFilter}
                onFilterChange={setWalkthroughFilter}
                onSelectStep={selectWalkthroughStep}
                onToggleReviewed={handleToggleStepReviewed}
                onNarrateInRook={handleNarrateWalkthroughInRook}
              />
            ) : (
              <div
                className="review-file-list"
                role="list"
                aria-label="Changed files list"
              >
                {groupedVisibleFiles.map((group) => (
                  <div className="review-role-group" key={group.role}>
                    {groupedVisibleFiles.length > 1 && (
                      <span className="review-role-heading">
                        {group.label} ({group.files.length})
                      </span>
                    )}
                    {group.files.map((file) => {
                      const checked = selectedPaths.includes(file.path);
                      const active = selectedFile === file.path;
                      const fileImpact = fileAnalysisByPath.get(file.path);
                      const baseName = file.path.split("/").at(-1) ?? file.path;
                      const dirName = file.path.includes("/")
                        ? file.path.slice(0, file.path.lastIndexOf("/"))
                        : "";
                      return (
                        <div
                          key={file.path}
                          className={`review-file-row${active ? " is-active" : ""}`}
                          role="listitem"
                          title={fileImpact?.summary ?? file.path}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Include ${file.path} in commit`}
                            checked={checked}
                            onChange={(event) =>
                              setSelectedPaths((current) =>
                                event.target.checked
                                  ? [...new Set([...current, file.path])]
                                  : current.filter(
                                      (item) => item !== file.path,
                                    ),
                              )
                            }
                          />
                          <button
                            type="button"
                            className="review-file-select"
                            onClick={() => setSelectedFile(file.path)}
                          >
                            <span className="review-file-badge">
                              {fileBadge(file.indexStatus, file.worktreeStatus)}
                            </span>
                            <span className="review-file-name">
                              <strong>{baseName}</strong>
                              {dirName && <small>{dirName}</small>}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}

        <div className="review-center">
          {snapshot && visibleFiles.length > 0 ? (
            <>
              <div className="review-files-bar">
                <span className="review-active-file-path" title={selectedFile}>
                  {selectedFile ?? "Select a file"}
                </span>
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
              {inWalkthroughMode && activeWalkthroughStep && walkthrough ? (
                <div
                  className="walkthrough-banner"
                  role="region"
                  aria-label="Active walkthrough step"
                >
                  <div className="walkthrough-banner-top">
                    <div className="walkthrough-banner-heading">
                      <span className="walkthrough-step-counter">
                        Step {activeWalkthroughStep.order} of{" "}
                        {walkthrough.totalSteps}
                      </span>
                      {activeWalkthroughChapter && (
                        <span className="status-pill">
                          {activeWalkthroughChapter.title}
                        </span>
                      )}
                      <strong className="walkthrough-banner-symbol">
                        {stepDisplayTitle(activeWalkthroughStep)}
                      </strong>
                      {activeWalkthroughStep.header && (
                        <code>{activeWalkthroughStep.header}</code>
                      )}
                    </div>
                    <div className="walkthrough-banner-nav">
                      <button
                        type="button"
                        className="button button-quiet"
                        disabled={activeWalkthroughStep.order <= 1}
                        title="Previous step (p)"
                        onClick={() => handleStepOffset(-1)}
                      >
                        ← Prev
                      </button>
                      <button
                        type="button"
                        className="button button-primary"
                        title="Mark reviewed and jump to next unreviewed step (r)"
                        onClick={handleMarkReviewedAndNext}
                      >
                        {reviewedStepIds.has(activeWalkthroughStep.id)
                          ? "Next →"
                          : "✓ Reviewed & Next"}
                      </button>
                    </div>
                  </div>
                  <div className="walkthrough-banner-bottom">
                    <p className="walkthrough-causal-reason">
                      {activeWalkthroughStep.causalReason}
                    </p>
                    <div className="walkthrough-banner-chips">
                      {activeWalkthroughStep.riskReasons.map((reason) => (
                        <span
                          key={reason}
                          className={`walkthrough-risk-pill is-${activeWalkthroughStep.riskLevel}`}
                        >
                          {reason}
                        </span>
                      ))}
                      <label className="walkthrough-commit-toggle">
                        <input
                          type="checkbox"
                          checked={selectedPaths.includes(
                            activeWalkthroughStep.filePath,
                          )}
                          onChange={(event) =>
                            setSelectedPaths((current) =>
                              event.target.checked
                                ? [
                                    ...new Set([
                                      ...current,
                                      activeWalkthroughStep.filePath,
                                    ]),
                                  ]
                                : current.filter(
                                    (item) =>
                                      item !== activeWalkthroughStep.filePath,
                                  ),
                            )
                          }
                        />
                        <span>In commit</span>
                      </label>
                      {activeHunk && (
                        <>
                          <button
                            type="button"
                            className="button button-quiet"
                            disabled={actionPending || inlineDirty}
                            title={
                              inlineDirty
                                ? "Save or discard inline diff edits first"
                                : "Revert only this hunk"
                            }
                            onClick={() => void handleRevertHunk(activeHunk)}
                          >
                            Revert hunk
                          </button>
                          <button
                            type="button"
                            className="button button-quiet"
                            onClick={() =>
                              setCommentLine(
                                String(
                                  Math.max(
                                    1,
                                    activeHunk.newStart ||
                                      activeHunk.oldStart ||
                                      1,
                                  ),
                                ),
                              )
                            }
                          >
                            Note line
                          </button>
                          {onAskRookWithContext && (
                            <button
                              type="button"
                              className="button button-quiet"
                              onClick={() => handleAskRookAboutHunk(activeHunk)}
                            >
                              Ask Rook why ↗
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                diffPair?.kind === "text" &&
                hunks.length > 0 &&
                activeHunk && (
                  <div
                    className="review-hunk-bar"
                    role="region"
                    aria-label="Hunk controls"
                  >
                    <div className="review-hunk-meta">
                      <strong>
                        Hunk {activeHunkIndex + 1} of {hunks.length}
                      </strong>
                      <code>{activeHunk.header}</code>
                    </div>
                    <div className="review-hunk-actions">
                      <button
                        type="button"
                        className="button button-quiet"
                        disabled={activeHunkIndex <= 0}
                        title="Previous hunk"
                        onClick={() => {
                          const prev = Math.max(0, activeHunkIndex - 1);
                          setActiveHunkIndex(prev);
                          setRevealModifiedLine(
                            Math.max(
                              1,
                              hunks[prev].newStart || hunks[prev].oldStart,
                            ),
                          );
                        }}
                      >
                        ↑ Prev
                      </button>
                      <button
                        type="button"
                        className="button button-quiet"
                        disabled={activeHunkIndex >= hunks.length - 1}
                        title="Next hunk"
                        onClick={() => {
                          const next = Math.min(
                            hunks.length - 1,
                            activeHunkIndex + 1,
                          );
                          setActiveHunkIndex(next);
                          setRevealModifiedLine(
                            Math.max(
                              1,
                              hunks[next].newStart || hunks[next].oldStart,
                            ),
                          );
                        }}
                      >
                        ↓ Next
                      </button>
                      <button
                        type="button"
                        className="button button-quiet"
                        disabled={actionPending || inlineDirty}
                        title={
                          inlineDirty
                            ? "Save or discard inline diff edits first"
                            : "Revert only this hunk"
                        }
                        onClick={() => void handleRevertHunk(activeHunk)}
                      >
                        Revert hunk
                      </button>
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() =>
                          setCommentLine(
                            String(
                              Math.max(
                                1,
                                activeHunk.newStart || activeHunk.oldStart || 1,
                              ),
                            ),
                          )
                        }
                      >
                        Note line
                      </button>
                      {onAskRookWithContext && (
                        <button
                          type="button"
                          className="button button-quiet"
                          onClick={() => handleAskRookAboutHunk(activeHunk)}
                        >
                          Ask Rook why ↗
                        </button>
                      )}
                    </div>
                  </div>
                )
              )}
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
                      revealLine={revealModifiedLine}
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
        </div>

        {snapshot && (
          <aside className="review-aside" aria-label="Verify and commit">
            <section
              className="review-aside-card review-comments"
              aria-label="Review notes"
            >
              <div className="review-section-head">
                <span className="eyebrow">
                  Review notes ({fileComments.length})
                </span>
                {unresolvedCount > 0 && (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={actionPending}
                    onClick={handleSendNotesToRook}
                  >
                    Send {unresolvedCount} to Rook ↗
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
                    placeholder="Ln"
                    aria-label="Line number (optional)"
                    value={commentLine}
                    onChange={(event) => setCommentLine(event.target.value)}
                  />
                  <input
                    className="review-body-input"
                    placeholder={`Note for ${selectedFile.split("/").at(-1)}…`}
                    aria-label="Review note"
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="button button-quiet"
                    disabled={actionPending || !commentBody.trim()}
                  >
                    Add
                  </button>
                </form>
              )}
              {fileComments.length > 0 && (
                <ul className="review-comment-list">
                  {fileComments.map((comment) => (
                    <li
                      key={comment.id}
                      className={comment.resolved ? "is-resolved" : ""}
                    >
                      <div>
                        <strong>
                          {comment.filePath.split("/").at(-1)}
                          {comment.lineNumber ? `:${comment.lineNumber}` : ""}
                        </strong>
                        <p>{comment.body}</p>
                      </div>
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() =>
                          void handleToggleComment(
                            comment.id,
                            !comment.resolved,
                          )
                        }
                      >
                        {comment.resolved ? "Reopen" : "Resolve"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {impactReport && (
              <section
                className="review-aside-card review-impact-card"
                aria-label="Blast radius"
              >
                <div className="review-section-head">
                  <span className="eyebrow">Blast radius</span>
                  {activeFileImpact && (
                    <span className="status-pill">
                      {impactRoleLabel(activeFileImpact.role)}
                    </span>
                  )}
                </div>
                {impactReport.warnings.length > 0 && (
                  <ul className="review-warning-list">
                    {impactReport.warnings.map((warning) => (
                      <li
                        key={warning.kind}
                        className={`review-warning-item is-${warning.severity}`}
                      >
                        <p>{warning.message}</p>
                        {warning.paths.length > 0 && (
                          <div className="review-warning-paths">
                            {warning.paths.slice(0, 4).map((p) => (
                              <button
                                key={p}
                                type="button"
                                className="review-inline-link"
                                onClick={() => onOpenInEditor(p)}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {activeFileImpact ? (
                  <div className="review-impact-details">
                    {activeFileImpact.staleNote && (
                      <div className="review-stale-note-box" role="status">
                        <strong>Stale context note</strong>
                        <p>{activeFileImpact.staleNote.summary}</p>
                      </div>
                    )}
                    <div className="review-impact-group">
                      <small>
                        Direct callers ({activeFileImpact.directCallers.length})
                      </small>
                      {activeFileImpact.directCallers.length === 0 ? (
                        <p className="review-aside-hint">
                          No observed workspace importers.
                        </p>
                      ) : (
                        <ul className="review-impact-links">
                          {activeFileImpact.directCallers
                            .slice(0, 5)
                            .map((caller) => (
                              <li key={caller.filePath}>
                                <button
                                  type="button"
                                  className="review-inline-link"
                                  onClick={() =>
                                    onOpenInEditor(caller.filePath)
                                  }
                                >
                                  {caller.filePath}
                                  {caller.line ? `:${caller.line}` : ""}
                                </button>
                                <span className="status-pill">
                                  {caller.alsoChanged ? "in diff" : "untouched"}
                                </span>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                    <div className="review-impact-group">
                      <small>
                        Related tests ({activeFileImpact.relatedTests.length})
                      </small>
                      {activeFileImpact.relatedTests.length === 0 ? (
                        <p className="review-aside-hint">
                          No linked tests matched.
                        </p>
                      ) : (
                        <ul className="review-impact-links">
                          {activeFileImpact.relatedTests
                            .slice(0, 5)
                            .map((test) => (
                              <li key={test.filePath}>
                                <button
                                  type="button"
                                  className="review-inline-link"
                                  onClick={() => onOpenInEditor(test.filePath)}
                                >
                                  {test.filePath}
                                </button>
                                <span className="status-pill">
                                  {test.provenance}
                                </span>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="review-aside-hint">
                    Select a changed file to inspect its callers and tests.
                  </p>
                )}
                {impactReport.recommendedChecks.length > 0 && (
                  <div className="review-impact-group">
                    <small>Recommended checks</small>
                    {impactReport.recommendedChecks.slice(0, 3).map((chk) => (
                      <div className="review-check-row" key={chk.id}>
                        <span title={chk.reason}>{chk.label}</span>
                        {workspaceTrusted &&
                          (onRunQuickRecipe || onRunQuickCheck) && (
                            <button
                              type="button"
                              className="button button-quiet"
                              disabled={actionPending}
                              onClick={() => {
                                setActionPending(true);
                                const promise =
                                  chk.recipeName && onRunQuickRecipe
                                    ? onRunQuickRecipe(chk.recipeName)
                                    : onRunQuickCheck?.(chk.program, chk.args);
                                void promise
                                  ?.then(() => loadReview())
                                  .catch((failure) =>
                                    setError(
                                      errorText(
                                        failure,
                                        "Check failed to run.",
                                      ),
                                    ),
                                  )
                                  .finally(() => setActionPending(false));
                              }}
                            >
                              {chk.isFresh ? "Re-run ✓" : "Run"}
                            </button>
                          )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

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
              {comparisons.length > 0 && (
                <div className="review-comparison-strip">
                  <span className="eyebrow">Behavior comparisons</span>
                  {comparisons.slice(0, 3).map((cmp) => (
                    <div className="review-check-row" key={cmp.id}>
                      <span title={cmp.observedScope}>{cmp.label}</span>
                      <span
                        className={`verify-status-pill verify-status-${comparisonOutcomeTone(cmp.outcome)}`}
                      >
                        {comparisonOutcomeLabel(cmp.outcome)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
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
