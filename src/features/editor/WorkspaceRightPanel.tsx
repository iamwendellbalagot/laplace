import type { AppService } from "../../services/app-service";
import type {
  EditorDiagnostic,
  ExecutionRecord,
  GitStatus,
  ProjectSummary,
  ReviewDiffBaseline,
  RookContextChip,
  RookMode,
} from "../../services/contracts";
import type { RightPanelTab } from "../../state/app-store";
import { RookPanel } from "../rook/RookPanel";
import {
  EditorContextInspector,
  type EditorCursorState,
  type EditorSelection,
} from "./EditorContextInspector";
import type { SyncableDocument } from "./workspace-sync";

export function WorkspaceRightPanel({
  service,
  browserPreview,
  activeTab,
  onTabChange,
  onHide,
  activeProject,
  activeDocument,
  selection,
  cursor,
  diagnostics,
  gitStatus,
  executions,
  syncVersion,
  returnAnchor,
  rookFocusNonce,
  onReturnToAnchor,
  onAttachToRook,
  onOpenInlinePatch,
  onOpenFileInReview,
  onOpenReview,
  onOpenVerify,
  onJumpToLocation,
  onExpandToContextLens,
  onRookModeChange,
  onRookTrustBuild,
  onRookDismissTrustPrompt,
  onRookNewSession,
  onRookOpenSession,
  onRookStart,
  onRookDraftSave,
  onPreviewRookPatch,
  onUndoTurn,
  onToggleRookExpand,
}: {
  service: AppService;
  browserPreview: boolean;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  onHide: () => void;
  activeProject?: ProjectSummary;
  activeDocument?: SyncableDocument;
  selection?: EditorSelection | null;
  cursor?: EditorCursorState | null;
  diagnostics?: EditorDiagnostic[];
  gitStatus?: GitStatus;
  executions: ExecutionRecord[];
  syncVersion: number;
  returnAnchor?: { filePath: string; line: number; column?: number } | null;
  rookFocusNonce: number;
  onReturnToAnchor?: () => void;
  onAttachToRook: (chip: RookContextChip, mode: RookMode) => void;
  onOpenInlinePatch: (document: SyncableDocument) => void;
  onOpenFileInReview: (relativePath: string) => void;
  onOpenReview: (
    selectedPaths?: string[],
    baseline?: ReviewDiffBaseline,
  ) => void;
  onOpenVerify: () => void;
  onJumpToLocation: (
    relativePath: string,
    line: number,
    column?: number,
    recordReturnAnchor?: boolean,
  ) => void;
  onExpandToContextLens: (focusPath?: string) => void;
  onRookModeChange: (mode: RookMode) => void;
  onRookTrustBuild: () => void;
  onRookDismissTrustPrompt: () => void;
  onRookNewSession: () => void;
  onRookOpenSession: (id: string) => void;
  onRookStart: () => void;
  onRookDraftSave: (draft: string) => void;
  onPreviewRookPatch: (code: string) => void;
  onUndoTurn: (messageIndex: number, touchedFiles: string[]) => Promise<void>;
  onToggleRookExpand: () => void;
}) {
  return (
    <aside
      className="editor-inspector workspace-right-panel"
      aria-label="Co-pilot and context panel"
    >
      <div className="inspector-heading">
        <div
          className="inspector-tabs inspector-tabs-inline"
          role="tablist"
          aria-label="Workspace right panel"
        >
          <button
            type="button"
            role="tab"
            id="workspace-tab-rook"
            aria-selected={activeTab === "rook"}
            onClick={() => onTabChange("rook")}
          >
            Rook
          </button>
          <button
            type="button"
            role="tab"
            id="workspace-tab-context"
            aria-selected={activeTab === "context"}
            onClick={() => onTabChange("context")}
          >
            Context
          </button>
          <button
            type="button"
            role="tab"
            id="workspace-tab-history"
            aria-selected={activeTab === "history"}
            onClick={() => onTabChange("history")}
          >
            History
          </button>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Hide right panel"
          title="Hide right panel"
          onClick={onHide}
        >
          ×
        </button>
      </div>

      {activeTab === "rook" ? (
        <RookPanel
          service={service}
          variant="docked"
          browserPreview={browserPreview}
          focusNonce={rookFocusNonce}
          onRookModeChange={onRookModeChange}
          onRookTrustBuild={onRookTrustBuild}
          onRookDismissTrustPrompt={onRookDismissTrustPrompt}
          onRookNewSession={onRookNewSession}
          onRookOpenSession={onRookOpenSession}
          onRookStart={onRookStart}
          onRookDraftSave={onRookDraftSave}
          onPreviewRookPatch={onPreviewRookPatch}
          onJumpToLocation={(relPath, line, col) =>
            onJumpToLocation(relPath, line, col, true)
          }
          onOpenReview={onOpenReview}
          onUndoTurn={onUndoTurn}
          onToggleExpand={onToggleRookExpand}
        />
      ) : (
        <EditorContextInspector
          embedded
          forcedTab={activeTab}
          service={service}
          browserPreview={browserPreview}
          activeProject={activeProject}
          activeDocument={activeDocument}
          selection={selection}
          cursor={cursor}
          diagnostics={diagnostics}
          gitStatus={gitStatus}
          executions={executions}
          syncVersion={syncVersion}
          returnAnchor={returnAnchor}
          onReturnToAnchor={onReturnToAnchor}
          onAttachToRook={onAttachToRook}
          onOpenInlinePatch={onOpenInlinePatch}
          onOpenFileInReview={onOpenFileInReview}
          onOpenVerify={onOpenVerify}
          onJumpToLocation={onJumpToLocation}
          onExpandToContextLens={onExpandToContextLens}
          onHide={onHide}
        />
      )}
    </aside>
  );
}
