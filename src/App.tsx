import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  SetStateAction,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { navigationItems, screenTitles } from "./app/navigation";
import { AppServiceError, type AppService } from "./services/app-service";
import type {
  AppEvent,
  GitStatus,
  RookContextChip,
  RookMode,
  RookModel,
  RookProvider,
  RookSandboxStatus,
  RookSessionSummary,
  RookAuthEvent,
  RookAuthPrompt,
  ProjectEntry,
  ProjectFileRead,
  ProjectSummary,
  UiPreferences,
  ChangeRecord,
  ChangeStatus,
  ExecutionRecord,
  ExecutionStatus,
  ProjectRecipeSummary,
  ReviewDiffBaseline,
  EditorDiagnostic,
} from "./services/contracts";
import { useAppStore, type PageId } from "./state/app-store";
import { TerminalPanel } from "./features/terminal/TerminalPanel";
import { GitPanel } from "./features/git/GitPanel";
import { RookPermissionCard } from "./features/rook/RookPermissionCard";
import { WorkspaceReviewScreen } from "./features/review/WorkspaceReviewScreen";
import {
  ContextLensScreen,
  type ReturnSourceAnchor,
} from "./features/context/ContextLensScreen";
import { BehaviorComparisonPanel } from "./features/compare/BehaviorComparisonPanel";
import { LinkedStackOutput, RunPanel } from "./features/runs/RunPanel";
import {
  formatFailureContextExcerpt,
  serializeRookContextChips,
} from "./features/runs/stack-trace";
import { QuickOpenDialog } from "./features/editor/QuickOpenDialog";
import {
  InlinePatchOverlay,
  type PendingInlinePatch,
} from "./features/editor/InlinePatchOverlay";
import {
  EditorContextInspector,
  type EditorCursorState,
  type EditorSelection,
} from "./features/editor/EditorContextInspector";
import type { RevealTarget } from "./features/editor/CodeEditor";
import {
  applyExternalReload,
  dismissExternalChangeKeepingEdits,
  isMutatingRookTool,
  reconcileDocumentWithDisk,
  type SyncableDocument,
} from "./features/editor/workspace-sync";

type RookChatTool = {
  id: string;
  name: string;
  summary: string;
  status: "running" | "ok" | "error";
};
type RookChatMessage = {
  role: "user" | "assistant";
  text: string;
  runId?: string;
  tools?: RookChatTool[];
  activeTextStart?: number;
  stopReason?: string;
  incomplete?: boolean;
  cancelled?: boolean;
  steered?: boolean;
};

function extractFirstFencedCodeBlock(text: string): string | null {
  const match = text.match(/```[^\n]*\n([\s\S]*?)```/);
  return match ? match[1] : null;
}

function updateRookAssistant(
  messages: RookChatMessage[],
  runId: string | undefined,
  update: (message: RookChatMessage) => RookChatMessage,
): RookChatMessage[] {
  let index = messages.length - 1;
  while (
    index >= 0 &&
    (messages[index].role !== "assistant" ||
      (runId && messages[index].runId !== runId))
  )
    index--;
  if (index < 0)
    return [...messages, update({ role: "assistant", text: "", runId })];
  const next = [...messages];
  next[index] = update(next[index]);
  return next;
}

function rookSessionTitle(session: RookSessionSummary) {
  return (session.name || session.firstMessage || "Untitled Ask").trim();
}

function groupRookSessions(sessions: RookSessionSummary[], query: string) {
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const yesterdayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  ).getTime();
  const needle = query.trim().toLowerCase();
  const groups = [
    { label: "Today", items: [] as RookSessionSummary[] },
    { label: "Yesterday", items: [] as RookSessionSummary[] },
    { label: "Older", items: [] as RookSessionSummary[] },
  ];
  for (const session of [...sessions].sort((left, right) =>
    right.modified.localeCompare(left.modified),
  )) {
    if (needle && !rookSessionTitle(session).toLowerCase().includes(needle))
      continue;
    const time = new Date(session.modified).getTime();
    groups[time >= todayStart ? 0 : time >= yesterdayStart ? 1 : 2].items.push(
      session,
    );
  }
  return groups.filter((group) => group.items.length);
}

const CodeEditor = lazy(() =>
  import("./features/editor/CodeEditor").then((module) => ({
    default: module.CodeEditor,
  })),
);

interface AppProps {
  service: AppService;
  browserPreview?: boolean;
}

interface PaletteCommand {
  id: string;
  label: string;
  description: string;
  run: () => void;
}

type EditorDocument = SyncableDocument;

