import { useCallback, useEffect, useState } from "react";
import type { AppService } from "../../services/app-service";
import type {
  BehaviorComparisonRecord,
  ExecutionRecord,
  NormalizationRules,
} from "../../services/contracts";
import {
  comparisonOutcomeLabel,
  comparisonOutcomeTone,
  DEFAULT_NORMALIZATION_RULES,
  findDefaultBaseline,
} from "./comparison-helpers";

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

export function BehaviorComparisonPanel({
  service,
  projectId,
  checks,
  changeId,
  requestedCandidateId,
  onJumpToExecution,
}: {
  service: AppService;
  projectId: string;
  checks: ExecutionRecord[];
  changeId?: string;
  requestedCandidateId?: string;
  onJumpToExecution: (executionId: string) => void;
}) {
  const [comparisons, setComparisons] = useState<BehaviorComparisonRecord[]>(
    [],
  );
  const [active, setActive] = useState<BehaviorComparisonRecord>();
  const [candidateId, setCandidateId] = useState<string>(checks[0]?.id ?? "");
  const [baselineId, setBaselineId] = useState<string>(() =>
    checks[0] ? (findDefaultBaseline(checks, checks[0].id)?.id ?? "") : "",
  );
  const [rules, setRules] = useState<NormalizationRules>(
    DEFAULT_NORMALIZATION_RULES,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const loadSaved = useCallback(async () => {
    try {
      const list = await service.listBehaviorComparisons(projectId);
      setComparisons(list);
      setActive((current) => {
        if (!current) return list[0];
        return list.find((item) => item.id === current.id) ?? list[0];
      });
    } catch {
      // Keep quiet on initial empty state if native service unavailable
    }
  }, [projectId, service]);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved, checks.length]);

  useEffect(() => {
    if (!requestedCandidateId) return;
    setCandidateId(requestedCandidateId);
    const fallbackBase = findDefaultBaseline(checks, requestedCandidateId);
    if (fallbackBase) {
      setBaselineId(fallbackBase.id);
    }
  }, [checks, requestedCandidateId]);

  useEffect(() => {
    if (checks.length < 2) return;
    if (!candidateId || !checks.some((c) => c.id === candidateId)) {
      const nextCand = checks[0].id;
      setCandidateId(nextCand);
      const nextBase = findDefaultBaseline(checks, nextCand);
      if (nextBase) setBaselineId(nextBase.id);
    } else if (!baselineId || baselineId === candidateId) {
      const nextBase = findDefaultBaseline(checks, candidateId);
      if (nextBase) setBaselineId(nextBase.id);
    }
  }, [baselineId, candidateId, checks]);

  async function runComparison(
    nextRules: NormalizationRules,
    persist: boolean,
  ) {
    if (!baselineId || !candidateId || baselineId === candidateId) {
      setError("Select two different recorded checks to compare.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const result = await service.compareExecutions(
        projectId,
        baselineId,
        candidateId,
        {
          changeId,
          normalization: nextRules,
          persist,
        },
      );
      setActive(result);
      if (persist) {
        await loadSaved();
      }
    } catch (failure) {
      setError(errorText(failure, "Comparison could not be computed."));
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(comparisonId: string) {
    setError(undefined);
    try {
      await service.deleteBehaviorComparison(projectId, comparisonId);
      setComparisons((current) =>
        current.filter((item) => item.id !== comparisonId),
      );
      setActive((current) =>
        current?.id === comparisonId ? undefined : current,
      );
    } catch (failure) {
      setError(errorText(failure, "Comparison could not be removed."));
    }
  }

  function toggleRule(key: keyof NormalizationRules) {
    const next = { ...rules, [key]: !rules[key] };
    setRules(next);
    if (baselineId && candidateId && baselineId !== candidateId) {
      void runComparison(next, false);
    }
  }

  return (
    <section
      className="compare-panel"
      aria-label="Narrow behavior comparison across recorded checks"
    >
      <div className="compare-panel-head">
        <div>
          <span className="eyebrow">Recorded check comparison</span>
          <p className="compare-panel-subtitle">
            Compare two recorded verification outputs under explicit
            normalization rules. Baseline failures are preserved, never hidden.
          </p>
        </div>
      </div>

      {checks.length < 2 ? (
        <p className="compare-empty">
          Run at least two checks (for example, before and after edits) to
          compare recorded outputs.
        </p>
      ) : (
        <div className="compare-controls">
          <label>
            Baseline run
            <select
              value={baselineId}
              onChange={(event) => setBaselineId(event.target.value)}
            >
              {checks.map((check) => (
                <option key={check.id} value={check.id}>
                  {check.program} {check.args.join(" ")} ·{" "}
                  {check.sourceDigest.slice(0, 8)} · {check.status} (exit{" "}
                  {check.exitCode ?? "—"})
                </option>
              ))}
            </select>
          </label>
          <label>
            Candidate run
            <select
              value={candidateId}
              onChange={(event) => setCandidateId(event.target.value)}
            >
              {checks.map((check) => (
                <option key={check.id} value={check.id}>
                  {check.program} {check.args.join(" ")} ·{" "}
                  {check.sourceDigest.slice(0, 8)} · {check.status} (exit{" "}
                  {check.exitCode ?? "—"})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button-primary"
            disabled={
              pending ||
              !baselineId ||
              !candidateId ||
              baselineId === candidateId
            }
            onClick={() => void runComparison(rules, true)}
          >
            {pending ? "Comparing…" : "Compare & record"}
          </button>
        </div>
      )}

      <fieldset className="compare-rules">
        <legend>Normalization rules (explicit, opt-in)</legend>
        <label>
          <input
            type="checkbox"
            checked={rules.stripAnsi}
            onChange={() => toggleRule("stripAnsi")}
          />
          Strip ANSI color codes
        </label>
        <label>
          <input
            type="checkbox"
            checked={rules.stripTimestamps}
            onChange={() => toggleRule("stripTimestamps")}
          />
          Normalize ISO timestamps
        </label>
        <label>
          <input
            type="checkbox"
            checked={rules.stripDurations}
            onChange={() => toggleRule("stripDurations")}
          />
          Normalize durations (ms/s)
        </label>
        <label>
          <input
            type="checkbox"
            checked={rules.trimTrailingWhitespace}
            onChange={() => toggleRule("trimTrailingWhitespace")}
          />
          Trim trailing whitespace
        </label>
      </fieldset>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      {active && (
        <article className="compare-result">
          <div className="compare-result-head">
            <span
              className={`verify-status-pill verify-status-${comparisonOutcomeTone(active.outcome)}`}
            >
              {comparisonOutcomeLabel(active.outcome)}
            </span>
            <strong>{active.label}</strong>
            <div className="compare-jump-actions">
              {active.baseline.present && (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => onJumpToExecution(active.baselineExecutionId)}
                >
                  Raw baseline ↗
                </button>
              )}
              {active.candidate.present && (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => onJumpToExecution(active.candidateExecutionId)}
                >
                  Raw candidate ↗
                </button>
              )}
            </div>
          </div>

          <div className="compare-meta-grid">
            <div>
              <span className="eyebrow">Baseline</span>
              <p>
                <code>{active.baseline.command}</code> ·{" "}
                {active.baseline.present
                  ? `digest ${active.baseline.sourceDigest.slice(0, 10)} · ${active.baseline.status} (exit ${active.baseline.exitCode ?? "—"})`
                  : "artifact missing"}
              </p>
              {active.baseline.environment && (
                <small>
                  {active.baseline.environment.os}/
                  {active.baseline.environment.arch}
                  {active.baseline.environment.programVersion
                    ? ` · ${active.baseline.environment.programVersion}`
                    : ""}
                </small>
              )}
            </div>
            <div>
              <span className="eyebrow">Candidate</span>
              <p>
                <code>{active.candidate.command}</code> ·{" "}
                {active.candidate.present
                  ? `digest ${active.candidate.sourceDigest.slice(0, 10)} · ${active.candidate.status} (exit ${active.candidate.exitCode ?? "—"})`
                  : "artifact missing"}
              </p>
              {active.candidate.environment && (
                <small>
                  {active.candidate.environment.os}/
                  {active.candidate.environment.arch}
                  {active.candidate.environment.programVersion
                    ? ` · ${active.candidate.environment.programVersion}`
                    : ""}
                </small>
              )}
            </div>
          </div>

          {active.warnings.length > 0 && (
            <ul
              className="compare-warning-list"
              aria-label="Comparison warnings"
            >
              {active.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.message}`}>
                  <strong>{warning.code}:</strong> {warning.message}
                </li>
              ))}
            </ul>
          )}

          {active.diffLines.length > 0 ? (
            <div
              className="compare-diff-block"
              role="region"
              aria-label="Normalized output diff"
            >
              <pre>
                {active.diffLines.map((line, index) => (
                  <div
                    key={index}
                    className={`compare-diff-line compare-diff-${line.kind}`}
                  >
                    <span className="compare-diff-gutter">
                      {line.kind === "removed"
                        ? "-"
                        : line.kind === "added"
                          ? "+"
                          : " "}
                    </span>
                    <span>{line.text}</span>
                  </div>
                ))}
              </pre>
              {active.diffTruncated && (
                <small className="compare-diff-note">
                  Diff truncated at 300 lines; inspect raw baseline and
                  candidate outputs for full text.
                </small>
              )}
            </div>
          ) : (
            <p className="compare-no-diff">
              {active.outcome === "missing_artifact"
                ? "Output diff unavailable because an execution artifact is missing."
                : "Normalized outputs have no line differences."}
            </p>
          )}

          <div className="compare-scope-disclosure">
            <p>{active.observedScope}</p>
            <p>{active.notCheckedScope}</p>
          </div>
        </article>
      )}

      {comparisons.length > 0 && (
        <div className="compare-history">
          <span className="eyebrow">
            Recorded comparisons ({comparisons.length})
          </span>
          <ul>
            {comparisons.slice(0, 8).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`compare-history-item${active?.id === item.id ? " is-active" : ""}`}
                  onClick={() => {
                    setActive(item);
                    setBaselineId(item.baselineExecutionId);
                    setCandidateId(item.candidateExecutionId);
                    setRules(item.normalization);
                  }}
                >
                  <span
                    className={`verify-status-pill verify-status-${comparisonOutcomeTone(item.outcome)}`}
                  >
                    {comparisonOutcomeLabel(item.outcome)}
                  </span>
                  <span>{item.label}</span>
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  aria-label={`Remove comparison ${item.label}`}
                  onClick={() => void handleDelete(item.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
