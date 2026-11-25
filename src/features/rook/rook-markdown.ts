export type RookMarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "blockquote"; text: string }
  | { kind: "code"; language: string; code: string };

export type RookInlineSegment =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | {
      kind: "file_ref";
      raw: string;
      relativePath: string;
      line?: number;
      column?: number;
    };

const KNOWN_EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|mts|cts|rs|py|go|css|scss|html|json|toml|md|mdx|sql|yaml|yml|sh";

const FILE_REF_PATTERN = new RegExp(
  `(?:^|[\\s(\\[{\`"'])((?:[A-Za-z0-9_.@-]+\\/)*[A-Za-z0-9_.-]+\\.(?:${KNOWN_EXTENSIONS}))(?::(\\d+)(?::(\\d+))?|#L(\\d+)(?:-L\\d+)?)?(?=$|[\\s)\\]}\`".,:;!?])`,
  "g",
);

export function normalizeWorkspaceCitation(
  rawPath: string,
  projectPath?: string,
): string | null {
  let cleaned = rawPath.trim().replaceAll("\\", "/").replace(/^\.\//, "");
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
    cleaned.startsWith("http:") ||
    cleaned.startsWith("https:")
  ) {
    return null;
  }
  return cleaned;
}

export function parseRookMarkdown(markdown: string): RookMarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RookMarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const fenceMatch = line.match(/^```([A-Za-z0-9_+.-]*)\s*$/);
    if (fenceMatch) {
      const language = fenceMatch[1] ?? "";
      const codeLines: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index++;
      }
      if (index < lines.length && /^```\s*$/.test(lines[index])) {
        index++;
      }
      blocks.push({ kind: "code", language, code: codeLines.join("\n") });
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        kind: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      index++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index++;
      }
      blocks.push({ kind: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-*]\s+(.+)$/);
    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const items: string[] = [];
      while (index < lines.length) {
        const nextLine = lines[index];
        const itemMatch = ordered
          ? nextLine.match(/^\s*\d+\.\s+(.+)$/)
          : nextLine.match(/^\s*[-*]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1].trim());
        index++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !/^#{1,3}\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paraLines.push(lines[index]);
      index++;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: "paragraph", text: paraLines.join("\n") });
    }
  }

  return blocks;
}

export function parseRookInlineSegments(
  text: string,
  projectPath?: string,
): RookInlineSegment[] {
  const segments: RookInlineSegment[] = [];
  const tokenPattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushPlainWithRefs = (plain: string) => {
    if (!plain) return;
    FILE_REF_PATTERN.lastIndex = 0;
    let refCursor = 0;
    let refMatch: RegExpExecArray | null;
    while ((refMatch = FILE_REF_PATTERN.exec(plain)) !== null) {
      const full = refMatch[0];
      const rawPath = refMatch[1];
      const lineStr = refMatch[2] ?? refMatch[4];
      const colStr = refMatch[3];
      const relPath = normalizeWorkspaceCitation(rawPath, projectPath);
      const pathOffset = full.indexOf(rawPath);
      const start = refMatch.index + pathOffset;
      const citationText = full.slice(pathOffset);
      if (!relPath || (!rawPath.includes("/") && !lineStr)) {
        continue;
      }
      if (start > refCursor) {
        segments.push({ kind: "text", text: plain.slice(refCursor, start) });
      }
      segments.push({
        kind: "file_ref",
        raw: citationText,
        relativePath: relPath,
        line: lineStr ? Number.parseInt(lineStr, 10) : undefined,
        column: colStr ? Number.parseInt(colStr, 10) : undefined,
      });
      refCursor = refMatch.index + full.length;
    }
    if (refCursor < plain.length) {
      segments.push({ kind: "text", text: plain.slice(refCursor) });
    }
  };

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      pushPlainWithRefs(text.slice(cursor, match.index));
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      const inner = token.slice(1, -1);
      const refMatch = inner.match(
        new RegExp(
          `^((?:[A-Za-z0-9_.@-]+\\/)*[A-Za-z0-9_.-]+\\.(?:${KNOWN_EXTENSIONS}))(?::(\\d+)(?::(\\d+))?|#L(\\d+)(?:-L\\d+)?)?$`,
        ),
      );
      const rel = refMatch
        ? normalizeWorkspaceCitation(refMatch[1], projectPath)
        : null;
      const lineStr = refMatch?.[2] ?? refMatch?.[4];
      const colStr = refMatch?.[3];
      if (rel && (rel.includes("/") || Boolean(lineStr))) {
        segments.push({
          kind: "file_ref",
          raw: inner,
          relativePath: rel,
          line: lineStr ? Number.parseInt(lineStr, 10) : undefined,
          column: colStr ? Number.parseInt(colStr, 10) : undefined,
        });
      } else {
        segments.push({ kind: "code", text: inner });
      }
    } else if (token.startsWith("**") && token.endsWith("**")) {
      segments.push({ kind: "bold", text: token.slice(2, -2) });
    } else if (token.startsWith("*") && token.endsWith("*")) {
      segments.push({ kind: "italic", text: token.slice(1, -1) });
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    pushPlainWithRefs(text.slice(cursor));
  }
  return segments;
}

export function extractTouchedFileFromToolSummary(
  toolName: string,
  summary: string,
  projectPath?: string,
): string | null {
  if (toolName !== "edit" && toolName !== "write") return null;
  const match = summary.match(
    /((?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)/,
  );
  if (!match) return null;
  return normalizeWorkspaceCitation(match[1], projectPath);
}