export function App({ service, browserPreview = false }: AppProps) {
  const page = useAppStore((state) => state.page);
  const preferences = useAppStore((state) => state.preferences);
  const navigate = useAppStore((state) => state.navigate);
  const setPreferences = useAppStore((state) => state.setPreferences);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string>();
  const [rookDevSettings, setRookDevSettings] =
    useState<import("./services/contracts").RookDevSettings>();
  const [rookDevError, setRookDevError] = useState<string>();
  const [nativeResult, setNativeResult] = useState<string>();
  const [nativeError, setNativeError] = useState<AppServiceError>();
  const [nativeEvent, setNativeEvent] = useState<AppEvent>();
  const [nativePending, setNativePending] = useState(false);
  const [activeProject, setActiveProject] = useState<ProjectSummary>();
  const [rookSession, setRookSession] = useState<string>();
  const [rookMode, setRookMode] = useState<RookMode>("ask");
  const [rookSandbox, setRookSandbox] = useState<RookSandboxStatus | null>(
    null,
  );
  const [workspaceTrusted, setWorkspaceTrusted] = useState(false);
  const [rookTrustPromptPending, setRookTrustPromptPending] = useState(false);
  const [rookProviders, setRookProviders] = useState<RookProvider[]>([]);
  const [rookProviderControlsAvailable, setRookProviderControlsAvailable] =
    useState(false);
  const [rookModels, setRookModels] = useState<RookModel[]>([]);
  const [rookCurrentModel, setRookCurrentModel] = useState<RookModel | null>(
    null,
  );
  const [rookStartupPending, setRookStartupPending] = useState(false);
  const [rookStartupError, setRookStartupError] = useState<string>();
  const [rookError, setRookError] = useState<string>();
  const rookStarting = useRef(false);
  const rookProjectId = useRef<string | undefined>(undefined);
  const [rookMessages, setRookMessages] = useState<RookChatMessage[]>([]);
  const [rookRunId, setRookRunId] = useState<string>();
  const [rookSessionStorage, setRookSessionStorage] = useState(false);
  const [rookSessions, setRookSessions] = useState<RookSessionSummary[]>([]);
  const [rookActiveSessionId, setRookActiveSessionId] = useState<string>();
  const [rookDraft, setRookDraft] = useState("");
  const rookDraftByProject = useRef<Record<string, string>>({});
  const rookAttemptedProjectId = useRef<string | undefined>(undefined);
  const [projectEntries, setProjectEntries] = useState<ProjectEntry[]>([]);
  const [projectEntriesTruncated, setProjectEntriesTruncated] = useState(false);
  const [recentProjects, setRecentProjects] = useState<ProjectSummary[]>([]);
  const [projectPending, setProjectPending] = useState(false);
  const [projectError, setProjectError] = useState<string>();
  const [projectDirectory, setProjectDirectory] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState<string>();
  const [selectedFile, setSelectedFile] = useState<ProjectFileRead>();
  const [documents, setDocuments] = useState<EditorDocument[]>([]);
  const [activeDocumentKey, setActiveDocumentKey] = useState<string>();
  const [savingFiles, setSavingFiles] = useState(false);
  const [workspaceSyncVersion, setWorkspaceSyncVersion] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number>();
  const documentsRef = useRef<EditorDocument[]>(documents);
  const projectDirectoryRef = useRef(projectDirectory);
  const rookModeRef = useRef<RookMode>(rookMode);
  const rookToolNamesRef = useRef(new Map<string, string>());
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  documentsRef.current = documents;
  projectDirectoryRef.current = projectDirectory;
  rookModeRef.current = rookMode;
  const [changes, setChanges] = useState<ChangeRecord[]>([]);
  const [changeFilter, setChangeFilter] = useState<ChangeStatus | "all">("all");
  const [candidateWorktrees, setCandidateWorktrees] = useState<
    Record<string, { path: string; branch: string; baseRevision: string }>
  >({});
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [projectRecipes, setProjectRecipes] = useState<ProjectRecipeSummary[]>(
    [],
  );
  const [verifyChangeId, setVerifyChangeId] = useState<string>("");
  const [reviewChangeId, setReviewChangeId] = useState<string | null>(null);
  const [reviewInitialSelectedPaths, setReviewInitialSelectedPaths] = useState<
    string[] | undefined
  >(undefined);
  const [reviewBaseline, setReviewBaseline] =
    useState<ReviewDiffBaseline>("head");
  const [splitDocumentKey, setSplitDocumentKey] = useState<string>();
  const [activeEditorPane, setActiveEditorPane] = useState<
    "primary" | "secondary"
  >("primary");
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
  const [bottomDrawerTab, setBottomDrawerTab] = useState<
    "terminal" | "run" | "git"
  >("terminal");
  const [editorGitStatus, setEditorGitStatus] = useState<GitStatus>();
  const [rookContextChips, setRookContextChips] = useState<RookContextChip[]>(
    [],
  );
  const [rookCancelling, setRookCancelling] = useState(false);
  const [rookQueuedSteering, setRookQueuedSteering] = useState<{
    text: string;
    mode: "steer" | "queue";
    context: string;
  } | null>(null);
  const rookCancellingRef = useRef(rookCancelling);
  const rookQueuedSteeringRef = useRef(rookQueuedSteering);
  rookCancellingRef.current = rookCancelling;
  rookQueuedSteeringRef.current = rookQueuedSteering;
  const draftTimersRef = useRef<Map<string, number>>(new Map());
  const [navHistory, setNavHistory] = useState<
    { page: PageId; filePath?: string; line?: number }[]
  >([{ page: "home" }]);
  const [navHistoryIndex, setNavHistoryIndex] = useState(0);
  const navSkipRecordRef = useRef(false);

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
    navigate(nextPage);
    recordNav(nextPage);
  }

  function navigateHistoryStep(delta: -1 | 1) {
    const nextIdx = navHistoryIndex + delta;
    const entry = navHistory[nextIdx];
    if (!entry) return;
    navSkipRecordRef.current = true;
    setNavHistoryIndex(nextIdx);
    navigate(entry.page);
    if (entry.page === "editor" && entry.filePath) {
      void openProjectFile(entry.filePath, { line: entry.line });
    }
    queueMicrotask(() => {
      navSkipRecordRef.current = false;
    });
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
  }, [browserPreview, service, setPreferences]);

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
        if (activeProject)
          rookDraftByProject.current[activeProject.id] = rookDraft;
        setDocuments((opened) =>
          opened.filter(
            (document) => document.content !== document.savedContent,
          ),
        );
        setActiveDocumentKey(undefined);
      }
      if (activeProject?.id !== project.id) {
        rookProjectId.current = project.id;
        rookStarting.current = false;
        if (rookSession)
          void service.stopRookAsk(rookSession).catch(() => undefined);
        setRookSession(undefined);
        setRookMode("ask");
        setRookSandbox(null);
        setRookTrustPromptPending(false);
        setRookProviders([]);
        setRookModels([]);
        setRookCurrentModel(null);
        setRookProviderControlsAvailable(false);
        setRookMessages([]);
        setRookRunId(undefined);
        setRookSessions([]);
        setRookActiveSessionId(undefined);
        setRookSessionStorage(false);
        setRookDraft(rookDraftByProject.current[project.id] ?? "");
        setRookError(undefined);
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
      setReviewChangeId(null);
      setReviewInitialSelectedPaths(undefined);
      setSplitDocumentKey(undefined);
      setInlinePatch(null);
      setRecoveredDraftNotice(undefined);
      setRookContextChips([]);
      setRookCancelling(false);
      setRookQueuedSteering(null);
      setProjectEntries(listing.entries);
      setProjectEntriesTruncated(listing.truncated);
      setProjectDirectory("");
      setSelectedFilePath(undefined);
      setSelectedFile(undefined);
      setActiveDocumentKey(undefined);
      setRecentProjects((projects) =>
        [
          project,
          ...projects.filter((recent) => recent.id !== project.id),
        ].slice(0, 12),
      );
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
          setSelectedFilePath(resolvedActive.path);
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
          continuity.layout?.bottomTab === "git"
        ) {
          setBottomDrawerTab(continuity.layout.bottomTab);
        }
        if (
          continuity.layout?.activePage === "editor" ||
          continuity.layout?.activePage === "changes" ||
          continuity.layout?.activePage === "context" ||
          continuity.layout?.activePage === "verify" ||
          continuity.layout?.activePage === "rook"
        ) {
          restoredPage = continuity.layout.activePage;
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
  ) {
    if (rookStarting.current || (rookSession && !forceRestart)) return;
    rookProjectId.current = project.id;
    rookAttemptedProjectId.current = project.id;
    rookStarting.current = true;
    setRookStartupPending(true);
    setRookStartupError(undefined);
    let sessionId: string | undefined;
    try {
      const id = (sessionId = crypto.randomUUID().replaceAll("-", ""));
      const result =
        targetMode === "build"
          ? await service.startRookBuild(id, project.path)
          : await service.startRookAsk(id, project.path);
      if (rookProjectId.current !== project.id) {
        await service.stopRookAsk(id).catch(() => undefined);
        return;
      }
      let models: RookModel[] = [];
      let currentModel = result.currentModel;
      if (result.capabilities.modelCatalog === true) {
        const catalog = await service.listRookModels(id);
        models = catalog.models;
        currentModel = catalog.currentModel;
      }
      if (rookProjectId.current !== project.id) {
        await service.stopRookAsk(id).catch(() => undefined);
        return;
      }
      setRookMode(result.mode ?? targetMode);
      setRookSandbox(result.sandbox ?? null);
      setRookProviders(result.providers);
      setRookProviderControlsAvailable(
        result.capabilities.providerControls !== undefined,
      );
      setRookModels(models);
      setRookCurrentModel(currentModel);
      setRookMessages(result.messages ?? []);
      setRookRunId(undefined);
      setRookError(undefined);
      setRookSessionStorage(result.hostSessionStorage === true);
      setRookSessions(result.sessions ?? []);
      setRookActiveSessionId(result.activeSessionId);
      setRookSession(id);
    } catch (failure) {
      if (sessionId) void service.stopRookAsk(sessionId).catch(() => undefined);
      if (rookProjectId.current === project.id) {
        setRookStartupError(
          errorMessage(failure, "Rook could not be started."),
        );
      }
    } finally {
      rookStarting.current = false;
      setRookStartupPending(false);
    }
  }

  async function switchRookMode(nextMode: RookMode) {
    if (
      !activeProject ||
      nextMode === rookMode ||
      rookStarting.current ||
      Boolean(rookRunId)
    )
      return;
    if (nextMode === "build" && !workspaceTrusted) {
      setRookTrustPromptPending(true);
      return;
    }
    setRookTrustPromptPending(false);
    const previousSession = rookSession;
    setRookSession(undefined);
    setRookMode(nextMode);
    setRookSandbox(null);
    if (previousSession)
      await service.stopRookAsk(previousSession).catch(() => undefined);
    await ensureRookSession(activeProject, nextMode, true);
  }

  async function trustAndEnableBuild() {
    if (!activeProject || rookStarting.current || Boolean(rookRunId)) return;
    setRookError(undefined);
    try {
      await service.trustWorkspace(activeProject.id);
      setWorkspaceTrusted(true);
      setRookTrustPromptPending(false);
      const previousSession = rookSession;
      setRookSession(undefined);
      setRookMode("build");
      setRookSandbox(null);
      if (previousSession)
        await service.stopRookAsk(previousSession).catch(() => undefined);
      await ensureRookSession(activeProject, "build", true);
    } catch (failure) {
      setRookError(
        errorMessage(failure, "Project trust could not be enabled."),
      );
    }
  }

  async function startNewRookChat() {
    if (!rookSession) return;
    try {
      const id = await service.newRookSession(rookSession, rookMode);
      setRookActiveSessionId(id);
      setRookMessages([]);
      setRookRunId(undefined);
      setRookError(undefined);
      setRookSessions(await service.listRookSessions(rookSession));
    } catch (failure) {
      setRookError(
        errorMessage(
          failure,
          rookMode === "build"
            ? "The new Build session could not be started."
            : "The new Ask could not be started.",
        ),
      );
    }
  }

  async function openRookChat(id: string) {
    if (!rookSession || id === rookActiveSessionId) return;
    try {
      await service.loadRookSession(rookSession, id);
      setRookActiveSessionId(id);
      setRookMessages(await service.getRookSessionHistory(rookSession));
      setRookRunId(undefined);
      setRookError(undefined);
    } catch (failure) {
      setRookError(errorMessage(failure, "That Ask could not be opened."));
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
        setProjectEntries(listing.entries);
        setProjectEntriesTruncated(listing.truncated);
      }
      const [latestExecutions, latestRecipes] = await Promise.all([
        service.listExecutions(projectId).catch(() => undefined),
        service.listProjectRecipes(projectId).catch(() => undefined),
      ]);
      if (rookProjectId.current === projectId) {
        if (latestExecutions) setExecutions(latestExecutions);
        if (latestRecipes) setProjectRecipes(latestRecipes);
      }
      setWorkspaceSyncVersion((version) => version + 1);
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
    if (
      page === "editor" ||
      page === "verify" ||
      page === "changes" ||
      page === "context"
    ) {
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
    void service
      .listenRook((event) => {
        if (event.sessionId !== rookSession) return;
        const params = event.message.params as
          | Record<string, unknown>
          | undefined;
        const agentEvent = params?.event as Record<string, unknown> | undefined;
        const runId =
          typeof params?.runId === "string" ? params.runId : undefined;
        if (runId) setRookRunId(runId);
        if (agentEvent?.type === "model_request_started") {
          setRookError(undefined);
          setRookMessages((items) => {
            if (
              items.some(
                (message) =>
                  message.role === "assistant" && message.runId === runId,
              )
            )
              return updateRookAssistant(items, runId, (message) => ({
                ...message,
                activeTextStart: message.text.length,
              }));
            return [
              ...items,
              {
                role: "assistant",
                text: "",
                runId,
                tools: [],
                activeTextStart: 0,
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
          setRookMessages((items) =>
            updateRookAssistant(items, runId, (message) => ({
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
            })),
          );
        } else if (
          agentEvent?.type === "tool_finished" &&
          typeof agentEvent.id === "string" &&
          (agentEvent.status === "ok" || agentEvent.status === "error")
        ) {
          const toolName = rookToolNamesRef.current.get(agentEvent.id);
          rookToolNamesRef.current.delete(agentEvent.id);
          setRookMessages((items) =>
            updateRookAssistant(items, runId, (message) => ({
              ...message,
              tools: (message.tools ?? []).map((tool) =>
                tool.id === agentEvent.id
                  ? { ...tool, status: agentEvent.status as "ok" | "error" }
                  : tool,
              ),
            })),
          );
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
          setRookMessages((items) =>
            updateRookAssistant(items, runId, (message) => ({
              ...message,
              text: message.text + (agentEvent.text as string),
            })),
          );
        } else if (
          agentEvent?.type === "message_complete" &&
          typeof agentEvent.text === "string"
        ) {
          setRookMessages((items) =>
            updateRookAssistant(items, runId, (message) => ({
              ...message,
              text: `${message.text.slice(0, message.activeTextStart ?? message.text.length)}${agentEvent.text as string}`,
              activeTextStart: undefined,
              stopReason:
                typeof agentEvent.stopReason === "string"
                  ? agentEvent.stopReason
                  : undefined,
              incomplete: false,
            })),
          );
        } else if (
          agentEvent?.type === "error" &&
          typeof agentEvent.message === "string"
        ) {
          setRookError(agentEvent.message);
        } else if (agentEvent?.type === "run_settled") {
          const wasCancelled =
            agentEvent.aborted === true || rookCancellingRef.current;
          setRookCancelling(false);
          setRookMessages((items) =>
            updateRookAssistant(items, runId, (message) => ({
              ...message,
              cancelled: wasCancelled ? true : message.cancelled,
              incomplete: !wasCancelled && message.stopReason === "toolUse",
            })),
          );
          setRookRunId(undefined);
          if (rookModeRef.current === "build" && rookProjectId.current) {
            void syncWorkspaceFromDisk(rookProjectId.current);
          }
          const queued = rookQueuedSteeringRef.current;
          if (queued && rookSession) {
            setRookQueuedSteering(null);
            setRookMessages((items) => [
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
                setRookError(
                  errorMessage(
                    failure,
                    "Queued steering prompt could not be sent.",
                  ),
                ),
              );
          }
          if (rookSessionStorage)
            void service
              .listRookSessions(rookSession)
              .then(setRookSessions)
              .catch(() => undefined);
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

  async function openProjectDirectory(relativePath: string) {
    if (browserPreview) return;
    if (!activeProject) return;
    try {
      setProjectError(undefined);
      const listing = await service.listProjectEntries(
        activeProject.id,
        relativePath,
      );
      setProjectEntries(listing.entries);
      setProjectEntriesTruncated(listing.truncated);
      setProjectDirectory(relativePath);
      setSelectedFilePath(undefined);
      setSelectedFile(undefined);
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
    if (browserPreview) return;
    if (!activeProject) return;
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
      setSelectedFilePath(fullRelativePath);
      setSelectedFile(undefined);
      return;
    }
    setProjectError(undefined);
    setSelectedFilePath(fullRelativePath);
    setSelectedFile(undefined);
    try {
      const file = await service.readProjectFile(
        activeProject.id,
        fullRelativePath,
      );
      setSelectedFile(file);
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
      setSelectedFilePath(undefined);
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
      navigate("editor");
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
    navigate("editor");
    void openProjectFile(relativePath, { line, column });
  }

  function attachContextChipToRook(chip: RookContextChip, mode?: RookMode) {
    setRookContextChips((current) => [
      ...current.filter((item) => item.id !== chip.id),
      chip,
    ]);
    navigateTracked("rook");
    if (mode && mode !== rookMode) {
      void switchRookMode(mode);
    }
  }

  function openWorkspaceReview(
    selectedPaths?: string[],
    baseline: ReviewDiffBaseline = "head",
  ) {
    setReviewInitialSelectedPaths(selectedPaths);
    setReviewBaseline(baseline);
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
    try {
      await service.saveProjectFile(
        activeProject.id,
        inlinePatch.path,
        inlinePatch.baseContent,
        nextContent,
      );
      const key = `${activeProject.id}\0${inlinePatch.path}`;
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
      setWorkspaceSyncVersion((v) => v + 1);
      void service
        .listExecutions(activeProject.id)
        .then(setExecutions)
        .catch(() => undefined);
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
    setWorkspaceSyncVersion((v) => v + 1);
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
        setWorkspaceSyncVersion((version) => version + 1);
        if (activeProject) {
          void service
            .listExecutions(activeProject.id)
            .then(setExecutions)
            .catch(() => undefined);
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
      setSelectedFilePath(remaining.at(-1)?.path);
      const next = remaining.at(-1);
      setSelectedFile(
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
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
        event.key.toLowerCase() === "p" &&
        activeProject &&
        !browserPreview
      ) {
        event.preventDefault();
        void openQuickOpen();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "\\" &&
        page === "editor" &&
        activeDocumentKey
      ) {
        event.preventDefault();
        setSplitDocumentKey((current) => {
          if (current) {
            setActiveEditorPane("primary");
            return undefined;
          }
          const other = documents.find(
            (doc) =>
              doc.projectId === activeProject?.id &&
              doc.key !== activeDocumentKey,
          );
          setActiveEditorPane("secondary");
          return other?.key ?? activeDocumentKey;
        });
      } else if (event.altKey && event.key === "ArrowLeft" && !isTextEntry) {
        event.preventDefault();
        navigateHistoryStep(-1);
      } else if (event.altKey && event.key === "ArrowRight" && !isTextEntry) {
        event.preventDefault();
        navigateHistoryStep(1);
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        if (isTextEntry) return;
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "b" &&
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

  const commands = useMemo<PaletteCommand[]>(
    () => [
      ...navigationItems.map((item) => ({
        id: `navigate-${item.id}`,
        label: `Go to ${item.label}`,
        description: item.description,
        run: () => navigate(item.id),
      })),
      {
        id: "toggle-navigation",
        label: preferences.navigationCollapsed
          ? "Expand navigation rail"
          : "Collapse navigation rail",
        description: "Toggle the left navigation rail",
        run: () =>
          void savePreferences({
            ...preferences,
            navigationCollapsed: !preferences.navigationCollapsed,
          }),
      },
      {
        id: "toggle-inspector",
        label: preferences.inspectorCollapsed
          ? "Show editor inspector"
          : "Hide editor inspector",
        description: "Toggle the Editor context inspector",
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
        run: () =>
          void savePreferences({
            ...preferences,
            theme: preferences.theme === "dark" ? "light" : "dark",
          }),
      },
    ],
    [navigate, preferences, service, setPreferences],
  );

  const platformShortcut = /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘ K"
    : "Ctrl K";

  return (
    <div
      className={`app-shell${page === "rook" ? " app-shell-rook" : ""}`}
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
          onClick={() => navigate("home")}
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
        <div className="project-context" aria-label="Project context">
          <span className="project-avatar" aria-hidden="true">
            {activeProject?.name.slice(0, 1) ?? "—"}
          </span>
          <span>{activeProject?.name ?? "No project open"}</span>
          <span className="toolbar-subtle">
            /{" "}
            {activeProject
              ? activeProject.isGitRepository
                ? "Git repository"
                : "not a Git repository"
              : "no branch"}
          </span>
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
            onRun={(command) => {
              command.run();
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
          <span className="connection-state">
            <span
              className={`status-dot${rookSession ? "" : " status-dot-muted"}`}
            />
            {rookStartupPending
              ? "Connecting to Rook"
              : rookSession
                ? "Rook connected"
                : "Rook not connected"}
          </span>
          <button
            type="button"
            className="toolbar-icon-button"
            aria-label="Open settings"
            title="Settings"
            onClick={() => navigate("settings")}
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
                index === 5 ? "nav-group nav-group-separated" : "nav-group"
              }
              key={item.id}
            >
              <button
                type="button"
                className={`nav-item${page === item.id ? " nav-item-active" : ""}`}
                aria-label={item.label}
                aria-current={page === item.id ? "page" : undefined}
                title={preferences.navigationCollapsed ? item.label : undefined}
                onClick={() => navigate(item.id)}
              >
                <span className="nav-symbol" aria-hidden="true">
                  {item.symbol}
                </span>
                <span className="nav-label">{item.label}</span>
                {!item.available && (
                  <span className="nav-unavailable" aria-hidden="true">
                    ·
                  </span>
                )}
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
          aria-label={page === "rook" ? "Rook Ask" : undefined}
          aria-labelledby={page === "rook" ? undefined : "screen-title"}
        >
          <ScreenContent
            service={service}
            page={page}
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
                  errorMessage(
                    error,
                    "The Rook checkout could not be cleared.",
                  ),
                );
              }
            }}
            preferencesError={preferencesError}
            nativeResult={nativeResult}
            nativeError={nativeError}
            nativeEvent={nativeEvent}
            nativePending={nativePending}
            onTestNative={testNativeConnection}
            onNavigate={navigateTracked}
            activeProject={activeProject}
            rookSession={rookSession}
            rookMode={rookMode}
            rookSandbox={rookSandbox}
            workspaceTrusted={workspaceTrusted}
            rookTrustPromptPending={rookTrustPromptPending}
            onRookModeChange={(mode) => void switchRookMode(mode)}
            onRookTrustBuild={() => void trustAndEnableBuild()}
            onRookDismissTrustPrompt={() => setRookTrustPromptPending(false)}
            rookProviders={rookProviders}
            rookProviderControlsAvailable={rookProviderControlsAvailable}
            rookModels={rookModels}
            rookCurrentModel={rookCurrentModel}
            rookPending={rookStartupPending}
            rookError={rookStartupError}
            conversationError={rookError}
            rookMessages={rookMessages}
            rookSessions={rookSessions}
            rookActiveSessionId={rookActiveSessionId}
            rookSessionStorage={rookSessionStorage}
            onRookNewSession={() => void startNewRookChat()}
            onRookOpenSession={(id) => void openRookChat(id)}
            rookRunId={rookRunId}
            rookCancelling={rookCancelling}
            onRookCancellingChange={setRookCancelling}
            rookQueuedSteering={rookQueuedSteering}
            onRookQueuedSteeringChange={setRookQueuedSteering}
            rookContextChips={rookContextChips}
            onRemoveRookContextChip={(id) =>
              setRookContextChips((chips) =>
                chips.filter((chip) => chip.id !== id),
              )
            }
            onClearRookContextChips={() => setRookContextChips([])}
            onPreviewRookPatch={(code) => {
              const targetDoc =
                documents.find((doc) => doc.key === activeDocumentKey) ??
                documents.find((doc) => doc.projectId === activeProject?.id);
              if (targetDoc) {
                openInlinePatchForDocument(
                  targetDoc,
                  code,
                  "Rook response preview",
                );
              } else {
                setProjectError(
                  "Open a file in Editor first to preview a Rook patch inline.",
                );
              }
            }}
            onPromoteRookToChange={() => {
              openWorkspaceReview(
                undefined,
                rookMode === "build" ? "last_review" : "head",
              );
            }}
            onOpenWorkspaceReview={openWorkspaceReview}
            reviewBaseline={reviewBaseline}
            rookDraft={rookDraft}
            onRookDraftChange={setRookDraft}
            onRookDraftSave={(draft) => {
              if (activeProject) {
                rookDraftByProject.current[activeProject.id] = draft;
              }
            }}
            onRookMessagesChange={setRookMessages}
            onRookProvidersChange={setRookProviders}
            onRookModelsChange={setRookModels}
            onRookModelChange={setRookCurrentModel}
            onRookStart={() => {
              rookAttemptedProjectId.current = undefined;
              if (activeProject)
                void ensureRookSession(activeProject, rookMode, true);
            }}
            recentProjects={recentProjects}
            projectEntries={projectEntries}
            projectEntriesTruncated={projectEntriesTruncated}
            projectDirectory={projectDirectory}
            selectedFilePath={selectedFilePath}
            selectedFile={selectedFile}
            projectPending={projectPending}
            projectError={projectError}
            onOpenProject={openProject}
            onOpenProjectDirectory={openProjectDirectory}
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
            contextFocusPath={contextFocusPath}
            onExpandToContextLens={expandToContextLens}
            onReturnToSourceAnchor={returnToSourceAnchor}
            inlinePatch={inlinePatch}
            inlinePatchSaving={inlinePatchSaving}
            inlinePatchError={inlinePatchError}
            onOpenInlinePatch={(doc) => openInlinePatchForDocument(doc)}
            onAcceptInlinePatch={acceptInlinePatch}
            onRejectInlinePatch={() => setInlinePatch(null)}
            onPromoteInlinePatch={promoteInlinePatchToChange}
            recoveredDraftNotice={recoveredDraftNotice}
            onDismissRecoveredDraftNotice={() =>
              setRecoveredDraftNotice(undefined)
            }
            bottomDrawerTab={bottomDrawerTab}
            onBottomDrawerTabChange={setBottomDrawerTab}
            editorGitStatus={editorGitStatus}
            onEditorGitStatusChange={setEditorGitStatus}
            onJumpToLocation={jumpToLocation}
            onAttachContextChipToRook={attachContextChipToRook}
            onPromoteEditsToChange={promoteEditsToChange}
            onPruneExecutions={async () => {
              if (!activeProject) return;
              await service.pruneProjectExecutions(activeProject.id, 50);
              setExecutions(
                await service.listExecutions(activeProject.id).catch(() => []),
              );
            }}
            onSelectDocument={(key) => {
              setActiveDocumentKey(key);
              setActiveEditorPane("primary");
              const document = documents.find((item) => item.key === key);
              if (document) {
                setSelectedFilePath(document.path);
                setSelectedFile({
                  kind: "text",
                  sizeBytes: new TextEncoder().encode(document.savedContent)
                    .length,
                  content: document.savedContent,
                });
              }
            }}
            onUpdateDocument={updateDocument}
            onSaveDocuments={saveDocuments}
            onReloadDocument={reloadDocumentFromDisk}
            onKeepDocumentEdits={keepDocumentEdits}
            onCloseDocument={closeDocument}
            savingFiles={savingFiles}
            workspaceSyncVersion={workspaceSyncVersion}
            lastSyncedAt={lastSyncedAt}
            browserPreview={browserPreview}
            changes={changes}
            changeFilter={changeFilter}
            onChangeFilter={setChangeFilter}
            candidateWorktrees={candidateWorktrees}
            executions={executions}
            projectRecipes={projectRecipes}
            verifyChangeId={verifyChangeId}
            onVerifyChangeIdChange={setVerifyChangeId}
            reviewChangeId={reviewChangeId}
            reviewInitialSelectedPaths={reviewInitialSelectedPaths}
            onOpenReviewChange={(id) => {
              setReviewInitialSelectedPaths(undefined);
              setReviewChangeId(id);
            }}
            onOpenReviewFileInEditor={(relativePath) => {
              navigate("editor");
              void openProjectFile(relativePath);
            }}
            onSendRevisionToRook={(prompt) => {
              setRookDraft(prompt);
              if (activeProject) {
                rookDraftByProject.current[activeProject.id] = prompt;
              }
              navigateTracked("rook");
              if (workspaceTrusted && rookMode !== "build") {
                void switchRookMode("build");
              }
            }}
            onRefreshChangeDomain={async () => {
              if (!activeProject) return;
              setChanges(
                await service.listChanges(activeProject.id).catch(() => []),
              );
              await syncWorkspaceFromDisk(activeProject.id);
            }}
            onOpenVerifyForChange={(changeId) => {
              setVerifyChangeId(changeId);
              navigate("verify");
            }}
            onTrustWorkspace={async () => {
              if (!activeProject) return;
              await service.trustWorkspace(activeProject.id);
              setWorkspaceTrusted(true);
            }}
            onRunCheck={async (program, args, changeId) => {
              if (!activeProject) return;
              const execution = await service.runCheck(
                activeProject.id,
                program,
                args,
                changeId || undefined,
              );
              setExecutions((items) => [execution, ...items]);
            }}
            onRunProjectRecipe={async (recipeName, changeId) => {
              if (!activeProject) return;
              const execution = await service.runProjectRecipe(
                activeProject.id,
                recipeName,
                changeId || undefined,
              );
              setExecutions((items) => [execution, ...items]);
            }}
            onCreateChange={async (objective) => {
              if (!activeProject) return;
              const change = await service.createChange(
                activeProject.id,
                objective,
              );
              setChanges((items) => [change, ...items]);
            }}
            onUpdateChange={async (changeId, objective, status) => {
              if (!activeProject) return;
              const change = await service.updateChange(
                activeProject.id,
                changeId,
                objective,
                status,
              );
              setChanges((items) =>
                items.map((item) => (item.id === change.id ? change : item)),
              );
            }}
            onReopenChange={async (changeId, objective) => {
              if (!activeProject) return;
              const change = await service.reopenChangeReview(
                activeProject.id,
                changeId,
                objective,
              );
              setChanges((items) =>
                items.map((item) => (item.id === change.id ? change : item)),
              );
            }}
            onCreateCandidate={async (changeId) => {
              if (!activeProject) return;
              const worktree = await service.createCandidateWorktree(
                activeProject.id,
                changeId,
              );
              setCandidateWorktrees((items) => ({
                ...items,
                [changeId]: worktree,
              }));
            }}
          />
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
          navigate("editor");
          void openProjectFile(relativePath, { split: openInSplit });
        }}
      />

      <footer className="statusbar" aria-label="Application status">
        <div className="statusbar-group">
          <span className="status-mark" aria-hidden="true">
            ◈
          </span>
          <span>{activeProject?.name ?? "No workspace"}</span>
          <span className="status-separator" />
          <span>Local-first</span>
        </div>
        <div className="statusbar-group statusbar-secondary">
          <span>Laplace · desktop</span>
          <span className="status-separator" />
          <span>{screenTitles[page]}</span>
        </div>
      </footer>
    </div>
  );
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

interface CommandPaletteProps {
  commands: PaletteCommand[];
  onRun: (command: PaletteCommand) => void;
}

function CommandPalette({ commands, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = commands.filter((command) =>
    `${command.label} ${command.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  useEffect(() => setSelectedIndex(0), [query]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[selectedIndex];
      if (command) onRun(command);
    }
  }

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="palette-overlay" />
      <Dialog.Content
        className="command-palette"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          setQuery("");
          setSelectedIndex(0);
          inputRef.current?.focus();
        }}
      >
        <div className="palette-search-row">
          <span className="search-glyph" aria-hidden="true">
            ⌕
          </span>
          <Dialog.Title className="visually-hidden">
            Command palette
          </Dialog.Title>
          <Dialog.Description className="visually-hidden">
            Search screens and commands. Use the arrow keys to move and Enter to
            run.
          </Dialog.Description>
          <input
            ref={inputRef}
            aria-label="Search screens and commands"
            aria-controls="command-results"
            aria-activedescendant={
              filtered[selectedIndex]
                ? `command-${filtered[selectedIndex].id}`
                : undefined
            }
            autoComplete="off"
            placeholder="Where would you like to go?"
            role="combobox"
            aria-expanded="true"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
          <Dialog.Close asChild>
            <button className="palette-escape" type="button">
              Esc
            </button>
          </Dialog.Close>
        </div>
        <div
          className="palette-results"
          id="command-results"
          role="listbox"
          aria-label="Commands"
        >
          {filtered.length === 0 ? (
            <p className="palette-empty">No matching commands.</p>
          ) : (
            filtered.map((command, index) => (
              <button
                id={`command-${command.id}`}
                className={`palette-command${index === selectedIndex ? " palette-command-active" : ""}`}
                key={command.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseMove={() => setSelectedIndex(index)}
                onClick={() => onRun(command)}
              >
                <span className="palette-command-symbol" aria-hidden="true">
                  ↗
                </span>
                <span className="palette-command-label">{command.label}</span>
                <span className="palette-command-description">
                  {command.description}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="palette-help" aria-hidden="true">
          <span>↑ ↓ Navigate</span>
          <span>↵ Open</span>
          <span>Esc Close</span>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

interface ScreenContentProps {
  service: AppService;
  changes?: ChangeRecord[];
  changeFilter?: ChangeStatus | "all";
  onChangeFilter?: (filter: ChangeStatus | "all") => void;
  candidateWorktrees?: Record<
    string,
    { path: string; branch: string; baseRevision: string }
  >;
  executions?: ExecutionRecord[];
  projectRecipes?: ProjectRecipeSummary[];
  verifyChangeId?: string;
  onVerifyChangeIdChange?: (changeId: string) => void;
  reviewChangeId?: string | null;
  reviewInitialSelectedPaths?: string[];
  reviewBaseline?: ReviewDiffBaseline;
  onOpenWorkspaceReview?: (
    selectedPaths?: string[],
    baseline?: ReviewDiffBaseline,
  ) => void;
  onOpenReviewChange?: (changeId: string | null) => void;
  onOpenReviewFileInEditor?: (relativePath: string) => void;
  onSendRevisionToRook?: (prompt: string) => void;
  onRefreshChangeDomain?: () => Promise<void>;
  onOpenVerifyForChange?: (changeId: string) => void;
  onTrustWorkspace?: () => Promise<void>;
  onRunCheck?: (
    program: string,
    args: string[],
    changeId?: string,
  ) => Promise<void>;
  onRunProjectRecipe?: (recipeName: string, changeId?: string) => Promise<void>;
  onCreateChange?: (objective: string) => Promise<void>;
  onUpdateChange?: (
    changeId: string,
    objective: string,
    status: ChangeStatus,
  ) => Promise<void>;
  onReopenChange?: (changeId: string, objective: string) => Promise<void>;
  onCreateCandidate?: (changeId: string) => Promise<void>;
  page: PageId;
  preferences: UiPreferences;
  onPreferencesChange: (preferences: UiPreferences) => Promise<void>;
  savingPreferences: boolean;
  rookDevSettings?: import("./services/contracts").RookDevSettings;
  rookDevError?: string;
  onChooseRookCheckout: () => void;
  onClearRookCheckout: () => void;
  preferencesError?: string;
  nativeResult?: string;
  nativeError?: AppServiceError;
  nativeEvent?: AppEvent;
  nativePending: boolean;
  onTestNative: () => void;
  onNavigate: (page: PageId) => void;
  activeProject?: ProjectSummary;
  rookSession?: string;
  rookMode: RookMode;
  rookSandbox: RookSandboxStatus | null;
  workspaceTrusted: boolean;
  rookTrustPromptPending: boolean;
  onRookModeChange: (mode: RookMode) => void;
  onRookTrustBuild: () => void;
  onRookDismissTrustPrompt: () => void;
  rookProviders: RookProvider[];
  rookProviderControlsAvailable: boolean;
  rookModels: RookModel[];
  rookCurrentModel: RookModel | null;
  rookPending: boolean;
  rookError?: string;
  conversationError?: string;
  rookMessages: RookChatMessage[];
  rookSessions: RookSessionSummary[];
  rookActiveSessionId?: string;
  rookSessionStorage: boolean;
  onRookNewSession: () => void;
  onRookOpenSession: (id: string) => void;
  rookRunId?: string;
  rookCancelling?: boolean;
  onRookCancellingChange?: (value: boolean) => void;
  rookQueuedSteering?: {
    text: string;
    mode: "steer" | "queue";
    context: string;
  } | null;
  onRookQueuedSteeringChange?: (
    value: { text: string; mode: "steer" | "queue"; context: string } | null,
  ) => void;
  rookContextChips?: RookContextChip[];
  onRemoveRookContextChip?: (id: string) => void;
  onClearRookContextChips?: () => void;
  onPreviewRookPatch?: (code: string) => void;
  onPromoteRookToChange?: (objective: string) => void;
  rookDraft: string;
  onRookDraftChange: Dispatch<SetStateAction<string>>;
  onRookDraftSave: (draft: string) => void;
  onRookMessagesChange: Dispatch<SetStateAction<RookChatMessage[]>>;
  onRookProvidersChange: Dispatch<SetStateAction<RookProvider[]>>;
  onRookModelsChange: Dispatch<SetStateAction<RookModel[]>>;
  onRookModelChange: (model: RookModel | null) => void;
  onRookStart: () => void;
  recentProjects: ProjectSummary[];
  projectEntries: ProjectEntry[];
  projectEntriesTruncated: boolean;
  projectDirectory: string;
  selectedFilePath?: string;
  selectedFile?: ProjectFileRead;
  projectPending: boolean;
  projectError?: string;
  onOpenProject: (path?: string) => void;
  onOpenProjectDirectory: (relativePath: string) => void;
  onOpenProjectFile: (relativePath: string) => void;
  documents: EditorDocument[];
  activeDocumentKey?: string;
  splitDocumentKey?: string;
  activeEditorPane?: "primary" | "secondary";
  onActiveEditorPaneChange?: (pane: "primary" | "secondary") => void;
  onToggleSplit?: () => void;
  onSelectSplitDocument?: (key: string) => void;
  onOpenQuickOpen?: () => void;
  revealTarget?: {
    key: string;
    line: number;
    column?: number;
    nonce: number;
  } | null;
  editorSelection?: EditorSelection | null;
  onEditorSelectionChange?: (selection: EditorSelection | null) => void;
  editorCursor?: EditorCursorState | null;
  onEditorCursorChange?: (cursor: EditorCursorState | null) => void;
  editorDiagnostics?: EditorDiagnostic[];
  onEditorDiagnosticsChange?: (diagnostics: EditorDiagnostic[]) => void;
  returnSourceAnchor?: ReturnSourceAnchor | null;
  contextFocusPath?: string;
  onExpandToContextLens?: (focusPath?: string) => void;
  onReturnToSourceAnchor?: () => void;
  inlinePatch?: PendingInlinePatch | null;
  inlinePatchSaving?: boolean;
  inlinePatchError?: string;
  onOpenInlinePatch?: (doc: EditorDocument) => void;
  onAcceptInlinePatch?: (nextContent: string) => Promise<void>;
  onRejectInlinePatch?: () => void;
  onPromoteInlinePatch?: (nextContent: string) => Promise<void>;
  recoveredDraftNotice?: string;
  onDismissRecoveredDraftNotice?: () => void;
  bottomDrawerTab?: "terminal" | "run" | "git";
  onBottomDrawerTabChange?: (tab: "terminal" | "run" | "git") => void;
  editorGitStatus?: GitStatus;
  onEditorGitStatusChange?: (status: GitStatus) => void;
  onJumpToLocation?: (
    relativePath: string,
    line: number,
    column?: number,
    recordReturnAnchor?: boolean,
  ) => void;
  onAttachContextChipToRook?: (chip: RookContextChip, mode?: RookMode) => void;
  onPromoteEditsToChange?: (
    objective: string,
    selectedPaths: string[],
  ) => Promise<void>;
  onPruneExecutions?: () => Promise<void>;
  onSelectDocument: (key: string) => void;
  onUpdateDocument: (key: string, content: string) => void;
  onSaveDocuments: (documents: EditorDocument[]) => Promise<boolean>;
  onReloadDocument: (key: string) => void;
  onKeepDocumentEdits: (key: string) => void;
  onCloseDocument: (document: EditorDocument) => void;
  savingFiles: boolean;
  workspaceSyncVersion: number;
  lastSyncedAt?: number;
  browserPreview: boolean;
}

function ScreenContent(props: ScreenContentProps) {
  const { page } = props;
  const keepEditorMounted = Boolean(
    props.activeProject && !props.browserPreview,
  );

  let nonEditorView: ReactNode = null;
  if (page === "settings") {
    nonEditorView = <SettingsScreen {...props} />;
  } else if (page === "home") {
    nonEditorView = <HomeScreen {...props} />;
  } else if (page === "changes") {
    if (props.browserPreview) {
      nonEditorView = (
        <section className="content-page" aria-labelledby="screen-title">
          <PageHeading eyebrow="Review" title="Review" />
          <EmptyState
            title="Not available in browser preview"
            description="Working-tree diff review and selective commits require the native desktop app."
            label="Desktop only"
          />
        </section>
      );
    } else if (!props.activeProject || !props.activeProject.isGitRepository) {
      nonEditorView = (
        <section className="content-page" aria-labelledby="screen-title">
          <PageHeading
            eyebrow={props.activeProject?.name ?? "Project required"}
            title="Review"
          />
          <EmptyState
            title={
              props.activeProject
                ? "Not a Git repository"
                : "Open a Git repository"
            }
            description="Review shows live uncommitted diffs, pre-Rook checkpoints, per-file revert, and selective commits for Git repositories."
            label="Git required"
          />
        </section>
      );
    } else {
      const dirtyProjectDocs = props.documents.filter(
        (doc) =>
          doc.projectId === props.activeProject?.id &&
          doc.content !== doc.savedContent,
      );
      nonEditorView = (
        <WorkspaceReviewScreen
          service={props.service}
          project={props.activeProject}
          initialSelectedPaths={props.reviewInitialSelectedPaths}
          initialBaseline={props.reviewBaseline ?? "head"}
          preferences={props.preferences}
          executions={props.executions ?? []}
          recipes={props.projectRecipes ?? []}
          workspaceTrusted={props.workspaceTrusted}
          dirtyCount={dirtyProjectDocs.length}
          savingFiles={props.savingFiles}
          syncVersion={props.workspaceSyncVersion}
          onSaveAllDirty={() => props.onSaveDocuments(dirtyProjectDocs)}
          onOpenInEditor={(path) => props.onOpenReviewFileInEditor?.(path)}
          onOpenVerify={() => props.onNavigate("verify")}
          onRunQuickRecipe={
            props.onRunProjectRecipe
              ? (name) => props.onRunProjectRecipe!(name)
              : undefined
          }
          onSendNotesToRook={(prompt) => props.onSendRevisionToRook?.(prompt)}
          onWorkspaceMutated={() =>
            props.onRefreshChangeDomain
              ? props.onRefreshChangeDomain()
              : Promise.resolve()
          }
        />
      );
    }
  } else if (page === "context") {
    if (props.browserPreview) {
      nonEditorView = (
        <section className="content-page" aria-labelledby="screen-title">
          <PageHeading eyebrow="System understanding" title="Context Lens" />
          <EmptyState
            title="Not available in browser preview"
            description="Source relationship indexing, file history, and developer-confirmed notes require the native desktop app."
            label="Desktop only"
          />
        </section>
      );
    } else if (!props.activeProject) {
      nonEditorView = (
        <section className="content-page" aria-labelledby="screen-title">
          <PageHeading eyebrow="Project required" title="Context Lens" />
          <EmptyState
            title="Open a project"
            description="Open a local project to explore observed source relationships, inferred test links, and developer-confirmed context."
            label="Project required"
          />
        </section>
      );
    } else {
      nonEditorView = (
        <ContextLensScreen
          service={props.service}
          project={props.activeProject}
          initialFocusPath={props.contextFocusPath}
          returnAnchor={props.returnSourceAnchor}
          syncVersion={props.workspaceSyncVersion}
          onReturnToSource={() => props.onReturnToSourceAnchor?.()}
          onJumpToLocation={(relativePath, line, column) =>
            props.onJumpToLocation?.(relativePath, line, column, false)
          }
          onAttachToRook={(chip, mode) =>
            props.onAttachContextChipToRook?.(chip, mode)
          }
        />
      );
    }
  } else if (page === "verify") {
    nonEditorView = <VerifyScreen {...props} />;
  } else if (page === "rook") {
    nonEditorView = (
      <RookScreen key={props.activeProject?.id ?? "no-project"} {...props} />
    );
  } else if (page !== "editor") {
    const item = navigationItems.find((entry) => entry.id === page);
    const details: Record<
      Exclude<PageId, "home" | "editor" | "settings">,
      string
    > = {
      changes: "Create and track durable Changes for this project.",
      context:
        "Context relationships will be grounded in opened source and recorded provenance.",
      verify:
        "Verification records will appear only after a real check is run against a known source state.",
      rook: "Rook is a separate process and is not connected to this shell yet. No sessions or agent tools are running.",
      tools:
        "Skills and MCP configuration are not available until the Rook integration is implemented.",
    };
    nonEditorView = (
      <section className="content-page" aria-labelledby="screen-title">
        <PageHeading eyebrow="Laplace workspace" title={screenTitles[page]} />
        <EmptyState
          title="Not available yet"
          description={details[page]}
          label={item?.label ?? "Feature"}
        />
      </section>
    );
  }

  if (!keepEditorMounted) {
    return page === "editor" ? (
      <EditorScreen {...props} />
    ) : (
      <>{nonEditorView}</>
    );
  }

  return (
    <>
      <div
        className={`editor-persistent-host${page === "editor" ? "" : " is-hidden"}`}
        aria-hidden={page !== "editor"}
      >
        <EditorScreen {...props} />
      </div>
      {page !== "editor" ? nonEditorView : null}
    </>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

function executionStatusLabel(status: ExecutionStatus): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "stale":
      return "Stale";
    case "inconclusive":
      return "Inconclusive";
    case "timed_out":
      return "Timed out";
    case "start_failed":
      return "Start failed";
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Interrupted";
    case "running":
      return "Running";
  }
}

function summarizeVerification(records: ExecutionRecord[]): {
  status: ExecutionStatus | "unverified";
  label: string;
  latest?: ExecutionRecord;
} {
  const latest = records[0];
  if (!latest) {
    return { status: "unverified", label: "Not verified" };
  }
  return {
    status: latest.status,
    label: `${executionStatusLabel(latest.status)} · ${latest.sourceDigest.slice(0, 8)}`,
    latest,
  };
}

function VerifyScreen({
  service,
  activeProject,
  changes = [],
  documents,
  executions = [],
  projectRecipes = [],
  verifyChangeId = "",
  workspaceTrusted,
  onTrustWorkspace,
  onSaveDocuments,
  onRunCheck,
  onRunProjectRecipe,
  onPruneExecutions,
  onJumpToLocation,
  onAttachContextChipToRook,
  savingFiles,
  browserPreview,
}: ScreenContentProps) {
  const [program, setProgram] = useState("pnpm");
  const [argsText, setArgsText] = useState("test");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "passed" | "failed" | "stale" | "inconclusive" | "other"
  >("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [compareCandidateId, setCompareCandidateId] = useState<string>();
  const [highlightedExecutionId, setHighlightedExecutionId] =
    useState<string>();

  const checks = executions.filter(
    (record) => record.projectId === activeProject?.id,
  );
  const dirtyDocuments = documents.filter(
    (document) =>
      document.projectId === activeProject?.id &&
      document.content !== document.savedContent,
  );
  const filteredChecks = checks.filter((check) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "other") {
      return !["passed", "failed", "stale", "inconclusive"].includes(
        check.status,
      );
    }
    return check.status === statusFilter;
  });
  const changesById = new Map(changes.map((change) => [change.id, change]));

  async function executeWithOptionalSave(
    saveFirst: boolean,
    run: () => Promise<void>,
  ) {
    setPending(true);
    setError(undefined);
    try {
      if (saveFirst && dirtyDocuments.length > 0) {
        const saved = await onSaveDocuments(dirtyDocuments);
        if (!saved) {
          setError(
            "Unsaved files could not be saved. Resolve the save error before running checks.",
          );
          return;
        }
      }
      await run();
    } catch (failure) {
      setError(errorMessage(failure, "The verification check failed to run."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="content-page" aria-labelledby="screen-title">
      <PageHeading
        eyebrow={activeProject?.name ?? "Project required"}
        title="Verify"
      />
      {browserPreview || !activeProject ? (
        <EmptyState
          title={browserPreview ? "Not available yet" : "Open a project"}
          description="Verification requires the native app and an open project."
          label="Workspace"
        />
      ) : (
        <>
          {dirtyDocuments.length > 0 && (
            <div
              className="verify-dirty-banner"
              role="status"
              aria-label="Unsaved editor files"
            >
              <p>
                <strong>
                  {dirtyDocuments.length} open file
                  {dirtyDocuments.length === 1 ? "" : "s"} ha
                  {dirtyDocuments.length === 1 ? "s" : "ve"} unsaved edits.
                </strong>{" "}
                Checks run against saved disk source, not unsaved editor
                buffers.
              </p>
              {workspaceTrusted && (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={pending || savingFiles || !program.trim()}
                  onClick={() =>
                    void executeWithOptionalSave(true, () =>
                      onRunCheck
                        ? onRunCheck(
                            program,
                            argsText.trim().split(/\s+/).filter(Boolean),
                            verifyChangeId || undefined,
                          )
                        : Promise.resolve(),
                    )
                  }
                >
                  Save all &amp; run check
                </button>
              )}
            </div>
          )}
          {projectRecipes.length > 0 && (
            <section
              className="verify-recipes"
              aria-label="Project verification recipes"
            >
              <span className="eyebrow">.laplace/recipes.toml</span>
              <div className="verify-recipe-list">
                {projectRecipes.map((recipe) => (
                  <button
                    key={recipe.name}
                    type="button"
                    className="button button-quiet"
                    disabled={!workspaceTrusted || pending || savingFiles}
                    title={`${recipe.program} ${recipe.args.join(" ")}${recipe.cwd ? ` (cwd: ${recipe.cwd})` : ""}`}
                    onClick={() =>
                      void executeWithOptionalSave(
                        dirtyDocuments.length > 0,
                        () =>
                          onRunProjectRecipe
                            ? onRunProjectRecipe(
                                recipe.name,
                                verifyChangeId || undefined,
                              )
                            : Promise.resolve(),
                      )
                    }
                  >
                    <span>{recipe.name}</span>
                    <code>
                      {recipe.program} {recipe.args.join(" ")}
                    </code>
                  </button>
                ))}
              </div>
            </section>
          )}
          <form
            className="check-run-form"
            onSubmit={(event) => {
              event.preventDefault();
              void executeWithOptionalSave(false, () =>
                onRunCheck
                  ? onRunCheck(
                      program,
                      argsText.trim().split(/\s+/).filter(Boolean),
                      verifyChangeId || undefined,
                    )
                  : Promise.resolve(),
              );
            }}
          >
            <label>
              Executable{" "}
              <input
                value={program}
                onChange={(event) => setProgram(event.target.value)}
              />
            </label>
            <label>
              Arguments{" "}
              <input
                value={argsText}
                onChange={(event) => setArgsText(event.target.value)}
              />
            </label>
            {!workspaceTrusted ? (
              <button
                type="button"
                className="button button-quiet"
                disabled={pending || browserPreview}
                onClick={() => {
                  setError(undefined);
                  void onTrustWorkspace?.().catch((failure) =>
                    setError(
                      errorMessage(
                        failure,
                        "Project trust could not be saved.",
                      ),
                    ),
                  );
                }}
              >
                Trust project to run checks
              </button>
            ) : pending ? (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => void service.cancelCheck()}
              >
                Cancel check
              </button>
            ) : (
              <button
                className="button button-primary"
                disabled={pending || !program.trim()}
              >
                {dirtyDocuments.length > 0 ? "Run on saved disk" : "Run check"}
              </button>
            )}
          </form>
          <div
            className="verify-filters"
            aria-label="Filter verification records"
          >
            <label>
              Status{" "}
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as
                      | "all"
                      | "passed"
                      | "failed"
                      | "stale"
                      | "inconclusive"
                      | "other",
                  )
                }
              >
                <option value="all">All ({checks.length})</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="stale">Stale</option>
                <option value="inconclusive">Inconclusive</option>
                <option value="other">Cancelled / Timed out / Other</option>
              </select>
            </label>
            <button
              type="button"
              className="button button-quiet"
              disabled={filteredChecks.length === 0}
              onClick={() => {
                const report = filteredChecks
                  .slice(0, 20)
                  .map(
                    (c) =>
                      `## ${c.program} ${c.args.join(" ")} (${c.status})\nDigest: ${c.sourceDigest} · Exit: ${c.exitCode ?? "—"}\n\`\`\`\n${c.output.slice(0, 4000)}\n\`\`\``,
                  )
                  .join("\n\n");
                if (navigator.clipboard?.writeText) {
                  void navigator.clipboard
                    .writeText(report)
                    .catch(() => undefined);
                }
              }}
            >
              Copy report
            </button>
            {checks.length > 50 && onPruneExecutions && (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => void onPruneExecutions()}
              >
                Prune old ({checks.length} → 50)
              </button>
            )}
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <BehaviorComparisonPanel
            service={service}
            projectId={activeProject.id}
            checks={checks}
            changeId={verifyChangeId || undefined}
            requestedCandidateId={compareCandidateId}
            onJumpToExecution={(executionId) => {
              setHighlightedExecutionId(executionId);
              const el = document.getElementById(`execution-${executionId}`);
              el?.scrollIntoView({ behavior: "auto", block: "center" });
            }}
          />
          <div className="execution-list">
            {filteredChecks.map((check) => {
              const linkedChange = check.changeId
                ? changesById.get(check.changeId)
                : undefined;
              const durationMs =
                check.finishedAt !== null
                  ? Math.max(0, check.finishedAt - check.startedAt)
                  : null;
              return (
                <article
                  key={check.id}
                  id={`execution-${check.id}`}
                  className={
                    highlightedExecutionId === check.id
                      ? "is-highlighted-execution"
                      : undefined
                  }
                >
                  <div>
                    <div className="verify-record-header">
                      <span
                        className={`verify-status-pill verify-status-${check.status}`}
                      >
                        {executionStatusLabel(check.status)}
                      </span>
                      {checks.length >= 2 && (
                        <button
                          type="button"
                          className="button button-quiet"
                          onClick={() => setCompareCandidateId(check.id)}
                        >
                          Compare with previous
                        </button>
                      )}
                      <button
                        type="button"
                        className="button button-quiet"
                        disabled={!workspaceTrusted || pending}
                        onClick={() =>
                          void executeWithOptionalSave(
                            dirtyDocuments.length > 0,
                            () =>
                              onRunCheck
                                ? onRunCheck(
                                    check.program,
                                    check.args,
                                    check.changeId ?? undefined,
                                  )
                                : Promise.resolve(),
                          )
                        }
                      >
                        {dirtyDocuments.length > 0 ? "Save & rerun" : "Rerun"}
                      </button>
                      {check.status === "failed" &&
                        onAttachContextChipToRook && (
                          <button
                            type="button"
                            className="button button-quiet"
                            onClick={() =>
                              onAttachContextChipToRook(
                                {
                                  id: `verify-${check.id}`,
                                  kind: "verify_failure",
                                  label:
                                    `Verify failure · ${check.program} ${check.args.join(" ")}`.slice(
                                      0,
                                      64,
                                    ),
                                  content: formatFailureContextExcerpt(
                                    `${check.program} ${check.args.join(" ")}`,
                                    check.output,
                                    activeProject.path,
                                  ),
                                },
                                "ask",
                              )
                            }
                          >
                            Investigate in Rook ↗
                          </button>
                        )}
                    </div>
                    <strong>
                      {check.program} {check.args.join(" ")}
                    </strong>
                    <span>
                      Digest {check.sourceDigest.slice(0, 12)} · exit{" "}
                      {check.exitCode ?? "—"}
                      {durationMs !== null
                        ? ` · ${(durationMs / 1000).toFixed(1)}s`
                        : ""}
                    </span>
                    {linkedChange && (
                      <small>Change · {linkedChange.objective}</small>
                    )}
                    <small>
                      {new Date(check.startedAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </small>
                    {check.files.length > 0 && (
                      <details className="verify-manifest-details">
                        <summary>
                          Source manifest ({check.files.length} files)
                        </summary>
                        <ul>
                          {check.files.slice(0, 100).map((filePath) => (
                            <li key={filePath}>{filePath}</li>
                          ))}
                          {check.files.length > 100 && (
                            <li>…and {check.files.length - 100} more</li>
                          )}
                        </ul>
                      </details>
                    )}
                  </div>
                  <LinkedStackOutput
                    output={check.output}
                    projectPath={activeProject.path}
                    onJump={(relativePath, line, column) =>
                      onJumpToLocation?.(relativePath, line, column)
                    }
                  />
                </article>
              );
            })}
          </div>
          {filteredChecks.length === 0 && (
            <p>
              {checks.length === 0
                ? "No verification records yet."
                : "No verification records match the current filter."}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function sandboxSummary(sandbox: RookSandboxStatus | null): string {
  if (!sandbox) return "Sandbox policy active";
  if (!sandbox.enabled) return "Unsandboxed host opt-out";
  if (!sandbox.available) return "Sandbox unavailable · shell blocked";
  if (sandbox.runtime === "seatbelt") return "Seatbelt sandbox · network off";
  if (sandbox.runtime === "bwrap") return "Bubblewrap sandbox · network off";
  return "OS sandbox active · network off";
}

function RookScreen({
  service,
  activeProject,
  rookSession: session,
  rookMode,
  rookSandbox,
  rookTrustPromptPending,
  onRookModeChange,
  onRookTrustBuild,
  onRookDismissTrustPrompt,
  rookProviders: providers,
  rookProviderControlsAvailable: providerControlsAvailable,
  rookModels: models,
  rookCurrentModel: currentModel,
  rookPending,
  rookError,
  conversationError,
  rookMessages: messages,
  rookSessions: sessions,
  rookActiveSessionId: activeSessionId,
  rookSessionStorage: sessionStorage,
  onRookNewSession,
  onRookOpenSession,
  rookRunId: runId,
  rookCancelling = false,
  onRookCancellingChange,
  rookQueuedSteering = null,
  onRookQueuedSteeringChange,
  rookContextChips = [],
  onRemoveRookContextChip,
  onClearRookContextChips,
  onPreviewRookPatch,
  onPromoteRookToChange,
  documents,
  rookDraft: prompt,
  onRookDraftChange: setPrompt,
  onRookDraftSave,
  onRookMessagesChange: setMessages,
  onRookProvidersChange: setProviders,
  onRookModelsChange: setModels,
  onRookModelChange: setCurrentModel,
  onRookStart,
  browserPreview,
}: ScreenContentProps) {
  const [search, setSearch] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [setupModel, setSetupModel] = useState<RookModel>();
  const [authPrompt, setAuthPrompt] = useState<{
    id: string;
    prompt: RookAuthPrompt;
  }>();
  const [authEvent, setAuthEvent] = useState<RookAuthEvent>();
  const [authValue, setAuthValue] = useState("");
  const [activeLogin, setActiveLogin] = useState<string>();
  const [activeLoginProvider, setActiveLoginProvider] = useState<string>();
  const [permission, setPermission] = useState<{
    permissionId: string;
    request: Record<string, unknown>;
  }>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const availableModels = models;
  const modelGroups = [...providers]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((provider) => ({
      provider: provider.id,
      name: provider.name,
      models: availableModels
        .filter((model) => model.provider === provider.id)
        .filter((model) =>
          `${model.name} ${model.provider} ${model.id}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
    }))
    .filter((group) => group.models.length > 0);
  const selectedModelAvailable = Boolean(currentModel);

  useEffect(() => setError(conversationError), [conversationError]);
  useEffect(() => {
    shouldAutoScrollRef.current = true;
    setShowJumpToLatest(false);
    const element = conversationRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [activeSessionId, session]);
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    const element = conversationRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, runId]);

  function scrollToLatest() {
    shouldAutoScrollRef.current = true;
    setShowJumpToLatest(false);
    const element = conversationRef.current;
    if (element) {
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    }
  }

  function handleConversationScroll() {
    const element = conversationRef.current;
    if (!element) return;
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    const nearBottom = distanceFromBottom < 72;
    shouldAutoScrollRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }

  function submitPrompt(steeringMode?: "steer" | "queue") {
    const text = prompt.trim();
    if (!text) return;
    if (
      currentModel &&
      providers.find((provider) => provider.id === currentModel.provider)
        ?.configured === false
    ) {
      setSetupModel(currentModel);
      setModelPickerOpen(true);
      setError("Sign in to the selected model before sending.");
      return;
    }
    if (
      !session ||
      (!currentModel && providerControlsAvailable) ||
      !selectedModelAvailable
    ) {
      setError("Choose an available model before sending.");
      return;
    }
    const serializedContext = serializeRookContextChips(rookContextChips);
    if (runId && steeringMode) {
      onRookQueuedSteeringChange?.({
        text,
        mode: steeringMode,
        context: serializedContext,
      });
      setPrompt("");
      onClearRookContextChips?.();
      setError(undefined);
      if (steeringMode === "steer") {
        onRookCancellingChange?.(true);
        void service.cancelRookAsk(session, runId).catch((failure) => {
          onRookCancellingChange?.(false);
          setError(
            errorMessage(failure, "Could not stop current run to steer."),
          );
        });
      }
      return;
    }
    shouldAutoScrollRef.current = true;
    setShowJumpToLatest(false);
    setMessages((items) => [...items, { role: "user", text }]);
    setPrompt("");
    onClearRookContextChips?.();
    setError(undefined);
    const send = async () => {
      if (rookMode === "build" && activeProject?.isGitRepository) {
        await service
          .saveWorkspaceCheckpoint(activeProject.id, "Before Rook Build")
          .catch(() => undefined);
      }
      await service.promptRookAsk(
        session,
        text,
        serializedContext || undefined,
      );
    };
    void send().catch((failure) => {
      setMessages((items) =>
        items.at(-1)?.role === "user" ? items.slice(0, -1) : items,
      );
      setPrompt(text);
      setError(errorMessage(failure, "Your message could not be sent."));
    });
  }
  useEffect(() => {
    if (!modelPickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modelPickerOpen]);
  useEffect(() => {
    setPermission(undefined);
    setAuthPrompt(undefined);
    setAuthEvent(undefined);
    setAuthValue("");
    if (activeLoginProvider && activeLogin)
      void service
        .cancelRookLogin(session!, activeLogin)
        .catch(() => undefined);
    setActiveLogin(undefined);
    setActiveLoginProvider(undefined);
    setSetupModel(undefined);
    setModelPickerOpen(false);
  }, [session]);
  useEffect(() => {
    if (!session || browserPreview) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void service
      .listenRook((event) => {
        if (event.sessionId !== session) return;
        const params = event.message.params as
          | Record<string, unknown>
          | undefined;
        if (
          event.message.method === "session/request_permission" &&
          typeof event.message.id === "string" &&
          params?.request &&
          typeof params.request === "object"
        ) {
          setPermission({
            permissionId: event.message.id,
            request: params.request as Record<string, unknown>,
          });
        }
        if (
          event.message.method === "provider/auth_prompt" &&
          typeof event.message.id === "string" &&
          params?.prompt &&
          typeof params.prompt === "object"
        ) {
          setAuthPrompt({
            id: event.message.id,
            prompt: params.prompt as RookAuthPrompt,
          });
          setAuthValue("");
        }
        if (
          event.message.method === "provider/auth_event" &&
          typeof params?.loginId === "string"
        ) {
          const auth = params.event as RookAuthEvent;
          setAuthEvent({ ...auth, loginId: params.loginId });
          if (["auth_url", "device_code"].includes(String(auth?.type))) {
            const url = auth.url ?? auth.verificationUri;
            if (url && /^https?:\/\//i.test(url)) {
              void service
                .openRookAuthUrl(url)
                .catch((failure) =>
                  setError(
                    errorMessage(
                      failure,
                      "The sign-in browser could not be opened.",
                    ),
                  ),
                );
            }
          }
        }
        if (
          event.message.method === "workspace/providers_changed" &&
          Array.isArray(params?.providers)
        ) {
          setProviders(params.providers as RookProvider[]);
          if (Array.isArray(params.models)) {
            const updatedModels = params.models as RookModel[];
            setModels(updatedModels);
            if (currentModel) {
              setCurrentModel(
                updatedModels.find(
                  (model) =>
                    model.provider === currentModel.provider &&
                    model.id === currentModel.id,
                ) ?? currentModel,
              );
            }
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
  }, [
    browserPreview,
    service,
    session,
    setProviders,
    setModels,
    currentModel,
    setCurrentModel,
  ]);

  if (browserPreview || !activeProject) {
    return (
      <section className="content-page" aria-label="Rook Ask">
        <EmptyState
          title="Desktop project required"
          description="Rook is a native process scoped to an open workspace."
          label="Desktop only"
        />
      </section>
    );
  }

  return (
    <section className="content-page rook-page" aria-label="Rook Ask">
      {sessionStorage && (
        <aside className="rook-sessions" aria-label="Sessions">
          <header className="rook-sessions-heading">
            <h2>Sessions</h2>
            <button
              className="rook-new-session"
              type="button"
              aria-label={rookMode === "build" ? "New Build" : "New Ask"}
              title={rookMode === "build" ? "New Build" : "New Ask"}
              disabled={!session || pending || Boolean(runId)}
              onClick={onRookNewSession}
            >
              +
            </button>
          </header>
          <label className="rook-session-search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Search sessions"
              placeholder="Search sessions…"
              value={sessionSearch}
              onChange={(event) => setSessionSearch(event.currentTarget.value)}
            />
          </label>
          {groupRookSessions(sessions, sessionSearch).map((group) => (
            <div className="rook-session-group" key={group.label}>
              <h3>{group.label}</h3>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === activeSessionId ? "is-active" : ""}
                  aria-current={
                    item.id === activeSessionId ? "true" : undefined
                  }
                  disabled={!session || Boolean(runId)}
                  onClick={() => onRookOpenSession(item.id)}
                >
                  <span className="rook-session-title">
                    {rookSessionTitle(item)}
                  </span>
                  <time dateTime={item.modified}>
                    {group.label === "Older"
                      ? new Date(item.modified).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })
                      : new Date(item.modified).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                  </time>
                </button>
              ))}
            </div>
          ))}
        </aside>
      )}
      <div className="rook-chat">
        <header className="rook-chat-topbar">
          <div>
            <h2>
              {messages
                .find((message) => message.role === "user")
                ?.text.slice(0, 80) ??
                (rookMode === "build" ? "New Build" : "New Ask")}
            </h2>
            <p>
              {rookMode === "build"
                ? `${activeProject.name} · Edits this repository directly · ${sandboxSummary(rookSandbox)}`
                : `${activeProject.name} · Reads your project · won’t edit files`}
            </p>
          </div>
          <div className="rook-chat-actions">
            <div
              className="rook-mode-toggle"
              role="group"
              aria-label="Rook mode"
            >
              <button
                type="button"
                aria-pressed={rookMode === "ask"}
                className={rookMode === "ask" ? "is-active" : ""}
                disabled={rookPending || Boolean(runId)}
                onClick={() => onRookModeChange("ask")}
              >
                Ask
              </button>
              <button
                type="button"
                aria-pressed={rookMode === "build"}
                className={rookMode === "build" ? "is-active" : ""}
                disabled={rookPending || Boolean(runId)}
                onClick={() => onRookModeChange("build")}
              >
                Build
              </button>
            </div>
            {providerControlsAvailable && (
              <Dialog.Root
                open={modelPickerOpen}
                onOpenChange={(open) => {
                  if (!open && activeLogin) {
                    void service
                      .cancelRookLogin(session!, activeLogin)
                      .catch((failure) =>
                        setError(
                          errorMessage(failure, "Sign-in cancellation failed."),
                        ),
                      );
                    setActiveLogin(undefined);
                    setActiveLoginProvider(undefined);
                    setAuthPrompt(undefined);
                    setAuthValue("");
                  }
                  setModelPickerOpen(open);
                  if (open) {
                    setSearch("");
                    setSetupModel(undefined);
                  } else setSetupModel(undefined);
                }}
              >
                <Dialog.Trigger asChild>
                  <button
                    className="rook-model-trigger"
                    type="button"
                    disabled={!session}
                  >
                    <span>{currentModel?.name ?? "Choose a model"}</span>
                    <span aria-hidden="true">⌄</span>
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="palette-overlay" />
                  <Dialog.Content className="rook-model-dialog">
                    <header className="rook-model-heading">
                      <span className="rook-model-icon" aria-hidden="true">
                        ◇
                      </span>
                      <div>
                        <Dialog.Title>Select Model</Dialog.Title>
                        <Dialog.Description>
                          Choose the model to use in this workspace.
                        </Dialog.Description>
                      </div>
                      <Dialog.Close asChild>
                        <button
                          className="rook-model-close"
                          type="button"
                          aria-label="Close"
                        >
                          ×
                        </button>
                      </Dialog.Close>
                    </header>
                    <label className="rook-model-search">
                      <span aria-hidden="true">⌕</span>
                      <input
                        ref={searchInput}
                        aria-label="Search models"
                        placeholder="Search models…"
                        value={search}
                        onChange={(event) =>
                          setSearch(event.currentTarget.value)
                        }
                      />
                      <kbd>⌘K</kbd>
                    </label>
                    <div className="rook-model-list">
                      {modelGroups.map(
                        ({
                          provider: providerId,
                          name,
                          models: groupModels,
                        }) => (
                          <div className="rook-model-group" key={providerId}>
                            <h3>{name}</h3>
                            {groupModels.map((model) => {
                              const provider = providers.find(
                                (item) => item.id === model.provider,
                              );
                              const selected =
                                currentModel?.provider === model.provider &&
                                currentModel.id === model.id;
                              return (
                                <button
                                  key={`${model.provider}/${model.id}`}
                                  type="button"
                                  className={selected ? "is-selected" : ""}
                                  disabled={pending}
                                  onClick={() => {
                                    if (
                                      model.configured === false ||
                                      !provider?.configured
                                    ) {
                                      setSetupModel(model);
                                      return;
                                    }
                                    setPending(true);
                                    void service
                                      .selectRookModel(session!, model)
                                      .then((confirmed) => {
                                        setCurrentModel(confirmed);
                                        setError(undefined);
                                        setModelPickerOpen(false);
                                      })
                                      .catch((failure) =>
                                        setError(
                                          errorMessage(
                                            failure,
                                            "Model selection failed.",
                                          ),
                                        ),
                                      )
                                      .finally(() => setPending(false));
                                  }}
                                >
                                  <span>{model.name}</span>
                                  {selected ? (
                                    <span aria-label="Selected">✓</span>
                                  ) : model.configured === false ||
                                    !provider?.configured ? (
                                    <span>Set up</span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        ),
                      )}
                      {!models.length && (
                        <p>
                          No models are available. Configure a provider to get
                          started.
                        </p>
                      )}
                    </div>
                  </Dialog.Content>
                  {setupModel && (
                    <Dialog.Root
                      open
                      onOpenChange={(open) => {
                        if (!open) {
                          if (activeLogin) {
                            void service
                              .cancelRookLogin(session!, activeLogin)
                              .catch((failure) =>
                                setError(
                                  errorMessage(
                                    failure,
                                    "Sign-in cancellation failed.",
                                  ),
                                ),
                              );
                            setActiveLogin(undefined);
                            setActiveLoginProvider(undefined);
                            setAuthPrompt(undefined);
                            setAuthValue("");
                          }
                          setSetupModel(undefined);
                        }
                      }}
                    >
                      <Dialog.Portal>
                        <Dialog.Overlay className="palette-overlay rook-setup-overlay" />
                        <Dialog.Content className="rook-model-dialog rook-setup-dialog">
                          <header className="rook-model-heading">
                            <span
                              className="rook-model-icon"
                              aria-hidden="true"
                            >
                              ◇
                            </span>
                            <div>
                              <Dialog.Title>
                                Set up{" "}
                                {providers.find(
                                  (item) => item.id === setupModel.provider,
                                )?.name ?? setupModel.provider}
                              </Dialog.Title>
                              <Dialog.Description>
                                Sign in to use {setupModel.name}.
                              </Dialog.Description>
                            </div>
                          </header>
                          <p>
                            {providers.find(
                              (item) => item.id === setupModel.provider,
                            )?.missingEnvironmentVariables?.length
                              ? ` Set ${providers.find((item) => item.id === setupModel.provider)?.missingEnvironmentVariables?.join(", ")} in your environment first.`
                              : providers.find(
                                    (item) => item.id === setupModel.provider,
                                  )?.authMethods.length
                                ? " Choose a sign-in method below."
                                : " This provider has no interactive sign-in method. Configure its credentials in your environment, then reconnect."}
                          </p>
                          {providers.find(
                            (item) => item.id === setupModel.provider,
                          )?.configured === false &&
                            !providers.find(
                              (item) => item.id === setupModel.provider,
                            )?.missingEnvironmentVariables?.length &&
                            !providers.find(
                              (item) => item.id === setupModel.provider,
                            )?.authMethods.length && (
                              <p>
                                Credentials may be provided by your environment.
                                If this model is configured, choose it again to
                                continue.
                              </p>
                            )}
                          {providers
                            .find((item) => item.id === setupModel.provider)
                            ?.authMethods.map((method) => (
                              <button
                                key={method.type}
                                className="button button-quiet"
                                type="button"
                                disabled={Boolean(activeLogin)}
                                onClick={() => {
                                  const loginId = crypto
                                    .randomUUID()
                                    .replaceAll("-", "");
                                  setActiveLogin(loginId);
                                  setActiveLoginProvider(setupModel.provider);
                                  setAuthEvent(undefined);
                                  void service
                                    .loginRookProvider(
                                      session!,
                                      loginId,
                                      setupModel.provider,
                                      method.type,
                                    )
                                    .then(async (result) => {
                                      setProviders(result.providers);
                                      setModels(result.models);
                                      setCurrentModel(result.currentModel);
                                      if (
                                        result.providers.find(
                                          (provider) =>
                                            provider.id === setupModel.provider,
                                        )?.configured
                                      ) {
                                        const selected =
                                          await service.selectRookModel(
                                            session!,
                                            setupModel,
                                          );
                                        setCurrentModel(selected);
                                        setSetupModel(undefined);
                                        setModelPickerOpen(false);
                                      }
                                    })
                                    .catch((failure) =>
                                      setError(
                                        errorMessage(
                                          failure,
                                          "Sign-in failed.",
                                        ),
                                      ),
                                    )
                                    .finally(() => {
                                      setActiveLogin(undefined);
                                      setActiveLoginProvider(undefined);
                                      setAuthPrompt(undefined);
                                    });
                                }}
                              >
                                {method.loginLabel ?? method.name}
                              </button>
                            ))}
                          {activeLogin && (
                            <div className="rook-auth-status" role="status">
                              <span>Sign-in in progress</span>
                              <button
                                type="button"
                                onClick={() =>
                                  void service
                                    .cancelRookLogin(session!, activeLogin)
                                    .catch((failure) =>
                                      setError(
                                        errorMessage(
                                          failure,
                                          "Sign-in cancellation failed.",
                                        ),
                                      ),
                                    )
                                    .finally(() => {
                                      setActiveLogin(undefined);
                                      setActiveLoginProvider(undefined);
                                      setAuthPrompt(undefined);
                                      setAuthValue("");
                                    })
                                }
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                          {authEvent && (
                            <p className="rook-auth-event" aria-live="polite">
                              {authEvent.type === "device_code" ? (
                                <>
                                  Open {authEvent.verificationUri} and enter{" "}
                                  <strong>{authEvent.userCode}</strong>
                                </>
                              ) : (
                                (authEvent.message ??
                                authEvent.instructions ??
                                authEvent.url)
                              )}
                            </p>
                          )}
                          {authPrompt && (
                            <form
                              className="rook-auth-prompt"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void service
                                  .respondRookAuthPrompt(
                                    session!,
                                    authPrompt.id,
                                    authValue,
                                  )
                                  .then(() => {
                                    setAuthPrompt(undefined);
                                    setAuthValue("");
                                  })
                                  .catch((failure) =>
                                    setError(
                                      errorMessage(
                                        failure,
                                        "Sign-in response failed.",
                                      ),
                                    ),
                                  );
                              }}
                            >
                              <label htmlFor="rook-auth-input">
                                {authPrompt.prompt.message}
                              </label>
                              {authPrompt.prompt.type === "select" ? (
                                <select
                                  id="rook-auth-input"
                                  value={authValue}
                                  onChange={(event) =>
                                    setAuthValue(event.currentTarget.value)
                                  }
                                >
                                  <option value="">Choose…</option>
                                  {authPrompt.prompt.options?.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.label}
                                      {option.description
                                        ? ` — ${option.description}`
                                        : ""}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  id="rook-auth-input"
                                  placeholder={authPrompt.prompt.placeholder}
                                  type={
                                    authPrompt.prompt.type === "secret"
                                      ? "password"
                                      : "text"
                                  }
                                  autoComplete="off"
                                  value={authValue}
                                  onChange={(event) =>
                                    setAuthValue(event.currentTarget.value)
                                  }
                                />
                              )}
                              <button
                                className="button button-primary"
                                disabled={!authValue}
                              >
                                Continue
                              </button>
                            </form>
                          )}
                          <div className="rook-setup-actions">
                            <button
                              className="button button-quiet"
                              type="button"
                              disabled={Boolean(activeLogin)}
                              onClick={() => setSetupModel(undefined)}
                            >
                              Back to models
                            </button>
                          </div>
                        </Dialog.Content>
                      </Dialog.Portal>
                    </Dialog.Root>
                  )}
                </Dialog.Portal>
              </Dialog.Root>
            )}
          </div>
        </header>
        {rookPending && !session && (
          <p role="status">Connecting to Rook… your draft is safe here.</p>
        )}
        {rookError && !session && (
          <div className="rook-startup-error" role="alert">
            <p>{rookError}</p>
            <button
              className="button button-quiet"
              type="button"
              disabled={rookPending}
              onClick={onRookStart}
            >
              Retry connection
            </button>
          </div>
        )}
        {rookTrustPromptPending && (
          <div
            className="rook-trust-banner"
            role="region"
            aria-label="Trust project for Build"
          >
            <p>
              <strong>Trust {activeProject.name} to enable Build?</strong> Rook
              Build edits files and runs sandboxed commands directly in this
              repository.
            </p>
            <div className="rook-trust-banner-actions">
              <button
                className="button button-primary"
                type="button"
                disabled={rookPending}
                onClick={onRookTrustBuild}
              >
                Trust project &amp; switch to Build
              </button>
              <button
                className="button button-quiet"
                type="button"
                onClick={onRookDismissTrustPrompt}
              >
                Stay in Ask
              </button>
            </div>
          </div>
        )}
        <div
          className="rook-conversation"
          aria-live="polite"
          ref={conversationRef}
          onScroll={handleConversationScroll}
        >
          {messages.length === 0 && (
            <div className="rook-welcome">
              <span aria-hidden="true">✳</span>
              <h3>
                {rookMode === "build"
                  ? "What would you like to build?"
                  : "What would you like to know?"}
              </h3>
              <p>
                {rookMode === "build"
                  ? "Edit files and run checks directly in this repository."
                  : "Ask about code, architecture, or how this project works."}
              </p>
            </div>
          )}
          {messages.length > 0 &&
            messages.map((message, index) => {
              if (
                message.role === "assistant" &&
                !message.text &&
                !message.tools?.length &&
                message.runId !== runId
              )
                return null;
              return (
                <article
                  className={`rook-message rook-message-${message.role}`}
                  key={`${index}-${message.role}`}
                >
                  <div className="rook-message-head">
                    <strong>{message.role === "user" ? "You" : "Rook"}</strong>
                    {message.steered && (
                      <span className="status-pill">Steered · applied</span>
                    )}
                    {message.cancelled && (
                      <span className="verify-status-pill verify-status-cancelled">
                        Cancelled
                      </span>
                    )}
                  </div>
                  {message.tools?.map((tool) => (
                    <div
                      className={`rook-tool-activity rook-tool-${tool.status}`}
                      key={tool.id}
                    >
                      <span aria-hidden="true">
                        {tool.status === "running"
                          ? "◌"
                          : tool.status === "ok"
                            ? "✓"
                            : "!"}
                      </span>
                      <span>{tool.name.replaceAll("_", " ")}</span>
                      <span>{tool.summary}</span>
                      <span>
                        {tool.status === "running"
                          ? "Checking"
                          : tool.status === "ok"
                            ? "Done"
                            : "Failed"}
                      </span>
                    </div>
                  ))}
                  {message.text ? (
                    <p>{message.text}</p>
                  ) : message.role === "assistant" &&
                    message.runId === runId ? (
                    <p className="rook-thinking">
                      {rookCancelling ? "Stopping…" : "Thinking…"}
                    </p>
                  ) : null}
                  {message.role === "assistant" && message.incomplete && (
                    <p className="rook-incomplete" role="status">
                      Rook stopped before providing a final answer.
                    </p>
                  )}
                  {message.role === "assistant" &&
                    message.text &&
                    message.runId !== runId && (
                      <div className="rook-message-actions">
                        {(() => {
                          const code = extractFirstFencedCodeBlock(
                            message.text,
                          );
                          return code && onPreviewRookPatch ? (
                            <button
                              type="button"
                              className="button button-quiet"
                              onClick={() => onPreviewRookPatch(code)}
                            >
                              Preview patch in Editor
                            </button>
                          ) : null;
                        })()}
                        {onPromoteRookToChange &&
                          activeProject?.isGitRepository && (
                            <button
                              type="button"
                              className="button button-quiet"
                              onClick={() => onPromoteRookToChange("")}
                            >
                              {rookMode === "build"
                                ? "Review Rook edits ↗"
                                : "Open Review ↗"}
                            </button>
                          )}
                      </div>
                    )}
                </article>
              );
            })}
        </div>
        {showJumpToLatest && messages.length > 0 && (
          <button
            className="rook-scroll-latest"
            type="button"
            onClick={scrollToLatest}
          >
            ↓ Latest
          </button>
        )}
        {session && permission && (
          <RookPermissionCard
            request={permission.request}
            onRespond={(choice) =>
              void service
                .respondRookPermission(session, permission.permissionId, choice)
                .then(() => setPermission(undefined))
                .catch((failure) => setError(String(failure)))
            }
          />
        )}
        <form
          className="rook-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt(runId ? "steer" : undefined);
          }}
        >
          {rookContextChips.length > 0 && (
            <div className="rook-context-chips" aria-label="Attached context">
              {rookContextChips.map((chip) => {
                const liveDoc = chip.filePath
                  ? documents.find(
                      (doc) =>
                        doc.projectId === activeProject?.id &&
                        doc.path === chip.filePath,
                    )
                  : undefined;
                const isStale = Boolean(
                  liveDoc &&
                    chip.sourceSnapshot !== undefined &&
                    liveDoc.content !== chip.sourceSnapshot,
                );
                return (
                  <span
                    key={chip.id}
                    className={`rook-context-chip${isStale ? " is-stale" : ""}`}
                  >
                    <span>{chip.label}</span>
                    {isStale && (
                      <small title="Attached file was edited after attaching">
                        stale
                      </small>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${chip.label}`}
                      onClick={() => onRemoveRookContextChip?.(chip.id)}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          {(rookCancelling || rookQueuedSteering) && (
            <div className="rook-steering-status" role="status">
              <span>
                {rookQueuedSteering
                  ? rookQueuedSteering.mode === "steer"
                    ? "Steering received — stopping current run before applying…"
                    : "Follow-up queued — will send when current run settles…"
                  : "Cancelling current run…"}
              </span>
              {rookQueuedSteering && (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => onRookQueuedSteeringChange?.(null)}
                >
                  Clear
                </button>
              )}
            </div>
          )}
          {prompt.trim() && !session && !rookPending && !rookError && (
            <button
              className="rook-draft-action"
              type="button"
              onClick={onRookStart}
            >
              Connect to send your draft
            </button>
          )}
          <div className="rook-composer-row">
            <textarea
              id="rook-prompt"
              rows={1}
              aria-label={
                rookMode === "build"
                  ? "Instruct Rook Build for this project"
                  : "Ask about this project"
              }
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                onRookDraftSave(event.target.value);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  submitPrompt(runId ? "steer" : undefined);
                }
              }}
              maxLength={64000}
              placeholder={
                runId
                  ? "Type a steering note to Stop & steer, or Queue next…"
                  : rookMode === "build"
                    ? "Describe changes to make in this repository… (Enter to send)"
                    : "Message Rook… (Enter to send)"
              }
            />
            {session && runId ? (
              <div className="rook-composer-run-actions">
                {prompt.trim() && (
                  <>
                    <button
                      type="button"
                      className="button button-quiet"
                      title="Wait for current run to finish, then send"
                      onClick={() => submitPrompt("queue")}
                    >
                      Queue
                    </button>
                    <button
                      type="button"
                      className="button button-primary"
                      title="Cancel current run and apply steering note"
                      onClick={() => submitPrompt("steer")}
                    >
                      Stop &amp; steer
                    </button>
                  </>
                )}
                <button
                  className="rook-send-button rook-stop-button"
                  type="button"
                  aria-label="Stop Rook"
                  title={rookCancelling ? "Cancelling…" : "Stop"}
                  disabled={rookCancelling}
                  onClick={() => {
                    onRookCancellingChange?.(true);
                    void service.cancelRookAsk(session, runId).catch(() => {
                      onRookCancellingChange?.(false);
                    });
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="10" height="10" rx="2" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                className="rook-send-button"
                type="submit"
                aria-label={
                  rookMode === "build"
                    ? "Send to Rook Build"
                    : "Send to Rook Ask"
                }
                title="Send (Enter)"
                disabled={
                  !session ||
                  (!currentModel && providerControlsAvailable) ||
                  !selectedModelAvailable ||
                  !prompt.trim()
                }
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 13V3" />
                  <path d="M3.75 7.25 8 3l4.25 4.25" />
                </svg>
              </button>
            )}
          </div>
        </form>
        {!providerControlsAvailable && session && (
          <p className="rook-version-note" role="status">
            This Rook version doesn’t provide a model picker. Ask will use its
            current Rook model.
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {rookError && session && (
          <p className="inline-error" role="alert">
            {rookError}
          </p>
        )}
      </div>
    </section>
  );
}

function HomeScreen({
  onNavigate,
  activeProject,
  recentProjects,
  projectPending,
  onOpenProject,
  browserPreview,
}: ScreenContentProps) {
  return (
    <section className="home-page" aria-labelledby="screen-title">
      <div className="home-copy">
        <p className="eyebrow">A focused desktop workspace</p>
        <h1 id="screen-title">
          Code when you want.
          <br />
          Delegate when you need.
        </h1>
        <p className="home-intro">
          Understand, change, and verify software in one local-first workflow.
        </p>
        <div className="home-open-state">
          <span className="status-dot status-dot-muted" />
          <div>
            <strong>{activeProject?.name ?? "No project open"}</strong>
            <span>
              {activeProject
                ? activeProject.isGitRepository
                  ? "Git repository · local files only"
                  : "Folder open · not a Git repository"
                : "Opening a folder never runs project code."}
            </span>
          </div>
        </div>
        <p className="home-note">
          Laplace does not run package scripts, shells, or agent tools when a
          project is opened. Files remain available without trusting the
          project.
        </p>
        <div className="home-actions">
          <button
            className="button button-primary"
            type="button"
            disabled={projectPending || browserPreview}
            onClick={() => onOpenProject()}
          >
            {browserPreview
              ? "Open project · desktop app only"
              : projectPending
                ? "Opening…"
                : "Open project folder"}
            {!projectPending && !browserPreview && (
              <span aria-hidden="true">→</span>
            )}
          </button>
          <button
            className="button button-quiet"
            type="button"
            onClick={() => onNavigate("editor")}
          >
            {activeProject ? "Return to editor" : "View editor shell"}
          </button>
          <button
            className="button button-quiet"
            type="button"
            onClick={() => onNavigate("settings")}
          >
            Appearance settings
          </button>
        </div>
        {recentProjects.length > 0 && (
          <section className="recent-projects" aria-label="Recent projects">
            <p className="eyebrow">Recent folders · no tools run</p>
            {recentProjects.map((project) => (
              <button
                className="recent-project-item"
                key={project.id}
                type="button"
                disabled={projectPending}
                onClick={() => onOpenProject(project.path)}
              >
                <span className="project-avatar" aria-hidden="true">
                  {project.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.path}</small>
                </span>
              </button>
            ))}
          </section>
        )}
      </div>
      <div className="home-orbit" aria-hidden="true">
        <span className="orbit-ring orbit-ring-outer" />
        <span className="orbit-ring orbit-ring-middle" />
        <span className="orbit-ring orbit-ring-inner" />
        <span className="orbit-axis orbit-axis-one" />
        <span className="orbit-axis orbit-axis-two" />
        <span className="orbit-glyph">ℒ</span>
        <span className="orbit-caption">LOCAL · EXPLICIT · REVIEWABLE</span>
      </div>
    </section>
  );
}

function EditorScreen(props: ScreenContentProps) {
  const {
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
    activeEditorPane = "primary",
    onActiveEditorPaneChange,
    onToggleSplit,
    onSelectSplitDocument,
    onOpenQuickOpen,
    revealTarget,
    editorSelection,
    onEditorSelectionChange,
    inlinePatch,
    inlinePatchSaving = false,
    inlinePatchError,
    onOpenInlinePatch,
    onAcceptInlinePatch,
    onRejectInlinePatch,
    onPromoteInlinePatch,
    recoveredDraftNotice,
    onDismissRecoveredDraftNotice,
    bottomDrawerTab = "terminal",
    onBottomDrawerTabChange,
    editorGitStatus,
    onEditorGitStatusChange,
    onJumpToLocation,
    onAttachContextChipToRook,
    onPromoteEditsToChange,
    workspaceTrusted,
    onTrustWorkspace,
    onSelectDocument,
    onUpdateDocument,
    onSaveDocuments,
    onReloadDocument,
    onKeepDocumentEdits,
    onCloseDocument,
    onNavigate,
    executions = [],
    savingFiles,
    workspaceSyncVersion,
    lastSyncedAt,
    browserPreview,
  } = props;
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
    const bounded = Math.max(220, Math.min(480, width));
    draftWidthRef.current = bounded;
    setDraftWidth(bounded);
  };

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
              {!browserPreview && activeProject && onOpenQuickOpen && (
                <button
                  className="editor-save-button"
                  type="button"
                  title="Quick Open file (⌘P / Ctrl+P)"
                  onClick={onOpenQuickOpen}
                >
                  Quick open
                </button>
              )}
              {onToggleSplit && (
                <button
                  className={`editor-save-button${splitDocument ? " is-active" : ""}`}
                  type="button"
                  title="Toggle split editor (⌘\ / Ctrl+\)"
                  onClick={onToggleSplit}
                >
                  {splitDocument ? "Close split" : "Split"}
                </button>
              )}
            </div>
          ) : (
            <>
              <span className="eyebrow">Source workspace</span>
              {!browserPreview && activeProject && onOpenQuickOpen && (
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
              onClick={() => onDismissRecoveredDraftNotice?.()}
            >
              Dismiss
            </button>
          </div>
        )}
        {inlinePatch &&
        onAcceptInlinePatch &&
        onRejectInlinePatch &&
        onPromoteInlinePatch ? (
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
              onMouseDown={() => onActiveEditorPaneChange?.("primary")}
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
                  onFocus={() => onActiveEditorPaneChange?.("primary")}
                  onSelectionChange={(sel) =>
                    onEditorSelectionChange?.(
                      sel ? { path: activeDocument.path, ...sel } : null,
                    )
                  }
                  onCursorChange={(cur) =>
                    props.onEditorCursorChange?.({
                      path: activeDocument.path,
                      ...cur,
                    })
                  }
                  onDiagnosticsChange={(diags) =>
                    props.onEditorDiagnosticsChange?.(diags)
                  }
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
                onMouseDown={() => onActiveEditorPaneChange?.("secondary")}
              >
                <div className="editor-split-header">
                  <select
                    aria-label="Split pane file"
                    value={splitDocument.key}
                    onChange={(event) =>
                      onSelectSplitDocument?.(event.target.value)
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
                    onFocus={() => onActiveEditorPaneChange?.("secondary")}
                    onSelectionChange={(sel) =>
                      onEditorSelectionChange?.(
                        sel ? { path: splitDocument.path, ...sel } : null,
                      )
                    }
                    onCursorChange={(cur) =>
                      props.onEditorCursorChange?.({
                        path: splitDocument.path,
                        ...cur,
                      })
                    }
                    onDiagnosticsChange={(diags) =>
                      props.onEditorDiagnosticsChange?.(diags)
                    }
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
                    ? "Open a UTF-8 text file to edit it. Changes are saved only when you choose Save."
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
            projectId={activeProject.id}
            projectPath={activeProject.path}
            tab={bottomDrawerTab}
            onTabChange={(next) => onBottomDrawerTabChange?.(next)}
            workspaceTrusted={workspaceTrusted}
            onTrustWorkspace={onTrustWorkspace}
            gitStatus={editorGitStatus}
            onGitStatusChange={(next) => onEditorGitStatusChange?.(next)}
            executions={executions.filter(
              (item) => item.projectId === activeProject.id,
            )}
            syncVersion={workspaceSyncVersion}
            onOpenVerify={() => onNavigate("verify")}
            onOpenFile={(path) => onOpenProjectFile(path)}
            onJumpToLocation={(relativePath, line, column) =>
              onJumpToLocation?.(relativePath, line, column)
            }
            onInvestigateInRook={(chip) =>
              onAttachContextChipToRook?.(chip, "ask")
            }
            onContinueAsChange={onPromoteEditsToChange}
            browserPreview={browserPreview}
          />
        )}
      </div>
      {!preferences.inspectorCollapsed && (
        <div
          className="inspector-separator"
          role="separator"
          aria-label="Resize editor inspector"
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={480}
          aria-valuenow={draftWidth}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const delta = event.key === "ArrowLeft" ? 16 : -16;
              const width = Math.max(220, Math.min(480, draftWidth + delta));
              changeWidth(width);
              void onPreferencesChange({
                ...preferences,
                inspectorWidth: width,
              });
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const width = event.key === "Home" ? 220 : 480;
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
            if (drag.current)
              changeWidth(drag.current.width + drag.current.x - event.clientX);
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
        <EditorContextInspector
          service={service}
          browserPreview={browserPreview}
          activeProject={activeProject}
          activeDocument={focusedDocument}
          selection={editorSelection}
          cursor={props.editorCursor}
          diagnostics={props.editorDiagnostics}
          gitStatus={editorGitStatus}
          executions={executions.filter(
            (item) => item.projectId === activeProject?.id,
          )}
          syncVersion={workspaceSyncVersion}
          returnAnchor={props.returnSourceAnchor}
          onReturnToAnchor={() => props.onReturnToSourceAnchor?.()}
          onAttachToRook={(chip, mode) =>
            onAttachContextChipToRook?.(chip, mode)
          }
          onOpenInlinePatch={(doc) => onOpenInlinePatch?.(doc)}
          onOpenFileInReview={(relativePath) =>
            props.onOpenWorkspaceReview?.([relativePath], "head")
          }
          onOpenVerify={() => props.onNavigate("verify")}
          onJumpToLocation={(relativePath, line, column, recordAnchor) =>
            onJumpToLocation?.(relativePath, line, column, recordAnchor)
          }
          onExpandToContextLens={(focusPath) =>
            props.onExpandToContextLens?.(focusPath)
          }
          onHide={() =>
            void onPreferencesChange({
              ...preferences,
              inspectorCollapsed: true,
            })
          }
        />
      ) : (
        <button
          className="show-inspector-button"
          type="button"
          onClick={() =>
            void onPreferencesChange({
              ...preferences,
              inspectorCollapsed: false,
            })
          }
        >
          Show context
        </button>
      )}
    </section>
  );
}

function WorkspaceTools({
  service,
  projectId,
  projectPath,
  tab,
  onTabChange,
  workspaceTrusted,
  onTrustWorkspace,
  gitStatus,
  onGitStatusChange,
  executions,
  syncVersion,
  onOpenVerify,
  onOpenFile,
  onJumpToLocation,
  onInvestigateInRook,
  onContinueAsChange,
  browserPreview,
}: {
  service: AppService;
  projectId: string;
  projectPath: string;
  tab: "terminal" | "run" | "git";
  onTabChange: (next: "terminal" | "run" | "git") => void;
  workspaceTrusted: boolean;
  onTrustWorkspace?: () => Promise<void>;
  gitStatus?: GitStatus;
  onGitStatusChange: (status: GitStatus) => void;
  executions: ExecutionRecord[];
  syncVersion: number;
  onOpenVerify: () => void;
  onOpenFile: (relativePath: string) => void;
  onJumpToLocation: (
    relativePath: string,
    line: number,
    column?: number,
  ) => void;
  onInvestigateInRook: (chip: RookContextChip) => void;
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
  }, [projectId]);

  useEffect(() => {
    if (browserPreview || tab !== "git") return;
    void service
      .gitStatus(projectId)
      .then(onGitStatusChange)
      .catch(() => undefined);
  }, [browserPreview, onGitStatusChange, projectId, service, tab]);

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
            className="workspace-tools-verify-link"
            onClick={onOpenVerify}
          >
            Verify
          </button>
        </div>
      </div>
      <div className={tab === "terminal" ? "" : "is-hidden"}>
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
              workspaceId={projectId}
              browserPreview={browserPreview}
              trusted={workspaceTrusted && terminalActive}
              onTrust={async () => {
                if (!workspaceTrusted) {
                  await (onTrustWorkspace
                    ? onTrustWorkspace()
                    : service.trustWorkspace(projectId));
                }
                setTerminalActive(true);
              }}
            />
            {workspaceTrusted && (
              <button
                type="button"
                className="button button-quiet"
                onClick={() =>
                  void service.untrustWorkspace(projectId).then(() => {
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
      <div className={tab === "run" ? "" : "is-hidden"}>
        <RunPanel
          service={service}
          projectId={projectId}
          projectPath={projectPath}
          workspaceTrusted={workspaceTrusted}
          browserPreview={browserPreview}
          onTrustWorkspace={async () => {
            await (onTrustWorkspace
              ? onTrustWorkspace()
              : service.trustWorkspace(projectId));
          }}
          onJumpToLocation={onJumpToLocation}
          onInvestigateInRook={onInvestigateInRook}
        />
      </div>
      {tab === "git" &&
        (browserPreview ? (
          <p role="status">Git access requires the native desktop app.</p>
        ) : (
          <GitPanel
            service={service}
            projectId={projectId}
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
        ))}
    </section>
  );
}

function SettingsScreen(props: ScreenContentProps) {
  const { preferences, onPreferencesChange } = props;
  return (
    <section
      className="content-page settings-page"
      aria-labelledby="screen-title"
    >
      <PageHeading eyebrow="Workspace preferences" title="Settings" />
      <div className="settings-layout">
        <nav className="settings-menu" aria-label="Settings sections">
          <a className="settings-menu-active" href="#appearance">
            Appearance
          </a>
          <a href="#layout">Layout</a>
          <a href="#native-check">Native connection</a>
          {props.rookDevSettings?.enabled && <a href="#developer">Developer</a>}
        </nav>
        <div className="settings-content">
          <section
            className="settings-group"
            id="appearance"
            aria-labelledby="appearance-title"
          >
            <h2 id="appearance-title">Appearance</h2>
            <p>
              Quiet contrast and readable density for long sessions in the
              editor and review surfaces.
            </p>
            <PreferenceRow
              title="Color treatment"
              description="Choose the graphite palette or its daylight counterpart."
            >
              <div
                className="segmented-control"
                role="radiogroup"
                aria-label="Color treatment"
              >
                {(["dark", "light"] as const).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    role="radio"
                    aria-checked={preferences.theme === theme}
                    className={
                      preferences.theme === theme ? "segment-active" : ""
                    }
                    disabled={props.savingPreferences}
                    onClick={() =>
                      void onPreferencesChange({ ...preferences, theme })
                    }
                  >
                    {theme === "dark" ? "Dark" : "Light"}
                  </button>
                ))}
              </div>
            </PreferenceRow>
            <PreferenceRow
              title="Interface density"
              description="Comfortable spacing or a more compact workspace."
            >
              <div
                className="segmented-control"
                role="radiogroup"
                aria-label="Interface density"
              >
                {(["comfortable", "compact"] as const).map((density) => (
                  <button
                    key={density}
                    type="button"
                    role="radio"
                    aria-checked={preferences.density === density}
                    className={
                      preferences.density === density ? "segment-active" : ""
                    }
                    disabled={props.savingPreferences}
                    onClick={() =>
                      void onPreferencesChange({ ...preferences, density })
                    }
                  >
                    {density === "comfortable" ? "Comfortable" : "Compact"}
                  </button>
                ))}
              </div>
            </PreferenceRow>
            <PreferenceRow
              title="Editor font size"
              description="Applied to source and engineering details."
            >
              <label className="select-label">
                <span className="visually-hidden">Editor font size</span>
                <select
                  value={preferences.editorFontSize}
                  disabled={props.savingPreferences}
                  onChange={(event) =>
                    void onPreferencesChange({
                      ...preferences,
                      editorFontSize: Number(event.currentTarget.value),
                    })
                  }
                >
                  {[11, 12, 13, 14, 15, 16].map((size) => (
                    <option key={size} value={size}>
                      {size} px
                    </option>
                  ))}
                </select>
              </label>
            </PreferenceRow>
            <div className="preference-preview" aria-label="Appearance preview">
              <span className="eyebrow">Preview</span>
              <h3>Quietly capable.</h3>
              <code>
                <span>const</span> workspace = <em>"thoughtful"</em>;
              </code>
            </div>
          </section>
          {props.rookDevSettings?.enabled && (
            <section
              className="settings-group"
              id="developer"
              aria-labelledby="developer-title"
            >
              <h2 id="developer-title">Developer</h2>
              <p>
                Use a local Rook source checkout for Tauri development. This
                setting is unavailable in release builds. Rebuild Rook with
                <code>pnpm build</code> after changing its source.
              </p>
              <PreferenceRow
                title="Rook checkout"
                description={
                  props.rookDevSettings.checkoutPath ??
                  "No local Rook checkout selected."
                }
              >
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={props.onChooseRookCheckout}
                >
                  Choose checkout
                </button>
              </PreferenceRow>
              {props.rookDevSettings.checkoutPath && (
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={props.onClearRookCheckout}
                >
                  Clear checkout
                </button>
              )}
              {props.rookDevError && (
                <p className="inline-error" role="alert">
                  {props.rookDevError}
                </p>
              )}
            </section>
          )}

          <section
            className="settings-group"
            id="layout"
            aria-labelledby="layout-title"
          >
            <h2 id="layout-title">Layout</h2>
            <p>
              Navigation and inspector choices are saved by Laplace and restored
              on the next launch.
            </p>
            <PreferenceRow
              title="Navigation rail"
              description="Collapse labels to make more room for the current view."
            >
              <button
                type="button"
                className="button button-quiet"
                aria-pressed={preferences.navigationCollapsed}
                disabled={props.savingPreferences}
                onClick={() =>
                  void onPreferencesChange({
                    ...preferences,
                    navigationCollapsed: !preferences.navigationCollapsed,
                  })
                }
              >
                {preferences.navigationCollapsed ? "Collapsed" : "Expanded"}
              </button>
            </PreferenceRow>
            <PreferenceRow
              title="Editor inspector"
              description="Keep source context beside the Editor when it becomes available."
            >
              <button
                type="button"
                className="button button-quiet"
                aria-pressed={preferences.inspectorCollapsed}
                disabled={props.savingPreferences}
                onClick={() =>
                  void onPreferencesChange({
                    ...preferences,
                    inspectorCollapsed: !preferences.inspectorCollapsed,
                  })
                }
              >
                {preferences.inspectorCollapsed ? "Hidden" : "Shown"}
              </button>
            </PreferenceRow>
            <PreferenceRow
              title="Inspector width"
              description="Resize the Editor context pane with its divider or arrow keys."
            >
              <span className="mono-value">
                {preferences.inspectorWidth} px
              </span>
            </PreferenceRow>
          </section>

          <section
            className="settings-group"
            id="native-check"
            aria-labelledby="native-title"
          >
            <h2 id="native-title">Native connection</h2>
            <p>
              {props.browserPreview
                ? "Native IPC and project/filesystem access are unavailable in this browser preview. Open Laplace as a desktop app to use them."
                : "The command/event smoke test runs only when requested. It does not open a project or start a tool."}
            </p>
            <div className="native-check-row">
              <button
                className="button button-primary"
                type="button"
                disabled={props.nativePending || props.browserPreview}
                onClick={props.onTestNative}
              >
                {props.browserPreview
                  ? "Unavailable in browser preview"
                  : props.nativePending
                    ? "Checking…"
                    : "Test native connection"}
              </button>
              <span role="status" aria-live="polite">
                {props.browserPreview
                  ? "No native commands are sent from this page."
                  : (props.nativeResult ??
                    (props.nativePending
                      ? "Waiting for native response…"
                      : "Not tested this session"))}
              </span>
            </div>
            {props.nativeEvent && (
              <p className="event-confirmation" data-testid="native-event">
                Event {props.nativeEvent.kind} · operation{" "}
                {props.nativeEvent.operationId}
              </p>
            )}
            {props.nativeError && (
              <p className="inline-error" role="alert">
                {props.nativeError.message} ({props.nativeError.code})
              </p>
            )}
          </section>
        </div>
      </div>
      {props.savingPreferences && (
        <span className="save-indicator" role="status">
          Saving preferences…
        </span>
      )}
    </section>
  );
}

function PreferenceRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="preference-row">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <div className="preference-control">{children}</div>
    </div>
  );
}

function PageHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="page-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="screen-title">{title}</h1>
    </header>
  );
}

function EmptyState({
  title,
  description,
  label,
}: {
  title: string;
  description: string;
  label: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-index">{label}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
