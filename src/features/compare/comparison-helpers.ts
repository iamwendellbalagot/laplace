import type {
  BehaviorComparisonRecord,
  ComparisonOutcome,
  ExecutionRecord,
  NormalizationRules,
} from "../../services/contracts";

export const DEFAULT_NORMALIZATION_RULES: NormalizationRules = {
  stripAnsi: true,
  stripTimestamps: false,
  stripDurations: false,
  trimTrailingWhitespace: false,
};

export function comparisonOutcomeLabel(outcome: ComparisonOutcome): string {
  switch (outcome) {
    case "equal":
      return "Equal";
    case "different":
      return "Different";
    case "regressed":
      return "Regressed";
    case "fixed":
      return "Fixed (baseline failed)";
    case "baseline_failed":
      return "Baseline failed";
    case "missing_artifact":
      return "Missing artifact";
    case "inconclusive":
      return "Inconclusive";
  }
}

export function comparisonOutcomeTone(
  outcome: ComparisonOutcome,
): "passed" | "failed" | "stale" | "inconclusive" {
  switch (outcome) {
    case "equal":
    case "fixed":
      return "passed";
    case "regressed":
    case "baseline_failed":
      return "failed";
    case "different":
      return "stale";
    case "missing_artifact":
    case "inconclusive":
      return "inconclusive";
  }
}

export function findDefaultBaseline(
  checks: ExecutionRecord[],
  candidateId: string,
): ExecutionRecord | undefined {
  const candidate = checks.find((item) => item.id === candidateId);
  if (!candidate) return undefined;
  const candidateCommand = `${candidate.program} ${candidate.args.join(" ")}`;
  const older = checks.filter(
    (item) => item.id !== candidate.id && item.startedAt <= candidate.startedAt,
  );
  return (
    older.find(
      (item) =>
        `${item.program} ${item.args.join(" ")}` === candidateCommand &&
        item.sourceDigest !== candidate.sourceDigest,
    ) ??
    older.find(
      (item) => `${item.program} ${item.args.join(" ")}` === candidateCommand,
    ) ??
    older[0]
  );
}

export function formatComparisonMarkdown(
  comparison: BehaviorComparisonRecord,
): string {
  const warningText =
    comparison.warnings.length > 0
      ? ` · Warnings: ${comparison.warnings.map((w) => w.code).join(", ")}`
      : "";
  return `- **${comparisonOutcomeLabel(comparison.outcome)}** — ${comparison.label} (${comparison.baseline.sourceDigest.slice(0, 8)} → ${comparison.candidate.sourceDigest.slice(0, 8)})${warningText}`;
}
