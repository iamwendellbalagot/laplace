import type {
  WalkthroughStep,
  WorkspaceWalkthrough,
} from "../../services/contracts";

export type WalkthroughFilter = "all" | "unreviewed" | "high_risk";

export function filterWalkthroughSteps(
  steps: WalkthroughStep[],
  reviewedIds: ReadonlySet<string>,
  filter: WalkthroughFilter,
): WalkthroughStep[] {
  if (filter === "unreviewed") {
    return steps.filter((step) => !reviewedIds.has(step.id));
  }
  if (filter === "high_risk") {
    return steps.filter((step) => step.riskLevel === "high");
  }
  return steps;
}

export function findNextUnreviewedStep(
  steps: WalkthroughStep[],
  reviewedIds: ReadonlySet<string>,
  afterStepId?: string,
): WalkthroughStep | undefined {
  if (steps.length === 0) return undefined;
  const startIdx = afterStepId
    ? Math.max(0, steps.findIndex((s) => s.id === afterStepId) + 1)
    : 0;
  for (let i = startIdx; i < steps.length; i++) {
    if (!reviewedIds.has(steps[i].id)) {
      return steps[i];
    }
  }
  for (let i = 0; i < startIdx && i < steps.length; i++) {
    if (!reviewedIds.has(steps[i].id)) {
      return steps[i];
    }
  }
  return undefined;
}

export function reconcileReviewedSteps(
  previousDigest: string | undefined,
  nextDigest: string | undefined,
  previousReviewed: ReadonlySet<string>,
  validSteps: WalkthroughStep[],
): Set<string> {
  if (!nextDigest || previousDigest !== nextDigest) {
    return new Set<string>();
  }
  const validIds = new Set(validSteps.map((s) => s.id));
  const next = new Set<string>();
  for (const id of previousReviewed) {
    if (validIds.has(id)) {
      next.add(id);
    }
  }
  return next;
}

export function stepDisplayTitle(step: WalkthroughStep): string {
  if (step.symbolName) {
    return step.symbolKind === "function" || step.symbolKind === "method"
      ? `${step.symbolName}()`
      : step.symbolName;
  }
  return step.filePath.split("/").at(-1) ?? step.filePath;
}

export function formatWalkthroughNarrationPrompt(
  walkthrough: WorkspaceWalkthrough,
): string {
  const stepById = new Map(walkthrough.steps.map((s) => [s.id, s]));
  const lines = [
    `Narrate this semantic change walkthrough (${walkthrough.totalSteps} step(s), baseline: ${walkthrough.baseline}) in concise, causal order—explain what changed, how the chapters connect, and call out any risks or untested paths:`,
    "",
  ];
  for (const chapter of walkthrough.chapters) {
    lines.push(`## ${chapter.title}`);
    for (const id of chapter.stepIds) {
      const step = stepById.get(id);
      if (!step) continue;
      const sym = step.symbolName ? ` (${step.symbolName})` : "";
      const risk =
        step.riskLevel === "high"
          ? ` [HIGH RISK: ${step.riskReasons.join("; ")}]`
          : step.riskLevel === "medium"
            ? ` [MEDIUM: ${step.riskReasons.join("; ")}]`
            : "";
      lines.push(
        `${step.order}. \`${step.filePath}:${Math.max(1, step.newStart)}\`${sym} (+${step.addedLines}/-${step.removedLines}) — ${step.causalReason}${risk}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
