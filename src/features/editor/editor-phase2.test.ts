import { describe, expect, it } from "vitest";
import { parseUnifiedDiffHunksForFile } from "./git-gutter";
import {
  parseTsCompilerOptions,
  stripJsonComments,
} from "./ts-project-hydration";
import { extractProposedCodeBlock, spliceLines } from "./InlineCommandBar";

describe("git-gutter parser", () => {
  it("parses added, modified, and deleted hunks for target file", () => {
    const diff = [
      "diff --git a/src/other.ts b/src/other.ts",
      "@@ -1,2 +1,2 @@",
      "-a",
      "+b",
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -3,0 +4,2 @@",
      "+added1",
      "+added2",
      "@@ -10,2 +12,2 @@",
      "-old",
      "+new",
      "@@ -20,3 +22,0 @@",
    ].join("\n");

    expect(parseUnifiedDiffHunksForFile(diff, "src/app.ts")).toEqual([
      { startLine: 4, endLine: 5, kind: "added" },
      { startLine: 12, endLine: 13, kind: "modified" },
      { startLine: 22, endLine: 22, kind: "deleted" },
    ]);
  });
});

describe("ts-project-hydration helpers", () => {
  it("strips JSONC comments and trailing commas cleanly", () => {
    const raw = `{
      // line comment
      "compilerOptions": {
        "strict": true, /* block comment */
        "jsx": "react-jsx",
      }
    }`;
    const cleaned = stripJsonComments(raw);
    expect(JSON.parse(cleaned)).toEqual({
      compilerOptions: { strict: true, jsx: "react-jsx" },
    });
    const opts = parseTsCompilerOptions(raw);
    expect(opts.strict).toBe(true);
  });
});

describe("InlineCommandBar code extraction & splicing", () => {
  it("extracts fenced code blocks and splices line ranges cleanly", () => {
    const reply = "Here is the update:\n```ts\nconst x = 42;\nreturn x;\n```\n";
    expect(extractProposedCodeBlock(reply)).toBe("const x = 42;\nreturn x;");

    const original = "line1\nline2\nline3\nline4";
    expect(spliceLines(original, 2, 3, "const x = 42;\nreturn x;")).toBe(
      "line1\nconst x = 42;\nreturn x;\nline4",
    );
  });
});
