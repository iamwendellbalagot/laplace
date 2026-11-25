import { describe, expect, it } from "vitest";
import {
  extractTouchedFileFromToolSummary,
  parseRookInlineSegments,
  parseRookMarkdown,
} from "./rook-markdown";

describe("rook-markdown", () => {
  it("parses headings, lists, blockquotes, paragraphs, and fenced code blocks", () => {
    const md = [
      "## Summary",
      "",
      "Updated `src/App.tsx:42` and checked tests.",
      "",
      "- First item",
      "- Second item",
      "",
      "> Note about safety",
      "",
      "```ts",
      "export const ok = true;",
      "```",
    ].join("\n");

    const blocks = parseRookMarkdown(md);
    expect(blocks).toEqual([
      { kind: "heading", level: 2, text: "Summary" },
      {
        kind: "paragraph",
        text: "Updated `src/App.tsx:42` and checked tests.",
      },
      { kind: "list", ordered: false, items: ["First item", "Second item"] },
      { kind: "blockquote", text: "Note about safety" },
      { kind: "code", language: "ts", code: "export const ok = true;" },
    ]);
  });

  it("extracts clickable file citations from inline code and plain text", () => {
    const segments = parseRookInlineSegments(
      "Look at `src/features/rook/RookPanel.tsx:18` and src-tauri/src/pulse.rs:45:3 for details.",
    );
    expect(segments).toContainEqual({
      kind: "file_ref",
      raw: "src/features/rook/RookPanel.tsx:18",
      relativePath: "src/features/rook/RookPanel.tsx",
      line: 18,
      column: undefined,
    });
    expect(segments).toContainEqual({
      kind: "file_ref",
      raw: "src-tauri/src/pulse.rs:45:3",
      relativePath: "src-tauri/src/pulse.rs",
      line: 45,
      column: 3,
    });
  });

  it("ignores traversal or bare filenames without path or line", () => {
    const segments = parseRookInlineSegments(
      "Do not link ../secret.ts or README.md without context, only `README.md:10`.",
    );
    const refs = segments.filter((s) => s.kind === "file_ref");
    expect(refs).toEqual([
      {
        kind: "file_ref",
        raw: "README.md:10",
        relativePath: "README.md",
        line: 10,
        column: undefined,
      },
    ]);
  });

  it("extracts touched file paths from edit/write tool summaries", () => {
    expect(
      extractTouchedFileFromToolSummary("edit", "Edited src/App.tsx (+4/-2)"),
    ).toBe("src/App.tsx");
    expect(
      extractTouchedFileFromToolSummary("read", "Read src/App.tsx"),
    ).toBeNull();
  });
});
