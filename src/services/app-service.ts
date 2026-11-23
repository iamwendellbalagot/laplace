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
} from "./contracts";

export interface AppService {
  ping(): Promise<PingResponse>;
  listen(listener: (event: AppEvent) => void): Promise<UnlistenFn>;
  getPreferences(): Promise<UiPreferences>;
  updatePreferences(preferences: UiPreferences): Promise<UiPreferences>;
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
