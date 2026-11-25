import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import {
  InlinePatchOverlay,
  type PendingInlinePatch,
} from "./InlinePatchOverlay";
import { WorkspaceRightPanel } from "./WorkspaceRightPanel";
import type { ReturnSourceAnchor } from "../context/ContextLensScreen";

const CodeEditor = lazy(() =>
  import("./CodeEditor").then((module) => ({
    default: module.CodeEditor,
  })),
);

function WorkspaceTools({
  service,
  activeProject,
  documents,
  tab,
  onTabChange,
  workspaceTrusted,
  onTrustWorkspace,
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
  onTabChange: (next: BottomDrawerTab) => void;
  workspaceTrusted: boolean;
  onTrustWorkspace: () => Promise<void>;
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

  return (
    <section className="workspace-tools" aria-label="Workspace tools">
      <div
        className="workspace-tool-tabs"
        role="tablist"
        aria-label="Bottom tools"
      >
        <button
          role="tab"
          aria-selected={tab === "terminal"}
          onClick={() => onTabChange("terminal")}
        >
          Terminal
        </button>
        <button
          role="tab"
          aria-selected={tab === "run"}
          onClick={() => onTabChange("run")}
        >
          Run
        </button>
        <button
          role="tab"
          aria-selected={tab === "git"}
          onClick={() => onTabChange("git")}
        >
          Git changes
          {gitStatus?.files.length ? ` (${gitStatus.files.length})` : ""}
        </button>
        <button
          role="tab"
          aria-selected={tab === "verify"}
          onClick={() => onTabChange("verify")}
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
        </div>
      </div>

      <div className={tab === "terminal" ? "workspace-tool-body" : "is-hidden"}>
        {!terminalStarted ? (
          <div className="terminal-panel">
            <p>Starting a shell can execute project-controlled commands.</p>
            <button
              type="button"
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
          <>
            <TerminalPanel
              service={service}
              workspaceId={activeProject.id}
              browserPreview={browserPreview}
              trusted={workspaceTrusted && terminalActive}
              onTrust={async () => {
                if (!workspaceTrusted) {
                  await onTrustWorkspace();
                }
                setTerminalActive(true);
              }}
            />
            {workspaceTrusted && (
              <button
                type="button"
                className="button button-quiet"
                onClick={() =>
                  void service.untrustWorkspace(activeProject.id).then(() => {
                    setTerminalActive(false);
                  })
                }
              >
                Revoke project trust
              </button>
            )}
          </>
        )}
      </div>

      <div className={tab === "run" ? "workspace-tool-body" : "is-hidden"}>
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

      {tab === "git" && (
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

      {tab === "verify" && (
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
  projectEntries,
  projectEntriesTruncated,
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
  onOpenQuickOpen,
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
  onUndoRookTurn,
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
  onUndoRookTurn: (
    messageIndex: number,
    touchedFiles: string[],
  ) => Promise<void>;
}) {
  const rightPanelTab = useAppStore((s) => s.rightPanelTab);
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const rookExpanded = useAppStore((s) => s.rookExpanded);
  const setRookExpanded = useAppStore((s) => s.setRookExpanded);
  const bottomDrawerTab = useAppStore((s) => s.bottomDrawerTab);
  const setBottomDrawerTab = useAppStore((s) => s.setBottomDrawerTab);

  const [draftWidth, setDraftWidth] = useState(preferences.inspectorWidth);
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
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);

  useEffect(() => {
    setDraftWidth(preferences.inspectorWidth);
    draftWidthRef.current = preferences.inspectorWidth;
  }, [preferences.inspectorWidth]);

  const changeWidth = (width: number) => {
    const bounded = Math.max(220, Math.min(560, width));
    draftWidthRef.current = bounded;
    setDraftWidth(bounded);
    document.documentElement.style.setProperty(
      "--inspector-width-live",
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
          onUndoTurn={onUndoRookTurn}
          onToggleExpand={() => setRookExpanded(false)}
        />
      </section>
    );
  }

  return (
    <section className="editor-shell" aria-label="Editor workspace">
      {activeProject && (
        <aside className="project-explorer" aria-label="Project files">
          <div className="explorer-heading">
            <span className="eyebrow">Project files</span>
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh project folder"
              title="Refresh this folder"
              onClick={() => void onOpenProjectDirectory(projectDirectory)}
            >
              ↻
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Open another project folder"
              disabled={projectPending}
              onClick={() => onOpenProject()}
            >
              +
            </button>
          </div>
          <div className="explorer-root">
            <span className="explorer-folder-glyph" aria-hidden="true">
              ⌄
            </span>
            <strong>{activeProject.name}</strong>
          </div>
          {projectDirectory && (
            <button
              className="explorer-up"
              type="button"
              onClick={() => {
                const parent = projectDirectory
                  .split(/[\\/]/)
                  .slice(0, -1)
                  .join("/");
                void onOpenProjectDirectory(parent);
              }}
            >
              <span aria-hidden="true">↰</span> Parent folder
            </button>
          )}
          <div
            className="explorer-list"
            role="list"
            aria-label="Files and folders"
          >
            {projectEntries.map((entry) =>
              entry.kind === "directory" ? (
                <button
                  className="explorer-entry explorer-directory"
                  key={entry.relativePath}
                  type="button"
                  onClick={() => onOpenProjectDirectory(entry.relativePath)}
                >
                  <span aria-hidden="true">▸</span>
                  <span>{entry.name}</span>
                </button>
              ) : entry.kind === "file" ? (
                <button
                  className={`explorer-entry explorer-file${selectedFilePath === entry.relativePath ? " explorer-file-active" : ""}`}
                  key={entry.relativePath}
                  type="button"
                  onClick={() => onOpenProjectFile(entry.relativePath)}
                >
                  <span aria-hidden="true">·</span>
                  <span>{entry.name}</span>
                </button>
              ) : (
                <div
                  className="explorer-entry explorer-symlink"
                  key={entry.relativePath}
                  role="listitem"
                  title="Symbolic links are not followed in the explorer."
                >
                  <span aria-hidden="true">↗</span>
                  <span>{entry.name}</span>
                </div>
              ),
            )}
            {projectEntries.length === 0 && (
              <p className="explorer-empty">
                This folder has no visible entries.
              </p>
            )}
            {projectEntriesTruncated && (
              <p className="explorer-limit" role="status">
                Showing the first 1,000 entries. Narrow this folder before
                browsing more.
              </p>
            )}
          </div>
        </aside>
      )}

      <div className="editor-placeholder">
        <div className="editor-placeholder-top">
          {projectDocuments.length > 0 ? (
            <div className="editor-tabs" role="tablist" aria-label="Open files">
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
              <button
                className="editor-save-button"
                type="button"
                disabled={
                  savingFiles ||
                  !activeDocument ||
                  activeDocument.content === activeDocument.savedContent
                }
                onClick={() =>
                  activeDocument && onSaveDocuments([activeDocument])
                }
              >
                Save
              </button>
              <button
                className="editor-save-button"
                type="button"
                disabled={
                  savingFiles ||
                  !projectDocuments.some(
                    (document) => document.content !== document.savedContent,
                  )
                }
                onClick={() => onSaveDocuments(projectDocuments)}
              >
                {savingFiles ? "Saving…" : "Save all"}
              </button>
              {!browserPreview && activeProject && (
                <button
                  className="editor-save-button"
                  type="button"
                  title="Quick Open file (⌘P / Ctrl+P)"
                  onClick={onOpenQuickOpen}
                >
                  Quick open
                </button>
              )}
              <button
                className={`editor-save-button${splitDocument ? " is-active" : ""}`}
                type="button"
                title="Toggle split editor (⌘\ / Ctrl+\)"
                onClick={onToggleSplit}
              >
                {splitDocument ? "Close split" : "Split"}
              </button>
            </div>
          ) : (
            <>
              <span className="eyebrow">Source workspace</span>
              {!browserPreview && activeProject && (
                <button
                  className="editor-save-button"
                  type="button"
                  onClick={onOpenQuickOpen}
                >
                  Quick open (⌘P)
                </button>
              )}
              <span className="status-pill">
                {activeProject
                  ? activeProject.isGitRepository
                    ? "Git repository"
                    : "Folder · no Git"
                  : "No project"}
              </span>
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
                  onSelectionChange={(sel) =>
                    onEditorSelectionChange(
                      sel ? { path: activeDocument.path, ...sel } : null,
                    )
                  }
                  onCursorChange={(cur) =>
                    onEditorCursorChange({
                      path: activeDocument.path,
                      ...cur,
                    })
                  }
                  onDiagnosticsChange={onEditorDiagnosticsChange}
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
                    onSelectionChange={(sel) =>
                      onEditorSelectionChange(
                        sel ? { path: splitDocument.path, ...sel } : null,
                      )
                    }
                    onCursorChange={(cur) =>
                      onEditorCursorChange({
                        path: splitDocument.path,
                        ...cur,
                      })
                    }
                    onDiagnosticsChange={onEditorDiagnosticsChange}
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

        <div className="editor-placeholder-footer">
          <span>
            {selectedFilePath ||
              projectDirectory ||
              activeProject?.path ||
              "No folder selected"}
          </span>
          <span>
            {activeDocument
              ? activeDocument.externalChange
                ? "Changed on disk"
                : activeDocument.content !== activeDocument.savedContent
                  ? "Unsaved changes"
                  : lastSyncedAt
                    ? `Synced · ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                    : "Saved"
              : selectedFilePath
                ? "Not editable"
                : "Ready to edit"}
          </span>
        </div>

        {activeProject && (
          <WorkspaceTools
            service={service}
            activeProject={activeProject}
            documents={documents}
            tab={bottomDrawerTab}
            onTabChange={setBottomDrawerTab}
            workspaceTrusted={workspaceTrusted}
            onTrustWorkspace={onTrustWorkspace}
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
        )}
      </div>

      {!preferences.inspectorCollapsed && (
        <div
          className="inspector-separator"
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
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current) {
              changeWidth(drag.current.width + drag.current.x - event.clientX);
            }
          }}
          onPointerUp={() => {
            if (!drag.current) return;
            drag.current = undefined;
            void onPreferencesChange({
              ...preferences,
              inspectorWidth: draftWidthRef.current,
            });
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
        />
      )}

      {!preferences.inspectorCollapsed ? (
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
          onAttachToRook={(chip, mode) => onAttachContextChipToRook(chip, mode)}
          onOpenInlinePatch={onOpenInlinePatch}
          onOpenFileInReview={(relativePath) =>
            onOpenWorkspaceReview([relativePath], "head")
          }
          onOpenReview={onOpenWorkspaceReview}
          onOpenVerify={() => setBottomDrawerTab("verify")}
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
        />
      ) : (
        <button
          className="show-inspector-button"
          type="button"
          title="Show Rook & Context panel (⌘L)"
          onClick={() =>
            void onPreferencesChange({
              ...preferences,
              inspectorCollapsed: false,
            })
          }
        >
          Show Rook &amp; Context
        </button>
      )}
    </section>
  );
}
