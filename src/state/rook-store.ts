import { create } from "zustand";
import type {
  RookContextChip,
  RookMode,
  RookModel,
  RookProvider,
  RookSandboxStatus,
  RookSessionSummary,
} from "../services/contracts";

export type RookChatTool = {
  id: string;
  name: string;
  summary: string;
  status: "running" | "ok" | "error";
};

export type RookChatMessage = {
  role: "user" | "assistant";
  text: string;
  runId?: string;
  mode?: RookMode;
  tools?: RookChatTool[];
  touchedFiles?: string[];
  turnUndone?: boolean;
  activeTextStart?: number;
  stopReason?: string;
  incomplete?: boolean;
  cancelled?: boolean;
  steered?: boolean;
  planOnly?: boolean;
  planOriginalPrompt?: string;
  planOriginalContext?: string;
};

export type PendingPlanTurn = {
  prompt: string;
  context: string;
};

export type QueuedSteering = {
  text: string;
  mode: "steer" | "queue";
  context: string;
};

interface RookStoreState {
  session?: string;
  mode: RookMode;
  sandbox: RookSandboxStatus | null;
  trustPromptPending: boolean;
  planFirst: boolean;
  autoVerifyAfterBuild: boolean;
  pendingPlanTurn: PendingPlanTurn | null;
  providers: RookProvider[];
  providerControlsAvailable: boolean;
  models: RookModel[];
  currentModel: RookModel | null;
  startupPending: boolean;
  startupError?: string;
  error?: string;
  messages: RookChatMessage[];
  runId?: string;
  sessionStorage: boolean;
  sessions: RookSessionSummary[];
  activeSessionId?: string;
  draft: string;
  contextChips: RookContextChip[];
  cancelling: boolean;
  queuedSteering: QueuedSteering | null;
  permissionPending: boolean;

  setSession: (session?: string) => void;
  setMode: (mode: RookMode) => void;
  setSandbox: (sandbox: RookSandboxStatus | null) => void;
  setTrustPromptPending: (pending: boolean) => void;
  setPlanFirst: (enabled: boolean) => void;
  setAutoVerifyAfterBuild: (enabled: boolean) => void;
  setPendingPlanTurn: (plan: PendingPlanTurn | null) => void;
  setProviders: (
    update: RookProvider[] | ((prev: RookProvider[]) => RookProvider[]),
  ) => void;
  setProviderControlsAvailable: (available: boolean) => void;
  setModels: (
    update: RookModel[] | ((prev: RookModel[]) => RookModel[]),
  ) => void;
  setCurrentModel: (
    update: RookModel | null | ((prev: RookModel | null) => RookModel | null),
  ) => void;
  setStartupPending: (pending: boolean) => void;
  setStartupError: (error?: string) => void;
  setError: (error?: string) => void;
  setMessages: (
    update:
      | RookChatMessage[]
      | ((prev: RookChatMessage[]) => RookChatMessage[]),
  ) => void;
  setRunId: (runId?: string) => void;
  setSessionStorage: (enabled: boolean) => void;
  setSessions: (sessions: RookSessionSummary[]) => void;
  setActiveSessionId: (id?: string) => void;
  setDraft: (update: string | ((prev: string) => string)) => void;
  addContextChip: (chip: RookContextChip) => void;
  removeContextChip: (id: string) => void;
  clearContextChips: () => void;
  setCancelling: (cancelling: boolean) => void;
  setQueuedSteering: (queued: QueuedSteering | null) => void;
  setPermissionPending: (pending: boolean) => void;
  resetForProjectSwitch: (draft: string) => void;
}

export const useRookStore = create<RookStoreState>((set) => ({
  mode: "ask",
  sandbox: null,
  trustPromptPending: false,
  planFirst: false,
  autoVerifyAfterBuild: false,
  pendingPlanTurn: null,
  providers: [],
  providerControlsAvailable: false,
  models: [],
  currentModel: null,
  startupPending: false,
  messages: [],
  sessionStorage: false,
  sessions: [],
  draft: "",
  contextChips: [],
  cancelling: false,
  queuedSteering: null,
  permissionPending: false,

  setSession: (session) => set({ session }),
  setMode: (mode) => set({ mode }),
  setSandbox: (sandbox) => set({ sandbox }),
  setTrustPromptPending: (trustPromptPending) => set({ trustPromptPending }),
  setPlanFirst: (planFirst) => set({ planFirst }),
  setAutoVerifyAfterBuild: (autoVerifyAfterBuild) =>
    set({ autoVerifyAfterBuild }),
  setPendingPlanTurn: (pendingPlanTurn) => set({ pendingPlanTurn }),
  setProviders: (update) =>
    set((state) => ({
      providers:
        typeof update === "function" ? update(state.providers) : update,
    })),
  setProviderControlsAvailable: (providerControlsAvailable) =>
    set({ providerControlsAvailable }),
  setModels: (update) =>
    set((state) => ({
      models: typeof update === "function" ? update(state.models) : update,
    })),
  setCurrentModel: (update) =>
    set((state) => ({
      currentModel:
        typeof update === "function" ? update(state.currentModel) : update,
    })),
  setStartupPending: (startupPending) => set({ startupPending }),
  setStartupError: (startupError) => set({ startupError }),
  setError: (error) => set({ error }),
  setMessages: (update) =>
    set((state) => ({
      messages: typeof update === "function" ? update(state.messages) : update,
    })),
  setRunId: (runId) => set({ runId }),
  setSessionStorage: (sessionStorage) => set({ sessionStorage }),
  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setDraft: (update) =>
    set((state) => ({
      draft: typeof update === "function" ? update(state.draft) : update,
    })),
  addContextChip: (chip) =>
    set((state) => ({
      contextChips: [
        ...state.contextChips.filter((item) => item.id !== chip.id),
        chip,
      ],
    })),
  removeContextChip: (id) =>
    set((state) => ({
      contextChips: state.contextChips.filter((item) => item.id !== id),
    })),
  clearContextChips: () => set({ contextChips: [] }),
  setCancelling: (cancelling) => set({ cancelling }),
  setQueuedSteering: (queuedSteering) => set({ queuedSteering }),
  setPermissionPending: (permissionPending) => set({ permissionPending }),
  resetForProjectSwitch: (draft) =>
    set({
      session: undefined,
      mode: "ask",
      sandbox: null,
      trustPromptPending: false,
      providers: [],
      models: [],
      currentModel: null,
      providerControlsAvailable: false,
      messages: [],
      runId: undefined,
      sessions: [],
      activeSessionId: undefined,
      sessionStorage: false,
      draft,
      error: undefined,
      startupError: undefined,
      contextChips: [],
      cancelling: false,
      queuedSteering: null,
      permissionPending: false,
      pendingPlanTurn: null,
    }),
}));
