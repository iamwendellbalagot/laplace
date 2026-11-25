import { describe, expect, it } from "vitest";
import {
  extractStackFrames,
  formatFailureContextExcerpt,
  serializeRookContextChips,
} from "./stack-trace";

describe("stack-trace helpers", () => {
  it("extracts workspace-relative TypeScript, Vite, and Rust frames while ignoring node_modules", () => {
    const output = [
      "TypeError: Cannot read properties of undefined",
      "    at render (src/App.tsx:412:18)",
      "    at run (/repo/demo/src/features/runs/RunPanel.tsx:55:9)",
      "    at internal (node_modules/react/index.js:12:4)",
      "   --> src-tauri/src/runs.rs:108:5",
    ].join("\n");

    const frames = extractStackFrames(output, "/repo/demo");
    expect(
      frames.map((f) => `${f.relativePath}:${f.line}:${f.column}`),
    ).toEqual([
      "src/App.tsx:412:18",
      "src/features/runs/RunPanel.tsx:55:9",
      "src-tauri/src/runs.rs:108:5",
    ]);
  });

  it("formats bounded failure excerpts with deduplicated locations", () => {
    const output = `FAIL src/foo.test.ts:10:2\n${"x".repeat(2000)}\nsrc/foo.test.ts:10:2`;
    const excerpt = formatFailureContextExcerpt(
      "vitest run",
      output,
      undefined,
      800,
    );
    expect(excerpt).toContain("Failure source: vitest run");
    expect(excerpt).toContain("- src/foo.test.ts:10:2");
    expect(excerpt.length).toBeLessThanOrEqual(820);
  });

  it("serializes Rook context chips within the bounded character budget", () => {
    const serialized = serializeRookContextChips(
      [
        { label: "src/a.ts:1-5", content: "const a = 1;" },
        { label: "src/b.ts:1-5", content: "b".repeat(500) },
      ],
      220,
    );
    expect(serialized).toContain("--- src/a.ts:1-5 ---");
    expect(serialized).toContain("…(truncated)");
  });
});
