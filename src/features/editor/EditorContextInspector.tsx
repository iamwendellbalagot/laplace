import type {
  ExecutionRecord,
  GitStatus,
  ProjectSummary,
  RookContextChip,
  RookMode,
} from "../../services/contracts";
import type { SyncableDocument } from "./workspace-sync";

export interface EditorSelection {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export function EditorContextInspector({
  activeProject,
  activeDocument,
  selection,
  gitStatus,
  executions,
  onAttachToRook,
  onOpenInlinePatch,
  onOpenFileInReview,
  onHide,
}: {
  activeProject?: ProjectSummary;
  activeDocument?: SyncableDocument;
  selection?: EditorSelection | null;
  gitStatus?: GitStatus;
  executions: ExecutionRecord[];
  onAttachToRook: (chip: RookContextChip, mode: RookMode) => void;
  onOpenInlinePatch: (document: SyncableDocument) => void;
  onOpenFileInReview: (relativePath: string) => void;
  onHide: () => void;
}) {
  const fileGit = activeDocument
    ? gitStatus?.files.find((item) => item.path === activeDocument.path)
    : undefined;
  const activeSelection =
    selection && activeDocument && selection.path === activeDocument.path
      ? selection
      : null;
  const latestCheck = executions[0];

  function buildChip(): RookContextChip | null {
    if (!activeDocument) return null;
    if (activeSelection && activeSelection.text.trim()) {
      return {
        id: `sel-${activeDocument.path}-${activeSelection.startLine}-${activeSelection.endLine}`,
        kind: "selection",
        label: `${activeDocument.path}:${activeSelection.startLine}-${activeSelection.endLine}`,
        filePath: activeDocument.path,
        startLine: activeSelection.startLine,
        endLine: activeSelection.endLine,
        content: activeSelection.text.slice(0, 16_000),
        sourceSnapshot: activeDocument.content,
      };
    }
    return {
      id: `file-${activeDocument.path}`,
      kind: "file",
      label: activeDocument.path,
      filePath: activeDocument.path,
      content: activeDocument.content.slice(0, 16_000),
      sourceSnapshot: activeDocument.content,
    };
  }

  return (
    <aside className="editor-inspector" aria-label="Editor context inspector">
      <div className="inspector-heading">
        <span className="eyebrow">Context</span>
        <button
          className="icon-button"
          type="button"
          aria-label="Hide editor inspector"
          onClick={onHide}
        >
          ×
        </button>
      </div>
      {!activeProject || !activeDocument ? (
        <div className="inspector-empty">
          <span aria-hidden="true">◇</span>
          <h2>No source context</h2>
          <p>
            Open a project and select a file to attach source context, preview
            localized patches, or promote edits to a Change.
          </p>
        </div>
      ) : (
        <div className="inspector-body">
          <section className="inspector-card">
            <span className="eyebrow">Active source</span>
            <strong className="inspector-file-path">
              {activeDocument.path}
            </strong>
            <div className="inspector-pills">
              <span className="status-pill">
                {activeDocument.content !== activeDocument.savedContent
                  ? "Unsaved"
                  : "Saved"}
              </span>
              {fileGit && (
                <span className="status-pill">
                  Git {fileGit.indexStatus}
                  {fileGit.worktreeStatus}
                </span>
              )}
              {activeSelection && (
                <span className="status-pill">
                  L{activeSelection.startLine}–L{activeSelection.endLine}
                </span>
              )}
            </div>
          </section>

          <section className="inspector-card">
            <span className="eyebrow">Contextual actions</span>
            <p className="inspector-hint">
              {activeSelection
                ? `Using selected lines ${activeSelection.startLine}–${activeSelection.endLine}.`
                : "Select lines in the editor to narrow context, or attach the full file."}
            </p>
            <div className="inspector-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  const chip = buildChip();
                  if (chip) onAttachToRook(chip, "ask");
                }}
              >
                Ask Rook {activeSelection ? "about selection" : "about file"}
              </button>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => {
                  const chip = buildChip();
                  if (chip) onAttachToRook(chip, "build");
                }}
              >
                Send to Rook Build
              </button>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => onOpenInlinePatch(activeDocument)}
              >
                Quick inline patch
              </button>
              {activeProject.isGitRepository && (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => onOpenFileInReview(activeDocument.path)}
                >
                  Open in Review ↗
                </button>
              )}
            </div>
          </section>

          <section className="inspector-card">
            <span className="eyebrow">Verification</span>
            {latestCheck ? (
              <p className="inspector-hint">
                <span
                  className={`verify-status-pill verify-status-${latestCheck.status}`}
                >
                  {latestCheck.status}
                </span>{" "}
                {latestCheck.program} {latestCheck.args.join(" ")}
              </p>
            ) : (
              <p className="inspector-hint">No verification checks yet.</p>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}
