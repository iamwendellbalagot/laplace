import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { AppService } from "../../services/app-service";
import type {
  EditorDiagnostic,
  ExecutionRecord,
  GitStatus,
  ProjectEntry,
  ProjectFileRead,
  ProjectRecipeSummary,
  ProjectSummary,
  ReviewDiffBaseline,
  RookContextChip,
  RookMode,
  UiPreferences,
} from "../../services/contracts";
import {
  useAppStore,
  type BottomDrawerTab,
  type RightPanelTab,
} from "../../state/app-store";
import { useRookStore } from "../../state/rook-store";
import type { EditorDocument } from "../../state/workspace-store";
import { GitPanel } from "../git/GitPanel";
import { RookPanel } from "../rook/RookPanel";
import { RunPanel } from "../runs/RunPanel";
import { TerminalPanel } from "../terminal/TerminalPanel";
import {
  VerifyDrawerPanel,
  summarizeVerification,
} from "../verify/VerifyDrawerPanel";
import type { RevealTarget } from "./CodeEditor";
import type {
  EditorCursorState,
  EditorSelection,
} from "./EditorContextInspector";
import { FileTreeExplorer } from "./FileTreeExplorer";
import { parseUnifiedDiffHunksForFile } from "./git-gutter";
import { InlineCommandBar } from "./InlineCommandBar";
import {
  InlinePatchOverlay,
  type PendingInlinePatch,
} from "./InlinePatchOverlay";
import { WorkspaceRightPanel } from "./WorkspaceRightPanel";
import { WorkspaceSearchPanel } from "./WorkspaceSearchPanel";
import type { ReturnSourceAnchor } from "../context/ContextLensScreen";

const CodeEditor = lazy(() =>
  import("./CodeEditor").then((module) => ({
    default: module.CodeEditor,
  })),
);

