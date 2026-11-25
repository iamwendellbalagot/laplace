import { describe, expect, it } from "vitest";
import {
  filterPaletteItems,
  parsePaletteQuery,
  type PaletteCommand,
} from "./palette-filter";

const sampleItems: PaletteCommand[] = [
  {
    id: "act-review",
    label: "Go to Review",
    description: "Inspect changes and blast radius",
    category: "action",
    run: () => undefined,
  },
  {
    id: "rook-worktree",
    label: "Rook: Toggle Isolated Worktree Build",
    description: "Experiment safely in a candidate Git worktree",
    category: "rook",
    run: () => undefined,
  },
  {
    id: "file-session",
    label: "session.ts",
    description: "src/auth/session.ts",
    category: "file",
    supportsSplit: true,
    run: () => undefined,
  },
  {
    id: "sym-rotate",
    label: "rotateSessionToken",
    description: "function · src/auth/session.ts:14",
    category: "symbol",
    supportsSplit: true,
    run: () => undefined,
  },
];

describe("palette-filter", () => {
  it("parses scope prefixes accurately", () => {
    expect(parsePaletteQuery("@rotate", "all")).toEqual({
      scope: "symbol",
      term: "rotate",
    });
    expect(parsePaletteQuery(">review", "all")).toEqual({
      scope: "action",
      term: "review",
    });
    expect(parsePaletteQuery("/auth", "all")).toEqual({
      scope: "file",
      term: "auth",
    });
    expect(parsePaletteQuery("?worktree", "all")).toEqual({
      scope: "rook",
      term: "worktree",
    });
  });

  it("shows actions and rook commands before search term and surfaces files/symbols on match", () => {
    const empty = filterPaletteItems(sampleItems, "", "all");
    expect(empty.items.map((item) => item.id)).toEqual([
      "act-review",
      "rook-worktree",
    ]);

    const unified = filterPaletteItems(sampleItems, "session", "all");
    expect(unified.items.map((item) => item.id)).toContain("file-session");
    expect(unified.items.map((item) => item.id)).toContain("sym-rotate");

    const symbolsOnly = filterPaletteItems(sampleItems, "@rst", "all");
    expect(symbolsOnly.effectiveScope).toBe("symbol");
    expect(symbolsOnly.items.map((item) => item.id)).toEqual(["sym-rotate"]);
  });
});
