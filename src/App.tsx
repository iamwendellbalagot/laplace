import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { navigationItems, screenTitles } from "./app/navigation";
import { AppServiceError, type AppService } from "./services/app-service";
import type {
  AppEvent,
  EditorDiagnostic,
  ProjectSummary,
  ProjectSymbolEntry,
  ReviewDiffBaseline,
  RookContextChip,
  RookMode,
  UiPreferences,
} from "./services/contracts";
import { useAppStore, type PageId } from "./state/app-store";
import { useRookStore } from "./state/rook-store";
import {
  useWorkspaceStore,
  type EditorDocument,
} from "./state/workspace-store";
import {
  ContextLensScreen,
  type ReturnSourceAnchor,
} from "./features/context/ContextLensScreen";
import type {
  EditorCursorState,
  EditorSelection,
} from "./features/editor/EditorContextInspector";
import type { PendingInlinePatch } from "./features/editor/InlinePatchOverlay";
import { QuickOpenDialog } from "./features/editor/QuickOpenDialog";
import { WorkspaceScreen } from "./features/editor/WorkspaceScreen";
import {
  applyExternalReload,
  dismissExternalChangeKeepingEdits,
  isMutatingRookTool,
  reconcileDocumentWithDisk,
} from "./features/editor/workspace-sync";
import { ProjectPulseHome } from "./features/home/ProjectPulseHome";
import { WorkspaceReviewScreen } from "./features/review/WorkspaceReviewScreen";
import { extractTouchedFileFromToolSummary } from "./features/rook/rook-markdown";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import {
  CommandPalette,
  type PaletteCommand,
} from "./features/shell/CommandPalette";
import { TopbarPulse } from "./features/shell/TopbarPulse";
import { ToolsScreen } from "./features/tools/ToolsScreen";

interface AppProps {
  service: AppService;
  browserPreview?: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

function OrbitMark() {
  return (
    <svg className="orbit-mark" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="15.5" />
      <path d="M12 9v17h15M12 26 25 10" />
      <circle className="orbit-point" cx="25" cy="10" r="2" />
    </svg>
  );
}

export function App({ service, browserPreview = false }: AppProps) {
  const page = useAppStore((s) => s.page);
  const preferences = useAppStore((s) => s.preferences);
  const setPage = useAppStore((s) => s.navigate);
  const setPreferences = useAppStore((s) => s.setPreferences);
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const setRookExpanded = useAppStore((s) => s.setRookExpanded);
  const bottomDrawerTab = useAppStore((s) => s.bottomDrawerTab);
  const setBottomDrawerTab = useAppStore((s) => s.setBottomDrawerTab);

  const activeProject = useWorkspaceStore((s) => s.activeProject);
  const recentProjects = useWorkspaceStore((s) => s.recentProjects);
  const workspaceTrusted = useWorkspaceStore((s) => s.workspaceTrusted);
  const workspacePulse = useWorkspaceStore((s) => s.workspacePulse);
  const projectEntries = useWorkspaceStore((s) => s.projectEntries);
  const projectEntriesTruncated = useWorkspaceStore(
    (s) => s.projectEntriesTruncated,
  );
  const projectDirectory = useWorkspaceStore((s) => s.projectDirectory);
  const selectedFilePath = useWorkspaceStore((s) => s.selectedFilePath);
  const selectedFile = useWorkspaceStore((s) => s.selectedFile);
  const documents = useWorkspaceStore((s) => s.documents);
  const activeDocumentKey = useWorkspaceStore((s) => s.activeDocumentKey);
  const splitDocumentKey = useWorkspaceStore((s) => s.splitDocumentKey);
  const activeEditorPane = useWorkspaceStore((s) => s.activeEditorPane);
  const savingFiles = useWorkspaceStore((s) => s.savingFiles);
  const projectPending = useWorkspaceStore((s) => s.projectPending);
  const projectError = useWorkspaceStore((s) => s.projectError);
  const workspaceSyncVersion = useWorkspaceStore((s) => s.workspaceSyncVersion);
  const lastSyncedAt = useWorkspaceStore((s) => s.lastSyncedAt);
  const executions = useWorkspaceStore((s) => s.executions);
  const projectRecipes = useWorkspaceStore((s) => s.projectRecipes);
  const verifyChangeId = useWorkspaceStore((s) => s.verifyChangeId);
  const reviewInitialSelectedPaths = useWorkspaceStore(
    (s) => s.reviewInitialSelectedPaths,
  );
  const reviewBaseline = useWorkspaceStore((s) => s.reviewBaseline);
  const editorGitStatus = useWorkspaceStore((s) => s.editorGitStatus);

  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject);
  const setRecentProjects = useWorkspaceStore((s) => s.setRecentProjects);
  const setWorkspaceTrusted = useWorkspaceStore((s) => s.setWorkspaceTrusted);
  const setWorkspacePulse = useWorkspaceStore((s) => s.setWorkspacePulse);
  const setProjectEntries = useWorkspaceStore((s) => s.setProjectEntries);
  const setProjectDirectory = useWorkspaceStore((s) => s.setProjectDirectory);
  const setSelectedFile = useWorkspaceStore((s) => s.setSelectedFile);
  const setDocuments = useWorkspaceStore((s) => s.setDocuments);
  const setActiveDocumentKey = useWorkspaceStore((s) => s.setActiveDocumentKey);
  const setSplitDocumentKey = useWorkspaceStore((s) => s.setSplitDocumentKey);
  const setActiveEditorPane = useWorkspaceStore((s) => s.setActiveEditorPane);
  const setSavingFiles = useWorkspaceStore((s) => s.setSavingFiles);
  const setProjectPending = useWorkspaceStore((s) => s.setProjectPending);
  const setProjectError = useWorkspaceStore((s) => s.setProjectError);
  const bumpSyncVersion = useWorkspaceStore((s) => s.bumpSyncVersion);
  const setLastSyncedAt = useWorkspaceStore((s) => s.setLastSyncedAt);
  const setChanges = useWorkspaceStore((s) => s.setChanges);
  const setExecutions = useWorkspaceStore((s) => s.setExecutions);
  const setProjectRecipes = useWorkspaceStore((s) => s.setProjectRecipes);
  const setVerifyChangeId = useWorkspaceStore((s) => s.setVerifyChangeId);
  const setReviewTarget = useWorkspaceStore((s) => s.setReviewTarget);
  const setEditorGitStatus = useWorkspaceStore((s) => s.setEditorGitStatus);

