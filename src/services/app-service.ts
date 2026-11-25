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
  type ProjectRecipeSummary,
  type ChangeReviewSnapshot,
  type WorkspaceReviewSnapshot,
  type RevertTarget,
  type GitDiffPair,
  type ReviewComment,
  type ReviewDiffBaseline,
  type IntegrationAttempt,
  type RunConfigsResponse,
  type RunEvent,
  type RunInstance,
  type WorkspaceContinuity,
  type RookInitResponse,
  type RookMode,
  type RookEvent,
  type RookPermissionChoice,
  type RookModel,
  type RookProvider,
  type RookSessionSummary,
  type RookSessionMessage,
  type FileContextSnapshot,
  type FileHistorySnapshot,
  type SystemContextSnapshot,
  type ContextAnnotationRecord,
  type ContextPinnedLinkRecord,
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
  listProjectFiles(projectId: string): Promise<string[]>;
  loadWorkspaceContinuity(projectId: string): Promise<WorkspaceContinuity>;
  saveWorkspaceLayout(
    projectId: string,
    layout: {
      openTabs: string[];
      activeTab: string | null;
      splitTab: string | null;
      bottomTab: string;
      activePage: string;
    },
  ): Promise<void>;
  saveEditorDraft(
    projectId: string,
    relativePath: string,
    savedContent: string,
    draftContent: string,
  ): Promise<void>;
  deleteEditorDraft(projectId: string, relativePath: string): Promise<void>;
  pruneProjectExecutions(
    projectId: string,
    keepLatest?: number,
  ): Promise<number>;
  listRunConfigs(projectId: string): Promise<RunConfigsResponse>;
  listRunInstances(projectId: string): Promise<RunInstance[]>;
  startRunConfig(
    projectId: string,
    name: string,
    portOverride?: number,
  ): Promise<RunInstance>;
  stopRunConfig(projectId: string, instanceId: string): Promise<RunInstance>;
  listenRunEvents(listener: (event: RunEvent) => void): Promise<UnlistenFn>;
  getFileContext(
    projectId: string,
    relativePath: string,
    options?: { symbol?: string; cursorLine?: number },
  ): Promise<FileContextSnapshot>;
  getFileHistory(
    projectId: string,
    relativePath: string,
  ): Promise<FileHistorySnapshot>;
  getSystemContext(projectId: string): Promise<SystemContextSnapshot>;
  cancelContextIndex(projectId: string): Promise<boolean>;
  saveContextAnnotation(
    projectId: string,
    targetKind: "file" | "module",
    targetKey: string,
    summary: string,
  ): Promise<ContextAnnotationRecord>;
  deleteContextAnnotation(
    projectId: string,
    targetKind: "file" | "module",
    targetKey: string,
  ): Promise<void>;
  saveContextPinnedLink(
    projectId: string,
    sourcePath: string,
    targetPath: string,
    relationKind: "calls" | "imports" | "tests" | "documents" | "depends_on",
    note?: string,
  ): Promise<ContextPinnedLinkRecord>;
  deleteContextPinnedLink(projectId: string, linkId: string): Promise<void>;
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
  getWorkspaceTrust(projectId: string): Promise<boolean>;
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
  getChangeReview(
    projectId: string,
    changeId: string,
  ): Promise<ChangeReviewSnapshot>;
  getWorkspaceReview(projectId: string): Promise<WorkspaceReviewSnapshot>;
  saveWorkspaceCheckpoint(
    projectId: string,
    label?: string,
  ): Promise<WorkspaceReviewSnapshot>;
  addWorkspaceReviewComment(
    projectId: string,
    filePath: string,
    body: string,
    lineNumber?: number,
  ): Promise<ReviewComment>;
  revertWorkspaceFile(
    projectId: string,
    relativePath: string,
    target: RevertTarget,
  ): Promise<WorkspaceReviewSnapshot>;
  commitWorkspaceReview(
    projectId: string,
    selectedPaths: string[],
    commitMessage: string,
    expectedSourceDigest: string,
    allowUnverified: boolean,
  ): Promise<IntegrationAttempt>;
  readGitFileDiffPair(
    projectId: string,
    relativePath: string,
    options?: { changeId?: string; baseline?: ReviewDiffBaseline },
  ): Promise<GitDiffPair>;
  saveReviewCheckpoint(
    projectId: string,
    changeId: string,
  ): Promise<ChangeReviewSnapshot>;
  addReviewComment(
    projectId: string,
    changeId: string,
    filePath: string,
    body: string,
    lineNumber?: number,
  ): Promise<ReviewComment>;
  toggleReviewCommentResolved(
    projectId: string,
    commentId: string,
    resolved: boolean,
  ): Promise<ReviewComment>;
  approveChangeReview(
    projectId: string,
    changeId: string,
    expectedSourceDigest: string,
    overrideReason?: string,
  ): Promise<ChangeReviewSnapshot>;
  requestChangeRevision(
    projectId: string,
    changeId: string,
    note?: string,
  ): Promise<ChangeReviewSnapshot>;
  prepareChangeIntegration(
    projectId: string,
    changeId: string,
    selectedPaths: string[],
    commitMessage: string,
  ): Promise<IntegrationAttempt>;
  executeChangeIntegration(
    projectId: string,
    changeId: string,
    attemptId: string,
  ): Promise<IntegrationAttempt>;
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
  listProjectRecipes(projectId: string): Promise<ProjectRecipeSummary[]>;
  runProjectRecipe(
    projectId: string,
    recipeName: string,
    changeId?: string,
  ): Promise<ExecutionRecord>;
  cancelCheck(): Promise<void>;
  startRookAsk(
    sessionId: string,
    workspaceId: string,
  ): Promise<RookInitResponse>;
  startRookBuild(
    sessionId: string,
    workspaceId: string,
  ): Promise<RookInitResponse>;
  listRookSessions(sessionId: string): Promise<RookSessionSummary[]>;
  newRookSession(sessionId: string, mode?: RookMode): Promise<string>;
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
  promptRookAsk(
    sessionId: string,
    text: string,
    context?: string,
  ): Promise<void>;
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

  async getWorkspaceTrust(projectId: string): Promise<boolean> {
    const request = this.workspaceRequest(projectId);
    try {
      return await invoke<boolean>("get_workspace_trust", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
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

  async getChangeReview(
    projectId: string,
    changeId: string,
  ): Promise<ChangeReviewSnapshot> {
    const request = {
      ...this.workspaceRequest(projectId),
      changeId,
    };
    try {
      return await invoke<ChangeReviewSnapshot>("get_change_review", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async getWorkspaceReview(
    projectId: string,
  ): Promise<WorkspaceReviewSnapshot> {
    const request = this.workspaceRequest(projectId);
    try {
      return await invoke<WorkspaceReviewSnapshot>("get_workspace_review", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async saveWorkspaceCheckpoint(
    projectId: string,
    label?: string,
  ): Promise<WorkspaceReviewSnapshot> {
    const request = {
      ...this.workspaceRequest(projectId),
      label: label ?? null,
    };
    try {
      return await invoke<WorkspaceReviewSnapshot>(
        "save_workspace_checkpoint",
        {
          request,
        },
      );
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async addWorkspaceReviewComment(
    projectId: string,
    filePath: string,
    body: string,
    lineNumber?: number,
  ): Promise<ReviewComment> {
    const request = {
      ...this.workspaceRequest(projectId),
      filePath,
      lineNumber: lineNumber ?? null,
      body,
    };
    try {
      return await invoke<ReviewComment>("add_workspace_review_comment", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async revertWorkspaceFile(
    projectId: string,
    relativePath: string,
    target: RevertTarget,
  ): Promise<WorkspaceReviewSnapshot> {
    const request = {
      ...this.workspaceRequest(projectId),
      relativePath,
      target,
    };
    try {
      return await invoke<WorkspaceReviewSnapshot>("revert_workspace_file", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async commitWorkspaceReview(
    projectId: string,
    selectedPaths: string[],
    commitMessage: string,
    expectedSourceDigest: string,
    allowUnverified: boolean,
  ): Promise<IntegrationAttempt> {
    const request = {
      ...this.workspaceRequest(projectId),
      selectedPaths,
      commitMessage,
      expectedSourceDigest,
      allowUnverified,
    };
    try {
      return await invoke<IntegrationAttempt>("commit_workspace_review", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async readGitFileDiffPair(
    projectId: string,
    relativePath: string,
    options?: { changeId?: string; baseline?: ReviewDiffBaseline },
  ): Promise<GitDiffPair> {
    const request = {
      ...this.workspaceRequest(projectId),
      relativePath,
      changeId: options?.changeId ?? null,
      baseline: options?.baseline ?? null,
    };
    try {
      return await invoke<GitDiffPair>("read_git_file_diff_pair", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async saveReviewCheckpoint(
    projectId: string,
    changeId: string,
  ): Promise<ChangeReviewSnapshot> {
    const request = {
      ...this.workspaceRequest(projectId),
      changeId,
    };
    try {
      return await invoke<ChangeReviewSnapshot>("save_review_checkpoint", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async addReviewComment(
    projectId: string,
    changeId: string,
    filePath: string,
    body: string,
    lineNumber?: number,
  ): Promise<ReviewComment> {
    const request = {
      ...this.workspaceRequest(projectId),
      changeId,
      filePath,
      lineNumber: lineNumber ?? null,
      body,
    };
    try {
      return await invoke<ReviewComment>("add_review_comment", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async toggleReviewCommentResolved(
    projectId: string,
    commentId: string,
    resolved: boolean,
  ): Promise<ReviewComment> {
    const request = {
      ...this.workspaceRequest(projectId),
      commentId,
      resolved,
    };
    try {
      return await invoke<ReviewComment>("toggle_review_comment_resolved", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async approveChangeReview(
    projectId: string,
    changeId: string,
    expectedSourceDigest: string,
    overrideReason?: string,
  ): Promise<ChangeReviewSnapshot> {
    const request = {
      ...this.workspaceRequest(projectId),
      changeId,
      expectedSourceDigest,
      overrideReason: overrideReason ?? null,
    };
    try {
      return await invoke<ChangeReviewSnapshot>("approve_change_review", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async requestChangeRevision(
    projectId: string,
    changeId: string,
    note?: string,
  ): Promise<ChangeReviewSnapshot> {
    const request = {
      ...this.workspaceRequest(projectId),
      changeId,
      note: note ?? null,
    };
    try {
      return await invoke<ChangeReviewSnapshot>("request_change_revision", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async prepareChangeIntegration(
    projectId: string,
    changeId: string,
    selectedPaths: string[],
    commitMessage: string,
  ): Promise<IntegrationAttempt> {
    const request = {
      ...this.workspaceRequest(projectId),
      changeId,
      selectedPaths,
      commitMessage,
    };
    try {
      return await invoke<IntegrationAttempt>("prepare_change_integration", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async executeChangeIntegration(
    projectId: string,
    changeId: string,
    attemptId: string,
  ): Promise<IntegrationAttempt> {
    const request = {
      ...this.workspaceRequest(projectId),
      changeId,
      attemptId,
    };
    try {
      return await invoke<IntegrationAttempt>("execute_change_integration", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
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

  async listProjectRecipes(projectId: string): Promise<ProjectRecipeSummary[]> {
    const request = {
      ...this.workspaceRequest(projectId),
      untrackedPath: null,
    };
    try {
      return await invoke<ProjectRecipeSummary[]>("list_project_recipes", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async runProjectRecipe(
    projectId: string,
    recipeName: string,
    changeId?: string,
  ): Promise<ExecutionRecord> {
    const request = {
      schemaVersion: IPC_SCHEMA_VERSION,
      operationId: crypto.randomUUID(),
      projectId,
      recipeName,
      changeId: changeId ?? null,
    };
    try {
      return await invoke<ExecutionRecord>("run_project_recipe", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
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

  async startRookBuild(
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
      return await invoke("start_rook_build", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async listRookSessions(sessionId: string): Promise<RookSessionSummary[]> {
    const result = await this.rookSessionRequest(sessionId, "session/list");
    return (result.sessions ?? []) as RookSessionSummary[];
  }

  async newRookSession(
    sessionId: string,
    mode: RookMode = "ask",
  ): Promise<string> {
    const result = await this.rookSessionRequest(sessionId, "session/new", {
      mode,
    });
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
        params,
      },
    });
  }

  async promptRookAsk(
    sessionId: string,
    text: string,
    context?: string,
  ): Promise<void> {
    await invoke("prompt_rook_ask", {
      request: {
        schemaVersion: IPC_SCHEMA_VERSION,
        operationId: crypto.randomUUID(),
        sessionId,
        text,
        ...(context ? { context } : {}),
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

  async listProjectFiles(projectId: string): Promise<string[]> {
    const request = this.workspaceRequest(projectId);
    try {
      return await invoke<string[]>("list_project_files", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async loadWorkspaceContinuity(
    projectId: string,
  ): Promise<WorkspaceContinuity> {
    const request = this.workspaceRequest(projectId);
    try {
      return await invoke<WorkspaceContinuity>("load_workspace_continuity", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async saveWorkspaceLayout(
    projectId: string,
    layout: {
      openTabs: string[];
      activeTab: string | null;
      splitTab: string | null;
      bottomTab: string;
      activePage: string;
    },
  ): Promise<void> {
    const request = {
      ...this.workspaceRequest(projectId),
      ...layout,
    };
    try {
      await invoke("save_workspace_layout", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async saveEditorDraft(
    projectId: string,
    relativePath: string,
    savedContent: string,
    draftContent: string,
  ): Promise<void> {
    const request = {
      ...this.workspaceRequest(projectId),
      relativePath,
      savedContent,
      draftContent,
    };
    try {
      await invoke("save_editor_draft", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async deleteEditorDraft(
    projectId: string,
    relativePath: string,
  ): Promise<void> {
    const request = {
      ...this.workspaceRequest(projectId),
      relativePath,
    };
    try {
      await invoke("delete_editor_draft", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async pruneProjectExecutions(
    projectId: string,
    keepLatest = 100,
  ): Promise<number> {
    const request = {
      ...this.workspaceRequest(projectId),
      keepLatest,
    };
    try {
      return await invoke<number>("prune_project_executions", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async listRunConfigs(projectId: string): Promise<RunConfigsResponse> {
    const request = this.workspaceRequest(projectId);
    try {
      return await invoke<RunConfigsResponse>("list_run_configs", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async listRunInstances(projectId: string): Promise<RunInstance[]> {
    const request = this.workspaceRequest(projectId);
    try {
      return await invoke<RunInstance[]>("list_run_instances", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async startRunConfig(
    projectId: string,
    name: string,
    portOverride?: number,
  ): Promise<RunInstance> {
    const request = {
      ...this.workspaceRequest(projectId),
      name,
      portOverride: portOverride ?? null,
    };
    try {
      return await invoke<RunInstance>("start_run_config", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async stopRunConfig(
    projectId: string,
    instanceId: string,
  ): Promise<RunInstance> {
    const request = {
      ...this.workspaceRequest(projectId),
      instanceId,
    };
    try {
      return await invoke<RunInstance>("stop_run_config", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async listenRunEvents(
    listener: (event: RunEvent) => void,
  ): Promise<UnlistenFn> {
    return listen<RunEvent>("laplace://run-event", (event) => {
      listener(event.payload);
    });
  }

  async getFileContext(
    projectId: string,
    relativePath: string,
    options?: { symbol?: string; cursorLine?: number },
  ): Promise<FileContextSnapshot> {
    const request = {
      ...this.workspaceRequest(projectId),
      relativePath,
      symbol: options?.symbol ?? null,
      cursorLine: options?.cursorLine ?? null,
    };
    try {
      return await invoke<FileContextSnapshot>("get_file_context", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async getFileHistory(
    projectId: string,
    relativePath: string,
  ): Promise<FileHistorySnapshot> {
    const request = {
      ...this.workspaceRequest(projectId),
      relativePath,
    };
    try {
      return await invoke<FileHistorySnapshot>("get_file_history", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async getSystemContext(projectId: string): Promise<SystemContextSnapshot> {
    const request = this.workspaceRequest(projectId);
    try {
      return await invoke<SystemContextSnapshot>("get_system_context", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async cancelContextIndex(projectId: string): Promise<boolean> {
    const request = this.workspaceRequest(projectId);
    try {
      return await invoke<boolean>("cancel_context_index", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async saveContextAnnotation(
    projectId: string,
    targetKind: "file" | "module",
    targetKey: string,
    summary: string,
  ): Promise<ContextAnnotationRecord> {
    const request = {
      ...this.workspaceRequest(projectId),
      targetKind,
      targetKey,
      summary,
    };
    try {
      return await invoke<ContextAnnotationRecord>("save_context_annotation", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async deleteContextAnnotation(
    projectId: string,
    targetKind: "file" | "module",
    targetKey: string,
  ): Promise<void> {
    const request = {
      ...this.workspaceRequest(projectId),
      targetKind,
      targetKey,
    };
    try {
      await invoke<void>("delete_context_annotation", { request });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async saveContextPinnedLink(
    projectId: string,
    sourcePath: string,
    targetPath: string,
    relationKind: "calls" | "imports" | "tests" | "documents" | "depends_on",
    note = "",
  ): Promise<ContextPinnedLinkRecord> {
    const request = {
      ...this.workspaceRequest(projectId),
      sourcePath,
      targetPath,
      relationKind,
      note,
    };
    try {
      return await invoke<ContextPinnedLinkRecord>("save_context_pinned_link", {
        request,
      });
    } catch (error) {
      throw normalizeError(error, request.operationId);
    }
  }

  async deleteContextPinnedLink(
    projectId: string,
    linkId: string,
  ): Promise<void> {
    const request = {
      ...this.workspaceRequest(projectId),
      linkId,
    };
    try {
      await invoke<void>("delete_context_pinned_link", { request });
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
