export interface GutterLineMarker {
  startLine: number;
  endLine: number;
  kind: "added" | "modified" | "deleted";
}

function normalizeGitHeaderPath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^"(.*)"$/, "$1");
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }
  return trimmed;
}

/**
 * Parse unified `git diff` output and return gutter markers for a workspace-relative file.
 */
export function parseUnifiedDiffHunksForFile(
  diffText: string,
  relativePath: string,
): GutterLineMarker[] {
  if (!diffText.trim() || !relativePath) return [];
  const normalizedTarget = relativePath.replaceAll("\\", "/");
  const markers: GutterLineMarker[] = [];

  let activeFile: string | null = null;
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const rest = line.slice("diff --git ".length);
      const bIndex = rest.lastIndexOf(" b/");
      activeFile =
        bIndex >= 0 ? normalizeGitHeaderPath(rest.slice(bIndex + 1)) : null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const targetPath = normalizeGitHeaderPath(line.slice(4));
      if (targetPath !== "/dev/null") {
        activeFile = targetPath;
      }
      continue;
    }
    if (activeFile !== normalizedTarget || !line.startsWith("@@ ")) {
      continue;
    }
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) continue;
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);

    if (newCount === 0) {
      markers.push({
        startLine: Math.max(1, newStart),
        endLine: Math.max(1, newStart),
        kind: "deleted",
      });
    } else if (oldCount === 0) {
      markers.push({
        startLine: Math.max(1, newStart),
        endLine: Math.max(1, newStart + newCount - 1),
        kind: "added",
      });
    } else {
      markers.push({
        startLine: Math.max(1, newStart),
        endLine: Math.max(1, newStart + newCount - 1),
        kind: "modified",
      });
    }
  }

  return markers;
}