  const rookSession = useRookStore((s) => s.session);
  const rookMode = useRookStore((s) => s.mode);
  const rookStartupPending = useRookStore((s) => s.startupPending);
  const rookRunId = useRookStore((s) => s.runId);
  const rookSessions = useRookStore((s) => s.sessions);
  const rookSessionStorage = useRookStore((s) => s.sessionStorage);
  const rookDraft = useRookStore((s) => s.draft);
  const rookPermissionPending = useRookStore((s) => s.permissionPending);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteFiles, setPaletteFiles] = useState<string[]>([]);
  const [paletteSymbols, setPaletteSymbols] = useState<ProjectSymbolEntry[]>(
    [],
  );
  const [paletteLoadingExtras, setPaletteLoadingExtras] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string>();
  const [rookDevSettings, setRookDevSettings] =
    useState<import("./services/contracts").RookDevSettings>();
  const [rookDevError, setRookDevError] = useState<string>();
  const [nativeResult, setNativeResult] = useState<string>();
  const [nativeError, setNativeError] = useState<AppServiceError>();
  const [nativeEvent, setNativeEvent] = useState<AppEvent>();
  const [nativePending, setNativePending] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenFiles, setQuickOpenFiles] = useState<string[]>([]);
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [revealTarget, setRevealTarget] = useState<{
    key: string;
    line: number;
    column?: number;
    nonce: number;
  } | null>(null);
  const [editorSelection, setEditorSelection] =
    useState<EditorSelection | null>(null);
  const [editorCursor, setEditorCursor] = useState<EditorCursorState | null>(
    null,
  );
  const [editorDiagnostics, setEditorDiagnostics] = useState<
    EditorDiagnostic[]
  >([]);
  const [returnSourceAnchor, setReturnSourceAnchor] =
    useState<ReturnSourceAnchor | null>(null);
  const [contextFocusPath, setContextFocusPath] = useState<string>();
  const [inlinePatch, setInlinePatch] = useState<PendingInlinePatch | null>(
    null,
  );
  const [inlinePatchSaving, setInlinePatchSaving] = useState(false);
  const [inlinePatchError, setInlinePatchError] = useState<string>();
  const [recoveredDraftNotice, setRecoveredDraftNotice] = useState<string>();
  const [rookFocusNonce, setRookFocusNonce] = useState(0);

  const [navHistory, setNavHistory] = useState<
    { page: PageId; filePath?: string; line?: number }[]
  >([{ page: "home" }]);
  const [navHistoryIndex, setNavHistoryIndex] = useState(0);

  const rookStarting = useRef(false);
  const rookProjectId = useRef<string | undefined>(undefined);
  const rookAttemptedProjectId = useRef<string | undefined>(undefined);
  const rookDraftByProject = useRef<Record<string, string>>({});
  const rookToolNamesRef = useRef(new Map<string, string>());
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const draftTimersRef = useRef<Map<string, number>>(new Map());
  const navSkipRecordRef = useRef(false);

  const documentsRef = useRef(documents);
  const projectDirectoryRef = useRef(projectDirectory);
  const rookModeRef = useRef(rookMode);
  documentsRef.current = documents;
  projectDirectoryRef.current = projectDirectory;
  rookModeRef.current = rookMode;

  function navigateTo(nextPage: PageId) {
    if (nextPage === "rook") {
      setRightPanelTab("rook");
      setPage("editor");
      if (preferences.inspectorCollapsed) {
        void savePreferences({ ...preferences, inspectorCollapsed: false });
      }
      setRookFocusNonce((n) => n + 1);
      return;
    }
    if (nextPage === "verify") {
      setBottomDrawerTab("verify");
      setPage("editor");
      return;
    }
    setPage(nextPage);
  }

  function recordNav(nextPage: PageId, filePath?: string, line?: number) {
    if (navSkipRecordRef.current) return;
    setNavHistory((current) => {
      const sliced = current.slice(0, navHistoryIndex + 1);
      const last = sliced.at(-1);
      if (
        last &&
        last.page === nextPage &&
        last.filePath === filePath &&
        last.line === line
      ) {
        return sliced;
      }
      const next = [...sliced, { page: nextPage, filePath, line }].slice(-40);
      setNavHistoryIndex(next.length - 1);
      return next;
    });
  }

  function navigateTracked(nextPage: PageId) {
    const resolved: PageId =
      nextPage === "rook" || nextPage === "verify" ? "editor" : nextPage;
    navigateTo(nextPage);
    recordNav(resolved);
  }

  function navigateHistoryStep(delta: -1 | 1) {
    const nextIdx = navHistoryIndex + delta;
    const entry = navHistory[nextIdx];
    if (!entry) return;
    navSkipRecordRef.current = true;
    setNavHistoryIndex(nextIdx);
    navigateTo(entry.page);
    if (entry.page === "editor" && entry.filePath) {
      void openProjectFile(entry.filePath, { line: entry.line });
    }
    queueMicrotask(() => {
      navSkipRecordRef.current = false;
    });
  }

  function focusDockedRook() {
    setRookExpanded(false);
    setRightPanelTab("rook");
    setPage("editor");
    if (preferences.inspectorCollapsed) {
      void savePreferences({ ...preferences, inspectorCollapsed: false });
    }
    setRookFocusNonce((n) => n + 1);
    recordNav("editor");
  }

  async function refreshWorkspacePulse(projectId: string) {
    if (browserPreview || !projectId) return;
    const pulse = await service.getWorkspacePulse(projectId).catch(() => null);
    if (pulse && rookProjectId.current === projectId) {
      setWorkspacePulse(pulse);
    }
  }

  useEffect(() => {
    if (browserPreview) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void service
      .getPreferences()
      .then((loaded) => {
        if (mounted) setPreferences(loaded);
      })
      .catch(() => {
        if (mounted) {
          setPreferencesError("Saved display preferences could not be loaded.");
        }
      });
    void service
      .getRookDevSettings()
      .then((settings) => {
        if (mounted) {
          setRookDevSettings(settings);
          if (settings.checkoutPath) {
            void service
              .setRookDevCheckout(settings.checkoutPath)
              .then(setRookDevSettings)
              .catch((error) => {
                setRookDevError(
                  errorMessage(
                    error,
                    "The saved Rook checkout is no longer valid.",
                  ),
                );
              });
          }
        }
      })
      .catch((error) => {
        if (mounted) {
          if (import.meta.env.DEV) {
            setRookDevSettings({ enabled: true, checkoutPath: null });
          }
          setRookDevError(
            errorMessage(error, "Rook developer settings could not be loaded."),
          );
        }
      });
    void service
      .getRecentProjects()
      .then((projects) => {
        if (mounted) setRecentProjects(projects);
      })
      .catch(() => {
        if (mounted) setProjectError("Recent projects could not be loaded.");
      });
    void service
      .listen((event) => {
        if (mounted) setNativeEvent(event);
      })
      .then((stop) => {
        if (mounted) unlisten = stop;
        else stop();
      })
      .catch(() => {
        if (mounted) {
          setNativeError(
            new AppServiceError(
              "event_listener_unavailable",
              "The native event listener could not be started.",
              "",
              true,
            ),
          );
        }
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [
    browserPreview,
    service,
    setPreferences,
    setProjectError,
    setRecentProjects,
  ]);

  useEffect(() => {
    if (browserPreview || !activeProject) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void service
      .listenWorkspaceFsChanged((event) => {
        if (event.projectId !== activeProject.id) return;
        void syncWorkspaceFromDisk(activeProject.id);
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, browserPreview, service]);

  async function openProject(path?: string) {
    if (browserPreview) return;
    if (activeProject && path && activeProject.id !== path) {
      const dirty = documents.filter(
        (document) => document.content !== document.savedContent,
      );
      if (
        dirty.length &&
        !window.confirm(
          `Switching projects will close ${dirty.length} unsaved document(s). Continue?`,
        )
      )
        return;
    }
    setProjectPending(true);
    setProjectError(undefined);
    try {
      const selectedPath = path ?? (await service.chooseProjectDirectory());
      if (!selectedPath) return;
      if (activeProject && activeProject.id !== selectedPath) {
        const dirty = documents.filter(
          (document) => document.content !== document.savedContent,
        );
        if (
          dirty.length &&
          !window.confirm(
            `Switching projects will close ${dirty.length} unsaved document(s). Continue?`,
          )
        )
          return;
      }
      const project = await service.openProject(selectedPath);
      const listing = await service.listProjectEntries(project.id);
      if (activeProject?.id !== project.id) {
        if (activeProject) {
          rookDraftByProject.current[activeProject.id] = rookDraft;
        }
        setDocuments((opened) =>
          opened.filter(
            (document) => document.content !== document.savedContent,
          ),
        );
        setActiveDocumentKey(undefined);
        rookProjectId.current = project.id;
        rookStarting.current = false;
        if (rookSession) {
          void service.stopRookAsk(rookSession).catch(() => undefined);
        }
        useRookStore
          .getState()
          .resetForProjectSwitch(rookDraftByProject.current[project.id] ?? "");
        rookAttemptedProjectId.current = undefined;
      }
      rookProjectId.current = project.id;
      setActiveProject(project);
      setWorkspaceTrusted(
        await service.getWorkspaceTrust(project.id).catch(() => false),
      );
      setChanges(await service.listChanges(project.id).catch(() => []));
      setExecutions(await service.listExecutions(project.id).catch(() => []));
      setProjectRecipes(
        await service.listProjectRecipes(project.id).catch(() => []),
      );
      setVerifyChangeId("");
      setReviewTarget(undefined, "head");
      setSplitDocumentKey(undefined);
      setInlinePatch(null);
      setRecoveredDraftNotice(undefined);
      setRookExpanded(false);
      setProjectEntries(listing.entries, listing.truncated);
      setProjectDirectory("");
      setSelectedFile(undefined, undefined);
      setActiveDocumentKey(undefined);
      setRecentProjects((projects) =>
        [
          project,
          ...projects.filter((recent) => recent.id !== project.id),
        ].slice(0, 12),
      );
      void service.startWorkspaceWatcher(project.id).catch(() => undefined);
      void refreshWorkspacePulse(project.id);

      let restoredPage: PageId = "editor";
      const continuity = await service
        .loadWorkspaceContinuity(project.id)
        .catch(() => null);
      if (continuity) {
        const draftByPath = new Map(
          continuity.drafts.map((draft) => [draft.relativePath, draft]),
        );
        const tabPaths = Array.from(
          new Set([
            ...(continuity.layout?.openTabs ?? []),
            ...continuity.drafts.map((draft) => draft.relativePath),
          ]),
        ).slice(0, 16);
        const restoredDocs: EditorDocument[] = [];
        for (const relPath of tabPaths) {
          const read = await service
            .readProjectFile(project.id, relPath)
            .catch(() => null);
          if (!read || read.kind !== "text" || read.content === null) continue;
          const draft = draftByPath.get(relPath);
          const key = `${project.id}\0${relPath}`;
          if (draft) {
            restoredDocs.push({
              key,
              projectId: project.id,
              path: relPath,
              content: draft.draftContent,
              savedContent: read.content,
              externalChange: draft.matchesDisk
                ? undefined
                : {
                    kind: "modified",
                    diskContent: read.content,
                    detectedAt: Date.now(),
                  },
            });
          } else {
            restoredDocs.push({
              key,
              projectId: project.id,
              path: relPath,
              content: read.content,
              savedContent: read.content,
            });
          }
        }
        if (restoredDocs.length > 0) {
          setDocuments((current) => {
            const others = current.filter(
              (doc) => doc.projectId !== project.id,
            );
            return [...others, ...restoredDocs];
          });
          const activeKey = continuity.layout?.activeTab
            ? `${project.id}\0${continuity.layout.activeTab}`
            : restoredDocs[0].key;
          const resolvedActive =
            restoredDocs.find((doc) => doc.key === activeKey) ??
            restoredDocs[0];
          setActiveDocumentKey(resolvedActive.key);
          setSelectedFile(resolvedActive.path, undefined);
          if (continuity.layout?.splitTab) {
            const splitKey = `${project.id}\0${continuity.layout.splitTab}`;
            if (restoredDocs.some((doc) => doc.key === splitKey)) {
              setSplitDocumentKey(splitKey);
            }
          }
        }
        if (continuity.drafts.length > 0) {
          setRecoveredDraftNotice(
            `Recovered ${continuity.drafts.length} unsaved draft(s) from your previous session.`,
          );
        }
        if (
          continuity.layout?.bottomTab === "terminal" ||
          continuity.layout?.bottomTab === "run" ||
          continuity.layout?.bottomTab === "git" ||
          continuity.layout?.bottomTab === "verify"
        ) {
          setBottomDrawerTab(continuity.layout.bottomTab);
        }
        if (
          continuity.layout?.activePage === "editor" ||
          continuity.layout?.activePage === "changes" ||
          continuity.layout?.activePage === "context" ||
          continuity.layout?.activePage === "tools"
        ) {
          restoredPage = continuity.layout.activePage;
        } else if (continuity.layout?.activePage === "verify") {
          setBottomDrawerTab("verify");
          restoredPage = "editor";
        } else if (continuity.layout?.activePage === "rook") {
          setRightPanelTab("rook");
          restoredPage = "editor";
        }
      }
      navigateTracked(restoredPage);
    } catch (error) {
      setProjectError(
        error instanceof Error
          ? error.message
          : "The selected project could not be opened.",
      );
    } finally {
      setProjectPending(false);
    }
  }

  async function ensureRookSession(
    project: ProjectSummary,
    targetMode: RookMode = rookMode,
    forceRestart = false,
    worktreePathOverride?: string | null,
  ) {
    const store = useRookStore.getState();
    if (rookStarting.current || (store.session && !forceRestart)) return;
    rookProjectId.current = project.id;
    rookAttemptedProjectId.current = project.id;
    rookStarting.current = true;
    store.setStartupPending(true);
    store.setStartupError(undefined);
    let sessionId: string | undefined;
    try {
      const id = (sessionId = crypto.randomUUID().replaceAll("-", ""));
      const effectiveWorktreePath =
        targetMode === "build"
          ? worktreePathOverride !== undefined
            ? worktreePathOverride || undefined
            : store.buildTarget === "worktree"
              ? store.activeWorktree?.path
              : undefined
          : undefined;
      const result =
        targetMode === "build"
          ? await service.startRookBuild(
              id,
              project.path,
              effectiveWorktreePath,
            )
          : await service.startRookAsk(id, project.path);
      if (rookProjectId.current !== project.id) {
        await service.stopRookAsk(id).catch(() => undefined);
        return;
      }
      let models = store.models;
      let currentModel = result.currentModel;
      if (result.capabilities.modelCatalog === true) {
        const catalog = await service.listRookModels(id);
        models = catalog.models;
        currentModel = catalog.currentModel;
      } else {
        models = [];
      }
      if (rookProjectId.current !== project.id) {
        await service.stopRookAsk(id).catch(() => undefined);
        return;
      }
      store.setMode(result.mode ?? targetMode);
      store.setSandbox(result.sandbox ?? null);
      store.setProviders(result.providers);
      store.setProviderControlsAvailable(
        result.capabilities.providerControls !== undefined,
      );
      store.setModels(models);
      store.setCurrentModel(currentModel);
      store.setMessages(result.messages ?? []);
      store.setRunId(undefined);
      store.setError(undefined);
      store.setSessionStorage(result.hostSessionStorage === true);
      store.setSessions(result.sessions ?? []);
      store.setActiveSessionId(result.activeSessionId);
      store.setSession(id);
    } catch (failure) {
      if (sessionId) void service.stopRookAsk(sessionId).catch(() => undefined);
      if (rookProjectId.current === project.id) {
        useRookStore
          .getState()
          .setStartupError(errorMessage(failure, "Rook could not be started."));
      }
    } finally {
      rookStarting.current = false;
      useRookStore.getState().setStartupPending(false);
    }
  }

  async function switchRookMode(nextMode: RookMode) {
    const store = useRookStore.getState();
    if (
      !activeProject ||
      nextMode === store.mode ||
      rookStarting.current ||
      Boolean(store.runId)
    )
      return;
    if (nextMode === "build" && !workspaceTrusted) {
      store.setTrustPromptPending(true);
      return;
    }
    store.setTrustPromptPending(false);
    const previousSession = store.session;
    store.setSession(undefined);
    store.setMode(nextMode);
    store.setSandbox(null);
    if (previousSession) {
      await service.stopRookAsk(previousSession).catch(() => undefined);
    }
    await ensureRookSession(activeProject, nextMode, true);
  }

  async function trustAndEnableBuild() {
    const store = useRookStore.getState();
    if (!activeProject || rookStarting.current || Boolean(store.runId)) return;
    store.setError(undefined);
    try {
      await service.trustWorkspace(activeProject.id);
      setWorkspaceTrusted(true);
      store.setTrustPromptPending(false);
      const previousSession = store.session;
      store.setSession(undefined);
      store.setMode("build");
      store.setSandbox(null);
      if (previousSession) {
        await service.stopRookAsk(previousSession).catch(() => undefined);
      }
      await ensureRookSession(activeProject, "build", true);
    } catch (failure) {
      store.setError(
        errorMessage(failure, "Project trust could not be enabled."),
      );
    }
  }

  async function switchRookBuildTarget(target: "direct" | "worktree") {
    const store = useRookStore.getState();
    if (
      !activeProject ||
      !activeProject.isGitRepository ||
      rookStarting.current ||
      Boolean(store.runId) ||
      target === store.buildTarget
    ) {
      return;
    }
    store.setError(undefined);
    try {
      let wt = store.activeWorktree;
      if (target === "worktree" && !wt) {
        const changeId = `exp-${crypto.randomUUID().slice(0, 8)}`;
        wt = await service.createCandidateWorktree(activeProject.id, changeId);
        store.setActiveWorktree(wt);
        store.setWorktreeSnapshot(null);
      }
      store.setBuildTarget(target);
      const previousSession = store.session;
      store.setSession(undefined);
      if (previousSession) {
        await service.stopRookAsk(previousSession).catch(() => undefined);
      }
      await ensureRookSession(
        activeProject,
        "build",
        true,
        target === "worktree" ? wt?.path : null,
      );
    } catch (failure) {
      store.setError(
        errorMessage(
          failure,
          "Candidate worktree target could not be toggled.",
        ),
      );
    }
  }

  async function applyActiveWorktree() {
    const store = useRookStore.getState();
    const wt = store.activeWorktree;
    if (!activeProject || !wt || Boolean(store.runId)) return;
    await service.applyWorktreeExperiment(
      activeProject.id,
      wt.path,
      wt.changeId,
      true,
    );
    store.setActiveWorktree(null);
    store.setWorktreeSnapshot(null);
    store.setBuildTarget("direct");
    const previousSession = store.session;
    store.setSession(undefined);
    if (previousSession) {
      await service.stopRookAsk(previousSession).catch(() => undefined);
    }
    await ensureRookSession(activeProject, "build", true, null);
    await syncWorkspaceFromDisk(activeProject.id);
    void service
      .gitStatus(activeProject.id)
      .then(setEditorGitStatus)
      .catch(() => undefined);
    void refreshWorkspacePulse(activeProject.id);
  }

  async function discardActiveWorktree() {
    const store = useRookStore.getState();
    const wt = store.activeWorktree;
    if (!activeProject || !wt || Boolean(store.runId)) return;
    await service.discardWorktreeExperiment(
      activeProject.id,
      wt.path,
      wt.changeId,
    );
    store.setActiveWorktree(null);
    store.setWorktreeSnapshot(null);
    if (store.buildTarget === "worktree") {
      store.setBuildTarget("direct");
      const previousSession = store.session;
      store.setSession(undefined);
      if (previousSession) {
        await service.stopRookAsk(previousSession).catch(() => undefined);
      }
      await ensureRookSession(activeProject, "build", true, null);
    }
  }

  async function startNewRookChat() {
    const store = useRookStore.getState();
    if (!store.session) return;
    try {
      const id = await service.newRookSession(store.session, store.mode);
      store.setActiveSessionId(id);
      store.setMessages([]);
      store.setRunId(undefined);
      store.setError(undefined);
      store.setSessions(await service.listRookSessions(store.session));
    } catch (failure) {
      store.setError(
        errorMessage(
          failure,
          store.mode === "build"
            ? "The new Build session could not be started."
            : "The new Ask could not be started.",
        ),
      );
    }
  }

  async function openRookChat(id: string) {
    const store = useRookStore.getState();
    if (!store.session || id === store.activeSessionId) return;
    try {
      await service.loadRookSession(store.session, id);
      store.setActiveSessionId(id);
      store.setMessages(await service.getRookSessionHistory(store.session));
      store.setRunId(undefined);
      store.setError(undefined);
    } catch (failure) {
      store.setError(errorMessage(failure, "That Ask could not be opened."));
    }
  }

  useEffect(() => {
    if (!activeProject || browserPreview) return;
    if (
      rookSession ||
      rookStarting.current ||
      rookAttemptedProjectId.current === activeProject.id
    )
      return;
    void ensureRookSession(activeProject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, browserPreview, rookSession, rookStartupPending]);

  async function syncWorkspaceFromDisk(projectId: string) {
    if (browserPreview || !projectId) return;
    if (syncInFlightRef.current) {
      syncQueuedRef.current = true;
      return;
    }
    syncInFlightRef.current = true;
    try {
      const openDocs = documentsRef.current.filter(
        (document) => document.projectId === projectId,
      );
      const reads = await Promise.all(
        openDocs.map(async (document) => {
          try {
            const file = await service.readProjectFile(
              projectId,
              document.path,
            );
            return {
              key: document.key,
              outcome: { ok: true as const, file },
            };
          } catch (error) {
            const code =
              error instanceof AppServiceError ? error.code : undefined;
            const deleted =
              code === "file_missing" ||
              code === "path_not_found" ||
              (error instanceof Error &&
                /not found|no such file|no longer exists/i.test(error.message));
            return {
              key: document.key,
              outcome: { ok: false as const, deleted },
            };
          }
        }),
      );
      if (reads.length > 0) {
        const byKey = new Map(reads.map((entry) => [entry.key, entry.outcome]));
        let reloadedAny = false;
        const now = Date.now();
        setDocuments((current) =>
          current.map((document) => {
            const outcome = byKey.get(document.key);
            if (!outcome) return document;
            const reconciled = reconcileDocumentWithDisk(
              document,
              outcome,
              now,
            );
            if (reconciled.status === "reloaded") reloadedAny = true;
            return reconciled.document;
          }),
        );
        if (reloadedAny) setLastSyncedAt(now);
      }
      const listing = await service
        .listProjectEntries(projectId, projectDirectoryRef.current)
        .catch(() => undefined);
      if (listing && rookProjectId.current === projectId) {
        setProjectEntries(listing.entries, listing.truncated);
      }
      const [latestExecutions, latestRecipes] = await Promise.all([
        service.listExecutions(projectId).catch(() => undefined),
        service.listProjectRecipes(projectId).catch(() => undefined),
      ]);
      if (rookProjectId.current === projectId) {
        if (latestExecutions) setExecutions(latestExecutions);
        if (latestRecipes) setProjectRecipes(latestRecipes);
      }
      bumpSyncVersion();
      void refreshWorkspacePulse(projectId);
    } finally {
      syncInFlightRef.current = false;
      if (syncQueuedRef.current) {
        syncQueuedRef.current = false;
        void syncWorkspaceFromDisk(projectId);
      }
    }
  }

  function reloadDocumentFromDisk(key: string) {
    setDocuments((current) =>
      current.map((document) =>
        document.key === key ? applyExternalReload(document) : document,
      ),
    );
  }

  function keepDocumentEdits(key: string) {
    setDocuments((current) =>
      current.map((document) =>
        document.key === key
          ? dismissExternalChangeKeepingEdits(document)
          : document,
      ),
    );
  }

  useEffect(() => {
    if (!activeProject || browserPreview) return;
    if (page === "editor" || page === "changes" || page === "context") {
      void syncWorkspaceFromDisk(activeProject.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, browserPreview, page]);

  useEffect(() => {
    if (!activeProject || browserPreview) return;
    const onFocus = () => void syncWorkspaceFromDisk(activeProject.id);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, browserPreview]);

  useEffect(() => {
    if (!rookSession || browserPreview) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const updateAssistant = (
      runId: string | undefined,
      update: (
        msg: import("./state/rook-store").RookChatMessage,
      ) => import("./state/rook-store").RookChatMessage,
    ) => {
      useRookStore.getState().setMessages((items) => {
        let index = items.length - 1;
        while (
          index >= 0 &&
          (items[index].role !== "assistant" ||
            (runId && items[index].runId !== runId))
        )
          index--;
        if (index < 0)
          return [...items, update({ role: "assistant", text: "", runId })];
        const next = [...items];
        next[index] = update(next[index]);
        return next;
      });
    };

    void service
      .listenRook((event) => {
        if (event.sessionId !== rookSession) return;
        const store = useRookStore.getState();
        const params = event.message.params as
          | Record<string, unknown>
          | undefined;
        const agentEvent = params?.event as Record<string, unknown> | undefined;
        const runId =
          typeof params?.runId === "string" ? params.runId : undefined;
        if (runId) store.setRunId(runId);

        if (agentEvent?.type === "model_request_started") {
          store.setError(undefined);
          store.setMessages((items) => {
            if (
              items.some(
                (message) =>
                  message.role === "assistant" && message.runId === runId,
              )
            ) {
              return items.map((m) =>
                m.role === "assistant" && m.runId === runId
                  ? { ...m, activeTextStart: m.text.length }
                  : m,
              );
            }
            const pendingPlan = store.pendingPlanTurn;
            if (pendingPlan) {
              store.setPendingPlanTurn(null);
            }
            return [
              ...items,
              {
                role: "assistant",
                text: "",
                runId,
                mode: rookModeRef.current,
                tools: [],
                touchedFiles: [],
                activeTextStart: 0,
                planOnly: Boolean(pendingPlan),
                planOriginalPrompt: pendingPlan?.prompt,
                planOriginalContext: pendingPlan?.context,
              },
            ];
          });
        } else if (
          agentEvent?.type === "tool_started" &&
          typeof agentEvent.id === "string" &&
          typeof agentEvent.name === "string" &&
          typeof agentEvent.summary === "string"
        ) {
          rookToolNamesRef.current.set(agentEvent.id, agentEvent.name);
          updateAssistant(runId, (message) => ({
            ...message,
            tools: [
              ...(message.tools ?? []).filter(
                (tool) => tool.id !== agentEvent.id,
              ),
              {
                id: agentEvent.id as string,
                name: agentEvent.name as string,
                summary: agentEvent.summary as string,
                status: "running",
              },
            ],
          }));
        } else if (
          agentEvent?.type === "tool_finished" &&
          typeof agentEvent.id === "string" &&
          (agentEvent.status === "ok" || agentEvent.status === "error")
        ) {
          const toolName = rookToolNamesRef.current.get(agentEvent.id);
          rookToolNamesRef.current.delete(agentEvent.id);
          updateAssistant(runId, (message) => {
            const matchedTool = (message.tools ?? []).find(
              (tool) => tool.id === agentEvent.id,
            );
            const touchedPath =
              agentEvent.status === "ok" &&
              rookModeRef.current === "build" &&
              toolName &&
              matchedTool
                ? extractTouchedFileFromToolSummary(
                    toolName,
                    matchedTool.summary,
                    activeProject?.path,
                  )
                : null;
            const touchedFiles = touchedPath
              ? Array.from(
                  new Set([...(message.touchedFiles ?? []), touchedPath]),
                )
              : message.touchedFiles;
            return {
              ...message,
              touchedFiles,
              tools: (message.tools ?? []).map((tool) =>
                tool.id === agentEvent.id
                  ? { ...tool, status: agentEvent.status as "ok" | "error" }
                  : tool,
              ),
            };
          });
          if (
            rookModeRef.current === "build" &&
            toolName &&
            isMutatingRookTool(toolName) &&
            rookProjectId.current
          ) {
            void syncWorkspaceFromDisk(rookProjectId.current);
          }
        } else if (
          agentEvent?.type === "text_delta" &&
          typeof agentEvent.text === "string"
        ) {
          updateAssistant(runId, (message) => ({
            ...message,
            text: message.text + (agentEvent.text as string),
          }));
        } else if (
          agentEvent?.type === "message_complete" &&
          typeof agentEvent.text === "string"
        ) {
          updateAssistant(runId, (message) => ({
            ...message,
            text: `${message.text.slice(0, message.activeTextStart ?? message.text.length)}${agentEvent.text as string}`,
            activeTextStart: undefined,
            stopReason:
              typeof agentEvent.stopReason === "string"
                ? agentEvent.stopReason
                : undefined,
            incomplete: false,
          }));
        } else if (
          agentEvent?.type === "error" &&
          typeof agentEvent.message === "string"
        ) {
          store.setError(agentEvent.message);
        } else if (agentEvent?.type === "run_settled") {
          const wasCancelled = agentEvent.aborted === true || store.cancelling;
          store.setCancelling(false);
          updateAssistant(runId, (message) => ({
            ...message,
            cancelled: wasCancelled ? true : message.cancelled,
            incomplete: !wasCancelled && message.stopReason === "toolUse",
          }));
          store.setRunId(undefined);
          if (rookModeRef.current === "build" && rookProjectId.current) {
            const projectId = rookProjectId.current;
            const activeWt =
              store.buildTarget === "worktree" ? store.activeWorktree : null;
            const settledMessage = useRookStore
              .getState()
              .messages.find(
                (msg) => msg.role === "assistant" && msg.runId === runId,
              );
            const isPlanOnlyTurn = Boolean(settledMessage?.planOnly);
            const runAutoVerify = (hasTouchedFiles: boolean) => {
              if (
                !hasTouchedFiles ||
                isPlanOnlyTurn ||
                wasCancelled ||
                !useRookStore.getState().autoVerifyAfterBuild ||
                !useWorkspaceStore.getState().workspaceTrusted
              ) {
                return;
              }
              const recipes = useWorkspaceStore.getState().projectRecipes;
              if (recipes.length === 0) return;
              void service
                .runProjectRecipe(
                  projectId,
                  recipes[0].name,
                  activeWt?.changeId,
                  activeWt?.path,
                )
                .then((execution) => {
                  useWorkspaceStore
                    .getState()
                    .setExecutions((items) => [execution, ...items]);
                  void refreshWorkspacePulse(projectId);
                })
                .catch(() => undefined);
            };
            if (activeWt) {
              void service
                .inspectWorktreeExperiment(projectId, activeWt.path)
                .then((snap) => {
                  useRookStore.getState().setWorktreeSnapshot(snap);
                  const changedPaths = snap.files.map((item) => item.path);
                  if (changedPaths.length > 0 && runId) {
                    updateAssistant(runId, (message) => ({
                      ...message,
                      touchedFiles: Array.from(
                        new Set([
                          ...(message.touchedFiles ?? []),
                          ...changedPaths,
                        ]),
                      ),
                    }));
                  }
                  const totalTouched =
                    (settledMessage?.touchedFiles?.length ?? 0) +
                    changedPaths.length;
                  runAutoVerify(totalTouched > 0);
                })
                .catch(() =>
                  runAutoVerify(
                    (settledMessage?.touchedFiles?.length ?? 0) > 0,
                  ),
                );
            } else {
              void syncWorkspaceFromDisk(projectId);
              if (activeProject?.isGitRepository) {
                void service
                  .getWorkspaceReview(projectId)
                  .then((review) => {
                    if (review.changedSinceCheckpoint.length > 0 && runId) {
                      updateAssistant(runId, (message) => ({
                        ...message,
                        touchedFiles: Array.from(
                          new Set([
                            ...(message.touchedFiles ?? []),
                            ...review.changedSinceCheckpoint,
                          ]),
                        ),
                      }));
                    }
                    const totalTouched =
                      (settledMessage?.touchedFiles?.length ?? 0) +
                      review.changedSinceCheckpoint.length;
                    runAutoVerify(totalTouched > 0);
                  })
                  .catch(() =>
                    runAutoVerify(
                      (settledMessage?.touchedFiles?.length ?? 0) > 0,
                    ),
                  );
              } else {
                runAutoVerify((settledMessage?.touchedFiles?.length ?? 0) > 0);
              }
            }
          }
          const queued = store.queuedSteering;
          if (queued && rookSession) {
            store.setQueuedSteering(null);
            store.setMessages((items) => [
              ...items,
              {
                role: "user",
                text: queued.text,
                steered: queued.mode === "steer",
              },
            ]);
            void service
              .promptRookAsk(
                rookSession,
                queued.text,
                queued.context || undefined,
              )
              .catch((failure) =>
                useRookStore
                  .getState()
                  .setError(
                    errorMessage(
                      failure,
                      "Queued steering prompt could not be sent.",
                    ),
                  ),
              );
          }
          if (rookSessionStorage) {
            void service
              .listRookSessions(rookSession)
              .then((list) => useRookStore.getState().setSessions(list))
              .catch(() => undefined);
          }
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserPreview, rookSession, rookSessionStorage, service]);

  async function undoRookTurn(messageIndex: number, touchedFiles: string[]) {
    if (!activeProject || !activeProject.isGitRepository) return;
    try {
      for (const filePath of touchedFiles) {
        await service.revertWorkspaceFile(
          activeProject.id,
          filePath,
          "checkpoint",
        );
      }
      useRookStore
        .getState()
        .setMessages((items) =>
          items.map((msg, idx) =>
            idx === messageIndex ? { ...msg, turnUndone: true } : msg,
          ),
        );
      await syncWorkspaceFromDisk(activeProject.id);
    } catch (failure) {
      useRookStore
        .getState()
        .setError(
          errorMessage(failure, "Could not undo Rook edits from checkpoint."),
        );
    }
  }

  async function openProjectDirectory(relativePath: string) {
    if (browserPreview || !activeProject) return;
    try {
      setProjectError(undefined);
      const listing = await service.listProjectEntries(
        activeProject.id,
        relativePath,
      );
      setProjectEntries(listing.entries, listing.truncated);
      setProjectDirectory(relativePath);
      setSelectedFile(undefined, undefined);
    } catch (error) {
      setProjectError(
        error instanceof Error
          ? error.message
          : "That project folder could not be read.",
      );
    }
  }

  async function openQuickOpen() {
    if (browserPreview || !activeProject) return;
    setQuickOpenOpen(true);
    setQuickOpenLoading(true);
    try {
      const files = await service.listProjectFiles(activeProject.id);
      setQuickOpenFiles(files);
    } catch {
      setQuickOpenFiles([]);
    } finally {
      setQuickOpenLoading(false);
    }
  }

  async function openProjectFile(
    relativePath: string,
    options?: { split?: boolean; line?: number; column?: number },
  ) {
    if (browserPreview || !activeProject) return;
    const fullRelativePath = relativePath;
    const key = `${activeProject.id}\0${fullRelativePath}`;
    const assignPane = (docKey: string) => {
      if (
        options?.split ||
        (activeEditorPane === "secondary" && splitDocumentKey)
      ) {
        setSplitDocumentKey(docKey);
        setActiveEditorPane("secondary");
      } else {
        setActiveDocumentKey(docKey);
        setActiveEditorPane("primary");
      }
      if (options?.line) {
        setRevealTarget({
          key: docKey,
          line: options.line,
          column: options.column,
          nonce: Date.now(),
        });
      }
      recordNav("editor", fullRelativePath, options?.line);
    };
    const existing = documentsRef.current.find(
      (document) => document.key === key,
    );
    if (existing) {
      assignPane(key);
      setSelectedFile(fullRelativePath, undefined);
      return;
    }
    setProjectError(undefined);
    setSelectedFile(fullRelativePath, undefined);
    try {
      const file = await service.readProjectFile(
        activeProject.id,
        fullRelativePath,
      );
      setSelectedFile(fullRelativePath, file);
      if (file.kind === "text" && file.content !== null) {
        const content = file.content;
        setDocuments((current) =>
          current.some((item) => item.key === key)
            ? current
            : [
                ...current,
                {
                  key,
                  projectId: activeProject.id,
                  path: fullRelativePath,
                  content,
                  savedContent: content,
                },
              ],
        );
        assignPane(key);
      } else {
        setActiveDocumentKey(undefined);
      }
    } catch (error) {
      setSelectedFile(undefined, undefined);
      setProjectError(
        error instanceof Error
          ? error.message
          : "This project file could not be previewed.",
      );
    }
  }

  function captureReturnSourceAnchor() {
    const activeDoc = documentsRef.current.find(
      (doc) =>
        doc.key ===
        (activeEditorPane === "secondary" && splitDocumentKey
          ? splitDocumentKey
          : activeDocumentKey),
    );
    if (!activeDoc) return;
    const line =
      editorCursor && editorCursor.path === activeDoc.path
        ? editorCursor.line
        : 1;
    const column =
      editorCursor && editorCursor.path === activeDoc.path
        ? editorCursor.column
        : 1;
    setReturnSourceAnchor({ filePath: activeDoc.path, line, column });
  }

  function expandToContextLens(focusPath?: string) {
    captureReturnSourceAnchor();
    setContextFocusPath(focusPath);
    navigateTracked("context");
  }

  function returnToSourceAnchor() {
    if (returnSourceAnchor) {
      navigateTo("editor");
      void openProjectFile(returnSourceAnchor.filePath, {
        line: returnSourceAnchor.line,
        column: returnSourceAnchor.column,
      });
      return;
    }
    navigateTracked("editor");
  }

  function jumpToLocation(
    relativePath: string,
    line: number,
    column?: number,
    recordReturnAnchor = false,
  ) {
    if (recordReturnAnchor) {
      captureReturnSourceAnchor();
    }
    setRookExpanded(false);
    navigateTo("editor");
    void openProjectFile(relativePath, { line, column });
  }

  function attachContextChipToRook(chip: RookContextChip, mode?: RookMode) {
    useRookStore.getState().addContextChip(chip);
    focusDockedRook();
    if (mode && mode !== useRookStore.getState().mode) {
      void switchRookMode(mode);
    }
  }

  function openWorkspaceReview(
    selectedPaths?: string[],
    baseline: ReviewDiffBaseline = "head",
  ) {
    setReviewTarget(selectedPaths, baseline);
    navigateTracked("changes");
  }

  async function promoteEditsToChange(
    objective: string,
    selectedPaths: string[],
  ) {
    if (!activeProject) return;
    void objective;
    openWorkspaceReview(selectedPaths, "head");
  }

  function openInlinePatchForDocument(
    doc: EditorDocument,
    proposedContent?: string,
    sourceLabel = "Localized edit",
  ) {
    setInlinePatchError(undefined);
    setInlinePatch({
      path: doc.path,
      sourceLabel,
      baseContent: doc.savedContent,
      proposedContent: proposedContent ?? doc.content,
      suggestedObjective: `Update ${doc.path}`,
    });
    navigateTracked("editor");
  }

  async function acceptInlinePatch(nextContent: string) {
    if (!activeProject || !inlinePatch) return;
    setInlinePatchSaving(true);
    setInlinePatchError(undefined);
    const key = `${activeProject.id}\0${inlinePatch.path}`;
    const liveDoc = documents.find((doc) => doc.key === key);
    const expectedOnDisk = liveDoc
      ? liveDoc.savedContent
      : inlinePatch.baseContent;
    try {
      await service.saveProjectFile(
        activeProject.id,
        inlinePatch.path,
        expectedOnDisk,
        nextContent,
      );
      setDocuments((current) =>
        current.map((doc) =>
          doc.key === key
            ? {
                ...doc,
                content: nextContent,
                savedContent: nextContent,
                externalChange: undefined,
              }
            : doc,
        ),
      );
      void service
        .deleteEditorDraft(activeProject.id, inlinePatch.path)
        .catch(() => undefined);
      setInlinePatch(null);
      bumpSyncVersion();
      void service
        .listExecutions(activeProject.id)
        .then(setExecutions)
        .catch(() => undefined);
      void refreshWorkspacePulse(activeProject.id);
    } catch (failure) {
      setInlinePatchError(
        errorMessage(
          failure,
          "Inline patch could not be saved. Source file may have changed.",
        ),
      );
    } finally {
      setInlinePatchSaving(false);
    }
  }

  async function promoteInlinePatchToChange(nextContent: string) {
    if (!activeProject || !inlinePatch) return;
    const targetPath = inlinePatch.path;
    const objective = inlinePatch.suggestedObjective ?? `Update ${targetPath}`;
    if (nextContent !== inlinePatch.baseContent) {
      setInlinePatchSaving(true);
      setInlinePatchError(undefined);
      try {
        await service.saveProjectFile(
          activeProject.id,
          targetPath,
          inlinePatch.baseContent,
          nextContent,
        );
        const key = `${activeProject.id}\0${targetPath}`;
        setDocuments((current) =>
          current.map((doc) =>
            doc.key === key
              ? {
                  ...doc,
                  content: nextContent,
                  savedContent: nextContent,
                  externalChange: undefined,
                }
              : doc,
          ),
        );
        void service
          .deleteEditorDraft(activeProject.id, targetPath)
          .catch(() => undefined);
      } catch (failure) {
        setInlinePatchError(
          errorMessage(failure, "Patch could not be saved before promoting."),
        );
        setInlinePatchSaving(false);
        return;
      } finally {
        setInlinePatchSaving(false);
      }
    }
    setInlinePatch(null);
    bumpSyncVersion();
    await promoteEditsToChange(objective, [targetPath]);
  }

  function updateDocument(key: string, content: string) {
    setDocuments((current) =>
      current.map((document) =>
        document.key === key ? { ...document, content } : document,
      ),
    );
    if (browserPreview) return;
    const doc = documentsRef.current.find((item) => item.key === key);
    if (!doc) return;
    const prevTimer = draftTimersRef.current.get(key);
    if (prevTimer) window.clearTimeout(prevTimer);
    const timer = window.setTimeout(() => {
      draftTimersRef.current.delete(key);
      if (content === doc.savedContent) {
        void service
          .deleteEditorDraft(doc.projectId, doc.path)
          .catch(() => undefined);
      } else {
        void service
          .saveEditorDraft(doc.projectId, doc.path, doc.savedContent, content)
          .catch(() => undefined);
      }
    }, 600);
    draftTimersRef.current.set(key, timer);
  }

  useEffect(() => {
    if (browserPreview || !activeProject) return;
    const projectDocs = documents.filter(
      (doc) => doc.projectId === activeProject.id,
    );
    const activeDoc = projectDocs.find((doc) => doc.key === activeDocumentKey);
    const splitDoc = projectDocs.find((doc) => doc.key === splitDocumentKey);
    const timer = window.setTimeout(() => {
      void service
        .saveWorkspaceLayout(activeProject.id, {
          openTabs: projectDocs.map((doc) => doc.path),
          activeTab: activeDoc?.path ?? null,
          splitTab: splitDoc?.path ?? null,
          bottomTab: bottomDrawerTab,
          activePage: page,
        })
        .catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    activeDocumentKey,
    activeProject,
    bottomDrawerTab,
    browserPreview,
    documents,
    page,
    service,
    splitDocumentKey,
  ]);

  async function saveDocument(document: EditorDocument) {
    const newline = document.savedContent.match(/\r\n|\r|\n/)?.[0] ?? "\n";
    const content = document.content
      .replace(/\r\n|\r|\n/g, "\n")
      .replace(/\n/g, newline);
    await service.saveProjectFile(
      document.projectId,
      document.path,
      document.savedContent,
      content,
    );
    setDocuments((current) =>
      current.map((item) =>
        item.key === document.key ? { ...item, savedContent: content } : item,
      ),
    );
    if (!browserPreview) {
      void service
        .deleteEditorDraft(document.projectId, document.path)
        .catch(() => undefined);
    }
  }

  async function saveDocuments(items: EditorDocument[]): Promise<boolean> {
    setSavingFiles(true);
    setProjectError(undefined);
    try {
      let savedAny = false;
      for (const document of items) {
        if (document.content !== document.savedContent) {
          await saveDocument(document);
          savedAny = true;
        }
      }
      if (savedAny) {
        bumpSyncVersion();
        if (activeProject) {
          void service
            .listExecutions(activeProject.id)
            .then(setExecutions)
            .catch(() => undefined);
          void refreshWorkspacePulse(activeProject.id);
        }
      }
      return true;
    } catch (error) {
      setProjectError(
        error instanceof Error ? error.message : "The file could not be saved.",
      );
      return false;
    } finally {
      setSavingFiles(false);
    }
  }

  function closeDocument(document: EditorDocument) {
    if (
      document.content !== document.savedContent &&
      !window.confirm(`Discard unsaved changes to ${document.path}?`)
    ) {
      return;
    }
    const remaining = documents.filter((item) => item.key !== document.key);
    setDocuments(remaining);
    if (!browserPreview) {
      void service
        .deleteEditorDraft(document.projectId, document.path)
        .catch(() => undefined);
    }
    if (splitDocumentKey === document.key) {
      setSplitDocumentKey(undefined);
      setActiveEditorPane("primary");
    }
    if (activeDocumentKey === document.key) {
      setActiveDocumentKey(remaining.at(-1)?.key);
      const next = remaining.at(-1);
      setSelectedFile(
        next?.path,
        next
          ? {
              kind: "text",
              sizeBytes: new TextEncoder().encode(next.savedContent).length,
              content: next.savedContent,
            }
          : undefined,
      );
    }
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target;
      const isTextEntry =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select, [role='textbox']"));
      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && key === "s") {
        event.preventDefault();
        const focusedKey =
          activeEditorPane === "secondary" && splitDocumentKey
            ? splitDocumentKey
            : activeDocumentKey;
        void saveDocuments(
          event.shiftKey
            ? documents
            : documents.filter((document) => document.key === focusedKey),
        );
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        key === "p"
      ) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        key === "p" &&
        activeProject &&
        !browserPreview
      ) {
        event.preventDefault();
        void openQuickOpen();
      } else if ((event.metaKey || event.ctrlKey) && key === "l") {
        event.preventDefault();
        focusDockedRook();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        key === "f" &&
        activeProject
      ) {
        event.preventDefault();
        useAppStore.getState().focusWorkspaceSearch();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        key === "r" &&
        activeProject
      ) {
        event.preventDefault();
        setPage("editor");
        setRookExpanded(!useAppStore.getState().rookExpanded);
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "\\" &&
        page === "editor" &&
        activeDocumentKey
      ) {
        event.preventDefault();
        if (splitDocumentKey) {
          setSplitDocumentKey(undefined);
          setActiveEditorPane("primary");
        } else {
          const other = documents.find(
            (doc) =>
              doc.projectId === activeProject?.id &&
              doc.key !== activeDocumentKey,
          );
          setSplitDocumentKey(other?.key ?? activeDocumentKey);
          setActiveEditorPane("secondary");
        }
      } else if (event.altKey && event.key === "ArrowLeft" && !isTextEntry) {
        event.preventDefault();
        navigateHistoryStep(-1);
      } else if (event.altKey && event.key === "ArrowRight" && !isTextEntry) {
        event.preventDefault();
        navigateHistoryStep(1);
      } else if (
        (event.metaKey || event.ctrlKey) &&
        key === "b" &&
        !isTextEntry
      ) {
        event.preventDefault();
        void savePreferences({
          ...preferences,
          navigationCollapsed: !preferences.navigationCollapsed,
        });
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    preferences,
    service,
    documents,
    activeDocumentKey,
    splitDocumentKey,
    activeEditorPane,
    activeProject,
    browserPreview,
    page,
    navHistory,
    navHistoryIndex,
  ]);

  async function savePreferences(next: UiPreferences) {
    if (browserPreview) {
      setPreferences(next);
      setPreferencesError(undefined);
      return;
    }
    setSavingPreferences(true);
    setPreferencesError(undefined);
    try {
      const saved = await service.updatePreferences(next);
      setPreferences(saved);
    } catch (error) {
      setPreferencesError(
        error instanceof Error
          ? error.message
          : "Display preferences could not be saved.",
      );
    } finally {
      setSavingPreferences(false);
    }
  }

  async function testNativeConnection() {
    setNativePending(true);
    setNativeError(undefined);
    setNativeResult(undefined);
    try {
      const response = await service.ping();
      setNativeResult(response.message);
    } catch (error) {
      setNativeError(
        error instanceof AppServiceError
          ? error
          : new AppServiceError(
              "native_unavailable",
              "The native command failed. Retry the connection check.",
              "",
              true,
            ),
      );
    } finally {
      setNativePending(false);
    }
  }

  useEffect(() => {
    if (!paletteOpen || !activeProject || browserPreview) return;
    let cancelled = false;
    setPaletteLoadingExtras(true);
    void Promise.allSettled([
      service.listProjectFiles(activeProject.id),
      service.listProjectSymbols(activeProject.id),
    ]).then(([filesRes, symbolsRes]) => {
      if (cancelled) return;
      if (filesRes.status === "fulfilled") setPaletteFiles(filesRes.value);
      if (symbolsRes.status === "fulfilled")
        setPaletteSymbols(symbolsRes.value);
      setPaletteLoadingExtras(false);
    });
    return () => {
      cancelled = true;
    };
  }, [paletteOpen, activeProject, browserPreview, service]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const activeDoc = documents.find(
      (doc) =>
        doc.key === activeDocumentKey && doc.projectId === activeProject?.id,
    );
    const items: PaletteCommand[] = [
      ...navigationItems.map((item) => ({
        id: `navigate-${item.id}`,
        label: `Go to ${item.label}`,
        description: item.description,
        category: "action" as const,
        run: () => navigateTracked(item.id),
      })),
      {
        id: "search-workspace",
        label: "Search Workspace Text",
        description: "Find code across repository files (⌘⇧F)",
        category: "action",
        run: () => useAppStore.getState().focusWorkspaceSearch(),
      },
      {
        id: "open-quick-open",
        label: "Quick Open File",
        description: "Jump to a workspace file (⌘P)",
        category: "action",
        run: () => void openQuickOpen(),
      },
      {
        id: "open-verify-drawer",
        label: "Open Verification Drawer",
        description: "Run checks and inspect evidence in Workspace",
        category: "action",
        run: () => {
          setBottomDrawerTab("verify");
          navigateTracked("editor");
        },
      },
      {
        id: "open-project-pulse",
        label: "Go to Project Pulse",
        description: "Workspace overview and recent sessions",
        category: "action",
        run: () => navigateTracked("home"),
      },
      {
        id: "toggle-navigation",
        label: preferences.navigationCollapsed
          ? "Expand navigation rail"
          : "Collapse navigation rail",
        description: "Toggle the left navigation rail",
        category: "action",
        run: () =>
          void savePreferences({
            ...preferences,
            navigationCollapsed: !preferences.navigationCollapsed,
          }),
      },
      {
        id: "toggle-inspector",
        label: preferences.inspectorCollapsed
          ? "Show co-pilot & context panel"
          : "Hide co-pilot & context panel",
        description: "Toggle the Workspace right panel",
        category: "action",
        run: () =>
          void savePreferences({
            ...preferences,
            inspectorCollapsed: !preferences.inspectorCollapsed,
          }),
      },
      {
        id: "toggle-theme",
        label: `Use ${preferences.theme === "dark" ? "light" : "dark"} theme`,
        description: "Change the application color treatment",
        category: "action",
        run: () =>
          void savePreferences({
            ...preferences,
            theme: preferences.theme === "dark" ? "light" : "dark",
          }),
      },
      // Rook commands
      {
        id: "rook-focus-docked",
        label: "Focus Docked Rook Co-pilot",
        description: "Open and focus Rook beside the Editor (⌘L)",
        category: "rook",
        run: () => focusDockedRook(),
      },
      {
        id: "rook-toggle-expanded",
        label: useAppStore.getState().rookExpanded
          ? "Dock Rook Co-pilot"
          : "Expand Rook Focus View",
        description: "Toggle full-width Rook panel (⌘⇧R)",
        category: "rook",
        run: () => {
          setPage("editor");
          setRookExpanded(!useAppStore.getState().rookExpanded);
        },
      },
      {
        id: "rook-new-session",
        label: "Rook: New Conversation",
        description: "Start a fresh Rook session thread",
        category: "rook",
        run: () => {
          focusDockedRook();
          void startNewRookChat();
        },
      },
      {
        id: "rook-switch-ask-build",
        label:
          rookMode === "build"
            ? "Rook: Switch to Ask mode"
            : "Rook: Switch to Build mode",
        description: "Toggle read-only Ask vs mutating Build",
        category: "rook",
        run: () => {
          focusDockedRook();
          void switchRookMode(rookMode === "build" ? "ask" : "build");
        },
      },
      {
        id: "rook-toggle-plan-first",
        label: "Rook: Toggle Plan First",
        description: "Require Build plan confirmation before editing files",
        category: "rook",
        run: () => {
          useRookStore
            .getState()
            .setPlanFirst(!useRookStore.getState().planFirst);
          focusDockedRook();
        },
      },
    ];

    if (activeProject?.isGitRepository) {
      items.push(
        {
          id: "rook-toggle-worktree",
          label:
            useRookStore.getState().buildTarget === "worktree"
              ? "Rook: Return Build to Direct Workspace"
              : "Rook: Build in Isolated Worktree",
          description: "Run candidate Build edits safely in a Git worktree",
          category: "rook",
          run: () => {
            focusDockedRook();
            if (useRookStore.getState().mode !== "build") {
              void switchRookMode("build").then(() =>
                switchRookBuildTarget("worktree"),
              );
            } else {
              void switchRookBuildTarget(
                useRookStore.getState().buildTarget === "worktree"
                  ? "direct"
                  : "worktree",
              );
            }
          },
        },
        {
          id: "open-workspace-review-palette",
          label: "Review: Inspect Workspace Diff & Blast Radius",
          description: "Compare edits against HEAD or checkpoint",
          category: "action",
          run: () => openWorkspaceReview(undefined, "head"),
        },
      );
    }

    if (activeDoc) {
      items.push({
        id: "rook-ask-active-file",
        label: `Rook: Ask about ${activeDoc.path.split("/").at(-1) ?? activeDoc.path}`,
        description: `Attach ${activeDoc.path} context chip to Rook`,
        category: "rook",
        run: () => {
          attachContextChipToRook(
            {
              id: `file-${activeDoc.path}`,
              label: activeDoc.path,
              kind: "file",
              filePath: activeDoc.path,
              content: activeDoc.content.slice(0, 16_000),
            },
            "ask",
          );
        },
      });
    }

    if (activeProject && !browserPreview) {
      for (const path of paletteFiles) {
        const name = path.split("/").at(-1) ?? path;
        items.push({
          id: `file:${path}`,
          label: name,
          description: path,
          category: "file",
          keywords: path,
          supportsSplit: true,
          run: (options) => {
            setRookExpanded(false);
            navigateTo("editor");
            void openProjectFile(path, { split: options?.split });
          },
        });
      }

      for (const sym of paletteSymbols) {
        items.push({
          id: `sym:${sym.filePath}:${sym.line}:${sym.name}`,
          label: sym.name,
          description: `${sym.kind} · ${sym.filePath}:${sym.line}`,
          category: "symbol",
          keywords: `${sym.filePath} ${sym.kind}`,
          supportsSplit: true,
          run: (options) => {
            setRookExpanded(false);
            navigateTo("editor");
            void openProjectFile(sym.filePath, {
              line: sym.line,
              column: 1,
              split: options?.split,
            });
          },
        });
      }
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    preferences,
    service,
    activeProject?.id,
    activeDocumentKey,
    documents,
    browserPreview,
    rookMode,
    paletteFiles,
    paletteSymbols,
  ]);

  const platformShortcut = /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘⇧P"
    : "Ctrl⇧P";

  const keepEditorMounted = Boolean(activeProject && !browserPreview);

  let nonEditorView: React.ReactNode = null;
  if (page === "settings") {
    nonEditorView = (
      <SettingsScreen
        service={service}
        preferences={preferences}
        onPreferencesChange={savePreferences}
        savingPreferences={savingPreferences}
        rookDevSettings={rookDevSettings}
        rookDevError={rookDevError}
        onChooseRookCheckout={async () => {
          const path = await service.chooseRookCheckout();
          if (!path) return;
          try {
            setRookDevSettings(await service.setRookDevCheckout(path));
            setRookDevError(undefined);
          } catch (error) {
            setRookDevError(
              errorMessage(error, "The selected Rook checkout is invalid."),
            );
          }
        }}
        onClearRookCheckout={async () => {
          try {
            setRookDevSettings(await service.setRookDevCheckout(null));
            setRookDevError(undefined);
          } catch (error) {
            setRookDevError(
              errorMessage(error, "The Rook checkout could not be cleared."),
            );
          }
        }}
        nativeResult={nativeResult}
        nativeError={nativeError}
        nativeEvent={nativeEvent}
        nativePending={nativePending}
        onTestNative={testNativeConnection}
        browserPreview={browserPreview}
      />
    );
  } else if (page === "home") {
    nonEditorView = (
      <ProjectPulseHome
        activeProject={activeProject}
        recentProjects={recentProjects}
        workspacePulse={workspacePulse}
        rookSessions={rookSessions}
        projectPending={projectPending}
        browserPreview={browserPreview}
        onOpenProject={openProject}
        onNavigate={navigateTracked}
        onResumeRookSession={(id) => {
          focusDockedRook();
          void openRookChat(id);
        }}
      />
    );
  } else if (page === "changes") {
    if (browserPreview || !activeProject || !activeProject.isGitRepository) {
      nonEditorView = (
        <section className="content-page" aria-labelledby="screen-title">
          <header className="page-heading">
            <p className="eyebrow">{activeProject?.name ?? "Review"}</p>
            <h1 id="screen-title">Review</h1>
          </header>
          <div className="empty-state">
            <span className="empty-state-index">
              {browserPreview ? "Desktop only" : "Git required"}
            </span>
            <h2>
              {browserPreview
                ? "Not available in browser preview"
                : activeProject
                  ? "Not a Git repository"
                  : "Open a Git repository"}
            </h2>
            <p>
              Review shows live uncommitted diffs, pre-Rook checkpoints,
              per-file revert, and selective commits for Git repositories.
            </p>
          </div>
        </section>
      );
    } else {
      const dirtyProjectDocs = documents.filter(
        (doc) =>
          doc.projectId === activeProject.id &&
          doc.content !== doc.savedContent,
      );
      nonEditorView = (
        <WorkspaceReviewScreen
          service={service}
          project={activeProject}
          initialSelectedPaths={reviewInitialSelectedPaths}
          initialBaseline={reviewBaseline}
          preferences={preferences}
          executions={executions}
          recipes={projectRecipes}
          workspaceTrusted={workspaceTrusted}
          dirtyCount={dirtyProjectDocs.length}
          savingFiles={savingFiles}
          syncVersion={workspaceSyncVersion}
          onSaveAllDirty={() => saveDocuments(dirtyProjectDocs)}
          onOpenInEditor={(path) => {
            navigateTo("editor");
            void openProjectFile(path);
          }}
          onOpenVerify={() => {
            setBottomDrawerTab("verify");
            navigateTracked("editor");
          }}
          onRunQuickRecipe={async (name) => {
            const execution = await service.runProjectRecipe(
              activeProject.id,
              name,
            );
            setExecutions((items) => [execution, ...items]);
            void refreshWorkspacePulse(activeProject.id);
          }}
          onRunQuickCheck={async (program, args) => {
            const execution = await service.runCheck(
              activeProject.id,
              program,
              args,
            );
            setExecutions((items) => [execution, ...items]);
            void refreshWorkspacePulse(activeProject.id);
          }}
          onSendNotesToRook={(prompt) => {
            useRookStore.getState().setDraft(prompt);
            rookDraftByProject.current[activeProject.id] = prompt;
            focusDockedRook();
            if (workspaceTrusted && rookMode !== "build") {
              void switchRookMode("build");
            }
          }}
          onAskRookWithContext={(chip, promptText, mode = "ask") => {
            useRookStore.getState().addContextChip(chip);
            useRookStore.getState().setDraft(promptText);
            rookDraftByProject.current[activeProject.id] = promptText;
            focusDockedRook();
            if (mode === "build" && workspaceTrusted && rookMode !== "build") {
              void switchRookMode("build");
            } else if (mode === "ask" && rookMode !== "ask") {
              void switchRookMode("ask");
            }
          }}
          onWorkspaceMutated={async () => {
            setChanges(
              await service.listChanges(activeProject.id).catch(() => []),
            );
            await syncWorkspaceFromDisk(activeProject.id);
          }}
        />
      );
    }
  } else if (page === "context") {
    if (browserPreview || !activeProject) {
      nonEditorView = (
        <section className="content-page" aria-labelledby="screen-title">
          <header className="page-heading">
            <p className="eyebrow">System understanding</p>
            <h1 id="screen-title">System Map</h1>
          </header>
          <div className="empty-state">
            <span className="empty-state-index">
              {browserPreview ? "Desktop only" : "Project required"}
            </span>
            <h2>
              {browserPreview
                ? "Not available in browser preview"
                : "Open a project"}
            </h2>
            <p>
              Source relationship indexing, file history, and
              developer-confirmed context require the native desktop app and an
              open project.
            </p>
          </div>
        </section>
      );
    } else {
      nonEditorView = (
        <ContextLensScreen
          service={service}
          project={activeProject}
          initialFocusPath={contextFocusPath}
          returnAnchor={returnSourceAnchor}
          syncVersion={workspaceSyncVersion}
          onReturnToSource={returnToSourceAnchor}
          onJumpToLocation={(relativePath, line, column) =>
            jumpToLocation(relativePath, line, column, false)
          }
          onAttachToRook={(chip, mode) => attachContextChipToRook(chip, mode)}
        />
      );
    }
  } else if (page === "tools") {
    if (browserPreview || !activeProject) {
      nonEditorView = (
        <section className="content-page" aria-labelledby="screen-title">
          <header className="page-heading">
            <p className="eyebrow">Agent capabilities</p>
            <h1 id="screen-title">Tools &amp; capabilities</h1>
          </header>
          <div className="empty-state">
            <span className="empty-state-index">Capabilities</span>
            <h2>{browserPreview ? "Not available yet" : "Open a project"}</h2>
            <p>
              Skills and MCP capability provenance requires the native app and
              an open project.
            </p>
          </div>
        </section>
      );
    } else {
      nonEditorView = (
        <ToolsScreen
          key={activeProject.id}
          service={service}
          project={activeProject}
          workspaceTrusted={workspaceTrusted}
          onTrustWorkspace={async () => {
            await service.trustWorkspace(activeProject.id);
            setWorkspaceTrusted(true);
          }}
          onOpenRookWorkspace={() => focusDockedRook()}
          onOpenRookTerminal={(command?: string) => {
            setBottomDrawerTab("terminal");
            navigateTracked("editor");
            if (command && navigator.clipboard?.writeText) {
              void navigator.clipboard
                .writeText(command)
                .catch(() => undefined);
            }
          }}
        />
      );
    }
  }

  const workspaceView = (
    <WorkspaceScreen
      service={service}
      preferences={preferences}
      onPreferencesChange={savePreferences}
      activeProject={activeProject}
      projectEntries={projectEntries}
      projectEntriesTruncated={projectEntriesTruncated}
      projectDirectory={projectDirectory}
      selectedFilePath={selectedFilePath}
      selectedFile={selectedFile}
      projectPending={projectPending}
      onOpenProject={openProject}
      onOpenProjectDirectory={(rel) => void openProjectDirectory(rel)}
      onOpenProjectFile={(path) => void openProjectFile(path)}
      documents={documents}
      activeDocumentKey={activeDocumentKey}
      splitDocumentKey={splitDocumentKey}
      activeEditorPane={activeEditorPane}
      onActiveEditorPaneChange={setActiveEditorPane}
      onToggleSplit={() => {
        if (splitDocumentKey) {
          setSplitDocumentKey(undefined);
          setActiveEditorPane("primary");
        } else if (activeDocumentKey) {
          const other = documents.find(
            (doc) =>
              doc.projectId === activeProject?.id &&
              doc.key !== activeDocumentKey,
          );
          setSplitDocumentKey(other?.key ?? activeDocumentKey);
          setActiveEditorPane("secondary");
        }
      }}
      onSelectSplitDocument={(key) => {
        setSplitDocumentKey(key);
        setActiveEditorPane("secondary");
      }}
      onOpenQuickOpen={() => void openQuickOpen()}
      revealTarget={revealTarget}
      editorSelection={editorSelection}
      onEditorSelectionChange={setEditorSelection}
      editorCursor={editorCursor}
      onEditorCursorChange={setEditorCursor}
      editorDiagnostics={editorDiagnostics}
      onEditorDiagnosticsChange={setEditorDiagnostics}
      returnSourceAnchor={returnSourceAnchor}
      onExpandToContextLens={expandToContextLens}
      inlinePatch={inlinePatch}
      inlinePatchSaving={inlinePatchSaving}
      inlinePatchError={inlinePatchError}
      onOpenInlinePatch={(doc) => openInlinePatchForDocument(doc)}
      onAcceptInlinePatch={acceptInlinePatch}
      onRejectInlinePatch={() => setInlinePatch(null)}
      onPromoteInlinePatch={promoteInlinePatchToChange}
      recoveredDraftNotice={recoveredDraftNotice}
      onDismissRecoveredDraftNotice={() => setRecoveredDraftNotice(undefined)}
      editorGitStatus={editorGitStatus}
      onEditorGitStatusChange={setEditorGitStatus}
      onJumpToLocation={jumpToLocation}
      onAttachContextChipToRook={attachContextChipToRook}
      onPromoteEditsToChange={promoteEditsToChange}
      onOpenWorkspaceReview={openWorkspaceReview}
      workspaceTrusted={workspaceTrusted}
      onTrustWorkspace={async () => {
        if (!activeProject) return;
        await service.trustWorkspace(activeProject.id);
        setWorkspaceTrusted(true);
      }}
      onSelectDocument={(key) => {
        setActiveDocumentKey(key);
        setActiveEditorPane("primary");
        const document = documents.find((item) => item.key === key);
        if (document) {
          setSelectedFile(document.path, {
            kind: "text",
            sizeBytes: new TextEncoder().encode(document.savedContent).length,
            content: document.savedContent,
          });
        }
      }}
      onUpdateDocument={updateDocument}
      onSaveDocuments={saveDocuments}
      onReloadDocument={reloadDocumentFromDisk}
      onKeepDocumentEdits={keepDocumentEdits}
      onCloseDocument={closeDocument}
      executions={executions}
      projectRecipes={projectRecipes}
      verifyChangeId={verifyChangeId}
      onRunCheck={async (program, args, changeId) => {
        if (!activeProject) return;
        const execution = await service.runCheck(
          activeProject.id,
          program,
          args,
          changeId || undefined,
        );
        setExecutions((items) => [execution, ...items]);
        void refreshWorkspacePulse(activeProject.id);
      }}
      onRunProjectRecipe={async (recipeName, changeId) => {
        if (!activeProject) return;
        const execution = await service.runProjectRecipe(
          activeProject.id,
          recipeName,
          changeId || undefined,
        );
        setExecutions((items) => [execution, ...items]);
        void refreshWorkspacePulse(activeProject.id);
      }}
      onPruneExecutions={async () => {
        if (!activeProject) return;
        await service.pruneProjectExecutions(activeProject.id, 50);
        setExecutions(
          await service.listExecutions(activeProject.id).catch(() => []),
        );
        void refreshWorkspacePulse(activeProject.id);
      }}
      savingFiles={savingFiles}
      workspaceSyncVersion={workspaceSyncVersion}
      lastSyncedAt={lastSyncedAt}
      browserPreview={browserPreview}
      rookFocusNonce={rookFocusNonce}
      onRookModeChange={(mode) => void switchRookMode(mode)}
      onRookTrustBuild={() => void trustAndEnableBuild()}
      onRookDismissTrustPrompt={() =>
        useRookStore.getState().setTrustPromptPending(false)
      }
      onRookNewSession={() => void startNewRookChat()}
      onRookOpenSession={(id) => void openRookChat(id)}
      onRookStart={() => {
        rookAttemptedProjectId.current = undefined;
        if (activeProject) {
          void ensureRookSession(activeProject, rookMode, true);
        }
      }}
      onRookDraftSave={(draft) => {
        if (activeProject) {
          rookDraftByProject.current[activeProject.id] = draft;
        }
      }}
      onPreviewRookPatch={(code) => {
        const targetDoc =
          documents.find((doc) => doc.key === activeDocumentKey) ??
          documents.find((doc) => doc.projectId === activeProject?.id);
        if (targetDoc) {
          openInlinePatchForDocument(targetDoc, code, "Rook response preview");
        } else {
          setProjectError(
            "Open a file in Editor first to preview a Rook patch inline.",
          );
        }
      }}
      onProposeInlinePatch={(patch) => {
        setInlinePatchError(undefined);
        setInlinePatch(patch);
        navigateTracked("editor");
      }}
      onEntryRenamed={(fromPath, toPath) => {
        if (!activeProject) return;
        const pid = activeProject.id;
        setDocuments((current) =>
          current.map((doc) => {
            if (doc.projectId !== pid) return doc;
            if (doc.path === fromPath) {
              return { ...doc, path: toPath, key: `${pid}\0${toPath}` };
            }
            if (doc.path.startsWith(`${fromPath}/`)) {
              const nextPath = `${toPath}${doc.path.slice(fromPath.length)}`;
              return { ...doc, path: nextPath, key: `${pid}\0${nextPath}` };
            }
            return doc;
          }),
        );
        if (activeDocumentKey === `${pid}\0${fromPath}`) {
          setActiveDocumentKey(`${pid}\0${toPath}`);
        }
        if (selectedFilePath === fromPath) {
          setSelectedFile(toPath, selectedFile);
        }
        bumpSyncVersion();
        void refreshWorkspacePulse(pid);
      }}
      onEntryDeleted={(deletedPath) => {
        if (!activeProject) return;
        const pid = activeProject.id;
        const isRemoved = (path: string) =>
          path === deletedPath || path.startsWith(`${deletedPath}/`);
        setDocuments((current) =>
          current.filter(
            (doc) => doc.projectId !== pid || !isRemoved(doc.path),
          ),
        );
        if (selectedFilePath && isRemoved(selectedFilePath)) {
          setSelectedFile(undefined, undefined);
        }
        bumpSyncVersion();
        void refreshWorkspacePulse(pid);
      }}
      onRefreshWorkspace={() => {
        if (!activeProject) return;
        bumpSyncVersion();
        void service
          .gitStatus(activeProject.id)
          .then(setEditorGitStatus)
          .catch(() => undefined);
        void refreshWorkspacePulse(activeProject.id);
      }}
      onUndoRookTurn={undoRookTurn}
      onRookBuildTargetChange={switchRookBuildTarget}
      onApplyWorktree={applyActiveWorktree}
      onDiscardWorktree={discardActiveWorktree}
    />
  );

  return (
    <div
      className="app-shell"
      data-theme={preferences.theme}
      data-density={preferences.density}
      style={
        {
          "--editor-font-size": `${preferences.editorFontSize}px`,
          "--inspector-width": `${preferences.inspectorWidth}px`,
        } as CSSProperties
      }
    >
      <header className="topbar" aria-label="Application toolbar">
        <button
          className="brand"
          type="button"
          aria-label="Laplace home"
          onClick={() => navigateTracked("home")}
        >
          <OrbitMark />
          <span>
            laplace<span className="brand-point">.</span>
          </span>
        </button>
        <span className="toolbar-divider" />
        <div className="nav-history-controls" aria-label="Navigation history">
          <button
            type="button"
            className="toolbar-icon-button"
            aria-label="Go back"
            title="Back (Alt+Left)"
            disabled={navHistoryIndex <= 0}
            onClick={() => navigateHistoryStep(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="toolbar-icon-button"
            aria-label="Go forward"
            title="Forward (Alt+Right)"
            disabled={navHistoryIndex >= navHistory.length - 1}
            onClick={() => navigateHistoryStep(1)}
          >
            ›
          </button>
        </div>

        <Dialog.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
          <Dialog.Trigger asChild>
            <button className="command-trigger" type="button">
              <span className="search-glyph" aria-hidden="true">
                ⌕
              </span>
              <span className="command-placeholder">
                Search screens and commands
              </span>
              <kbd>{platformShortcut}</kbd>
            </button>
          </Dialog.Trigger>
          <CommandPalette
            commands={commands}
            loadingExtras={paletteLoadingExtras}
            onRun={(command, options) => {
              command.run(options);
              setPaletteOpen(false);
            }}
          />
        </Dialog.Root>

        <div className="toolbar-right">
          {browserPreview && (
            <span className="preview-badge" role="status">
              Browser preview · native actions off
            </span>
          )}
          <TopbarPulse
            activeProject={activeProject}
            recentProjects={recentProjects}
            workspacePulse={workspacePulse}
            browserPreview={browserPreview}
            projectPending={projectPending}
            rookConnected={Boolean(rookSession)}
            rookConnecting={rookStartupPending}
            rookMode={rookMode}
            rookRunning={Boolean(rookRunId)}
            rookPermissionPending={rookPermissionPending}
            onOpenProject={(p) => void openProject(p)}
            onOpenHome={() => navigateTracked("home")}
            onOpenReview={() => openWorkspaceReview(undefined, "head")}
            onOpenVerify={() => {
              setBottomDrawerTab("verify");
              navigateTracked("editor");
            }}
            onFocusRook={focusDockedRook}
          />
          <button
            type="button"
            className="toolbar-icon-button"
            aria-label="Open settings"
            title="Settings"
            onClick={() => navigateTracked("settings")}
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="app-body">
        <nav
          className={`nav-rail${preferences.navigationCollapsed ? " nav-rail-collapsed" : ""}`}
          aria-label="Primary navigation"
        >
          {navigationItems.map((item, index) => (
            <div
              className={
                index === 3 ? "nav-group nav-group-separated" : "nav-group"
              }
              key={item.id}
            >
              <button
                type="button"
                className={`nav-item${page === item.id ? " nav-item-active" : ""}`}
                aria-label={item.label}
                aria-current={page === item.id ? "page" : undefined}
                title={preferences.navigationCollapsed ? item.label : undefined}
                onClick={() => navigateTracked(item.id)}
              >
                <span className="nav-symbol" aria-hidden="true">
                  {item.symbol}
                </span>
                <span className="nav-label">{item.label}</span>
              </button>
            </div>
          ))}
          <div className="nav-rail-footer">
            <button
              type="button"
              className="nav-collapse-button"
              aria-label={
                preferences.navigationCollapsed
                  ? "Expand navigation rail"
                  : "Collapse navigation rail"
              }
              title={
                preferences.navigationCollapsed
                  ? "Expand navigation"
                  : "Collapse navigation"
              }
              onClick={() =>
                void savePreferences({
                  ...preferences,
                  navigationCollapsed: !preferences.navigationCollapsed,
                })
              }
            >
              <span aria-hidden="true">
                {preferences.navigationCollapsed ? "›" : "‹"}
              </span>
              <span className="nav-label">Collapse</span>
            </button>
          </div>
        </nav>

        <main
          className="screen"
          id="main-content"
          aria-labelledby="screen-title"
        >
          {!keepEditorMounted ? (
            page === "editor" ? (
              workspaceView
            ) : (
              nonEditorView
            )
          ) : (
            <>
              <div
                className={`editor-persistent-host${page === "editor" ? "" : " is-hidden"}`}
                aria-hidden={page !== "editor"}
              >
                {workspaceView}
              </div>
              {page !== "editor" ? nonEditorView : null}
            </>
          )}
        </main>
      </div>

      {preferencesError && (
        <div className="global-alert" role="alert">
          {preferencesError}
        </div>
      )}
      {projectError && (
        <div className="global-alert" role="alert">
          {projectError}
        </div>
      )}

      <QuickOpenDialog
        open={quickOpenOpen}
        files={quickOpenFiles}
        loading={quickOpenLoading}
        onOpenChange={setQuickOpenOpen}
        onSelectFile={(relativePath, openInSplit) => {
          navigateTo("editor");
          void openProjectFile(relativePath, { split: openInSplit });
        }}
      />

      <footer className="statusbar" aria-label="Application status">
        <div className="statusbar-group">
          <span className="status-mark" aria-hidden="true">
            ◈
          </span>
          <span>{activeProject?.name ?? "No workspace"}</span>
          {workspacePulse?.branch && (
            <>
              <span className="status-separator" />
              <span>{workspacePulse.branch}</span>
            </>
          )}
          <span className="status-separator" />
          <span>Local-first</span>
        </div>
        <div className="statusbar-group statusbar-secondary">
          <span>⌘L Rook · ⌘⇧P Commands · ⌘P Files</span>
          <span className="status-separator" />
          <span>{screenTitles[page]}</span>
        </div>
      </footer>
    </div>
  );
}
