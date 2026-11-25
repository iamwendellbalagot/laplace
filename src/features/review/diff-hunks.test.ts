import { describe, expect, it } from "vitest";
import { computeDiffHunks, impactRoleLabel } from "./diff-hunks";

describe("computeDiffHunks", () => {
  it("extracts tight coordinates for multi-hunk replacements, insertions, and deletions", () => {
    const original = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    const modified = "line 1\nline TWO\nline 3\nline FOUR\ninserted\n";

    const hunks = computeDiffHunks(original, modified);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      oldStart: 2,
      oldCount: 1,
      newStart: 2,
      newCount: 1,
      header: "@@ -2,1 +2,1 @@",
      removedLines: ["line 2"],
      addedLines: ["line TWO"],
    });
    expect(hunks[1]).toMatchObject({
      oldStart: 4,
      oldCount: 2,
      newStart: 4,
      newCount: 2,
      removedLines: ["line 4", "line 5"],
      addedLines: ["line FOUR", "inserted"],
    });
  });

  it("handles pure insertions and pure deletions with zero counts", () => {
    const inserted = computeDiffHunks("a\nc\n", "a\nb\nc\n");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      oldStart: 1,
      oldCount: 0,
      newStart: 2,
      newCount: 1,
    });

    const deleted = computeDiffHunks("a\nb\nc\n", "a\nc\n");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({
      oldStart: 2,
      oldCount: 1,
      newStart: 1,
      newCount: 0,
    });
  });

  it("formats semantic role labels cleanly", () => {
    expect(impactRoleLabel("backend")).toBe("Backend & Data");
    expect(impactRoleLabel("api_service")).toBe("API & Services");
    expect(impactRoleLabel("ui")).toBe("UI & Views");
  });
});