function clampPanelSize(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function WorkspaceTools({
  service,
  activeProject,
  documents,
  tab,
  collapsed,
  theme,
  onTabChange,
  onToggleCollapse,
  workspaceTrusted,
  onTrustWorkspace,
  onUntrustWorkspace,
  gitStatus,
  onGitStatusChange,
  executions,
  projectRecipes,
  verifyChangeId,
  savingFiles,
  syncVersion,
  onSaveDocuments,
  onRunCheck,
  onRunProjectRecipe,
  onPruneExecutions,
  onOpenFile,
  onJumpToLocation,
  onInvestigateInRook,
  onContinueAsChange,
  browserPreview,
}: {
  service: AppService;
  activeProject: ProjectSummary;
  documents: EditorDocument[];
  tab: BottomDrawerTab;
  collapsed: boolean;
  theme: "dark" | "light";
  onTabChange: (next: BottomDrawerTab) => void;
  onToggleCollapse: () => void;
  workspaceTrusted: boolean;
  onTrustWorkspace: () => Promise<void>;
  onUntrustWorkspace: () => Promise<void>;
  gitStatus?: GitStatus;
  onGitStatusChange: (status: GitStatus) => void;
  executions: ExecutionRecord[];
  projectRecipes: ProjectRecipeSummary[];
  verifyChangeId?: string;
  savingFiles: boolean;
  syncVersion: number;
  onSaveDocuments: (documents: EditorDocument[]) => Promise<boolean>;
  onRunCheck: (
    program: string,
    args: string[],
    changeId?: string,
  ) => Promise<void>;
  onRunProjectRecipe: (recipeName: string, changeId?: string) => Promise<void>;
  onPruneExecutions?: () => Promise<void>;
  onOpenFile: (relativePath: string) => void;
  onJumpToLocation: (
    relativePath: string,
    line: number,
    column?: number,
  ) => void;
  onInvestigateInRook: (chip: RookContextChip, mode?: RookMode) => void;
  onContinueAsChange?: (
    objective: string,
    selectedPaths: string[],
  ) => Promise<void>;
  browserPreview: boolean;
}) {
  const verifySummary = summarizeVerification(executions);
  const [terminalStarted, setTerminalStarted] = useState(false);
  const [terminalActive, setTerminalActive] = useState(false);

  useEffect(() => {
    setTerminalStarted(false);
    setTerminalActive(false);
  }, [activeProject.id]);

  useEffect(() => {
    if (browserPreview || tab !== "git") return;
    void service
      .gitStatus(activeProject.id)
      .then(onGitStatusChange)
      .catch(() => undefined);
  }, [activeProject.id, browserPreview, onGitStatusChange, service, tab]);

  const selectToolTab = (next: BottomDrawerTab) => {
    onTabChange(next);
    if (collapsed) onToggleCollapse();
  };

  return (
    <section
      className={`workspace-tools${collapsed ? " workspace-tools-collapsed" : ""}`}
      aria-label="Workspace tools"
    >
      <div
        className="workspace-tool-tabs"
        role="tablist"
        aria-label="Bottom tools"
      >
        <button
          role="tab"
          aria-selected={!collapsed && tab === "terminal"}
          onClick={() => selectToolTab("terminal")}
        >
          Terminal
        </button>
        <button
          role="tab"
          aria-selected={!collapsed && tab === "run"}
          onClick={() => selectToolTab("run")}
        >
          Run
        </button>
        <button
          role="tab"
          aria-selected={!collapsed && tab === "git"}
          onClick={() => selectToolTab("git")}
        >
          Git changes
          {gitStatus?.files.length ? ` (${gitStatus.files.length})` : ""}
        </button>
        <button
          role="tab"
          aria-selected={!collapsed && tab === "verify"}
          onClick={() => selectToolTab("verify")}
        >
          Verify
        </button>
        <div className="workspace-tools-verify">
          <span
            className={`verify-status-pill verify-status-${verifySummary.status}`}
            title={
              verifySummary.latest
                ? `${verifySummary.latest.program} ${verifySummary.latest.args.join(" ")}`
                : "No verification checks recorded yet"
            }
          >
            {verifySummary.label}
          </span>
          <button
            type="button"
            className="workspace-drawer-toggle"
            aria-label={
              collapsed ? "Expand tools drawer" : "Collapse tools drawer"
            }
            title={collapsed ? "Expand drawer (⌘J)" : "Collapse drawer (⌘J)"}
            onClick={onToggleCollapse}
          >
            {collapsed ? "⌃" : "⌄"}
          </button>
        </div>
      </div>

      <div
        className={
          !collapsed && tab === "terminal" ? "workspace-tool-body" : "is-hidden"
        }
      >
        {!terminalStarted ? (
          <div className="terminal-panel">
            <p>Starting a shell can execute project-controlled commands.</p>
            <button
              type="button"
              className="button button-primary"
              disabled={browserPreview}
              onClick={() => {
                setTerminalStarted(true);
                if (workspaceTrusted) setTerminalActive(true);
              }}
            >
              Start terminal
            </button>
          </div>
        ) : (
          <TerminalPanel
            service={service}
            workspaceId={activeProject.id}
            browserPreview={browserPreview}
            trusted={workspaceTrusted && terminalActive}
            theme={theme}
            onTrust={async () => {
              if (!workspaceTrusted) {
                await onTrustWorkspace();
              }
              setTerminalActive(true);
            }}
            onUntrust={async () => {
              await onUntrustWorkspace();
              setTerminalActive(false);
            }}
          />
        )}
      </div>

      <div
        className={
          !collapsed && tab === "run" ? "workspace-tool-body" : "is-hidden"
        }
      >
        <RunPanel
          service={service}
          projectId={activeProject.id}
          projectPath={activeProject.path}
          workspaceTrusted={workspaceTrusted}
          browserPreview={browserPreview}
          onTrustWorkspace={onTrustWorkspace}
          onJumpToLocation={onJumpToLocation}
          onInvestigateInRook={(chip) => onInvestigateInRook(chip, "ask")}
        />
      </div>

      {!collapsed && tab === "git" && (
        <div className="workspace-tool-body">
          {browserPreview ? (
            <p role="status">Git access requires the native desktop app.</p>
          ) : (
            <GitPanel
              service={service}
              projectId={activeProject.id}
              status={gitStatus}
              syncVersion={syncVersion}
              onStatus={onGitStatusChange}
              onOpenFile={onOpenFile}
              onOpenInReview={
                onContinueAsChange
                  ? (paths) => void onContinueAsChange("", paths)
                  : undefined
              }
            />
          )}
        </div>
      )}

      {!collapsed && tab === "verify" && (
        <div className="workspace-tool-body">
          <VerifyDrawerPanel
            service={service}
            activeProject={activeProject}
            documents={documents}
            executions={executions}
            projectRecipes={projectRecipes}
            verifyChangeId={verifyChangeId}
            workspaceTrusted={workspaceTrusted}
            savingFiles={savingFiles}
            browserPreview={browserPreview}
            onTrustWorkspace={onTrustWorkspace}
            onSaveDocuments={onSaveDocuments}
            onRunCheck={onRunCheck}
            onRunProjectRecipe={onRunProjectRecipe}
            onPruneExecutions={onPruneExecutions}
            onJumpToLocation={onJumpToLocation}
            onAttachContextChipToRook={onInvestigateInRook}
          />
        </div>
      )}
    </section>
  );
}

export function WorkspaceScreen({
  service,
  preferences,
  onPreferencesChange,
  activeProject,
  projectEntries: _projectEntries,
  projectEntriesTruncated: _projectEntriesTruncated,
  projectDirectory,
  selectedFilePath,
  selectedFile,
  projectPending,
  onOpenProject,
  onOpenProjectDirectory,
  onOpenProjectFile,
  documents,
  activeDocumentKey,
  splitDocumentKey,
  activeEditorPane,
  onActiveEditorPaneChange,
  onToggleSplit,
  onSelectSplitDocument,
  onOpenQuickOpen: _onOpenQuickOpen,
  revealTarget,
  editorSelection,
  onEditorSelectionChange,
  editorCursor,
  onEditorCursorChange,
  editorDiagnostics,
  onEditorDiagnosticsChange,
  returnSourceAnchor,
  onExpandToContextLens,
  inlinePatch,
  inlinePatchSaving,
  inlinePatchError,
  onOpenInlinePatch,
  onAcceptInlinePatch,
  onRejectInlinePatch,
  onPromoteInlinePatch,
  recoveredDraftNotice,
  onDismissRecoveredDraftNotice,
  editorGitStatus,
  onEditorGitStatusChange,
  onJumpToLocation,
  onAttachContextChipToRook,
  onPromoteEditsToChange,
  onOpenWorkspaceReview,
  workspaceTrusted,
  onTrustWorkspace,
  onUntrustWorkspace,
  onSelectDocument,
  onUpdateDocument,
  onSaveDocuments,
  onReloadDocument,
  onKeepDocumentEdits,
  onCloseDocument,
  executions,
  projectRecipes,
  verifyChangeId,
  onRunCheck,
  onRunProjectRecipe,
  onPruneExecutions,
  savingFiles,
  workspaceSyncVersion,
  lastSyncedAt,
  browserPreview,
  rookFocusNonce,
  onRookModeChange,
  onRookTrustBuild,
  onRookDismissTrustPrompt,
  onRookNewSession,
  onRookOpenSession,
  onRookStart,
  onRookDraftSave,
  onPreviewRookPatch,
  onProposeInlinePatch,
  onEntryRenamed,
  onEntryDeleted,
  onRefreshWorkspace,
  onUndoRookTurn,
  onRookBuildTargetChange,
  onApplyWorktree,
  onDiscardWorktree,
}: {
  service: AppService;
  preferences: UiPreferences;
  onPreferencesChange: (preferences: UiPreferences) => Promise<void>;
  activeProject?: ProjectSummary;
  projectEntries: ProjectEntry[];
  projectEntriesTruncated: boolean;
  projectDirectory: string;
  selectedFilePath?: string;
  selectedFile?: ProjectFileRead;
  projectPending: boolean;
  onOpenProject: (path?: string) => void;
  onOpenProjectDirectory: (relativePath: string) => void;
  onOpenProjectFile: (relativePath: string) => void;
  documents: EditorDocument[];
  activeDocumentKey?: string;
  splitDocumentKey?: string;
  activeEditorPane: "primary" | "secondary";
  onActiveEditorPaneChange: (pane: "primary" | "secondary") => void;
  onToggleSplit: () => void;
  onSelectSplitDocument: (key: string) => void;
  onOpenQuickOpen: () => void;
  revealTarget: {
    key: string;
    line: number;
    column?: number;
    nonce: number;
  } | null;
  editorSelection: EditorSelection | null;
  onEditorSelectionChange: (selection: EditorSelection | null) => void;
  editorCursor: EditorCursorState | null;
  onEditorCursorChange: (cursor: EditorCursorState | null) => void;
  editorDiagnostics: EditorDiagnostic[];
  onEditorDiagnosticsChange: (diagnostics: EditorDiagnostic[]) => void;
  returnSourceAnchor: ReturnSourceAnchor | null;
  onExpandToContextLens: (focusPath?: string) => void;
  inlinePatch: PendingInlinePatch | null;
  inlinePatchSaving: boolean;
  inlinePatchError?: string;
  onOpenInlinePatch: (doc: EditorDocument) => void;
  onAcceptInlinePatch: (nextContent: string) => Promise<void>;
  onRejectInlinePatch: () => void;
  onPromoteInlinePatch: (nextContent: string) => Promise<void>;
  recoveredDraftNotice?: string;
  onDismissRecoveredDraftNotice: () => void;
  editorGitStatus?: GitStatus;
  onEditorGitStatusChange: (status: GitStatus) => void;
  onJumpToLocation: (
    relativePath: string,
    line: number,
    column?: number,
    recordReturnAnchor?: boolean,
  ) => void;
  onAttachContextChipToRook: (chip: RookContextChip, mode?: RookMode) => void;
  onPromoteEditsToChange: (
    objective: string,
    selectedPaths: string[],
  ) => Promise<void>;
  onOpenWorkspaceReview: (
    selectedPaths?: string[],
    baseline?: ReviewDiffBaseline,
  ) => void;
  workspaceTrusted: boolean;
  onTrustWorkspace: () => Promise<void>;
  onUntrustWorkspace: () => Promise<void>;
  onSelectDocument: (key: string) => void;
  onUpdateDocument: (key: string, content: string) => void;
  onSaveDocuments: (documents: EditorDocument[]) => Promise<boolean>;
  onReloadDocument: (key: string) => void;
  onKeepDocumentEdits: (key: string) => void;
  onCloseDocument: (document: EditorDocument) => void;
  executions: ExecutionRecord[];
  projectRecipes: ProjectRecipeSummary[];
  verifyChangeId: string;
  onRunCheck: (
    program: string,
    args: string[],
    changeId?: string,
  ) => Promise<void>;
  onRunProjectRecipe: (recipeName: string, changeId?: string) => Promise<void>;
  onPruneExecutions: () => Promise<void>;
  savingFiles: boolean;
  workspaceSyncVersion: number;
  lastSyncedAt?: number;
  browserPreview: boolean;
  rookFocusNonce: number;
  onRookModeChange: (mode: RookMode) => void;
  onRookTrustBuild: () => void;
  onRookDismissTrustPrompt: () => void;
  onRookNewSession: () => void;
  onRookOpenSession: (id: string) => void;
  onRookStart: () => void;
  onRookDraftSave: (draft: string) => void;
  onPreviewRookPatch: (code: string) => void;
  onProposeInlinePatch?: (patch: PendingInlinePatch) => void;
  onEntryRenamed?: (fromRelativePath: string, toRelativePath: string) => void;
  onEntryDeleted?: (relativePath: string) => void;
  onRefreshWorkspace?: () => void;
  onUndoRookTurn: (
    messageIndex: number,
    touchedFiles: string[],
  ) => Promise<void>;
  onRookBuildTargetChange?: (
    target: "direct" | "worktree",
  ) => Promise<void> | void;
  onApplyWorktree?: () => Promise<void>;
  onDiscardWorktree?: () => Promise<void>;
}) {
  const leftSidebarTab = useAppStore((s) => s.leftSidebarTab);
  const setLeftSidebarTab = useAppStore((s) => s.setLeftSidebarTab);
  const searchFocusNonce = useAppStore((s) => s.searchFocusNonce);
  const rightPanelTab = useAppStore((s) => s.rightPanelTab);
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const rookExpanded = useAppStore((s) => s.rookExpanded);
  const setRookExpanded = useAppStore((s) => s.setRookExpanded);
  const bottomDrawerTab = useAppStore((s) => s.bottomDrawerTab);
  const setBottomDrawerTab = useAppStore((s) => s.setBottomDrawerTab);
  const rookRunId = useRookStore((s) => s.runId);
  const rookMessages = useRookStore((s) => s.messages);
  const rookMode = useRookStore((s) => s.mode);
  const rookTouchedPaths = useMemo(() => {
    const paths = new Set<string>();
    const recent = rookMessages.slice(-4);
    for (const msg of recent) {
      for (const file of msg.touchedFiles ?? []) paths.add(file);
    }
    return [...paths];
  }, [rookMessages]);

  const explorerCollapsed = Boolean(preferences.explorerCollapsed);
  const bottomDrawerCollapsed = Boolean(preferences.bottomDrawerCollapsed);
  const resolvedExplorerWidth = preferences.explorerWidth ?? 238;
  const resolvedDrawerHeight = preferences.bottomDrawerHeight ?? 240;

  const [draftWidth, setDraftWidth] = useState(preferences.inspectorWidth);
  const [draftExplorerWidth, setDraftExplorerWidth] = useState(
    resolvedExplorerWidth,
  );
  const [draftDrawerHeight, setDraftDrawerHeight] =
    useState(resolvedDrawerHeight);
  const [isResizingInspector, setIsResizingInspector] = useState(false);
  const [gitDiffText, setGitDiffText] = useState("");
  const [inlineCommandTarget, setInlineCommandTarget] = useState<{
    filePath: string;
    startLine: number;
    endLine: number;
  } | null>(null);
  const activeDocument = documents.find(
    (document) =>
      document.key === activeDocumentKey &&
      document.projectId === activeProject?.id,
  );
  const splitDocument = splitDocumentKey
    ? documents.find(
        (document) =>
          document.key === splitDocumentKey &&
          document.projectId === activeProject?.id,
      )
    : undefined;
  const focusedDocument =
    activeEditorPane === "secondary" && splitDocument
      ? splitDocument
      : activeDocument;
  const projectDocuments = documents.filter(
    (document) => document.projectId === activeProject?.id,
  );
  const draftWidthRef = useRef(preferences.inspectorWidth);
  const draftExplorerWidthRef = useRef(resolvedExplorerWidth);
  const draftDrawerHeightRef = useRef(resolvedDrawerHeight);
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  const explorerDrag = useRef<{ x: number; width: number } | undefined>(
    undefined,
  );
  const drawerDrag = useRef<{ y: number; height: number } | undefined>(
    undefined,
  );

  useEffect(() => {
    setDraftWidth(preferences.inspectorWidth);
    draftWidthRef.current = preferences.inspectorWidth;
    document.documentElement.style.setProperty(
      "--inspector-width-live",
      `${preferences.inspectorWidth}px`,
    );
  }, [preferences.inspectorWidth]);

  useEffect(() => {
    setDraftExplorerWidth(resolvedExplorerWidth);
    draftExplorerWidthRef.current = resolvedExplorerWidth;
    document.documentElement.style.setProperty(
      "--explorer-width-live",
      `${resolvedExplorerWidth}px`,
    );
  }, [resolvedExplorerWidth]);

  useEffect(() => {
    setDraftDrawerHeight(resolvedDrawerHeight);
    draftDrawerHeightRef.current = resolvedDrawerHeight;
    document.documentElement.style.setProperty(
      "--drawer-height-live",
      `${resolvedDrawerHeight}px`,
    );
  }, [resolvedDrawerHeight]);

  useEffect(() => {
    if (browserPreview || !activeProject || !activeProject.isGitRepository) {
      setGitDiffText("");
      return;
    }
    let cancelled = false;
    void service
      .gitDiff(activeProject.id)
      .then((diff) => {
        if (!cancelled) setGitDiffText(diff);
      })
      .catch(() => {
        if (!cancelled) setGitDiffText("");
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeProject?.id,
    activeProject?.isGitRepository,
    browserPreview,
    service,
    workspaceSyncVersion,
  ]);

  const primaryGutterMarkers = useMemo(
    () =>
      activeDocument
        ? parseUnifiedDiffHunksForFile(gitDiffText, activeDocument.path)
        : [],
    [gitDiffText, activeDocument],
  );
  const splitGutterMarkers = useMemo(
    () =>
      splitDocument
        ? parseUnifiedDiffHunksForFile(gitDiffText, splitDocument.path)
        : [],
    [gitDiffText, splitDocument],
  );

  const changeWidth = (width: number) => {
    const bounded = clampPanelSize(width, 220, 560);
    draftWidthRef.current = bounded;
    setDraftWidth(bounded);
    document.documentElement.style.setProperty(
      "--inspector-width-live",
      `${bounded}px`,
    );
  };

  const changeExplorerWidth = (width: number) => {
    const bounded = clampPanelSize(width, 170, 420);
    draftExplorerWidthRef.current = bounded;
    setDraftExplorerWidth(bounded);
    document.documentElement.style.setProperty(
      "--explorer-width-live",
      `${bounded}px`,
    );
  };

  const changeDrawerHeight = (height: number) => {
    const bounded = clampPanelSize(height, 140, 480);
    draftDrawerHeightRef.current = bounded;
    setDraftDrawerHeight(bounded);
    document.documentElement.style.setProperty(
      "--drawer-height-live",
      `${bounded}px`,
    );
  };

  if (rookExpanded && activeProject) {
    return (
      <section
        className="content-page rook-page rook-expanded-host"
        aria-label="Rook Focus View"
      >
        <RookPanel
          service={service}
          variant="expanded"
          browserPreview={browserPreview}
          focusNonce={rookFocusNonce}
          onRookModeChange={onRookModeChange}
          onRookTrustBuild={onRookTrustBuild}
          onRookDismissTrustPrompt={onRookDismissTrustPrompt}
          onRookNewSession={onRookNewSession}
          onRookOpenSession={onRookOpenSession}
          onRookStart={onRookStart}
          onRookDraftSave={onRookDraftSave}
          onPreviewRookPatch={(code) => {
            setRookExpanded(false);
            onPreviewRookPatch(code);
          }}
          onJumpToLocation={(relPath, line, col) => {
            setRookExpanded(false);
            onJumpToLocation(relPath, line, col, true);
          }}
          onOpenReview={(paths, baseline) => {
            setRookExpanded(false);
            onOpenWorkspaceReview(paths, baseline);
          }}
          onOpenVerify={() => {
            setRookExpanded(false);
            setBottomDrawerTab("verify");
            if (bottomDrawerCollapsed) {
              void onPreferencesChange({
                ...preferences,
                bottomDrawerCollapsed: false,
              });
            }
          }}
          onUndoTurn={onUndoRookTurn}
          onToggleExpand={() => setRookExpanded(false)}
          onRookBuildTargetChange={onRookBuildTargetChange}
          onApplyWorktree={onApplyWorktree}
          onDiscardWorktree={onDiscardWorktree}
        />
      </section>
    );
  }

  return (
    <section className="editor-shell" aria-label="Editor workspace">
      {activeProject &&
        (!explorerCollapsed ? (
          <>
            <aside className="project-explorer" aria-label="Project files">
              <div className="explorer-heading explorer-heading-tabs">
                <div
                  className="explorer-mode-tabs"
                  role="tablist"
                  aria-label="Workspace explorer mode"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={leftSidebarTab === "files"}
                    className={leftSidebarTab === "files" ? "is-active" : ""}
                    onClick={() => setLeftSidebarTab("files")}
                  >
                    Files
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={leftSidebarTab === "search"}
                    className={leftSidebarTab === "search" ? "is-active" : ""}
                    onClick={() => setLeftSidebarTab("search")}
                  >
                    Search
                  </button>
                </div>
                <button
                  type="button"
                  className="panel-collapse-button"
                  aria-label="Hide file explorer"
                  title="Hide file explorer (⌘B)"
                  onClick={() =>
                    void onPreferencesChange({
                      ...preferences,
                      explorerCollapsed: true,
                    })
                  }
                >
                  ‹
                </button>
              </div>

              <div
                className={
                  leftSidebarTab === "files"
                    ? "explorer-pane-host"
                    : "is-hidden"
                }
                aria-hidden={leftSidebarTab !== "files"}
              >
                <FileTreeExplorer
                  service={service}
                  browserPreview={browserPreview}
                  activeProject={activeProject}
                  gitStatus={editorGitStatus}
                  syncVersion={workspaceSyncVersion}
                  selectedFilePath={selectedFilePath}
                  projectPending={projectPending}
                  rookTouchedPaths={rookTouchedPaths}
                  rookBuildRunning={Boolean(rookRunId && rookMode === "build")}
                  onOpenProjectFile={onOpenProjectFile}
                  onOpenProject={() => onOpenProject()}
                  onEntryRenamed={(from, to) => onEntryRenamed?.(from, to)}
                  onEntryDeleted={(rel) => onEntryDeleted?.(rel)}
                  onRefreshWorkspace={() =>
                    onRefreshWorkspace
                      ? onRefreshWorkspace()
                      : void onOpenProjectDirectory(projectDirectory)
                  }
                />
              </div>
              <div
                className={
                  leftSidebarTab === "search"
                    ? "explorer-pane-host"
                    : "is-hidden"
                }
                aria-hidden={leftSidebarTab !== "search"}
              >
                <WorkspaceSearchPanel
                  service={service}
                  browserPreview={browserPreview}
                  activeProject={activeProject}
                  focusNonce={searchFocusNonce}
                  onOpenLocation={(relPath, line, col) =>
                    onJumpToLocation(relPath, line, col, true)
                  }
                  onAttachToRook={(chip) =>
                    onAttachContextChipToRook(chip, "ask")
                  }
                />
              </div>
            </aside>
            <div
              className="inspector-separator explorer-separator"
              role="separator"
              aria-label="Resize file explorer"
              aria-orientation="vertical"
              aria-valuemin={170}
              aria-valuemax={420}
              aria-valuenow={draftExplorerWidth}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 16 : -16;
                  const width = clampPanelSize(
                    draftExplorerWidth + delta,
                    170,
                    420,
                  );
                  changeExplorerWidth(width);
                  void onPreferencesChange({
                    ...preferences,
                    explorerWidth: width,
                  });
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  const width = event.key === "Home" ? 170 : 420;
                  changeExplorerWidth(width);
                  void onPreferencesChange({
                    ...preferences,
                    explorerWidth: width,
                  });
                }
              }}
              onPointerDown={(event) => {
                explorerDrag.current = {
                  x: event.clientX,
                  width: draftExplorerWidth,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (explorerDrag.current) {
                  changeExplorerWidth(
                    explorerDrag.current.width +
                      event.clientX -
                      explorerDrag.current.x,
                  );
                }
              }}
              onPointerUp={() => {
                if (!explorerDrag.current) return;
                explorerDrag.current = undefined;
                void onPreferencesChange({
                  ...preferences,
                  explorerWidth: draftExplorerWidthRef.current,
                });
              }}
              onPointerCancel={() => {
                explorerDrag.current = undefined;
              }}
            />
          </>
        ) : null)}

      <div className="editor-placeholder">
        <div
          className={`editor-placeholder-top${projectDocuments.length === 0 && !explorerCollapsed ? " editor-placeholder-top-empty" : ""}`}
        >
          {activeProject && explorerCollapsed && (
            <button
              className="editor-panel-toggle editor-panel-toggle-left"
              type="button"
              aria-label="Show file explorer"
              title="Show file explorer (⌘B)"
              onClick={() =>
                void onPreferencesChange({
                  ...preferences,
                  explorerCollapsed: false,
                })
              }
            >
              Files ›
            </button>
          )}
          {projectDocuments.length > 0 ? (
            <>
              <div
                className="editor-tabs"
                role="tablist"
                aria-label="Open files"
              >
                {projectDocuments.map((document) => (
                  <div
                    className={`editor-tab${document.key === activeDocumentKey ? " editor-tab-active" : ""}`}
                    key={document.key}
                    role="presentation"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={document.key === activeDocumentKey}
                      title={document.path}
                      onClick={() => {
                        onSelectDocument(document.key);
                      }}
                    >
                      {document.path.split(/[\\/]/).at(-1)}
                      {document.externalChange && (
                        <span
                          className="editor-tab-conflict"
                          aria-label="changed on disk"
                          title="Changed on disk"
                        >
                          {" "}
                          ↻
                        </span>
                      )}
                      {document.content !== document.savedContent && (
                        <span aria-label="unsaved changes"> ●</span>
                      )}
                    </button>
                    <button
                      className="editor-tab-close"
                      type="button"
                      aria-label={`Close ${document.path.split(/[\\/]/).at(-1)}`}
                      onClick={() => onCloseDocument(document)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="editor-top-actions">
                {!browserPreview && activeProject && focusedDocument && (
                  <button
                    className="editor-save-button"
                    type="button"
                    title="Inline Edit with Rook (⌘K / Ctrl+K)"
                    onClick={() => {
                      const sel =
                        editorSelection?.path === focusedDocument.path
                          ? editorSelection
                          : null;
                      const cur =
                        editorCursor?.path === focusedDocument.path
                          ? editorCursor
                          : null;
                      setInlineCommandTarget({
                        filePath: focusedDocument.path,
                        startLine: sel?.startLine ?? cur?.line ?? 1,
                        endLine: sel?.endLine ?? cur?.line ?? 1,
                      });
                    }}
                  >
                    Edit ⌘K
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <span className="eyebrow">Source workspace</span>
              <div className="editor-top-actions">
                <span className="status-pill">
                  {activeProject
                    ? activeProject.isGitRepository
                      ? "Git repository"
                      : "Folder · no Git"
                    : "No project"}
                </span>
              </div>
            </>
          )}
        </div>

        {recoveredDraftNotice && (
          <div className="editor-external-banner" role="status">
            <p>{recoveredDraftNotice}</p>
            <button
              type="button"
              className="button button-quiet"
              onClick={onDismissRecoveredDraftNotice}
            >
              Dismiss
            </button>
          </div>
        )}

        {inlineCommandTarget &&
          activeProject &&
          !browserPreview &&
          (() => {
            const targetDoc =
              projectDocuments.find(
                (d) => d.path === inlineCommandTarget.filePath,
              ) ?? focusedDocument;
            if (!targetDoc) return null;
            return (
              <InlineCommandBar
                service={service}
                projectId={activeProject.id}
                filePath={targetDoc.path}
                fileContent={targetDoc.content}
                startLine={inlineCommandTarget.startLine}
                endLine={inlineCommandTarget.endLine}
                diagnostics={
                  editorCursor?.path === targetDoc.path ? editorDiagnostics : []
                }
                onClose={() => setInlineCommandTarget(null)}
                onProposePatch={(patch) => {
                  if (onProposeInlinePatch) {
                    onProposeInlinePatch(patch);
                  }
                }}
                onExplainInRook={(chip, promptText) => {
                  onAttachContextChipToRook(chip, "ask");
                  onRookDraftSave(promptText);
                  setRightPanelTab("rook");
                }}
              />
            );
          })()}

        {inlinePatch ? (
          <InlinePatchOverlay
            patch={inlinePatch}
            theme={preferences.theme}
            fontSize={preferences.editorFontSize}
            saving={inlinePatchSaving}
            error={inlinePatchError}
            onAcceptAndSave={onAcceptInlinePatch}
            onReject={onRejectInlinePatch}
            onPromoteToChange={onPromoteInlinePatch}
          />
        ) : activeDocument ? (
          <div
            className={`editor-panes${splitDocument ? " is-split" : ""}`}
            aria-label={`Editing ${activeDocument.path}`}
          >
            <div
              className={`code-editor${activeEditorPane === "primary" ? " is-focused-pane" : ""}`}
              onMouseDown={() => onActiveEditorPaneChange("primary")}
            >
              {splitDocument && (
                <div className="editor-pane-header">
                  <span
                    className="editor-pane-title"
                    title={activeDocument.path}
                  >
                    {activeDocument.path}
                    {activeDocument.content !== activeDocument.savedContent
                      ? " ●"
                      : ""}
                  </span>
                </div>
              )}
              {activeDocument.externalChange && (
                <div
                  className="editor-external-banner"
                  role="status"
                  aria-label="External file change"
                >
                  <p>
                    {activeDocument.externalChange.kind === "deleted"
                      ? "This file was removed on disk."
                      : activeDocument.externalChange.kind === "unreadable"
                        ? "This file changed on disk and is no longer a supported UTF-8 text file."
                        : "This file changed on disk while you have unsaved edits."}
                  </p>
                  <div className="editor-external-banner-actions">
                    {activeDocument.externalChange.kind === "modified" && (
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => onReloadDocument(activeDocument.key)}
                      >
                        Reload from disk
                      </button>
                    )}
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => onKeepDocumentEdits(activeDocument.key)}
                    >
                      {activeDocument.externalChange.kind === "deleted"
                        ? "Keep open"
                        : "Keep mine"}
                    </button>
                  </div>
                </div>
              )}
              <Suspense
                fallback={<p className="editor-loading">Loading editor…</p>}
              >
                <CodeEditor
                  path={`${activeDocument.projectId}/${activeDocument.path}`}
                  value={activeDocument.content}
                  theme={preferences.theme}
                  fontSize={preferences.editorFontSize}
                  projectId={activeProject?.id}
                  service={service}
                  syncVersion={workspaceSyncVersion}
                  gutterMarkers={primaryGutterMarkers}
                  revealTarget={
                    revealTarget && revealTarget.key === activeDocument.key
                      ? ({
                          line: revealTarget.line,
                          column: revealTarget.column,
                          nonce: revealTarget.nonce,
                        } satisfies RevealTarget)
                      : null
                  }
                  onFocus={() => onActiveEditorPaneChange("primary")}
                  onTriggerInlineCommand={() => {
                    const sel =
                      editorSelection?.path === activeDocument.path
                        ? editorSelection
                        : null;
                    const cur =
                      editorCursor?.path === activeDocument.path
                        ? editorCursor
                        : null;
                    setInlineCommandTarget({
                      filePath: activeDocument.path,
                      startLine: sel?.startLine ?? cur?.line ?? 1,
                      endLine: sel?.endLine ?? cur?.line ?? 1,
                    });
                  }}
                  onSelectionChange={(sel) => {
                    if (!splitDocument || activeEditorPane === "primary") {
                      onEditorSelectionChange(
                        sel ? { path: activeDocument.path, ...sel } : null,
                      );
                    }
                  }}
                  onCursorChange={(cur) => {
                    if (!splitDocument || activeEditorPane === "primary") {
                      onEditorCursorChange({
                        path: activeDocument.path,
                        ...cur,
                      });
                    }
                  }}
                  onDiagnosticsChange={(diags) => {
                    if (!splitDocument || activeEditorPane === "primary") {
                      onEditorDiagnosticsChange(diags);
                    }
                  }}
                  onChange={(content) =>
                    onUpdateDocument(activeDocument.key, content)
                  }
                />
              </Suspense>
              <div className="editor-breadcrumb">
                <span>{activeDocument.path.split("/").join(" › ")}</span>
                <span>
                  {activeDocument.content !== activeDocument.savedContent
                    ? "Modified"
                    : "Saved"}
                </span>
              </div>
            </div>

            {splitDocument && (
              <div
                className={`code-editor editor-split-pane${activeEditorPane === "secondary" ? " is-focused-pane" : ""}`}
                onMouseDown={() => onActiveEditorPaneChange("secondary")}
              >
                <div className="editor-split-header">
                  <select
                    aria-label="Split pane file"
                    value={splitDocument.key}
                    onChange={(event) =>
                      onSelectSplitDocument(event.target.value)
                    }
                  >
                    {projectDocuments.map((doc) => (
                      <option key={doc.key} value={doc.key}>
                        {doc.path}
                        {doc.content !== doc.savedContent ? " ●" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Close split pane"
                    onClick={onToggleSplit}
                  >
                    ×
                  </button>
                </div>
                <Suspense
                  fallback={
                    <p className="editor-loading">Loading split editor…</p>
                  }
                >
                  <CodeEditor
                    path={`${splitDocument.projectId}/split/${splitDocument.path}`}
                    value={splitDocument.content}
                    theme={preferences.theme}
                    fontSize={preferences.editorFontSize}
                    projectId={activeProject?.id}
                    service={service}
                    syncVersion={workspaceSyncVersion}
                    gutterMarkers={splitGutterMarkers}
                    revealTarget={
                      revealTarget && revealTarget.key === splitDocument.key
                        ? ({
                            line: revealTarget.line,
                            column: revealTarget.column,
                            nonce: revealTarget.nonce,
                          } satisfies RevealTarget)
                        : null
                    }
                    onFocus={() => onActiveEditorPaneChange("secondary")}
                    onTriggerInlineCommand={() => {
                      const sel =
                        editorSelection?.path === splitDocument.path
                          ? editorSelection
                          : null;
                      const cur =
                        editorCursor?.path === splitDocument.path
                          ? editorCursor
                          : null;
                      setInlineCommandTarget({
                        filePath: splitDocument.path,
                        startLine: sel?.startLine ?? cur?.line ?? 1,
                        endLine: sel?.endLine ?? cur?.line ?? 1,
                      });
                    }}
                    onSelectionChange={(sel) => {
                      if (activeEditorPane === "secondary") {
                        onEditorSelectionChange(
                          sel ? { path: splitDocument.path, ...sel } : null,
                        );
                      }
                    }}
                    onCursorChange={(cur) => {
                      if (activeEditorPane === "secondary") {
                        onEditorCursorChange({
                          path: splitDocument.path,
                          ...cur,
                        });
                      }
                    }}
                    onDiagnosticsChange={(diags) => {
                      if (activeEditorPane === "secondary") {
                        onEditorDiagnosticsChange(diags);
                      }
                    }}
                    onChange={(content) =>
                      onUpdateDocument(splitDocument.key, content)
                    }
                  />
                </Suspense>
                <div className="editor-breadcrumb">
                  <span>{splitDocument.path.split("/").join(" › ")}</span>
                  <span>
                    {splitDocument.content !== splitDocument.savedContent
                      ? "Modified"
                      : "Saved"}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="editor-placeholder-center">
            {selectedFilePath && selectedFile ? (
              <article
                className="file-preview"
                aria-label="Read-only file preview"
              >
                <div className="file-preview-heading">
                  <span className="eyebrow">Read-only preview</span>
                  <span className="status-pill">
                    {selectedFile.sizeBytes.toLocaleString()} bytes
                  </span>
                </div>
                <h1 id="screen-title">
                  {selectedFilePath.split(/[\\/]/).at(-1)}
                </h1>
                {selectedFile.kind !== "text" && (
                  <p role="status">
                    {selectedFile.kind === "binary"
                      ? "This file appears to be binary and is not displayed as text."
                      : "This file exceeds the 1 MiB preview limit. Narrow or inspect it with another tool."}
                  </p>
                )}
                <p className="file-preview-path">{selectedFilePath}</p>
              </article>
            ) : selectedFilePath ? (
              <p role="status">Reading selected file…</p>
            ) : (
              <>
                <span className="editor-placeholder-mark" aria-hidden="true">
                  ⌘
                </span>
                <h1 id="screen-title">
                  {activeProject
                    ? "Project files are ready."
                    : "Your source belongs here."}
                </h1>
                <p>
                  {activeProject
                    ? "Open a UTF-8 text file to edit it, or press ⌘L to ask Rook alongside your code."
                    : "Open a local project to browse its folders. Opening never runs project code or agent tools."}
                </p>
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={projectPending || browserPreview}
                  onClick={() => onOpenProject()}
                >
                  {browserPreview
                    ? "Project access requires the desktop app"
                    : projectPending
                      ? "Opening…"
                      : activeProject
                        ? "Open another folder"
                        : "Open project folder"}
                </button>
              </>
            )}
          </div>
        )}

        {!activeDocument && (
          <div className="editor-placeholder-footer">
            <span>
              {selectedFilePath ||
                projectDirectory ||
                activeProject?.path ||
                "No folder selected"}
            </span>
            <span>
              {selectedFilePath
                ? "Not editable"
                : lastSyncedAt
                  ? `Synced · ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                  : "Ready to edit"}
            </span>
          </div>
        )}

        {activeProject && (
          <>
            {!bottomDrawerCollapsed && (
              <div
                className="drawer-separator"
                role="separator"
                aria-label="Resize bottom tools drawer"
                aria-orientation="horizontal"
                aria-valuemin={140}
                aria-valuemax={480}
                aria-valuenow={draftDrawerHeight}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    const delta = event.key === "ArrowUp" ? 16 : -16;
                    const height = clampPanelSize(
                      draftDrawerHeight + delta,
                      140,
                      480,
                    );
                    changeDrawerHeight(height);
                    void onPreferencesChange({
                      ...preferences,
                      bottomDrawerHeight: height,
                    });
                  } else if (event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    const height = event.key === "Home" ? 140 : 480;
                    changeDrawerHeight(height);
                    void onPreferencesChange({
                      ...preferences,
                      bottomDrawerHeight: height,
                    });
                  }
                }}
                onPointerDown={(event) => {
                  drawerDrag.current = {
                    y: event.clientY,
                    height: draftDrawerHeight,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (drawerDrag.current) {
                    changeDrawerHeight(
                      drawerDrag.current.height +
                        drawerDrag.current.y -
                        event.clientY,
                    );
                  }
                }}
                onPointerUp={() => {
                  if (!drawerDrag.current) return;
                  drawerDrag.current = undefined;
                  void onPreferencesChange({
                    ...preferences,
                    bottomDrawerHeight: draftDrawerHeightRef.current,
                  });
                }}
                onPointerCancel={() => {
                  drawerDrag.current = undefined;
                }}
              />
            )}
            <WorkspaceTools
              service={service}
              activeProject={activeProject}
              documents={documents}
              tab={bottomDrawerTab}
              collapsed={bottomDrawerCollapsed}
              theme={preferences.theme}
              onTabChange={setBottomDrawerTab}
              onToggleCollapse={() =>
                void onPreferencesChange({
                  ...preferences,
                  bottomDrawerCollapsed: !bottomDrawerCollapsed,
                })
              }
              workspaceTrusted={workspaceTrusted}
              onTrustWorkspace={onTrustWorkspace}
              onUntrustWorkspace={onUntrustWorkspace}
              gitStatus={editorGitStatus}
              onGitStatusChange={onEditorGitStatusChange}
              executions={executions.filter(
                (item) => item.projectId === activeProject.id,
              )}
              projectRecipes={projectRecipes}
              verifyChangeId={verifyChangeId}
              savingFiles={savingFiles}
              syncVersion={workspaceSyncVersion}
              onSaveDocuments={onSaveDocuments}
              onRunCheck={onRunCheck}
              onRunProjectRecipe={onRunProjectRecipe}
              onPruneExecutions={onPruneExecutions}
              onOpenFile={(path) => onOpenProjectFile(path)}
              onJumpToLocation={(relativePath, line, column) =>
                onJumpToLocation(relativePath, line, column)
              }
              onInvestigateInRook={onAttachContextChipToRook}
              onContinueAsChange={onPromoteEditsToChange}
              browserPreview={browserPreview}
            />
          </>
        )}
      </div>

      <div
        className={`rook-dock-floating${preferences.inspectorCollapsed ? " is-collapsed" : ""}${isResizingInspector ? " is-resizing" : ""}`}
      >
        <button
          type="button"
          className="rook-dock-toggle"
          aria-expanded={!preferences.inspectorCollapsed}
          aria-controls="workspace-rook-dock"
          aria-label={
            preferences.inspectorCollapsed ? "Show Rook dock" : "Hide Rook dock"
          }
          title={
            preferences.inspectorCollapsed
              ? "Show Rook dock (⌘L)"
              : "Hide Rook dock (⌘L)"
          }
          onClick={() =>
            void onPreferencesChange({
              ...preferences,
              inspectorCollapsed: !preferences.inspectorCollapsed,
            })
          }
        >
          <svg
            className="rook-dock-toggle-icon"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6.25 3.5L10.75 8L6.25 12.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {!preferences.inspectorCollapsed && (
          <div
            className="inspector-separator rook-dock-resizer"
            role="separator"
            aria-label="Resize right panel"
            aria-orientation="vertical"
            aria-valuemin={220}
            aria-valuemax={560}
            aria-valuenow={draftWidth}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const delta = event.key === "ArrowLeft" ? 16 : -16;
                const width = Math.max(220, Math.min(560, draftWidth + delta));
                changeWidth(width);
                void onPreferencesChange({
                  ...preferences,
                  inspectorWidth: width,
                });
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                const width = event.key === "Home" ? 220 : 560;
                changeWidth(width);
                void onPreferencesChange({
                  ...preferences,
                  inspectorWidth: width,
                });
              }
            }}
            onPointerDown={(event) => {
              drag.current = { x: event.clientX, width: draftWidth };
              setIsResizingInspector(true);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (drag.current) {
                changeWidth(
                  drag.current.width + drag.current.x - event.clientX,
                );
              }
            }}
            onPointerUp={() => {
              if (!drag.current) return;
              drag.current = undefined;
              setIsResizingInspector(false);
              void onPreferencesChange({
                ...preferences,
                inspectorWidth: draftWidthRef.current,
              });
            }}
            onPointerCancel={() => {
              drag.current = undefined;
              setIsResizingInspector(false);
            }}
          />
        )}

        <div
          id="workspace-rook-dock"
          className="rook-dock-surface"
          inert={preferences.inspectorCollapsed}
          aria-hidden={preferences.inspectorCollapsed}
        >
          <WorkspaceRightPanel
            service={service}
            browserPreview={browserPreview}
            activeTab={rightPanelTab}
            onTabChange={(tab: RightPanelTab) => setRightPanelTab(tab)}
            onHide={() =>
              void onPreferencesChange({
                ...preferences,
                inspectorCollapsed: true,
              })
            }
            activeProject={activeProject}
            activeDocument={focusedDocument}
            selection={editorSelection}
            cursor={editorCursor}
            diagnostics={editorDiagnostics}
            gitStatus={editorGitStatus}
            executions={executions.filter(
              (item) => item.projectId === activeProject?.id,
            )}
            syncVersion={workspaceSyncVersion}
            returnAnchor={returnSourceAnchor}
            rookFocusNonce={rookFocusNonce}
            onReturnToAnchor={() => {
              if (returnSourceAnchor) {
                onJumpToLocation(
                  returnSourceAnchor.filePath,
                  returnSourceAnchor.line,
                  returnSourceAnchor.column,
                  false,
                );
              }
            }}
            onAttachToRook={(chip, mode) =>
              onAttachContextChipToRook(chip, mode)
            }
            onOpenInlinePatch={onOpenInlinePatch}
            onOpenFileInReview={(relativePath) =>
              onOpenWorkspaceReview([relativePath], "head")
            }
            onOpenReview={onOpenWorkspaceReview}
            onOpenVerify={() => {
              setBottomDrawerTab("verify");
              if (bottomDrawerCollapsed) {
                void onPreferencesChange({
                  ...preferences,
                  bottomDrawerCollapsed: false,
                });
              }
            }}
            onJumpToLocation={onJumpToLocation}
            onExpandToContextLens={onExpandToContextLens}
            onRookModeChange={onRookModeChange}
            onRookTrustBuild={onRookTrustBuild}
            onRookDismissTrustPrompt={onRookDismissTrustPrompt}
            onRookNewSession={onRookNewSession}
            onRookOpenSession={onRookOpenSession}
            onRookStart={onRookStart}
            onRookDraftSave={onRookDraftSave}
            onPreviewRookPatch={onPreviewRookPatch}
            onUndoTurn={onUndoRookTurn}
            onToggleRookExpand={() => setRookExpanded(true)}
            onRookBuildTargetChange={onRookBuildTargetChange}
            onApplyWorktree={onApplyWorktree}
            onDiscardWorktree={onDiscardWorktree}
          />
        </div>
      </div>
    </section>
  );
}
