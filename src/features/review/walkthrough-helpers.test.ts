import { describe, expect, it } from "vitest";
import type {
  WalkthroughStep,
  WorkspaceWalkthrough,
} from "../../services/contracts";
import {
  filterWalkthroughSteps,
  findNextUnreviewedStep,
  formatWalkthroughNarrationPrompt,
  reconcileReviewedSteps,
  stepDisplayTitle,
} from "./walkthrough-helpers";

function makeStep(overrides: Partial<WalkthroughStep> = {}): WalkthroughStep {
  return {
    id: "src/services/auth.ts::0",
    order: 1,
    chapter: "core",
    filePath: "src/services/auth.ts",
    role: "api_service",
    fileStatus: "modified",
    symbolName: "verifyToken",
    symbolKind: "function",
    hunkIndex: 0,
    oldStart: 3,
    oldCount: 2,
    newStart: 3,
    newCount: 4,
    addedLines: 4,
    removedLines: 2,
    header: "@@ -3,2 +3,4 @@",
    causalReason: "1 untouched downstream caller(s) import this file",
    riskLevel: "medium",
    riskReasons: ["1 untouched downstream caller(s)"],
    directCallersCount: 2,
    untouchedCallersCount: 1,
    relatedTestsCount: 1,
    ...overrides,
  };
}

describe("walkthrough-helpers", () => {
  it("filters steps by all, unreviewed, and high_risk", () => {
    const s1 = makeStep({ id: "a::0", order: 1, riskLevel: "high" });
    const s2 = makeStep({ id: "b::0", order: 2, riskLevel: "low" });
    const reviewed = new Set(["a::0"]);

    expect(filterWalkthroughSteps([s1, s2], reviewed, "all")).toHaveLength(2);
    expect(
      filterWalkthroughSteps([s1, s2], reviewed, "unreviewed").map((s) => s.id),
    ).toEqual(["b::0"]);
    expect(
      filterWalkthroughSteps([s1, s2], reviewed, "high_risk").map((s) => s.id),
    ).toEqual(["a::0"]);
  });

  it("finds next unreviewed step wrapping around when needed", () => {
    const s1 = makeStep({ id: "a::0", order: 1 });
    const s2 = makeStep({ id: "b::0", order: 2 });
    const s3 = makeStep({ id: "c::0", order: 3 });

    expect(
      findNextUnreviewedStep([s1, s2, s3], new Set(["b::0"]), "a::0")?.id,
    ).toBe("c::0");
    expect(
      findNextUnreviewedStep([s1, s2, s3], new Set(["b::0", "c::0"]), "c::0")
        ?.id,
    ).toBe("a::0");
    expect(
      findNextUnreviewedStep([s1, s2], new Set(["a::0", "b::0"]), "a::0"),
    ).toBeUndefined();
  });

  it("resets reviewed steps when sourceDigest changes and prunes removed IDs when unchanged", () => {
    const s1 = makeStep({ id: "a::0" });
    const prev = new Set(["a::0", "removed::0"]);

    const sameDigest = reconcileReviewedSteps("dig-1", "dig-1", prev, [s1]);
    expect([...sameDigest]).toEqual(["a::0"]);

    const changedDigest = reconcileReviewedSteps("dig-1", "dig-2", prev, [s1]);
    expect(changedDigest.size).toBe(0);
  });

  it("formats display titles and Rook narration prompts", () => {
    const fnStep = makeStep({
      symbolName: "verifyToken",
      symbolKind: "function",
    });
    const fileStep = makeStep({
      id: "src/README.md::0",
      order: 2,
      chapter: "config",
      filePath: "src/README.md",
      symbolName: null,
      symbolKind: null,
      riskLevel: "low",
      riskReasons: [],
    });

    expect(stepDisplayTitle(fnStep)).toBe("verifyToken()");
    expect(stepDisplayTitle(fileStep)).toBe("README.md");

    const wt: WorkspaceWalkthrough = {
      projectId: "/work/repo",
      baseline: "head",
      sourceDigest: "abc123",
      totalSteps: 2,
      highRiskCount: 0,
      chapters: [
        {
          id: "core",
          title: "Core Logic & Services",
          summary: "1 step(s)",
          stepIds: [fnStep.id],
        },
        {
          id: "config",
          title: "Config & Docs",
          summary: "1 step(s)",
          stepIds: [fileStep.id],
        },
      ],
      steps: [fnStep, fileStep],
      truncated: false,
    };

    const prompt = formatWalkthroughNarrationPrompt(wt);
    expect(prompt).toContain("## Core Logic & Services");
    expect(prompt).toContain("`src/services/auth.ts:3` (verifyToken)");
    expect(prompt).toContain("## Config & Docs");
  });
});
