import { useState } from "react";
import type { AppService } from "../../services/app-service";
import type {
  ExecutionRecord,
  ExecutionStatus,
  ProjectRecipeSummary,
  ProjectSummary,
  RookContextChip,
  RookMode,
} from "../../services/contracts";
import { BehaviorComparisonPanel } from "../compare/BehaviorComparisonPanel";
import { LinkedStackOutput } from "../runs/RunPanel";
import { formatFailureContextExcerpt } from "../runs/stack-trace";
import type { EditorDocument } from "../../state/workspace-store";

export function executionStatusLabel(status: ExecutionStatus): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "stale":
      return "Stale";
    case "inconclusive":
      return "Inconclusive";
    case "timed_out":
      return "Timed out";
    case "start_failed":
      return "Start failed";
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Interrupted";
    case "running":
      return "Running";
  }
}

export function summarizeVerification(records: ExecutionRecord[]): {
  status: ExecutionStatus | "unverified";
  label: string;
  latest?: ExecutionRecord;
} {
  const latest = records[0];
  if (!latest) {
    return { status: "unverified", label: "Not verified" };
  }
  return {
    status: latest.status,
    label: `${executionStatusLabel(latest.status)} · ${latest.sourceDigest.slice(0, 8)}`,
    latest,
  };
}

