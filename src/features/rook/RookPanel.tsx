import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { AppService } from "../../services/app-service";
import type {
  RookAuthEvent,
  RookAuthPrompt,
  RookMode,
  RookModel,
  RookSandboxStatus,
  RookSessionSummary,
} from "../../services/contracts";
import { useRookStore } from "../../state/rook-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import {
  formatFailureContextExcerpt,
  serializeRookContextChips,
} from "../runs/stack-trace";
import { RookMarkdown } from "./RookMarkdown";
import { RookPermissionCard } from "./RookPermissionCard";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string") return message;
  }
  return fallback;
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

function sandboxSummary(sandbox: RookSandboxStatus | null): string {
  if (!sandbox) return "Sandbox policy active";
  if (!sandbox.enabled) return "Unsandboxed host opt-out";
  if (!sandbox.available) return "Sandbox unavailable · shell blocked";
  if (sandbox.runtime === "seatbelt") return "Seatbelt sandbox · network off";
  if (sandbox.runtime === "bwrap") return "Bubblewrap sandbox · network off";
  return "OS sandbox active · network off";
}

export function RookPanel({
  service,
  variant,
  browserPreview,
  focusNonce = 0,
  onRookModeChange,
  onRookTrustBuild,
  onRookDismissTrustPrompt,
  onRookNewSession,
  onRookOpenSession,
  onRookStart,
  onRookDraftSave,
  onPreviewRookPatch,
  onJumpToLocation,
  onOpenReview,
  onOpenVerify,
  onUndoTurn,
  onToggleExpand,
  onRookBuildTargetChange,
  onApplyWorktree,
  onDiscardWorktree,
}: {
  service: AppService;
  variant: "docked" | "expanded";
  browserPreview: boolean;
  focusNonce?: number;
  onRookModeChange: (mode: RookMode) => void;
  onRookTrustBuild: () => void;
  onRookDismissTrustPrompt: () => void;
  onRookNewSession: () => void;
  onRookOpenSession: (id: string) => void;
  onRookStart: () => void;
  onRookDraftSave: (draft: string) => void;
  onPreviewRookPatch?: (code: string) => void;
  onJumpToLocation?: (
    relativePath: string,
    line: number,
    column?: number,
  ) => void;
  onOpenReview?: (
    selectedPaths?: string[],
    baseline?: "head" | "last_review",
  ) => void;
  onOpenVerify?: () => void;
  onUndoTurn?: (messageIndex: number, touchedFiles: string[]) => Promise<void>;
  onToggleExpand?: () => void;
  onRookBuildTargetChange?: (
    target: "direct" | "worktree",
  ) => Promise<void> | void;
  onApplyWorktree?: () => Promise<void>;
  onDiscardWorktree?: () => Promise<void>;
}) {
  const activeProject = useWorkspaceStore((s) => s.activeProject);
  const documents = useWorkspaceStore((s) => s.documents);
  const workspaceTrusted = useWorkspaceStore((s) => s.workspaceTrusted);
  const executions = useWorkspaceStore((s) => s.executions);
  const projectRecipes = useWorkspaceStore((s) => s.projectRecipes);
  const setExecutions = useWorkspaceStore((s) => s.setExecutions);

  const session = useRookStore((s) => s.session);
  const rookMode = useRookStore((s) => s.mode);
  const rookSandbox = useRookStore((s) => s.sandbox);
  const rookTrustPromptPending = useRookStore((s) => s.trustPromptPending);
  const planFirst = useRookStore((s) => s.planFirst);
  const autoVerifyAfterBuild = useRookStore((s) => s.autoVerifyAfterBuild);
  const buildTarget = useRookStore((s) => s.buildTarget);
  const activeWorktree = useRookStore((s) => s.activeWorktree);
  const worktreeSnapshot = useRookStore((s) => s.worktreeSnapshot);
  const providers = useRookStore((s) => s.providers);
  const providerControlsAvailable = useRookStore(
    (s) => s.providerControlsAvailable,
  );
  const models = useRookStore((s) => s.models);
  const currentModel = useRookStore((s) => s.currentModel);
  const rookPending = useRookStore((s) => s.startupPending);
  const rookStartupError = useRookStore((s) => s.startupError);
  const conversationError = useRookStore((s) => s.error);
  const messages = useRookStore((s) => s.messages);
  const sessions = useRookStore((s) => s.sessions);
  const activeSessionId = useRookStore((s) => s.activeSessionId);
  const sessionStorage = useRookStore((s) => s.sessionStorage);
  const runId = useRookStore((s) => s.runId);
  const rookCancelling = useRookStore((s) => s.cancelling);
  const rookQueuedSteering = useRookStore((s) => s.queuedSteering);
  const rookContextChips = useRookStore((s) => s.contextChips);
  const prompt = useRookStore((s) => s.draft);

  const setPrompt = useRookStore((s) => s.setDraft);
  const setMessages = useRookStore((s) => s.setMessages);
  const setProviders = useRookStore((s) => s.setProviders);
  const setModels = useRookStore((s) => s.setModels);
  const setCurrentModel = useRookStore((s) => s.setCurrentModel);
  const setCancelling = useRookStore((s) => s.setCancelling);
  const setQueuedSteering = useRookStore((s) => s.setQueuedSteering);
  const removeContextChip = useRookStore((s) => s.removeContextChip);
  const clearContextChips = useRookStore((s) => s.clearContextChips);
  const setPermissionPending = useRookStore((s) => s.setPermissionPending);
  const setPlanFirst = useRookStore((s) => s.setPlanFirst);
  const setAutoVerifyAfterBuild = useRookStore(
    (s) => s.setAutoVerifyAfterBuild,
  );
  const setPendingPlanTurn = useRookStore((s) => s.setPendingPlanTurn);
  const setWorktreeSnapshot = useRookStore((s) => s.setWorktreeSnapshot);

  const [worktreeCompareOpen, setWorktreeCompareOpen] = useState(false);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [selectedComparePath, setSelectedComparePath] = useState<string>();

  const [runningVerifyTurn, setRunningVerifyTurn] = useState<number | null>(
    null,
  );
  const [verifyFeedback, setVerifyFeedback] = useState<string>();

  const [search, setSearch] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
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
  const [undoingTurnIndex, setUndoingTurnIndex] = useState<number | null>(null);

  const modelGroups = [...providers]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((provider) => ({
      provider: provider.id,
      name: provider.name,
      models: models
        .filter((model) => model.provider === provider.id)
        .filter((model) =>
          `${model.name} ${model.provider} ${model.id}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
    }))
    .filter((group) => group.models.length > 0);
  const selectedModelAvailable = Boolean(currentModel);

  useEffect(() => {
    if (focusNonce > 0) {
      promptRef.current?.focus();
    }
  }, [focusNonce]);

  useEffect(() => setError(conversationError), [conversationError]);
  useEffect(() => {
    setPermissionPending(Boolean(permission));
  }, [permission, setPermissionPending]);

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

  function dispatchRookPrompt(
    userDisplayText: string,
    payloadText: string,
    serializedContext: string,
    options?: { isPlanOnly?: boolean; restoreDraftOnFail?: boolean },
  ) {
    if (!session) return;
    shouldAutoScrollRef.current = true;
    setShowJumpToLatest(false);
    setMessages((items) => [...items, { role: "user", text: userDisplayText }]);
    if (options?.isPlanOnly) {
      setPendingPlanTurn({
        prompt: userDisplayText,
        context: serializedContext,
      });
    } else {
      setPendingPlanTurn(null);
    }
    setError(undefined);
    const send = async () => {
      if (
        rookMode === "build" &&
        !options?.isPlanOnly &&
        activeProject?.isGitRepository
      ) {
        await service
          .saveWorkspaceCheckpoint(activeProject.id, "Before Rook Build")
          .catch(() => undefined);
      }
      await service.promptRookAsk(
        session,
        payloadText,
        serializedContext || undefined,
      );
    };
    void send().catch((failure) => {
      setPendingPlanTurn(null);
      setMessages((items) =>
        items.at(-1)?.role === "user" ? items.slice(0, -1) : items,
      );
      if (options?.restoreDraftOnFail) {
        setPrompt(userDisplayText);
      }
      setError(errorMessage(failure, "Your message could not be sent."));
    });
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
      setQueuedSteering({
        text,
        mode: steeringMode,
        context: serializedContext,
      });
      setPrompt("");
      clearContextChips();
      setError(undefined);
      if (steeringMode === "steer") {
        setCancelling(true);
        void service.cancelRookAsk(session, runId).catch((failure) => {
          setCancelling(false);
          setError(
            errorMessage(failure, "Could not stop current run to steer."),
          );
        });
      }
      return;
    }
    setPrompt("");
    clearContextChips();
    const isPlanOnly = rookMode === "build" && planFirst;
    const payloadText = isPlanOnly
      ? [
          "[PLAN FIRST — DO NOT EDIT FILES YET]",
          "Inspect the workspace read-only and respond with a concise implementation plan:",
          "1. Target files to edit",
          "2. Planned behavior & data changes",
          "3. Recommended checks to run",
          "Do not modify files in this turn.",
          "",
          `Request:\n${text}`,
        ].join("\n")
      : text;
    dispatchRookPrompt(text, payloadText, serializedContext, {
      isPlanOnly,
      restoreDraftOnFail: true,
    });
  }

  async function runTurnVerifyCheck(turnIndex: number) {
    if (!activeProject || !workspaceTrusted) return;
    const recipe = projectRecipes[0];
    setRunningVerifyTurn(turnIndex);
    setVerifyFeedback(undefined);
    try {
      const execution = recipe
        ? await service.runProjectRecipe(
            activeProject.id,
            recipe.name,
            activeWorktree?.changeId,
            activeWorktree?.path,
          )
        : await service.runCheck(activeProject.id, "pnpm", ["test"]);
      setExecutions((items) => [execution, ...items]);
      setVerifyFeedback(
        execution.status === "passed"
          ? `${execution.program} ${execution.args.join(" ")} passed`
          : `${execution.program} ${execution.args.join(" ")}: ${execution.status}`,
      );
    } catch (failure) {
      setVerifyFeedback(
        errorMessage(failure, "Verification check could not start."),
      );
    } finally {
      setRunningVerifyTurn(null);
    }
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
    if (activeLoginProvider && activeLogin && session) {
      void service.cancelRookLogin(session, activeLogin).catch(() => undefined);
    }
    setActiveLogin(undefined);
    setActiveLoginProvider(undefined);
    setSetupModel(undefined);
    setModelPickerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          setProviders(params.providers as typeof providers);
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
      <div className="rook-panel-empty">
        <p className="inspector-muted">
          Rook requires the desktop app and an open project.
        </p>
      </div>
    );
  }

  return (
    <section
      className={`rook-panel rook-panel-${variant}`}
      aria-label="Rook co-pilot"
    >
      {variant === "expanded" && sessionStorage && (
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
          <div className="rook-chat-meta">
            {variant === "expanded" ? (
              <>
                <h2>
                  {messages
                    .find((message) => message.role === "user")
                    ?.text.slice(0, 80) ??
                    (rookMode === "build" ? "New Build" : "New Ask")}
                </h2>
                <p>
                  {rookMode === "build"
                    ? `${activeProject.name} · Edits directly · ${sandboxSummary(rookSandbox)}`
                    : `${activeProject.name} · Read-only · won’t edit files`}
                </p>
              </>
            ) : (
              <div className="rook-docked-controls">
                {sessionStorage && (
                  <>
                    <select
                      aria-label="Rook session"
                      className="rook-session-select"
                      value={activeSessionId ?? ""}
                      disabled={!session || Boolean(runId)}
                      onChange={(event) => {
                        if (event.currentTarget.value) {
                          onRookOpenSession(event.currentTarget.value);
                        }
                      }}
                    >
                      {sessions.length === 0 && (
                        <option value="">
                          {rookMode === "build" ? "New Build" : "New Ask"}
                        </option>
                      )}
                      {sessions.slice(0, 25).map((item) => (
                        <option key={item.id} value={item.id}>
                          {rookSessionTitle(item).slice(0, 38)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={
                        rookMode === "build" ? "New Build" : "New Ask"
                      }
                      title="New Rook session"
                      disabled={!session || pending || Boolean(runId)}
                      onClick={onRookNewSession}
                    >
                      +
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="rook-docked-topbar-right">
            {variant === "docked" && rookMode === "build" && (
              <span
                className="rook-build-badge"
                title={sandboxSummary(rookSandbox)}
              >
                <span className="rook-build-badge-dot" aria-hidden="true" />
                Build
              </span>
            )}
            {onToggleExpand && (
              <button
                type="button"
                className="icon-button"
                aria-label={
                  variant === "expanded"
                    ? "Dock Rook panel"
                    : "Expand Rook panel"
                }
                title={
                  variant === "expanded"
                    ? "Dock to right panel (⌘⇧R)"
                    : "Expand full-width focus view (⌘⇧R)"
                }
                onClick={onToggleExpand}
              >
                {variant === "expanded" ? "⤡" : "⤢"}
              </button>
            )}
          </div>
        </header>

        {rookPending && !session && (
          <p className="rook-status-note" role="status">
            Connecting to Rook… your draft is safe here.
          </p>
        )}
        {rookStartupError && !session && (
          <div className="rook-startup-error" role="alert">
            <p>{rookStartupError}</p>
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
                Trust &amp; switch to Build
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

        {activeWorktree && (
          <div
            className="rook-worktree-banner"
            role="region"
            aria-label="Isolated candidate worktree"
          >
            <div className="rook-worktree-banner-info">
              <span className="status-pill">
                Worktree · {activeWorktree.branch}
              </span>
              <span className="rook-worktree-count">
                {worktreeSnapshot
                  ? `${worktreeSnapshot.files.length} changed`
                  : "Isolated sandbox"}
              </span>
              {worktreeSnapshot && worktreeSnapshot.conflictCount > 0 && (
                <span className="verify-status-pill verify-status-failed">
                  {worktreeSnapshot.conflictCount} conflict
                </span>
              )}
            </div>
            <div className="rook-worktree-banner-actions">
              <button
                type="button"
                className="button button-quiet"
                disabled={worktreeBusy}
                onClick={async () => {
                  setWorktreeBusy(true);
                  try {
                    const snap = await service.inspectWorktreeExperiment(
                      activeProject.id,
                      activeWorktree.path,
                    );
                    setWorktreeSnapshot(snap);
                    setSelectedComparePath(snap.files[0]?.path);
                    setWorktreeCompareOpen(true);
                  } catch (failure) {
                    setError(
                      errorMessage(
                        failure,
                        "Candidate worktree changes could not be inspected.",
                      ),
                    );
                  } finally {
                    setWorktreeBusy(false);
                  }
                }}
              >
                Compare
              </button>
              {projectRecipes[0] && (
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={worktreeBusy || Boolean(runId)}
                  onClick={() => void runTurnVerifyCheck(messages.length)}
                >
                  Verify
                </button>
              )}
              {onApplyWorktree && (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={
                    worktreeBusy ||
                    Boolean(runId) ||
                    (worktreeSnapshot !== null &&
                      worktreeSnapshot.files.length === 0) ||
                    (worktreeSnapshot !== null &&
                      worktreeSnapshot.conflictCount > 0)
                  }
                  onClick={async () => {
                    setWorktreeBusy(true);
                    try {
                      await onApplyWorktree();
                      setWorktreeCompareOpen(false);
                    } catch (failure) {
                      setError(
                        errorMessage(
                          failure,
                          "Candidate worktree edits could not be applied.",
                        ),
                      );
                    } finally {
                      setWorktreeBusy(false);
                    }
                  }}
                >
                  Apply
                </button>
              )}
              {onDiscardWorktree && (
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={worktreeBusy || Boolean(runId)}
                  onClick={async () => {
                    setWorktreeBusy(true);
                    try {
                      await onDiscardWorktree();
                      setWorktreeCompareOpen(false);
                    } catch (failure) {
                      setError(
                        errorMessage(
                          failure,
                          "Candidate worktree could not be discarded.",
                        ),
                      );
                    } finally {
                      setWorktreeBusy(false);
                    }
                  }}
                >
                  Discard
                </button>
              )}
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
              {variant === "docked" ? (
                <div className="rook-cli-welcome-head">
                  <span className="rook-cli-welcome-sigil" aria-hidden="true">
                    ◆
                  </span>
                  <span className="rook-cli-welcome-title">
                    ROOK CLI · {rookMode}
                  </span>
                  <span className="rook-cli-welcome-project">
                    {activeProject.name}
                  </span>
                </div>
              ) : (
                <>
                  <span className="rook-welcome-emblem" aria-hidden="true">
                    ✳
                  </span>
                  <h3>
                    {rookMode === "build"
                      ? "What would you like to build?"
                      : "What would you like to know?"}
                  </h3>
                </>
              )}
              <p>
                {rookMode === "build"
                  ? "Edits files directly with instant pre-turn undo."
                  : "Read-only exploration with cited files and line links."}
              </p>
              <div
                className="rook-welcome-starters"
                aria-label="Suggested prompts"
              >
                {(rookMode === "build"
                  ? [
                      "Fix diagnostics in the active file",
                      "Add focused unit tests",
                      "Refactor cleanly with minimal diff",
                    ]
                  : [
                      "Explain the active file",
                      "Trace callers & data flow",
                      "Summarize uncommitted changes",
                    ]
                ).map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    className="rook-starter-chip"
                    onClick={() => {
                      setPrompt(starter);
                      onRookDraftSave(starter);
                      promptRef.current?.focus();
                    }}
                  >
                    {starter}
                  </button>
                ))}
              </div>
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
              const isSettledAssistant =
                message.role === "assistant" && message.runId !== runId;
              const touchedFiles = message.touchedFiles ?? [];
              const hasFlags = Boolean(
                message.steered || message.cancelled || message.turnUndone,
              );

              const turnFlags = hasFlags ? (
                <div className="rook-cli-turn-flags">
                  {message.steered && (
                    <span className="rook-cli-flag">[steered]</span>
                  )}
                  {message.cancelled && (
                    <span className="rook-cli-flag is-danger">[cancelled]</span>
                  )}
                  {message.turnUndone && (
                    <span className="rook-cli-flag">[undone]</span>
                  )}
                </div>
              ) : null;

              const turnContent = (
                <>
                  {variant === "docked" ? (
                    turnFlags
                  ) : (
                    <div className="rook-message-head">
                      <strong>
                        {message.role === "user" ? "You" : "Rook"}
                      </strong>
                      {message.steered && (
                        <span className="status-pill">Steered · applied</span>
                      )}
                      {message.cancelled && (
                        <span className="verify-status-pill verify-status-cancelled">
                          Cancelled
                        </span>
                      )}
                      {message.turnUndone && (
                        <span className="status-pill">Turn undone</span>
                      )}
                    </div>
                  )}

                  {message.tools && message.tools.length > 0 && (
                    <div className="rook-tool-trace">
                      {message.tools.map((tool) => (
                        <div
                          className={`rook-tool-activity rook-tool-${tool.status}`}
                          key={tool.id}
                        >
                          <span aria-hidden="true">
                            {tool.status === "running"
                              ? "◌"
                              : tool.status === "ok"
                                ? "✓"
                                : variant === "docked"
                                  ? "✗"
                                  : "!"}
                          </span>
                          <span>
                            {variant === "docked"
                              ? (tool.name ?? "tool")
                              : (tool.name ?? "tool").replaceAll("_", " ")}
                          </span>
                          <span>{tool.summary ?? ""}</span>
                          <span>
                            {variant === "docked"
                              ? tool.status === "running"
                                ? "…"
                                : tool.status === "ok"
                                  ? "ok"
                                  : "err"
                              : tool.status === "running"
                                ? "Checking"
                                : tool.status === "ok"
                                  ? "Done"
                                  : "Failed"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {message.text ? (
                    <RookMarkdown
                      text={message.text}
                      projectPath={activeProject.path}
                      onOpenFileRef={(relPath, line, column) =>
                        onJumpToLocation?.(relPath, line ?? 1, column)
                      }
                      onPreviewPatch={onPreviewRookPatch}
                    />
                  ) : message.role === "assistant" &&
                    message.runId === runId ? (
                    <p className="rook-thinking">
                      {rookCancelling ? "Stopping…" : "Thinking…"}
                    </p>
                  ) : null}

                  {message.role === "assistant" && message.incomplete && (
                    <p className="rook-incomplete" role="status">
                      {variant === "docked"
                        ? "[!] Rook stopped before providing a final answer."
                        : "Rook stopped before providing a final answer."}
                    </p>
                  )}

                  {isSettledAssistant &&
                    message.planOnly &&
                    message.planOriginalPrompt && (
                      <div className="rook-turn-diff-strip">
                        <span className="rook-turn-diff-count">
                          Plan ready · no files edited
                        </span>
                        <div className="rook-turn-diff-actions">
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={!session || Boolean(runId)}
                            onClick={() => {
                              setPlanFirst(false);
                              dispatchRookPrompt(
                                `Approve & Build: ${message.planOriginalPrompt}`,
                                message.planOriginalPrompt!,
                                message.planOriginalContext ?? "",
                              );
                            }}
                          >
                            Approve &amp; Build →
                          </button>
                        </div>
                      </div>
                    )}

                  {isSettledAssistant &&
                    touchedFiles.length > 0 &&
                    !message.turnUndone && (
                      <div className="rook-turn-diff-strip">
                        <span className="rook-turn-diff-count">
                          {touchedFiles.length} file
                          {touchedFiles.length === 1 ? "" : "s"} touched
                        </span>
                        <div className="rook-turn-diff-actions">
                          {onOpenReview && activeProject.isGitRepository && (
                            <button
                              type="button"
                              className="button button-quiet"
                              onClick={() =>
                                onOpenReview(touchedFiles, "last_review")
                              }
                            >
                              Inspect diff ↗
                            </button>
                          )}
                          {onUndoTurn && activeProject.isGitRepository && (
                            <button
                              type="button"
                              className="button button-quiet"
                              disabled={
                                undoingTurnIndex === index || Boolean(runId)
                              }
                              onClick={() => {
                                setUndoingTurnIndex(index);
                                void onUndoTurn(index, touchedFiles).finally(
                                  () => setUndoingTurnIndex(null),
                                );
                              }}
                            >
                              {undoingTurnIndex === index
                                ? "Undoing…"
                                : "Undo turn"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                  {isSettledAssistant &&
                    touchedFiles.length > 0 &&
                    !message.turnUndone &&
                    !message.planOnly &&
                    workspaceTrusted &&
                    (() => {
                      const projectChecks = executions.filter(
                        (item) => item.projectId === activeProject.id,
                      );
                      const latestCheck = projectChecks[0];
                      const primaryRecipe = projectRecipes[0];
                      const checkFailed =
                        latestCheck &&
                        (latestCheck.status === "failed" ||
                          latestCheck.status === "timed_out" ||
                          latestCheck.status === "start_failed");
                      return (
                        <div className="rook-verify-strip">
                          <div className="rook-verify-strip-status">
                            <span
                              className={`verify-status-pill verify-status-${latestCheck?.status ?? "stale"}`}
                            >
                              {latestCheck
                                ? `${latestCheck.program}: ${latestCheck.status}`
                                : primaryRecipe
                                  ? `Suggested: ${primaryRecipe.name}`
                                  : "Not verified"}
                            </span>
                            {verifyFeedback && (
                              <span className="rook-verify-note">
                                {verifyFeedback}
                              </span>
                            )}
                          </div>
                          <div className="rook-turn-diff-actions">
                            <button
                              type="button"
                              className="button button-quiet"
                              disabled={runningVerifyTurn === index}
                              onClick={() => void runTurnVerifyCheck(index)}
                            >
                              {runningVerifyTurn === index
                                ? "Running…"
                                : primaryRecipe
                                  ? `Verify (${primaryRecipe.name})`
                                  : "Run verify"}
                            </button>
                            {checkFailed && latestCheck && (
                              <button
                                type="button"
                                className="button button-primary"
                                disabled={!session || Boolean(runId)}
                                onClick={() => {
                                  const excerpt = formatFailureContextExcerpt(
                                    `${latestCheck.program} ${latestCheck.args.join(" ")}`,
                                    latestCheck.output ||
                                      "(no output recorded)",
                                  );
                                  dispatchRookPrompt(
                                    `Fix verification failure in \`${latestCheck.program}\` and prepare for re-verify`,
                                    `Fix the failure from \`${latestCheck.program} ${latestCheck.args.join(" ")}\` (status: ${latestCheck.status}) and keep the diff minimal.\n\nFailure output:\n${excerpt}`,
                                    excerpt,
                                  );
                                }}
                              >
                                Fix failure &amp; re-verify
                              </button>
                            )}
                            {onOpenVerify && (
                              <button
                                type="button"
                                className="button button-quiet"
                                onClick={onOpenVerify}
                              >
                                {projectChecks.length >= 2
                                  ? "Compare vs prev ↗"
                                  : "Verify ↗"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                  {isSettledAssistant &&
                    message.text &&
                    onOpenReview &&
                    activeProject.isGitRepository &&
                    touchedFiles.length === 0 && (
                      <div className="rook-message-actions">
                        <button
                          type="button"
                          className="button button-quiet"
                          onClick={() =>
                            onOpenReview(
                              undefined,
                              rookMode === "build" ? "last_review" : "head",
                            )
                          }
                        >
                          {rookMode === "build"
                            ? "Review Rook edits ↗"
                            : "Open Review ↗"}
                        </button>
                      </div>
                    )}
                </>
              );

              return (
                <article
                  className={
                    variant === "docked"
                      ? `rook-message rook-message-${message.role} rook-cli-${message.role}`
                      : `rook-message rook-message-${message.role}`
                  }
                  key={`${index}-${message.role}`}
                >
                  {variant === "docked" ? (
                    <>
                      <span className="rook-cli-sigil" aria-hidden="true">
                        {message.role === "user" ? "❯" : "✦"}
                      </span>
                      <span className="sr-only">
                        {message.role === "user" ? "You" : "Rook"}
                      </span>
                      <div className="rook-cli-turn-body">{turnContent}</div>
                    </>
                  ) : (
                    turnContent
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

        <div className="rook-composer-dock-wrap">
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
          {rookStartupError && session && (
            <p className="inline-error" role="alert">
              {rookStartupError}
            </p>
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
                          doc.projectId === activeProject.id &&
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
                        onClick={() => removeContextChip(chip.id)}
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
                    onClick={() => setQueuedSteering(null)}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {prompt.trim() && !session && !rookPending && !rookStartupError && (
              <button
                className="rook-draft-action"
                type="button"
                onClick={onRookStart}
              >
                Connect to send your draft
              </button>
            )}

            <div
              className={
                variant === "docked"
                  ? "rook-composer-row rook-cli-composer-row"
                  : "rook-composer-row"
              }
            >
              {variant === "docked" && (
                <span className="rook-cli-input-prompt" aria-hidden="true">
                  ❯
                </span>
              )}
              <textarea
                ref={promptRef}
                id="rook-prompt"
                rows={2}
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
                    ? "Steer or queue next… (Enter)"
                    : rookMode === "build"
                      ? "Describe changes to build… (⌘L)"
                      : "Ask about this codebase… (⌘L)"
                }
              />
            </div>

            <div className="rook-composer-toolbar">
              <div className="rook-composer-controls">
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

                {rookMode === "build" && (
                  <button
                    type="button"
                    aria-pressed={planFirst}
                    className={`rook-plan-pill${planFirst ? " is-active" : ""}`}
                    title="Inspect and present a plan before editing files"
                    disabled={Boolean(runId)}
                    onClick={() => setPlanFirst(!planFirst)}
                  >
                    Plan first
                  </button>
                )}

                {rookMode === "build" &&
                  activeProject.isGitRepository &&
                  onRookBuildTargetChange && (
                    <div
                      className="rook-target-toggle"
                      role="group"
                      aria-label="Build target"
                    >
                      <button
                        type="button"
                        aria-pressed={buildTarget === "direct"}
                        className={buildTarget === "direct" ? "is-active" : ""}
                        disabled={rookPending || Boolean(runId) || worktreeBusy}
                        title="Edit files directly in main workspace"
                        onClick={() => void onRookBuildTargetChange("direct")}
                      >
                        Direct
                      </button>
                      <button
                        type="button"
                        aria-pressed={buildTarget === "worktree"}
                        className={
                          buildTarget === "worktree" ? "is-active" : ""
                        }
                        disabled={rookPending || Boolean(runId) || worktreeBusy}
                        title="Experiment in an isolated candidate Git worktree"
                        onClick={() => void onRookBuildTargetChange("worktree")}
                      >
                        Worktree
                      </button>
                    </div>
                  )}

                {providerControlsAvailable && (
                  <Dialog.Root
                    open={modelPickerOpen}
                    onOpenChange={(open) => {
                      if (!open && activeLogin) {
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
                        title={currentModel?.name ?? "Choose a model"}
                      >
                        <span>{currentModel?.name ?? "Choose model"}</span>
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
                              <div
                                className="rook-model-group"
                                key={providerId}
                              >
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
                              No models are available. Configure a provider to
                              get started.
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
                                        (item) =>
                                          item.id === setupModel.provider,
                                      )?.authMethods.length
                                    ? " Choose a sign-in method below."
                                    : " This provider has no interactive sign-in method. Configure its credentials in your environment, then reconnect."}
                              </p>
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
                                      setActiveLoginProvider(
                                        setupModel.provider,
                                      );
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
                                                provider.id ===
                                                setupModel.provider,
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
                                <p
                                  className="rook-auth-event"
                                  aria-live="polite"
                                >
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
                                      {authPrompt.prompt.options?.map(
                                        (option) => (
                                          <option
                                            key={option.id}
                                            value={option.id}
                                          >
                                            {option.label}
                                            {option.description
                                              ? ` — ${option.description}`
                                              : ""}
                                          </option>
                                        ),
                                      )}
                                    </select>
                                  ) : (
                                    <input
                                      id="rook-auth-input"
                                      placeholder={
                                        authPrompt.prompt.placeholder
                                      }
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

              <div className="rook-composer-actions">
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
                        setCancelling(true);
                        void service.cancelRookAsk(session, runId).catch(() => {
                          setCancelling(false);
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
                      width="15"
                      height="15"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
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
            </div>
          </form>

          <div className="rook-composer-footer">
            <span
              className="rook-sandbox-meta"
              title={
                rookMode === "build"
                  ? sandboxSummary(rookSandbox)
                  : "Read-only Ask mode"
              }
            >
              {rookMode === "build"
                ? sandboxSummary(rookSandbox)
                : "Read-only · cites workspace"}
            </span>
            <div className="rook-footer-right">
              {rookMode === "build" && workspaceTrusted && (
                <label
                  className="rook-autoverify-toggle"
                  title="Automatically run the primary verify recipe after Build edits files"
                >
                  <input
                    type="checkbox"
                    checked={autoVerifyAfterBuild}
                    onChange={(event) =>
                      setAutoVerifyAfterBuild(event.currentTarget.checked)
                    }
                  />
                  <span>Auto-verify</span>
                </label>
              )}
              <span className="rook-shortcut-hint">⇧↵ newline</span>
            </div>
          </div>
        </div>
      </div>

      {activeWorktree && (
        <Dialog.Root
          open={worktreeCompareOpen}
          onOpenChange={setWorktreeCompareOpen}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="palette-overlay" />
            <Dialog.Content className="rook-worktree-compare-dialog">
              <header className="rook-worktree-compare-header">
                <div>
                  <Dialog.Title>
                    Compare candidate worktree vs workspace
                  </Dialog.Title>
                  <Dialog.Description>
                    Branch {activeWorktree.branch} ·{" "}
                    {worktreeSnapshot?.files.length ?? 0} changed file
                    {worktreeSnapshot?.files.length === 1 ? "" : "s"}
                  </Dialog.Description>
                </div>
                <div className="rook-worktree-compare-actions">
                  {projectRecipes[0] && (
                    <button
                      type="button"
                      className="button button-quiet"
                      disabled={worktreeBusy || Boolean(runId)}
                      onClick={() => void runTurnVerifyCheck(messages.length)}
                    >
                      Verify worktree
                    </button>
                  )}
                  {onApplyWorktree && (
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={
                        worktreeBusy ||
                        !worktreeSnapshot?.files.length ||
                        worktreeSnapshot.conflictCount > 0
                      }
                      onClick={async () => {
                        setWorktreeBusy(true);
                        try {
                          await onApplyWorktree();
                          setWorktreeCompareOpen(false);
                        } catch (failure) {
                          setError(
                            errorMessage(
                              failure,
                              "Candidate worktree edits could not be applied.",
                            ),
                          );
                        } finally {
                          setWorktreeBusy(false);
                        }
                      }}
                    >
                      Apply to Workspace
                    </button>
                  )}
                  {onDiscardWorktree && (
                    <button
                      type="button"
                      className="button button-quiet"
                      disabled={worktreeBusy}
                      onClick={async () => {
                        setWorktreeBusy(true);
                        try {
                          await onDiscardWorktree();
                          setWorktreeCompareOpen(false);
                        } catch (failure) {
                          setError(
                            errorMessage(
                              failure,
                              "Candidate worktree could not be discarded.",
                            ),
                          );
                        } finally {
                          setWorktreeBusy(false);
                        }
                      }}
                    >
                      Discard
                    </button>
                  )}
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Close comparison"
                    >
                      ×
                    </button>
                  </Dialog.Close>
                </div>
              </header>

              {worktreeSnapshot && worktreeSnapshot.conflictCount > 0 && (
                <p className="inline-error" role="alert">
                  {worktreeSnapshot.conflictCount} file
                  {worktreeSnapshot.conflictCount === 1
                    ? " has"
                    : "s have"}{" "}
                  uncommitted edits in your main workspace. Commit or revert
                  those files in main before applying.
                </p>
              )}

              <div className="rook-worktree-compare-body">
                <div
                  className="rook-worktree-compare-files"
                  role="listbox"
                  aria-label="Worktree changed files"
                >
                  {!worktreeSnapshot || worktreeSnapshot.files.length === 0 ? (
                    <p className="palette-empty">
                      No edits recorded in this candidate worktree yet.
                    </p>
                  ) : (
                    worktreeSnapshot.files.map((file) => {
                      const active =
                        (selectedComparePath ??
                          worktreeSnapshot.files[0]?.path) === file.path;
                      return (
                        <button
                          key={file.path}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={`rook-worktree-file-row${active ? " is-active" : ""}`}
                          onClick={() => setSelectedComparePath(file.path)}
                        >
                          <span className="rook-worktree-file-path">
                            {file.path}
                          </span>
                          <span className="rook-worktree-file-meta">
                            <span>{file.status}</span>
                            {file.conflictsWithMain && (
                              <span className="verify-status-pill verify-status-failed">
                                conflict
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="rook-worktree-compare-diff">
                  {(() => {
                    const activeFile = worktreeSnapshot?.files.find(
                      (item) =>
                        item.path ===
                        (selectedComparePath ??
                          worktreeSnapshot.files[0]?.path),
                    );
                    if (!activeFile) {
                      return (
                        <p className="palette-empty">
                          Select a changed file to inspect its unified diff.
                        </p>
                      );
                    }
                    const diffLines = activeFile.diff
                      ? activeFile.diff.split("\n")
                      : ["(No textual diff available)"];
                    return (
                      <pre className="rook-worktree-diff-pre">
                        {diffLines.map((line, i) => {
                          const cls = line.startsWith("+")
                            ? "diff-line-add"
                            : line.startsWith("-")
                              ? "diff-line-del"
                              : line.startsWith("@@")
                                ? "diff-line-hunk"
                                : "diff-line-ctx";
                          return (
                            <span key={i} className={`rook-diff-line ${cls}`}>
                              {line}
                            </span>
                          );
                        })}
                      </pre>
                    );
                  })()}
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </section>
  );
}

export { formatFailureContextExcerpt };
