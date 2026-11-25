import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppService } from "../../services/app-service";
import type {
  GitFileStatus,
  GitStatus,
  ProjectEntry,
  ProjectSummary,
} from "../../services/contracts";

function formatGitBadge(file: GitFileStatus): { label: string; tone: string } {
  const code =
    file.worktreeStatus !== " " && file.worktreeStatus !== ""
      ? file.worktreeStatus
      : file.indexStatus;
  if (code === "?") return { label: "U", tone: "untracked" };
  if (code === "A") return { label: "A", tone: "added" };
  if (code === "D") return { label: "D", tone: "deleted" };
  return { label: "M", tone: "modified" };
}

export function FileTreeExplorer({
  service,
  browserPreview,
  activeProject,
  gitStatus,
  syncVersion,
  selectedFilePath,
  projectPending,
  rookTouchedPaths,
  rookBuildRunning,
  onOpenProjectFile,
  onOpenProject,
  onEntryRenamed,
  onEntryDeleted,
  onRefreshWorkspace,
}: {
  service: AppService;
  browserPreview: boolean;
  activeProject: ProjectSummary;
  gitStatus?: GitStatus;
  syncVersion: number;
  selectedFilePath?: string;
  projectPending: boolean;
  rookTouchedPaths: string[];
  rookBuildRunning: boolean;
  onOpenProjectFile: (relativePath: string) => void;
  onOpenProject: () => void;
  onEntryRenamed: (fromRelativePath: string, toRelativePath: string) => void;
  onEntryDeleted: (relativePath: string) => void;
  onRefreshWorkspace: () => void;
}) {
  const [expandedDirs, setExpandedDirs] = useState<string[]>([]);
  const [entriesByDir, setEntriesByDir] = useState<
    Record<string, { entries: ProjectEntry[]; truncated: boolean }>
  >({});
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();

  const [creating, setCreating] = useState<{
    parentDir: string;
    kind: "file" | "directory";
    name: string;
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<ProjectEntry | null>(null);
  const [mutating, setMutating] = useState(false);

  const loadDirectory = useCallback(
    async (relativePath: string) => {
      if (browserPreview) return;
      setLoadingDirs((prev) => ({ ...prev, [relativePath]: true }));
      try {
        const listing = await service.listProjectEntries(
          activeProject.id,
          relativePath,
        );
        setEntriesByDir((prev) => ({
          ...prev,
          [relativePath]: listing,
        }));
        setError(undefined);
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Could not load folder.",
        );
      } finally {
        setLoadingDirs((prev) => ({ ...prev, [relativePath]: false }));
      }
    },
    [activeProject.id, browserPreview, service],
  );

  // Reset tree cache on project switch
  useEffect(() => {
    setExpandedDirs([]);
    setEntriesByDir({});
    setCreating(null);
    setRenamingPath(null);
    setConfirmDelete(null);
    setError(undefined);
    void loadDirectory("");
  }, [activeProject.id, loadDirectory]);

  // Refresh root + open directories when workspace syncs
  useEffect(() => {
    if (syncVersion === 0) return;
    void loadDirectory("");
    for (const dir of expandedDirs) {
      void loadDirectory(dir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion]);

  const gitByPath = useMemo(() => {
    const map = new Map<string, { label: string; tone: string }>();
    for (const file of gitStatus?.files ?? []) {
      map.set(file.path, formatGitBadge(file));
    }
    return map;
  }, [gitStatus]);

  const dirHasChanges = useMemo(() => {
    const dirs = new Set<string>();
    for (const file of gitStatus?.files ?? []) {
      const parts = file.path.split("/");
      for (let i = 1; i < parts.length; i += 1) {
        dirs.add(parts.slice(0, i).join("/"));
      }
    }
    return dirs;
  }, [gitStatus]);

  const rookTouchedSet = useMemo(
    () => new Set(rookTouchedPaths),
    [rookTouchedPaths],
  );

  async function toggleDirectory(relativePath: string) {
    if (expandedDirs.includes(relativePath)) {
      setExpandedDirs((prev) => prev.filter((item) => item !== relativePath));
      return;
    }
    setExpandedDirs((prev) => [...prev, relativePath]);
    if (!entriesByDir[relativePath]) {
      await loadDirectory(relativePath);
    }
  }

  async function submitCreate() {
    if (!creating) return;
    const rawName = creating.name.trim().replace(/^\/+|\/+$/g, "");
    if (!rawName) return;
    const targetPath = creating.parentDir
      ? `${creating.parentDir}/${rawName}`
      : rawName;
    setMutating(true);
    try {
      const created = await service.createProjectEntry(
        activeProject.id,
        targetPath,
        creating.kind,
      );
      setCreating(null);
      setError(undefined);
      if (creating.parentDir && !expandedDirs.includes(creating.parentDir)) {
        setExpandedDirs((prev) => [...prev, creating.parentDir]);
      }
      await loadDirectory(creating.parentDir);
      onRefreshWorkspace();
      if (created.kind === "file") {
        onOpenProjectFile(created.relativePath);
      } else {
        setExpandedDirs((prev) =>
          prev.includes(created.relativePath)
            ? prev
            : [...prev, created.relativePath],
        );
        await loadDirectory(created.relativePath);
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not create entry.",
      );
    } finally {
      setMutating(false);
    }
  }

  async function submitRename(entry: ProjectEntry) {
    const nextName = renameDraft.trim().replace(/^\/+|\/+$/g, "");
    if (!nextName || nextName === entry.name) {
      setRenamingPath(null);
      return;
    }
    const parent = entry.relativePath.includes("/")
      ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/"))
      : "";
    const nextPath = parent ? `${parent}/${nextName}` : nextName;
    setMutating(true);
    try {
      const updated = await service.renameProjectEntry(
        activeProject.id,
        entry.relativePath,
        nextPath,
      );
      setRenamingPath(null);
      setError(undefined);
      onEntryRenamed(entry.relativePath, updated.relativePath);
      await loadDirectory(parent);
      onRefreshWorkspace();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not rename entry.",
      );
    } finally {
      setMutating(false);
    }
  }

  async function submitDelete(entry: ProjectEntry) {
    const parent = entry.relativePath.includes("/")
      ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/"))
      : "";
    setMutating(true);
    try {
      await service.deleteProjectEntry(
        activeProject.id,
        entry.relativePath,
        entry.kind === "directory",
      );
      setConfirmDelete(null);
      setError(undefined);
      onEntryDeleted(entry.relativePath);
      await loadDirectory(parent);
      onRefreshWorkspace();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not delete entry.",
      );
    } finally {
      setMutating(false);
    }
  }

  function renderEntries(dirPath: string, depth: number) {
    const listing = entriesByDir[dirPath];
    if (!listing) {
      if (loadingDirs[dirPath]) {
        return (
          <p
            className="explorer-empty"
            style={{ paddingLeft: `${14 + depth * 12}px` }}
          >
            Loading…
          </p>
        );
      }
      return null;
    }

    return (
      <>
        {creating && creating.parentDir === dirPath && (
          <form
            className="explorer-inline-form"
            style={{ paddingLeft: `${12 + depth * 12}px` }}
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreate();
            }}
          >
            <input
              aria-label={`New ${creating.kind} name`}
              placeholder={
                creating.kind === "file" ? "path/to/file.ts" : "folder-name"
              }
              autoFocus
              disabled={mutating}
              value={creating.name}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setCreating((prev) => (prev ? { ...prev, name: value } : null));
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setCreating(null);
                }
              }}
            />
          </form>
        )}
        {listing.entries.map((entry) => {
          const isDir = entry.kind === "directory";
          const isExpanded = isDir && expandedDirs.includes(entry.relativePath);
          const isRenaming = renamingPath === entry.relativePath;
          const gitBadge = gitByPath.get(entry.relativePath);
          const hasDirtyDescendant =
            isDir && dirHasChanges.has(entry.relativePath);
          const isRookTouched = rookTouchedSet.has(entry.relativePath);

          return (
            <div key={entry.relativePath} className="explorer-tree-branch">
              {isRenaming ? (
                <form
                  className="explorer-inline-form"
                  style={{ paddingLeft: `${12 + depth * 12}px` }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitRename(entry);
                  }}
                >
                  <input
                    aria-label={`Rename ${entry.name}`}
                    autoFocus
                    disabled={mutating}
                    value={renameDraft}
                    onChange={(event) =>
                      setRenameDraft(event.currentTarget.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setRenamingPath(null);
                      }
                    }}
                  />
                </form>
              ) : (
                <div
                  className={`explorer-tree-row${selectedFilePath === entry.relativePath ? " explorer-file-active" : ""}`}
                  style={{ paddingLeft: `${10 + depth * 12}px` }}
                >
                  {entry.kind === "symlink" ? (
                    <div
                      className="explorer-entry explorer-symlink"
                      title="Symbolic links are not followed in the explorer."
                    >
                      <span aria-hidden="true">↗</span>
                      <span className="explorer-entry-name">{entry.name}</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`explorer-entry ${isDir ? "explorer-directory" : "explorer-file"}`}
                      onClick={() => {
                        if (isDir) {
                          void toggleDirectory(entry.relativePath);
                        } else {
                          onOpenProjectFile(entry.relativePath);
                        }
                      }}
                    >
                      <span aria-hidden="true">
                        {isDir ? (isExpanded ? "▾" : "▸") : "·"}
                      </span>
                      <span className="explorer-entry-name">{entry.name}</span>
                    </button>
                  )}

                  <span className="explorer-row-meta">
                    {isRookTouched && (
                      <span
                        className={`explorer-rook-dot${rookBuildRunning ? " is-active" : ""}`}
                        title="Modified by Rook Build"
                      />
                    )}
                    {gitBadge && (
                      <span
                        className={`explorer-git-badge is-${gitBadge.tone}`}
                        title={`Git: ${gitBadge.label}`}
                      >
                        {gitBadge.label}
                      </span>
                    )}
                    {!gitBadge && hasDirtyDescendant && (
                      <span
                        className="explorer-dir-dirty-dot"
                        title="Contains modified files"
                      />
                    )}
                  </span>

                  {entry.kind !== "symlink" && !browserPreview && (
                    <span className="explorer-row-actions">
                      {isDir && (
                        <button
                          type="button"
                          className="explorer-mini-btn"
                          aria-label={`New file in ${entry.name}`}
                          title="New file here"
                          disabled={rookBuildRunning}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!expandedDirs.includes(entry.relativePath)) {
                              void toggleDirectory(entry.relativePath);
                            }
                            setCreating({
                              parentDir: entry.relativePath,
                              kind: "file",
                              name: "",
                            });
                          }}
                        >
                          +
                        </button>
                      )}
                      <button
                        type="button"
                        className="explorer-mini-btn"
                        aria-label={`Rename ${entry.name}`}
                        title="Rename"
                        disabled={rookBuildRunning}
                        onClick={(event) => {
                          event.stopPropagation();
                          setRenamingPath(entry.relativePath);
                          setRenameDraft(entry.name);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="explorer-mini-btn explorer-mini-danger"
                        aria-label={`Delete ${entry.name}`}
                        title="Delete"
                        disabled={rookBuildRunning}
                        onClick={(event) => {
                          event.stopPropagation();
                          setConfirmDelete(entry);
                        }}
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
              )}

              {isExpanded && renderEntries(entry.relativePath, depth + 1)}
            </div>
          );
        })}
        {listing.entries.length === 0 && dirPath === "" && !creating && (
          <p className="explorer-empty">This folder has no visible entries.</p>
        )}
        {listing.truncated && (
          <p className="explorer-limit" role="status">
            Showing the first 1,000 entries.
          </p>
        )}
      </>
    );
  }

  return (
    <div className="explorer-tree-panel">
      <div className="explorer-toolbar">
        <div className="explorer-root" title={activeProject.path}>
          <span className="explorer-folder-glyph" aria-hidden="true">
            ⌄
          </span>
          <strong>{activeProject.name}</strong>
        </div>
        <div className="explorer-toolbar-actions">
          {!browserPreview && (
            <>
              <button
                className="icon-button"
                type="button"
                aria-label="New file"
                title="New file"
                disabled={rookBuildRunning}
                onClick={() =>
                  setCreating({ parentDir: "", kind: "file", name: "" })
                }
              >
                +F
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="New folder"
                title="New folder"
                disabled={rookBuildRunning}
                onClick={() =>
                  setCreating({ parentDir: "", kind: "directory", name: "" })
                }
              >
                +D
              </button>
            </>
          )}
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh project folder"
            title="Refresh explorer"
            onClick={() => {
              void loadDirectory("");
              for (const dir of expandedDirs) {
                void loadDirectory(dir);
              }
              onRefreshWorkspace();
            }}
          >
            ↻
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Open another project folder"
            title="Open another project folder"
            disabled={projectPending}
            onClick={onOpenProject}
          >
            +
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div className="explorer-delete-confirm" role="alert">
          <p>
            Delete <strong>{confirmDelete.relativePath}</strong>?
          </p>
          <div>
            <button
              type="button"
              className="button button-primary"
              disabled={mutating}
              onClick={() => void submitDelete(confirmDelete)}
            >
              {mutating ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              className="button button-quiet"
              disabled={mutating}
              onClick={() => setConfirmDelete(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="inline-error explorer-error" role="alert">
          {error}
        </p>
      )}

      <div className="explorer-list" role="tree" aria-label="Files and folders">
        {renderEntries("", 0)}
      </div>
    </div>
  );
}
