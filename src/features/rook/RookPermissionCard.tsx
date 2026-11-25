import type { RookPermissionChoice } from "../../services/contracts";

interface RookPermissionCardProps {
  request: Record<string, unknown>;
  onRespond: (choice: RookPermissionChoice) => void;
}

function accessLabel(access: unknown): string {
  if (access === "execute") return "Run shell command";
  if (access === "write") return "Write outside workspace";
  if (access === "read") return "Read outside workspace";
  if (access === "mcp") return "Invoke MCP tool";
  return "External access";
}

export function RookPermissionCard({
  request,
  onRespond,
}: RookPermissionCardProps) {
  const toolName =
    typeof request.toolName === "string" ? request.toolName : "tool";
  const access = request.access;
  const command =
    typeof request.command === "string" ? request.command : undefined;
  const targetPath =
    typeof request.path === "string" ? request.path : undefined;
  const folderPath =
    typeof request.folderPath === "string" ? request.folderPath : undefined;
  const reason =
    typeof request.reason === "string" ? request.reason : undefined;
  const inputSummary =
    typeof request.inputSummary === "string" ? request.inputSummary : undefined;
  const sandboxed =
    typeof request.sandboxed === "boolean" ? request.sandboxed : undefined;
  const timeoutSeconds =
    typeof request.timeoutSeconds === "number"
      ? request.timeoutSeconds
      : undefined;

  return (
    <section className="permission-card" aria-label="Rook permission request">
      <div className="permission-card-header">
        <strong>{accessLabel(access)}</strong>
        <span className="permission-card-meta">
          {toolName}
          {sandboxed !== undefined &&
            ` · ${sandboxed ? "Sandboxed (network off)" : "Unsandboxed host"}`}
          {timeoutSeconds !== undefined && ` · ${timeoutSeconds}s timeout`}
        </span>
      </div>
      {command && <code className="permission-card-code">{command}</code>}
      {targetPath && (
        <p className="permission-card-detail">
          <span>Path:</span> <code>{targetPath}</code>
        </p>
      )}
      {folderPath && folderPath !== targetPath && (
        <p className="permission-card-detail">
          <span>Scope:</span> <code>{folderPath}</code>
        </p>
      )}
      {inputSummary && (
        <p className="permission-card-detail">
          <span>Input:</span> <code>{inputSummary}</code>
        </p>
      )}
      {reason && <p className="permission-card-reason">{reason}</p>}
      <div className="permission-card-actions">
        {(["once", "session", "deny"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            className={
              choice === "deny"
                ? "button button-quiet"
                : choice === "once"
                  ? "button button-primary"
                  : "button"
            }
            onClick={() => onRespond(choice)}
          >
            {choice === "deny"
              ? "Deny"
              : choice === "once"
                ? "Allow once"
                : "Allow for session"}
          </button>
        ))}
      </div>
    </section>
  );
}
