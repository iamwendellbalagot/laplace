import type {
  ProjectSummary,
  RookMode,
  WorkspacePulse,
} from "../../services/contracts";

function verifyPillMeta(pulse: WorkspacePulse | null): {
  tone: string;
  label: string;
  title: string;
} {
  if (!pulse?.latestExecutionStatus) {
    return {
      tone: "unverified",
      label: "Unverified",
      title: "No verification checks recorded yet — click to open Verify",
    };
  }
  const cmd = pulse.latestExecutionCommand
    ? `${pulse.latestExecutionCommand} · `
    : "";
  switch (pulse.latestExecutionStatus) {
    case "passed":
      return {
        tone: "passed",
        label: "✓ Verified",
        title: `${cmd}Passed on current source — click to open Verify`,
      };
    case "stale":
      return {
        tone: "stale",
        label: "◌ Stale",
        title: `${cmd}Source changed since last check — click to re-verify`,
      };
    case "failed":
      return {
        tone: "failed",
        label: "✕ Failed",
        title: `${cmd}Latest check failed — click to inspect`,
      };
    case "inconclusive":
      return {
        tone: "inconclusive",
        label: "? Inconclusive",
        title: `${cmd}Source changed while check ran — click to re-verify`,
      };
    default:
      return {
        tone: pulse.latestExecutionStatus,
        label: pulse.latestExecutionStatus,
        title: `${cmd}Click to open Verify`,
      };
  }
}

export function TopbarPulse({
  activeProject,
  workspacePulse,
  rookConnected,
  rookConnecting,
  rookMode,
  rookRunning,
  rookPermissionPending,
  onOpenReview,
  onOpenVerify,
  onFocusRook,
}: {
  activeProject?: ProjectSummary;
  workspacePulse: WorkspacePulse | null;
  rookConnected: boolean;
  rookConnecting: boolean;
  rookMode: RookMode;
  rookRunning: boolean;
  rookPermissionPending: boolean;
  onOpenReview: () => void;
  onOpenVerify: () => void;
  onFocusRook: () => void;
}) {
  const verifyMeta = verifyPillMeta(workspacePulse);
  const isGitRepo = Boolean(
    workspacePulse?.isGitRepository ?? activeProject?.isGitRepository,
  );
  const dirtyTotal =
    (workspacePulse?.dirtyCount ?? 0) + (workspacePulse?.untrackedCount ?? 0);
  const aheadBehind =
    workspacePulse && (workspacePulse.ahead > 0 || workspacePulse.behind > 0)
      ? `${workspacePulse.ahead > 0 ? `↑${workspacePulse.ahead}` : ""}${workspacePulse.behind > 0 ? `↓${workspacePulse.behind}` : ""}`
      : null;
  const branchName = workspacePulse?.branch ?? "Git";

  const rookLabel = rookPermissionPending
    ? "Rook · Permission needed"
    : rookRunning
      ? `Rook ${rookMode === "build" ? "Build" : "Ask"} · running`
      : rookConnecting
        ? "Connecting Rook…"
        : rookConnected
          ? `Rook · ${rookMode === "build" ? "Build" : "Ask"}`
          : "Rook offline";

  return (
    <>
      {activeProject &&
        (isGitRepo ? (
          <button
            type="button"
            className={`pulse-pill pulse-git-pill${dirtyTotal > 0 ? " is-dirty" : ""}`}
            title={
              dirtyTotal > 0
                ? `Git branch ${branchName}${aheadBehind ? ` (${aheadBehind})` : ""} · ${dirtyTotal} modified — click to open Review`
                : `Git branch ${branchName}${aheadBehind ? ` (${aheadBehind})` : ""} · clean working tree — click to open Review`
            }
            onClick={onOpenReview}
          >
            <svg
              className="pulse-git-icon"
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="5"
                cy="3.5"
                r="1.75"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <circle
                cx="5"
                cy="12.5"
                r="1.75"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <circle
                cx="11.5"
                cy="6"
                r="1.75"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M5 5.25v5.5M11.5 7.75c0 2.1-1.5 2.75-6.5 2.75"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            <span className="pulse-git-branch">
              {branchName}
              {aheadBehind ? ` ${aheadBehind}` : ""}
            </span>
            <span className="pulse-git-state">
              {dirtyTotal > 0 ? `${dirtyTotal} changed` : "clean"}
            </span>
          </button>
        ) : (
          <span
            className="pulse-pill pulse-git-pill is-non-git"
            title="Current workspace is not a Git repository"
          >
            Folder · no Git
          </span>
        ))}

      {activeProject?.isGitRepository && (
        <button
          type="button"
          className={`pulse-pill pulse-verify-${verifyMeta.tone}`}
          title={verifyMeta.title}
          onClick={onOpenVerify}
        >
          {verifyMeta.label}
        </button>
      )}

      <button
        type="button"
        className={`connection-state pulse-rook-pill${rookPermissionPending ? " is-permission" : ""}${rookRunning ? " is-running" : ""}`}
        title="Focus Rook co-pilot (⌘L / Ctrl+L)"
        onClick={onFocusRook}
      >
        <span
          className={`status-dot${rookConnected ? "" : " status-dot-muted"}${rookRunning ? " is-pulsing" : ""}`}
        />
        <span>{rookLabel}</span>
      </button>
    </>
  );
}
