import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  IPC_SCHEMA_VERSION,
  type AppEvent,
  type IpcError,
  type PingRequest,
  type PingResponse,
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
