import { describe, expect, it } from "vitest";
import {
  buildFileContextBundleChip,
  buildModuleContextChip,
  filterContextRelations,
  provenanceLabel,
} from "./context-bundle";
import type {
  ContextRelation,
  FileContextSnapshot,
  SystemModuleNode,
} from "../../services/contracts";

describe("context-bundle helpers", () => {
  const sampleRelations: ContextRelation[] = [
    {
      id: "1",
      sourcePath: "src/routes/auth.ts",
      sourceLine: 4,
      targetPath: "src/services/session.ts",
      relationKind: "imports",
      provenance: "observed",
      evidence: "Static import at line 4",
      stale: false,
      pinnedLinkId: null,
    },
    {
      id: "2",
      sourcePath: "src/services/session.ts",
      sourceLine: null,
      targetPath: "tests/session.spec.ts",
      relationKind: "tests",
      provenance: "inferred",
      evidence: "Filename stem match",
      stale: false,
      pinnedLinkId: null,
    },
    {
      id: "3",
      sourcePath: "src/services/session.ts",
      sourceLine: null,
      targetPath: "tests/rotation.test.ts",
      relationKind: "tests",
      provenance: "developer_confirmed",
      evidence: "Pinned regression suite",
      stale: true,
      pinnedLinkId: "lnk-1",
    },
  ];

  it("maps provenance categories to explicit non-numeric labels", () => {
    expect(provenanceLabel("observed")).toBe("Observed");
    expect(provenanceLabel("inferred")).toBe("Inferred");
    expect(provenanceLabel("developer_confirmed")).toBe("Confirmed");
  });

  it("filters relationships by provenance, staleness, and search query", () => {
    expect(
      filterContextRelations(sampleRelations, "", "observed"),
    ).toHaveLength(1);
    expect(
      filterContextRelations(sampleRelations, "", "inferred"),
    ).toHaveLength(1);
    expect(filterContextRelations(sampleRelations, "", "stale")).toHaveLength(
      1,
    );
    expect(
      filterContextRelations(sampleRelations, "rotation", "all"),
    ).toHaveLength(1);
  });

  it("builds a bounded Rook context chip containing callers, tests, and confirmed note", () => {
    const snapshot: FileContextSnapshot = {
      filePath: "src/services/session.ts",
      language: "typescript",
      fileDigest: "abc",
      symbols: [
        { name: "rotateSession", kind: "function", line: 10, exported: true },
      ],
      activeSymbol: {
        name: "rotateSession",
        kind: "function",
        line: 10,
        exported: true,
      },
      queriedSymbol: "rotateSession",
      symbolReferences: [],
      imports: [],
      importers: [sampleRelations[0]],
      relatedTests: [sampleRelations[1], sampleRelations[2]],
      annotation: {
        id: "ann-1",
        targetKind: "file",
        targetKey: "src/services/session.ts",
        summary: "Handles single-flight token rotation.",
        provenance: "developer_confirmed",
        sourceDigest: "old",
        stale: true,
        createdAt: 1,
        updatedAt: 2,
      },
      pinnedLinks: [],
      indexedFileCount: 12,
      truncated: false,
      cancelled: false,
    };

    const chip = buildFileContextBundleChip(
      snapshot,
      "export function rotateSession() {}",
    );
    expect(chip.kind).toBe("context_bundle");
    expect(chip.content).toContain("Developer-confirmed note [STALE]");
    expect(chip.content).toContain("src/routes/auth.ts:4");
    expect(chip.content).toContain("tests/session.spec.ts [Inferred]");
    expect(chip.content).toContain("tests/rotation.test.ts [Confirmed, Stale]");
  });

  it("builds a grounded module context chip for Rook", () => {
    const mod: SystemModuleNode = {
      key: "src/services",
      label: "services",
      primaryFile: "src/services/session.ts",
      files: ["src/services/session.ts"],
      fileCount: 1,
      incomingCount: 2,
      outgoingCount: 0,
      digest: "d1",
      annotation: null,
    };
    const chip = buildModuleContextChip(mod, [
      {
        sourceModule: "src/routes",
        targetModule: "src/services",
        referenceCount: 2,
      },
    ]);
    expect(chip.label).toBe("Module src/services");
    expect(chip.content).toContain("src/routes -> src/services (2 imports)");
  });
});
