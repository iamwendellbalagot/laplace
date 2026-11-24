import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  IPC_SCHEMA_VERSION,
  type AppEvent,
  type IpcError,
  type PingRequest,
  type PingResponse,
  type ListProjectEntriesRequest,
  type OpenProjectRequest,
  type OpenProjectResponse,
  type ProjectEntriesResponse,
  type ProjectDirectoryListing,
  type ProjectSummary,
  type ProjectsRequest,
  type RecentProjectsResponse,
  type ProjectFileRead,
  type ReadProjectFileRequest,
  type ReadProjectFileResponse,
  type SaveProjectFileRequest,
  type SaveProjectFileResponse,
  type PreferencesRequest,
  type PreferencesResponse,
  type UiPreferences,
  type UpdatePreferencesRequest,
  type RookDevSettings,
  type RookDevSettingsRequest,
  type GitStatus,
  type TerminalEvent,
  type ChangeRecord,
  type ChangeStatus,
  type WorktreeRecord,
  type ExecutionRecord,
  type RookInitResponse,
  type RookEvent,
  type RookPermissionChoice,
  type RookModel,
  type RookProvider,
  type RookSessionSummary,
  type RookSessionMessage,
} from "./contracts";

export interface AppService {
  ping(): Promise<PingResponse>;
  listen(listener: (event: AppEvent) => void): Promise<UnlistenFn>;
  getPreferences(): Promise<UiPreferences>;
  updatePreferences(preferences: UiPreferences): Promise<UiPreferences>;
  getRookDevSettings(): Promise<RookDevSettings>;
  setRookDevCheckout(path: string | null): Promise<RookDevSettings>;
  chooseRookCheckout(): Promise<string | null>;
  chooseProjectDirectory(): Promise<string | null>;
  openProject(path: string): Promise<ProjectSummary>;
  getRecentProjects(): Promise<ProjectSummary[]>;
  listProjectEntries(
    projectId: string,
    relativePath?: string,
  ): Promise<ProjectDirectoryListing>;
  readProjectFile(
    projectId: string,
    relativePath: string,
  ): Promise<ProjectFileRead>;
  saveProjectFile(
    projectId: string,
    relativePath: string,
    expectedContent: string,
    content: string,
  ): Promise<boolean>;
  gitStatus(projectId: string): Promise<GitStatus>;
  gitDiff(projectId: string): Promise<string>;
  startTerminal(sessionId: string, workspaceId: string): Promise<void>;
  writeTerminal(
    sessionId: string,
    workspaceId: string,
    data?: string,
    rows?: number,
    cols?: number,
  ): Promise<void>;
  stopTerminal(sessionId: string, workspaceId: string): Promise<void>;
  trustWorkspace(projectId: string): Promise<void>;
  untrustWorkspace(projectId: string): Promise<void>;
  listChanges(projectId: string): Promise<ChangeRecord[]>;
  createChange(projectId: string, objective: string): Promise<ChangeRecord>;
  updateChange(
    projectId: string,
    changeId: string,
    objective: string,
    status: ChangeStatus,
  ): Promise<ChangeRecord>;
  reopenChangeReview(
    projectId: string,
    changeId: string,
    objective: string,
  ): Promise<ChangeRecord>;
  createCandidateWorktree(
    projectId: string,
    changeId: string,
  ): Promise<WorktreeRecord>;
  runCheck(
    projectId: string,
    program: string,
    args: string[],
    changeId?: string,
  ): Promise<ExecutionRecord>;
  listExecutions(projectId: string): Promise<ExecutionRecord[]>;
  cancelCheck(): Promise<void>;
  startRookAsk(
    sessionId: string,
    workspaceId: string,
  ): Promise<RookInitResponse>;
  listRookSessions(sessionId: string): Promise<RookSessionSummary[]>;
  newRookSession(sessionId: string): Promise<string>;
  loadRookSession(sessionId: string, rookSessionId: string): Promise<void>;
  getRookSessionHistory(sessionId: string): Promise<RookSessionMessage[]>;
  listRookModels(
    sessionId: string,
  ): Promise<{ models: RookModel[]; currentModel: RookModel | null }>;
  selectRookModel(sessionId: string, model: RookModel): Promise<RookModel>;
  loginRookProvider(
    sessionId: string,
    loginId: string,
    providerId: string,
    authType: "api_key" | "oauth",
  ): Promise<{
    providers: RookProvider[];
    models: RookModel[];
    currentModel: RookModel | null;
  }>;
  respondRookAuthPrompt(
    sessionId: string,
    promptId: string,
    value: string,
  ): Promise<void>;
  cancelRookLogin(sessionId: string, loginId: string): Promise<void>;
  openRookAuthUrl(url: string): Promise<void>;
  promptRookAsk(sessionId: string, text: string): Promise<void>;
  listenRook(listener: (event: RookEvent) => void): Promise<UnlistenFn>;
  stopRookAsk(sessionId: string): Promise<void>;
  cancelRookAsk(sessionId: string, runId: string): Promise<void>;
  respondRookPermission(
    sessionId: string,
    permissionId: string,
    choice: RookPermissionChoice,
  ): Promise<void>;
  listenTerminal(listener: (event: TerminalEvent) => void): Promise<UnlistenFn>;
}

