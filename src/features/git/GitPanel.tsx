import { useCallback, useEffect, useState } from "react";
import type { AppService } from "../../services/app-service";
import type { GitStatus } from "../../services/contracts";

export function GitPanel({
  service,
  projectId,
  status: initialStatus,
  onStatus,
}: {
  service: AppService;
  projectId: string;
  status?: GitStatus;
  onStatus: (status: GitStatus) => void;
}) {
  const status = initialStatus;
  const [diff, setDiff] = useState("");
  const [error, setError] = useState<string>();
  const refresh = useCallback(() => {
    setError(undefined);
    void Promise.all([service.gitStatus(projectId), service.gitDiff(projectId)])
      .then(([next, patch]) => {
        onStatus(next);
        setDiff(patch);
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
  }, [refresh]);
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
      <ul aria-label="Changed files">
        {status?.files.map((file) => (
          <li key={`${file.path}:${file.indexStatus}:${file.worktreeStatus}`}>
            <code>
              {file.indexStatus}
              {file.worktreeStatus}
            </code>
            <span>{file.path}</span>
          </li>
        ))}
      </ul>
      {status?.files.length === 0 && <p>No tracked or untracked changes.</p>}
      <pre aria-label="Git diff">{diff || "No tracked diff."}</pre>
    </section>
  );
}
