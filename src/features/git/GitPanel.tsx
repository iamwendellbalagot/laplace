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
  onOpenInReview,
}: {
  service: AppService;
  projectId: string;
  status?: GitStatus;
  syncVersion?: number;
  onStatus: (status: GitStatus) => void;
  onOpenFile?: (relativePath: string) => void;
  onOpenInReview?: (selectedPaths: string[]) => void;
}) {
  const status = initialStatus;
  const [diff, setDiff] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
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

  return (
    <section className="git-panel" aria-label="Git changes">
      <header>
        <strong>{status?.branch ?? "Git status"}</strong>
        <div className="review-inline-actions">
          {status && status.files.length > 0 && onOpenInReview && (
            <button
              type="button"
              className="button button-primary"
              disabled={selectedPaths.length === 0}
              onClick={() => onOpenInReview(selectedPaths)}
            >
              Review {selectedPaths.length} file(s) ↗
            </button>
          )}
          <button
            type="button"
            className="button button-quiet"
            onClick={refresh}
          >
            Refresh
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <ul aria-label="Changed files">
        {status?.files.map((file) => {
          const checked = selectedPaths.includes(file.path);
          return (
            <li key={`${file.path}:${file.indexStatus}:${file.worktreeStatus}`}>
              {onOpenInReview && (
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={`Select ${file.path} for Review`}
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
