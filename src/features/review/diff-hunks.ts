export interface DiffHunk {
  index: number;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  removedLines: string[];
  addedLines: string[];
  snippet: string;
}

function splitLinesForDiff(text: string): string[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const trimmed = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized;
  return trimmed.split("\n");
}

interface EditOp {
  type: "equal" | "delete" | "insert";
  oldIdx: number;
  newIdx: number;
  line: string;
}

/**
 * Computes tight contiguous diff hunks whose coordinates match
 * Rust's `apply_hunk_revert_text` 1-based unified slicing rules.
 */
export function computeDiffHunks(
  original: string,
  modified: string,
): DiffHunk[] {
  if (original === modified) return [];
  const oldLines = splitLinesForDiff(original);
  const newLines = splitLinesForDiff(modified);

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (
    oldEnd > prefix &&
    newEnd > prefix &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  const midOldLen = oldEnd - prefix;
  const midNewLen = newEnd - prefix;

  if (midOldLen === 0 && midNewLen === 0) return [];

  // Bound DP table for very large edits so UI remains instant
  if (midOldLen * midNewLen > 240_000) {
    const oldStart = midOldLen === 0 ? prefix : prefix + 1;
    const newStart = midNewLen === 0 ? prefix : prefix + 1;
    const removed = oldLines.slice(prefix, oldEnd);
    const added = newLines.slice(prefix, newEnd);
    return [
      {
        index: 0,
        oldStart,
        oldCount: midOldLen,
        newStart,
        newCount: midNewLen,
        header: `@@ -${oldStart},${midOldLen} +${newStart},${midNewLen} @@`,
        removedLines: removed,
        addedLines: added,
        snippet: formatHunkSnippet(removed, added),
      },
    ];
  }

  // LCS matrix over differing middle slices
  const dp: number[][] = Array.from({ length: midOldLen + 1 }, () =>
    new Array<number>(midNewLen + 1).fill(0),
  );
  for (let i = midOldLen - 1; i >= 0; i--) {
    for (let j = midNewLen - 1; j >= 0; j--) {
      if (oldLines[prefix + i] === newLines[prefix + j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const ops: EditOp[] = [];
  let i = 0;
  let j = 0;
  while (i < midOldLen && j < midNewLen) {
    if (oldLines[prefix + i] === newLines[prefix + j]) {
      ops.push({
        type: "equal",
        oldIdx: prefix + i,
        newIdx: prefix + j,
        line: oldLines[prefix + i],
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({
        type: "delete",
        oldIdx: prefix + i,
        newIdx: prefix + j,
        line: oldLines[prefix + i],
      });
      i++;
    } else {
      ops.push({
        type: "insert",
        oldIdx: prefix + i,
        newIdx: prefix + j,
        line: newLines[prefix + j],
      });
      j++;
    }
  }
  while (i < midOldLen) {
    ops.push({
      type: "delete",
      oldIdx: prefix + i,
      newIdx: prefix + j,
      line: oldLines[prefix + i],
    });
    i++;
  }
  while (j < midNewLen) {
    ops.push({
      type: "insert",
      oldIdx: prefix + i,
      newIdx: prefix + j,
      line: newLines[prefix + j],
    });
    j++;
  }

  const hunks: DiffHunk[] = [];
  let idx = 0;
  while (idx < ops.length) {
    if (ops[idx].type === "equal") {
      idx++;
      continue;
    }
    const startIdx = idx;
    const removedLines: string[] = [];
    const addedLines: string[] = [];
    let firstOldIdx: number | undefined;
    let firstNewIdx: number | undefined;

    while (idx < ops.length && ops[idx].type !== "equal") {
      const op = ops[idx];
      if (op.type === "delete") {
        firstOldIdx ??= op.oldIdx;
        removedLines.push(op.line);
      } else {
        firstNewIdx ??= op.newIdx;
        addedLines.push(op.line);
      }
      idx++;
    }

    const oldCount = removedLines.length;
    const newCount = addedLines.length;
    const anchorOldIdx = ops[startIdx].oldIdx;
    const anchorNewIdx = ops[startIdx].newIdx;
    const oldStart =
      oldCount === 0 ? anchorOldIdx : (firstOldIdx ?? anchorOldIdx) + 1;
    const newStart =
      newCount === 0 ? anchorNewIdx : (firstNewIdx ?? anchorNewIdx) + 1;

    hunks.push({
      index: hunks.length,
      oldStart,
      oldCount,
      newStart,
      newCount,
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      removedLines,
      addedLines,
      snippet: formatHunkSnippet(removedLines, addedLines),
    });
  }

  return hunks;
}

function formatHunkSnippet(removed: string[], added: string[]): string {
  const lines = [
    ...removed.slice(0, 12).map((line) => `- ${line}`),
    ...added.slice(0, 12).map((line) => `+ ${line}`),
  ];
  return lines.join("\n");
}

export function impactRoleLabel(role: string): string {
  switch (role) {
    case "backend":
      return "Backend & Data";
    case "api_service":
      return "API & Services";
    case "state":
      return "State & Stores";
    case "tests":
      return "Tests";
    case "config_docs":
      return "Config & Docs";
    case "ui":
      return "UI & Views";
    default:
      return role;
  }
}