export function VerifyDrawerPanel({
  service,
  activeProject,
  documents,
  executions,
  projectRecipes,
  verifyChangeId,
  workspaceTrusted,
  savingFiles,
  browserPreview,
  onTrustWorkspace,
  onSaveDocuments,
  onRunCheck,
  onRunProjectRecipe,
  onPruneExecutions,
  onJumpToLocation,
  onAttachContextChipToRook,
}: {
  service: AppService;
  activeProject?: ProjectSummary;
  documents: EditorDocument[];
  executions: ExecutionRecord[];
  projectRecipes: ProjectRecipeSummary[];
  verifyChangeId?: string;
  workspaceTrusted: boolean;
  savingFiles: boolean;
  browserPreview: boolean;
  onTrustWorkspace: () => Promise<void>;
  onSaveDocuments: (documents: EditorDocument[]) => Promise<boolean>;
  onRunCheck: (
    program: string,
    args: string[],
    changeId?: string,
  ) => Promise<void>;
  onRunProjectRecipe: (recipeName: string, changeId?: string) => Promise<void>;
  onPruneExecutions?: () => Promise<void>;
  onJumpToLocation: (
    relativePath: string,
    line: number,
    column?: number,
  ) => void;
  onAttachContextChipToRook: (chip: RookContextChip, mode?: RookMode) => void;
}) {
  const [program, setProgram] = useState("pnpm");
  const [argsText, setArgsText] = useState("test");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "passed" | "failed" | "stale" | "inconclusive" | "other"
  >("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [compareCandidateId, setCompareCandidateId] = useState<string>();
  const [showCompare, setShowCompare] = useState(false);
  const [highlightedExecutionId, setHighlightedExecutionId] =
    useState<string>();

  if (browserPreview || !activeProject) {
    return (
      <div className="verify-drawer-empty">
        <p role="status">
          Verification requires the native desktop app and an open project.
        </p>
      </div>
    );
  }

  const checks = executions.filter(
    (record) => record.projectId === activeProject.id,
  );
  const dirtyDocuments = documents.filter(
    (document) =>
      document.projectId === activeProject.id &&
      document.content !== document.savedContent,
  );
  const filteredChecks = checks.filter((check) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "other") {
      return !["passed", "failed", "stale", "inconclusive"].includes(
        check.status,
      );
    }
    return check.status === statusFilter;
  });

  async function executeWithOptionalSave(
    saveFirst: boolean,
    run: () => Promise<void>,
  ) {
    setPending(true);
    setError(undefined);
    try {
      if (saveFirst && dirtyDocuments.length > 0) {
        const saved = await onSaveDocuments(dirtyDocuments);
        if (!saved) {
          setError(
            "Unsaved files could not be saved. Resolve the save error before running checks.",
          );
          return;
        }
      }
      await run();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The verification check failed to run.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="verify-drawer">
      {dirtyDocuments.length > 0 && (
        <div
          className="verify-dirty-banner"
          role="status"
          aria-label="Unsaved editor files"
        >
          <p>
            <strong>
              {dirtyDocuments.length} open file
              {dirtyDocuments.length === 1 ? "" : "s"} ha
              {dirtyDocuments.length === 1 ? "s" : "ve"} unsaved edits.
            </strong>{" "}
            Checks run against saved disk source.
          </p>
          {workspaceTrusted && (
            <button
              type="button"
              className="button button-primary"
              disabled={pending || savingFiles || !program.trim()}
              onClick={() =>
                void executeWithOptionalSave(true, () =>
                  onRunCheck(
                    program,
                    argsText.trim().split(/\s+/).filter(Boolean),
                    verifyChangeId || undefined,
                  ),
                )
              }
            >
              Save all &amp; run check
            </button>
          )}
        </div>
      )}

      {projectRecipes.length > 0 && (
        <div
          className="verify-recipe-list"
          aria-label="Project verification recipes"
        >
          {projectRecipes.map((recipe) => (
            <button
              key={recipe.name}
              type="button"
              className="button button-quiet"
              disabled={!workspaceTrusted || pending || savingFiles}
              title={`${recipe.program} ${recipe.args.join(" ")}${recipe.cwd ? ` (cwd: ${recipe.cwd})` : ""}`}
              onClick={() =>
                void executeWithOptionalSave(dirtyDocuments.length > 0, () =>
                  onRunProjectRecipe(recipe.name, verifyChangeId || undefined),
                )
              }
            >
              <span>{recipe.name}</span>
              <code>
                {recipe.program} {recipe.args.join(" ")}
              </code>
            </button>
          ))}
        </div>
      )}

      <form
        className="check-run-form verify-drawer-form"
        onSubmit={(event) => {
          event.preventDefault();
          void executeWithOptionalSave(false, () =>
            onRunCheck(
              program,
              argsText.trim().split(/\s+/).filter(Boolean),
              verifyChangeId || undefined,
            ),
          );
        }}
      >
        <label>
          Executable{" "}
          <input
            value={program}
            onChange={(event) => setProgram(event.target.value)}
          />
        </label>
        <label>
          Arguments{" "}
          <input
            value={argsText}
            onChange={(event) => setArgsText(event.target.value)}
          />
        </label>
        {!workspaceTrusted ? (
          <button
            type="button"
            className="button button-quiet"
            disabled={pending}
            onClick={() => {
              setError(undefined);
              void onTrustWorkspace().catch((failure) =>
                setError(
                  failure instanceof Error
                    ? failure.message
                    : "Project trust could not be saved.",
                ),
              );
            }}
          >
            Trust project to run checks
          </button>
        ) : pending ? (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => void service.cancelCheck()}
          >
            Cancel check
          </button>
        ) : (
          <button
            className="button button-primary"
            disabled={pending || !program.trim()}
          >
            {dirtyDocuments.length > 0 ? "Run on saved disk" : "Run check"}
          </button>
        )}
        <select
          aria-label="Filter verification status"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(
              event.target.value as
                | "all"
                | "passed"
                | "failed"
                | "stale"
                | "inconclusive"
                | "other",
            )
          }
        >
          <option value="all">All ({checks.length})</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="stale">Stale</option>
          <option value="inconclusive">Inconclusive</option>
          <option value="other">Other</option>
        </select>
        {checks.length >= 2 && (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setShowCompare((v) => !v)}
          >
            {showCompare ? "Hide compare" : "Compare runs"}
          </button>
        )}
        {checks.length > 50 && onPruneExecutions && (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => void onPruneExecutions()}
          >
            Prune ({checks.length} → 50)
          </button>
        )}
      </form>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      {showCompare && (
        <BehaviorComparisonPanel
          service={service}
          projectId={activeProject.id}
          checks={checks}
          changeId={verifyChangeId || undefined}
          requestedCandidateId={compareCandidateId}
          onJumpToExecution={(executionId) => {
            setHighlightedExecutionId(executionId);
            const el = document.getElementById(`execution-${executionId}`);
            el?.scrollIntoView({ behavior: "auto", block: "center" });
          }}
        />
      )}

      <div className="execution-list verify-drawer-list">
        {filteredChecks.map((check) => {
          const durationMs =
            check.finishedAt !== null
              ? Math.max(0, check.finishedAt - check.startedAt)
              : null;
          return (
            <article
              key={check.id}
              id={`execution-${check.id}`}
              className={
                highlightedExecutionId === check.id
                  ? "is-highlighted-execution"
                  : undefined
              }
            >
              <div>
                <div className="verify-record-header">
                  <span
                    className={`verify-status-pill verify-status-${check.status}`}
                  >
                    {executionStatusLabel(check.status)}
                  </span>
                  {checks.length >= 2 && (
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => {
                        setCompareCandidateId(check.id);
                        setShowCompare(true);
                      }}
                    >
                      Compare
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={!workspaceTrusted || pending}
                    onClick={() =>
                      void executeWithOptionalSave(
                        dirtyDocuments.length > 0,
                        () =>
                          onRunCheck(
                            check.program,
                            check.args,
                            check.changeId ?? undefined,
                          ),
                      )
                    }
                  >
                    {dirtyDocuments.length > 0 ? "Save & rerun" : "Rerun"}
                  </button>
                  {check.status === "failed" && (
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() =>
                        onAttachContextChipToRook(
                          {
                            id: `verify-${check.id}`,
                            kind: "verify_failure",
                            label:
                              `Verify failure · ${check.program} ${check.args.join(" ")}`.slice(
                                0,
                                64,
                              ),
                            content: formatFailureContextExcerpt(
                              `${check.program} ${check.args.join(" ")}`,
                              check.output,
                              activeProject.path,
                            ),
                          },
                          "ask",
                        )
                      }
                    >
                      Investigate in Rook ↗
                    </button>
                  )}
                </div>
                <strong>
                  {check.program} {check.args.join(" ")}
                </strong>
                <span>
                  Digest {check.sourceDigest.slice(0, 12)} · exit{" "}
                  {check.exitCode ?? "—"}
                  {durationMs !== null
                    ? ` · ${(durationMs / 1000).toFixed(1)}s`
                    : ""}
                </span>
              </div>
              <LinkedStackOutput
                output={check.output}
                projectPath={activeProject.path}
                onJump={(relativePath, line, column) =>
                  onJumpToLocation(relativePath, line, column)
                }
              />
            </article>
          );
        })}
        {filteredChecks.length === 0 && (
          <p className="inspector-muted">
            {checks.length === 0
              ? "No verification records yet."
              : "No verification records match the current filter."}
          </p>
        )}
      </div>
    </div>
  );
}
