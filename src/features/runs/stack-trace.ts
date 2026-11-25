export interface StackFrameMatch {
  raw: string;
  relativePath: string;
  line: number;
  column?: number;
  startIndex: number;
  endIndex: number;
}

const FRAME_PATTERN =
  /(?:file:\/\/)?([A-Za-z0-9_./@\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|rs|css|json|toml|md|py|go)):(\d+)(?::(\d+))?/g;

export function normalizeFramePath(
  rawPath: string,
  projectPath?: string,
): string | null {
  let cleaned = rawPath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (projectPath) {
    const normalizedRoot = projectPath.replaceAll("\\", "/").replace(/\/$/, "");
    if (cleaned.startsWith(`${normalizedRoot}/`)) {
      cleaned = cleaned.slice(normalizedRoot.length + 1);
    }
  }
  if (
    !cleaned ||
    cleaned.startsWith("/") ||
    cleaned.includes("..") ||
    cleaned.startsWith("node_modules/") ||
    cleaned.includes("/node_modules/") ||
    cleaned.startsWith("node:")
  ) {
    return null;
  }
  return cleaned;
}

export function extractStackFrames(
  output: string,
  projectPath?: string,
): StackFrameMatch[] {
  const matches: StackFrameMatch[] = [];
  FRAME_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FRAME_PATTERN.exec(output)) !== null) {
    const rawPath = match[1];
    const line = Number.parseInt(match[2], 10);
    const column = match[3] ? Number.parseInt(match[3], 10) : undefined;
    if (!Number.isInteger(line) || line < 1) continue;
    const relativePath = normalizeFramePath(rawPath, projectPath);
    if (!relativePath) continue;
    matches.push({
      raw: match[0],
      relativePath,
      line,
      column: column && column > 0 ? column : undefined,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
    if (matches.length >= 200) break;
  }
  return matches;
}

export function formatFailureContextExcerpt(
  title: string,
  output: string,
  projectPath?: string,
  maxChars = 8_000,
): string {
  const frames = extractStackFrames(output, projectPath);
  const uniqueLocations = Array.from(
    new Set(
      frames.map(
        (frame) =>
          `${frame.relativePath}:${frame.line}${frame.column ? `:${frame.column}` : ""}`,
      ),
    ),
  ).slice(0, 12);
  const header = [
    `Failure source: ${title}`,
    uniqueLocations.length > 0
      ? `Locations:\n${uniqueLocations.map((loc) => `- ${loc}`).join("\n")}`
      : null,
    "Output tail:",
  ]
    .filter(Boolean)
    .join("\n");
  const budget = Math.max(500, maxChars - header.length - 4);
  const trimmedOutput =
    output.length > budget
      ? `…(truncated)\n${output.slice(output.length - budget)}`
      : output;
  return `${header}\n${trimmedOutput}`;
}

export function serializeRookContextChips(
  chips: { label: string; content: string }[],
  maxChars = 30_000,
): string {
  if (chips.length === 0) return "";
  const parts: string[] = [];
  let used = 0;
  for (const chip of chips) {
    const block = `--- ${chip.label} ---\n${chip.content.trim()}`;
    if (used + block.length + 2 > maxChars) {
      const remaining = maxChars - used - 24;
      if (remaining > 80) {
        parts.push(`${block.slice(0, remaining)}\n…(truncated)`);
      }
      break;
    }
    parts.push(block);
    used += block.length + 2;
  }
  return parts.join("\n\n");
}
