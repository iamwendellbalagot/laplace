import { useCallback, useEffect, useState } from "react";
import type { AppService } from "../../services/app-service";
import type { GitStatus } from "../../services/contracts";

export function GitPanel({
  service,
  projectId,
  status: initialStatus,
  syncVersion = 0,
  onStatus,
  onOpenFile,
  onContinueAsChange,
}: {
  service: AppService;
  projectId: string;
  status?: GitStatus;
  syncVersion?: number;
  onStatus: (status: GitStatus) => void;
  onOpenFile?: (relativePath: string) => void;
  onContinueAsChange?: (
    objective: string,
    selectedPaths: string[],
  ) => Promise<void>;
}) {
  const status = initialStatus;
  const [diff, setDiff] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [promoteObjective, setPromoteObjective] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(() => {
    setError(undefined);
    void Promise.all([service.gitStatus(projectId), service.gitDiff(projectId)])
      .then(([next, patch]) => {
        onStatus(next);
        setDiff(patch);
        const livePaths = next.files.map((file) => file.path);
        setSelectedPaths((current) => {
          const kept = current.filter((path) => livePaths.includes(path));
          return kept.length > 0 ? kept : livePaths;
        });
      })
      .catch((failure) =>
        setError(
          failure instanceof Error
            ? failure.message
            : "Git status could not be read.",
        ),
      );
  }, [onStatus, projectId, service]);

  useEffect(() => {
    refresh();
  }, [refresh, syncVersion]);

  async function handlePromote() {
    if (!onContinueAsChange || selectedPaths.length === 0) return;
    const objective =
      promoteObjective.trim() ||
      `Continue edits in ${selectedPaths.slice(0, 2).join(", ")}${selectedPaths.length > 2 ? ` (+${selectedPaths.length - 2})` : ""}`;
    setPromoting(true);
    setError(undefined);
    try {
      await onContinueAsChange(objective, selectedPaths);
      setPromoteObjective("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Selected edits could not be promoted to a Change.",
      );
    } finally {
      setPromoting(false);
    }
  }

  return (
    <section className="git-panel" aria-label="Git changes">
      <header>
        <strong>{status?.branch ?? "Git status"}</strong>
        <button type="button" onClick={refresh}>
          Refresh
        </button>
      </header>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {status && status.files.length > 0 && onContinueAsChange && (
        <form
          className="git-promote-bar"
          onSubmit={(event) => {
            event.preventDefault();
            void handlePromote();
          }}
        >
          <input
            value={promoteObjective}
            onChange={(event) => setPromoteObjective(event.target.value)}
            placeholder="Objective for selected edits (unrelated files stay untouched)…"
            aria-label="Change objective for selected edits"
          />
          <button
            type="submit"
            className="button button-primary"
            disabled={promoting || selectedPaths.length === 0}
          >
            {promoting
              ? "Creating…"
              : `Continue ${selectedPaths.length} file(s) as Change`}
          </button>
        </form>
      )}
      <ul aria-label="Changed files">
        {status?.files.map((file) => {
          const checked = selectedPaths.includes(file.path);
          return (
            <li key={`${file.path}:${file.indexStatus}:${file.worktreeStatus}`}>
              {onContinueAsChange && (
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={`Select ${file.path} for Change`}
                  onChange={(event) =>
                    setSelectedPaths((current) =>
                      event.target.checked
                        ? [...new Set([...current, file.path])]
                        : current.filter((item) => item !== file.path),
                    )
                  }
                />
              )}
              <code>
                {file.indexStatus}
                {file.worktreeStatus}
              </code>
              {onOpenFile ? (
                <button
                  type="button"
                  className="git-file-open"
                  onClick={() => onOpenFile(file.path)}
                >
                  {file.path}
                </button>
              ) : (
                <span>{file.path}</span>
              )}
            </li>
          );
        })}
      </ul>
      {status?.files.length === 0 && <p>No tracked or untracked changes.</p>}
      <pre aria-label="Git diff">{diff || "No tracked diff."}</pre>
    </section>
  );
}
