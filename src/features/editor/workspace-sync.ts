import type { ProjectFileRead } from "../../services/contracts";

const MUTATING_ROOK_TOOLS = new Set(["edit", "write", "bash"]);

export interface EditorExternalChange {
  kind: "modified" | "deleted" | "unreadable";
  diskContent?: string;
  detectedAt: number;
}

export interface SyncableDocument {
  key: string;
  projectId: string;
  path: string;
  content: string;
  savedContent: string;
  externalChange?: EditorExternalChange;
}

export type DiskReadOutcome =
  | { ok: true; file: ProjectFileRead }
  | { ok: false; deleted: boolean };

export type ReconcileStatus =
  | "unchanged"
  | "reloaded"
  | "conflict"
  | "deleted"
  | "unreadable";

export function isMutatingRookTool(name: string): boolean {
  return MUTATING_ROOK_TOOLS.has(name);
}

export function reconcileDocumentWithDisk<T extends SyncableDocument>(
  document: T,
  outcome: DiskReadOutcome,
  now = Date.now(),
): { document: T; status: ReconcileStatus } {
  if (!outcome.ok) {
    if (!outcome.deleted) {
      return { document, status: "unchanged" };
    }
    if (document.externalChange?.kind === "deleted") {
      return { document, status: "deleted" };
    }
    return {
      document: {
        ...document,
        externalChange: { kind: "deleted", detectedAt: now },
      },
      status: "deleted",
    };
  }

  const { file } = outcome;
  if (file.kind !== "text" || file.content === null) {
    if (document.externalChange?.kind === "unreadable") {
      return { document, status: "unreadable" };
    }
    return {
      document: {
        ...document,
        externalChange: { kind: "unreadable", detectedAt: now },
      },
      status: "unreadable",
    };
  }

  const diskContent = file.content;
  if (diskContent === document.savedContent) {
    if (!document.externalChange) {
      return { document, status: "unchanged" };
    }
    return {
      document: { ...document, externalChange: undefined },
      status: "unchanged",
    };
  }

  const isClean = document.content === document.savedContent;
  if (isClean) {
    return {
      document: {
        ...document,
        content: diskContent,
        savedContent: diskContent,
        externalChange: undefined,
      },
      status: "reloaded",
    };
  }

  if (
    document.externalChange?.kind === "modified" &&
    document.externalChange.diskContent === diskContent
  ) {
    return { document, status: "conflict" };
  }

  return {
    document: {
      ...document,
      externalChange: {
        kind: "modified",
        diskContent,
        detectedAt: now,
      },
    },
    status: "conflict",
  };
}

export function applyExternalReload<T extends SyncableDocument>(
  document: T,
): T {
  const diskContent = document.externalChange?.diskContent;
  if (diskContent === undefined) return document;
  return {
    ...document,
    content: diskContent,
    savedContent: diskContent,
    externalChange: undefined,
  };
}

export function dismissExternalChangeKeepingEdits<T extends SyncableDocument>(
  document: T,
): T {
  const nextSaved =
    document.externalChange?.kind === "modified" &&
    document.externalChange.diskContent !== undefined
      ? document.externalChange.diskContent
      : document.savedContent;
  return {
    ...document,
    savedContent: nextSaved,
    externalChange: undefined,
  };
}

function remapRelativePath(
  path: string,
  fromPath: string,
  toPath: string,
): string {
  if (path === fromPath) return toPath;
  if (path.startsWith(`${fromPath}/`)) {
    return `${toPath}${path.slice(fromPath.length)}`;
  }
  return path;
}

function isSameOrDescendantPath(path: string, targetPath: string): boolean {
  return path === targetPath || path.startsWith(`${targetPath}/`);
}

export function remapDocumentsForRename<T extends SyncableDocument>(
  documents: T[],
  projectId: string,
  fromPath: string,
  toPath: string,
  activeDocumentKey?: string,
  splitDocumentKey?: string,
  selectedFilePath?: string,
): {
  documents: T[];
  activeDocumentKey?: string;
  splitDocumentKey?: string;
  selectedFilePath?: string;
} {
  const prefix = `${projectId}\0`;
  const nextDocs = documents.map((doc) => {
    if (doc.projectId !== projectId) return doc;
    const nextPath = remapRelativePath(doc.path, fromPath, toPath);
    return nextPath === doc.path
      ? doc
      : { ...doc, path: nextPath, key: `${prefix}${nextPath}` };
  });
  const remapKey = (key?: string) =>
    key?.startsWith(prefix)
      ? `${prefix}${remapRelativePath(key.slice(prefix.length), fromPath, toPath)}`
      : key;
  return {
    documents: nextDocs,
    activeDocumentKey: remapKey(activeDocumentKey),
    splitDocumentKey: remapKey(splitDocumentKey),
    selectedFilePath: selectedFilePath
      ? remapRelativePath(selectedFilePath, fromPath, toPath)
      : undefined,
  };
}

export function pruneDocumentsForDelete<T extends SyncableDocument>(
  documents: T[],
  projectId: string,
  deletedPath: string,
  activeDocumentKey?: string,
  splitDocumentKey?: string,
  selectedFilePath?: string,
): {
  documents: T[];
  activeDocumentKey?: string;
  splitDocumentKey?: string;
  clearSelectedFile: boolean;
} {
  const prefix = `${projectId}\0`;
  const nextDocs = documents.filter(
    (doc) =>
      doc.projectId !== projectId ||
      !isSameOrDescendantPath(doc.path, deletedPath),
  );
  const nextActiveKey =
    activeDocumentKey?.startsWith(prefix) &&
    isSameOrDescendantPath(activeDocumentKey.slice(prefix.length), deletedPath)
      ? nextDocs.filter((doc) => doc.projectId === projectId).at(-1)?.key
      : activeDocumentKey;
  const nextSplitKey =
    splitDocumentKey?.startsWith(prefix) &&
    isSameOrDescendantPath(splitDocumentKey.slice(prefix.length), deletedPath)
      ? undefined
      : splitDocumentKey;
  return {
    documents: nextDocs,
    activeDocumentKey: nextActiveKey,
    splitDocumentKey: nextSplitKey,
    clearSelectedFile: Boolean(
      selectedFilePath && isSameOrDescendantPath(selectedFilePath, deletedPath),
    ),
  };
}

export function nextActiveDocumentAfterClose<T extends SyncableDocument>(
  remainingDocuments: T[],
  closedDocument: T,
  activeDocumentKey?: string,
): T | undefined {
  const projectDocs = remainingDocuments.filter(
    (item) => item.projectId === closedDocument.projectId,
  );
  if (activeDocumentKey === closedDocument.key) {
    return projectDocs.at(-1);
  }
  return projectDocs.find((item) => item.key === activeDocumentKey);
}