export class AppServiceError extends Error implements IpcError {
  readonly schemaVersion = IPC_SCHEMA_VERSION;

  constructor(
    readonly code: string,
    message: string,
    readonly operationId: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AppServiceError";
  }
}

export class TauriAppService implements AppService {
  async gitStatus(projectId: string): Promise<GitStatus> {
    return invoke("git_status", { request: this.workspaceRequest(projectId) });
  }

  async gitDiff(projectId: string): Promise<string> {
    return invoke("git_diff", { request: this.workspaceRequest(projectId) });
  }

  async startTerminal(sessionId: string, workspaceId: string): Promise<void> {
    await invoke("start_terminal", {
      request: this.terminalRequest(sessionId, workspaceId),
    });
  }

  async writeTerminal(
    sessionId: string,
    workspaceId: string,
    data?: string,
    rows?: number,
    cols?: number,
  ): Promise<void> {
    await invoke("write_terminal", {
      request: {
        ...this.terminalRequest(sessionId, workspaceId),
        data,
        rows,
        cols,
      },
    });
  }

  async stopTerminal(sessionId: string, workspaceId: string): Promise<void> {
    await invoke("stop_terminal", {
      request: this.terminalRequest(sessionId, workspaceId),
    });
  }

  async trustWorkspace(projectId: string): Promise<void> {
    await invoke("trust_workspace", {
      request: this.workspaceRequest(projectId),
    });
  }

  async untrustWorkspace(projectId: string): Promise<void> {
    await invoke("untrust_workspace", {
      request: this.workspaceRequest(projectId),
    });
  }

  async listChanges(projectId: string): Promise<ChangeRecord[]> {
    return invoke("list_changes", {
      request: {
        ...this.workspaceRequest(projectId),
        changeId: null,
        objective: null,
        status: null,
      },
    });
  }

  async createChange(
    projectId: string,
    objective: string,
  ): Promise<ChangeRecord> {
    return invoke("create_change", {
      request: {
        ...this.workspaceRequest(projectId),
        changeId: null,
        objective,
        status: null,
      },
    });
  }

