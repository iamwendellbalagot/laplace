import { describe, expect, it } from "vitest";
import type {
  BehaviorComparisonRecord,
  ExecutionRecord,
} from "../../services/contracts";
import {
  comparisonOutcomeLabel,
  comparisonOutcomeTone,
  DEFAULT_NORMALIZATION_RULES,
  findDefaultBaseline,
  formatComparisonMarkdown,
} from "./comparison-helpers";

function execFixture(
  id: string,
  digest: string,
  startedAt: number,
  args = ["test"],
): ExecutionRecord {
  return {
    id,
    projectId: "/tmp/demo",
    changeId: null,
    program: "pnpm",
    args,
    sourceDigest: digest,
    files: [],
    status: "passed",
    exitCode: 0,
    output: "ok",
    startedAt,
    finishedAt: startedAt + 100,
  };
}

describe("comparison helpers", () => {
  it("selects prior check with matching command and different digest first", () => {
    const checks = [
      execFixture("c3", "digest-new", 3000),
      execFixture("c2", "digest-new", 2000),
      execFixture("c1", "digest-old", 1000),
    ];
    expect(findDefaultBaseline(checks, "c3")?.id).toBe("c1");
  });

  it("maps every comparison outcome to explicit label and tone", () => {
    expect(comparisonOutcomeLabel("equal")).toBe("Equal");
    expect(comparisonOutcomeLabel("fixed")).toContain("baseline failed");
    expect(comparisonOutcomeTone("regressed")).toBe("failed");
    expect(comparisonOutcomeTone("missing_artifact")).toBe("inconclusive");
  });

  it("formats comparison markdown including warnings for review bundles", () => {
    const record: BehaviorComparisonRecord = {
      id: "cmp-1",
      projectId: "/tmp/demo",
      changeId: null,
      label: "pnpm test (aaaa1111 → bbbb2222)",
      baselineExecutionId: "e1",
      candidateExecutionId: "e2",
      baseline: {
        executionId: "e1",
        present: true,
        command: "pnpm test",
        sourceDigest: "aaaa11112222",
        status: "failed",
        exitCode: 1,
        startedAt: 1000,
        finishedAt: 1200,
        environment: null,
      },
      candidate: {
        executionId: "e2",
        present: true,
        command: "pnpm test",
        sourceDigest: "bbbb22223333",
        status: "passed",
        exitCode: 0,
        startedAt: 2000,
        finishedAt: 2200,
        environment: null,
      },
      normalization: DEFAULT_NORMALIZATION_RULES,
      outcome: "fixed",
      outputsEqual: false,
      warnings: [{ code: "baseline_failed", message: "Baseline failed" }],
      sharedServices: [],
      diffLines: [],
      diffTruncated: false,
      observedScope: "Observed",
      notCheckedScope: "Not checked",
      createdAt: 3000,
    };
    const md = formatComparisonMarkdown(record);
    expect(md).toContain("Fixed (baseline failed)");
    expect(md).toContain("aaaa1111 → bbbb2222");
    expect(md).toContain("baseline_failed");
  });
});
