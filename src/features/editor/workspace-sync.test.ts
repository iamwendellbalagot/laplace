import { describe, expect, it } from "vitest";
import {
  applyExternalReload,
  dismissExternalChangeKeepingEdits,
  isMutatingRookTool,
  nextActiveDocumentAfterClose,
  pruneDocumentsForDelete,
  reconcileDocumentWithDisk,
  remapDocumentsForRename,
  type SyncableDocument,
} from "./workspace-sync";

function makeDoc(overrides: Partial<SyncableDocument> = {}): SyncableDocument {
  return {
    key: "/repo\0src/index.ts",
    projectId: "/repo",
    path: "src/index.ts",
    content: "const x = 1;\n",
    savedContent: "const x = 1;\n",
    ...overrides,
  };
}

describe("workspace-sync", () => {
  it("auto-reloads clean buffers when disk content changes", () => {
    const result = reconcileDocumentWithDisk(
      makeDoc(),
      {
        ok: true,
        file: { kind: "text", sizeBytes: 13, content: "const x = 2;\n" },
      },
      100,
    );
    expect(result.status).toBe("reloaded");
    expect(result.document.content).toBe("const x = 2;\n");
    expect(result.document.savedContent).toBe("const x = 2;\n");
    expect(result.document.externalChange).toBeUndefined();
  });

  it("leaves clean buffers untouched when disk content matches savedContent", () => {
    const doc = makeDoc();
    const result = reconcileDocumentWithDisk(
      doc,
      {
        ok: true,
        file: { kind: "text", sizeBytes: 13, content: "const x = 1;\n" },
      },
      100,
    );
    expect(result.status).toBe("unchanged");
    expect(result.document).toBe(doc);
  });

  it("never overwrites dirty buffers and records a conflict with diskContent", () => {
    const dirty = makeDoc({ content: "const x = 99;\n" });
    const result = reconcileDocumentWithDisk(
      dirty,
      {
        ok: true,
        file: { kind: "text", sizeBytes: 13, content: "const x = 2;\n" },
      },
      250,
    );
    expect(result.status).toBe("conflict");
    expect(result.document.content).toBe("const x = 99;\n");
    expect(result.document.savedContent).toBe("const x = 1;\n");
    expect(result.document.externalChange).toEqual({
      kind: "modified",
      diskContent: "const x = 2;\n",
      detectedAt: 250,
    });
  });

  it("applies reload or keeps local edits on conflict resolution", () => {
    const conflicted = reconcileDocumentWithDisk(
      makeDoc({ content: "const mine = true;\n" }),
      {
        ok: true,
        file: { kind: "text", sizeBytes: 19, content: "const disk = true;\n" },
      },
      300,
    ).document;

    const reloaded = applyExternalReload(conflicted);
    expect(reloaded.content).toBe("const disk = true;\n");
    expect(reloaded.savedContent).toBe("const disk = true;\n");
    expect(reloaded.externalChange).toBeUndefined();

    const kept = dismissExternalChangeKeepingEdits(conflicted);
    expect(kept.content).toBe("const mine = true;\n");
    expect(kept.savedContent).toBe("const disk = true;\n");
    expect(kept.externalChange).toBeUndefined();
  });

  it("flags deleted and unreadable files without dropping buffer text", () => {
    const deleted = reconcileDocumentWithDisk(
      makeDoc(),
      { ok: false, deleted: true },
      400,
    );
    expect(deleted.status).toBe("deleted");
    expect(deleted.document.content).toBe("const x = 1;\n");
    expect(deleted.document.externalChange?.kind).toBe("deleted");

    const unreadable = reconcileDocumentWithDisk(
      makeDoc(),
      { ok: true, file: { kind: "binary", sizeBytes: 10, content: null } },
      401,
    );
    expect(unreadable.status).toBe("unreadable");
    expect(unreadable.document.externalChange?.kind).toBe("unreadable");
  });

  it("identifies mutating Rook Build tools accurately", () => {
    expect(isMutatingRookTool("edit")).toBe(true);
    expect(isMutatingRookTool("write")).toBe(true);
    expect(isMutatingRookTool("bash")).toBe(true);
    expect(isMutatingRookTool("read")).toBe(false);
    expect(isMutatingRookTool("rook_search")).toBe(false);
    expect(isMutatingRookTool("ls")).toBe(false);
  });

  it("remaps active and split keys on directory rename and clears them on delete", () => {
    const docs = [
      makeDoc({ key: "/repo\0src/old/a.ts", path: "src/old/a.ts" }),
      makeDoc({ key: "/repo\0src/old/b.ts", path: "src/old/b.ts" }),
      makeDoc({
        key: "/other\0src/old/a.ts",
        projectId: "/other",
        path: "src/old/a.ts",
      }),
    ];

    const renamed = remapDocumentsForRename(
      docs,
      "/repo",
      "src/old",
      "src/new",
      "/repo\0src/old/a.ts",
      "/repo\0src/old/b.ts",
      "src/old/a.ts",
    );
    expect(renamed.activeDocumentKey).toBe("/repo\0src/new/a.ts");
    expect(renamed.splitDocumentKey).toBe("/repo\0src/new/b.ts");
    expect(renamed.selectedFilePath).toBe("src/new/a.ts");
    expect(renamed.documents[2].path).toBe("src/old/a.ts");

    const pruned = pruneDocumentsForDelete(
      renamed.documents,
      "/repo",
      "src/new/b.ts",
      renamed.activeDocumentKey,
      renamed.splitDocumentKey,
      "src/new/b.ts",
    );
    expect(pruned.splitDocumentKey).toBeUndefined();
    expect(pruned.activeDocumentKey).toBe("/repo\0src/new/a.ts");
    expect(pruned.clearSelectedFile).toBe(true);
  });

  it("scopes next active tab fallback to the closed document project", () => {
    const otherDoc = makeDoc({
      key: "/other\0keep.ts",
      projectId: "/other",
      path: "keep.ts",
    });
    const closedDoc = makeDoc({
      key: "/repo\0close.ts",
      projectId: "/repo",
      path: "close.ts",
    });
    expect(
      nextActiveDocumentAfterClose([otherDoc], closedDoc, closedDoc.key),
    ).toBeUndefined();
  });
});