  async updateChange(
    projectId: string,
    changeId: string,
    objective: string,
    status: ChangeStatus,
  ): Promise<ChangeRecord> {
    const request = {
      ...this.workspaceRequest(projectId),
      changeId,
      objective,
      status,
    };
    try {
      return await invoke("update_change", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async updateChangeIfVersion(
    projectId: string,
    current: ChangeRecord,
    objective: string,
    status: ChangeStatus,
  ): Promise<ChangeRecord> {
    const latest = (await this.listChanges(projectId)).find(
      (item) => item.id === current.id,
    );
    if (!latest || latest.updatedAt !== current.updatedAt) {
      throw new AppServiceError(
        "change_conflict",
        "This Change was updated elsewhere. Reload it before editing.",
        crypto.randomUUID(),
        false,
      );
    }
    return this.updateChange(projectId, current.id, objective, status);
  }

  async reopenChangeReview(
    projectId: string,
    changeId: string,
    objective: string,
  ): Promise<ChangeRecord> {
    return invoke("reopen_change_review", {
      request: {
        ...this.workspaceRequest(projectId),
        changeId,
        objective,
        status: null,
      },
    });
  }

  async createCandidateWorktree(
    projectId: string,
    changeId: string,
  ): Promise<WorktreeRecord> {
    return invoke("create_candidate_worktree", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        projectId,
        changeId,
      },
    });
  }

  async runCheck(
    projectId: string,
    program: string,
    args: string[],
    changeId?: string,
  ): Promise<ExecutionRecord> {
    return invoke("run_check", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        projectId,
        program,
        args,
        changeId: changeId ?? null,
        timeoutMs: 600000,
      },
    });
  }

  async listExecutions(projectId: string): Promise<ExecutionRecord[]> {
    return invoke("list_executions", {
      request: {
        ...this.workspaceRequest(projectId),
        changeId: null,
        objective: null,
        status: null,
        untrackedPath: null,
      },
    });
  }

  async cancelCheck(): Promise<void> {
    await invoke("cancel_check", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
      },
    });
  }

  async startRookAsk(
    sessionId: string,
    workspaceId: string,
  ): Promise<RookInitResponse> {
    const request = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
      sessionId,
      workspaceId,
    };
    try {
      return await invoke("start_rook_ask", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async listRookSessions(sessionId: string): Promise<RookSessionSummary[]> {
    const result = await this.rookSessionRequest(sessionId, "session/list");
    return (result.sessions ?? []) as RookSessionSummary[];
  }

  async newRookSession(sessionId: string): Promise<string> {
    const result = await this.rookSessionRequest(sessionId, "session/new");
    return result.sessionId as string;
  }

  async loadRookSession(
    sessionId: string,
    rookSessionId: string,
  ): Promise<void> {
    await this.rookSessionRequest(sessionId, "session/load", {
      sessionId: rookSessionId,
    });
  }

  async getRookSessionHistory(
    sessionId: string,
  ): Promise<RookSessionMessage[]> {
    const result = await this.rookSessionRequest(sessionId, "session/history", {
      limit: 200,
    });
    return (result.messages ?? []) as RookSessionMessage[];
  }

  private rookSessionRequest(
    sessionId: string,
    method: "session/list" | "session/new" | "session/load" | "session/history",
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return invoke("rook_provider_request", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        sessionId,
        method,
        params: method === "session/new" ? { mode: "ask" } : params,
      },
    });
  }

  async promptRookAsk(sessionId: string, text: string): Promise<void> {
    await invoke("prompt_rook_ask", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        sessionId,
        text,
      },
    });
  }

  async listRookModels(
    sessionId: string,
  ): Promise<{ models: RookModel[]; currentModel: RookModel | null }> {
    const response = await invoke<{
      models: RookModel[];
      currentModel: RookModel | null;
    }>("rook_provider_request", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        sessionId,
        method: "model/list",
        params: {},
      },
    });
    return response;
  }

  async selectRookModel(
    sessionId: string,
    model: RookModel,
  ): Promise<RookModel> {
    const response = await invoke<{ currentModel: RookModel }>(
      "rook_provider_request",
      {
        request: {
          schemaVersion: IPC_SCHEMA_VERSION,
          operationId: crypto.randomUUID(),
          sessionId,
          method: "model/select",
          params: { provider: model.provider, id: model.id },
        },
      },
    );
    return response.currentModel;
  }

  async loginRookProvider(
    sessionId: string,
    loginId: string,
    providerId: string,
    authType: "api_key" | "oauth",
  ): Promise<{
    providers: RookProvider[];
    models: RookModel[];
    currentModel: RookModel | null;
  }> {
    return invoke<{
      providers: RookProvider[];
      models: RookModel[];
      currentModel: RookModel | null;
    }>("rook_provider_request", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        sessionId,
        method: "provider/login",
        params: { providerId, authType, loginId },
      },
    });
  }

  async respondRookAuthPrompt(
    sessionId: string,
    promptId: string,
    value: string,
  ): Promise<void> {
    await invoke("respond_rook_auth_prompt", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        sessionId,
        promptId,
        value,
      },
    });
  }

  async cancelRookLogin(sessionId: string, loginId: string): Promise<void> {
    await invoke("rook_provider_request", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        sessionId,
        method: "provider/auth_cancel",
        params: { loginId },
      },
    });
  }

  async openRookAuthUrl(url: string): Promise<void> {
    await invoke("open_rook_auth_url", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        url,
      },
    });
  }

  listenRook(listener: (event: RookEvent) => void): Promise<UnlistenFn> {
    return listen<RookEvent>("rook-event", (event) => listener(event.payload));
  }

  async stopRookAsk(sessionId: string): Promise<void> {
    await invoke("stop_rook_ask", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        sessionId,
      },
    });
  }

  async cancelRookAsk(sessionId: string, runId: string): Promise<void> {
    await invoke("cancel_rook_ask", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        sessionId,
        runId,
      },
    });
  }

  async respondRookPermission(
    sessionId: string,
    permissionId: string,
    choice: RookPermissionChoice,
  ): Promise<void> {
    await invoke("respond_rook_permission", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        sessionId,
        permissionId,
        choice,
      },
    });
  }

  listenTerminal(
    listener: (event: TerminalEvent) => void,
  ): Promise<UnlistenFn> {
    return listen<TerminalEvent>("terminal-event", (event) =>
      listener(event.payload),
    );
  }

  private workspaceRequest(projectId: string) {
    return {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
      projectId,
    };
  }

  private terminalRequest(sessionId: string, workspaceId: string) {
    return {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
      sessionId,
      workspaceId,
    };
  }

  async ping(): Promise<PingResponse> {
    const request: PingRequest = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
    };
    try {
      return await invoke<PingResponse>("ping", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  listen(listener: (event: AppEvent) => void): Promise<UnlistenFn> {
    return listen<AppEvent>("app-event", (event) => listener(event.payload));
  }

  async getPreferences(): Promise<UiPreferences> {
    const request: PreferencesRequest = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
    };
    try {
      const response = await invoke<PreferencesResponse>("get_preferences", {
        request,
      });
      return response.preferences;
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async updatePreferences(preferences: UiPreferences): Promise<UiPreferences> {
    const request: UpdatePreferencesRequest = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
      preferences,
    };
    try {
      const response = await invoke<PreferencesResponse>("update_preferences", {
        request,
      });
      return response.preferences;
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async getRookDevSettings(): Promise<RookDevSettings> {
    const request: PreferencesRequest = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
    };
    try {
      return await invoke("get_rook_dev_settings", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async setRookDevCheckout(path: string | null): Promise<RookDevSettings> {
    const request: RookDevSettingsRequest = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
      checkoutPath: path,
    };
    try {
      return await invoke("set_rook_dev_checkout", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async chooseRookCheckout(): Promise<string | null> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select local Rook checkout",
    });
    return typeof selected === "string" ? selected : null;
  }

  async chooseProjectDirectory(): Promise<string | null> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open project folder",
    });
    return typeof selected === "string" ? selected : null;
  }

  async openProject(path: string): Promise<ProjectSummary> {
    const request: OpenProjectRequest = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
      path,
    };
    try {
      const response = await invoke<OpenProjectResponse>("open_project", {
        request,
      });
      return response.project;
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async getRecentProjects(): Promise<ProjectSummary[]> {
    const request: ProjectsRequest = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
    };
    try {
      const response = await invoke<RecentProjectsResponse>(
        "get_recent_projects",
        { request },
      );
      return response.projects;
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async listProjectEntries(
    projectId: string,
    relativePath = "",
  ): Promise<ProjectDirectoryListing> {
    const request: ListProjectEntriesRequest = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
      projectId,
      relativePath,
    };
    try {
      const response = await invoke<ProjectEntriesResponse>(
        "list_project_entries",
        { request },
      );
      return { entries: response.entries, truncated: response.truncated };
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async readProjectFile(
    projectId: string,
    relativePath: string,
  ): Promise<ProjectFileRead> {
    const request: ReadProjectFileRequest = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
      projectId,
      relativePath,
    };
    try {
      const response = await invoke<ReadProjectFileResponse>(
        "read_project_file",
        {
          request,
        },
      );
      return response.file;
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async saveProjectFile(
    projectId: string,
    relativePath: string,
    expectedContent: string,
    content: string,
  ): Promise<boolean> {
    const request: SaveProjectFileRequest = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
      projectId,
      relativePath,
      expectedContent,
      content,
    };
    try {
      const response = await invoke<SaveProjectFileResponse>(
        "save_project_file",
        { request },
      );
      return response.saved;
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }
}

function normalizeError(error: unknown, operationId: string): AppServiceError {
  if (typeof error === "object" && error !== null) {
    const value = error as Partial<IpcError>;
    if (
      typeof value.code === "string" &&
      typeof value.message === "string" &&
      typeof value.retryable === "boolean"
    ) {
      return new AppServiceError(
        value.code,
        value.message,
        typeof value.operationId === "string" ? value.operationId : operationId,
        value.retryable,
      );
    }
  }
  return new AppServiceError(
    "native_unavailable",
    "The native command failed. Check the application diagnostics and retry.",
    operationId,
    true,
  );
}
