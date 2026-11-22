export const IPC_SCHEMA_VERSION = 1 as const;

export interface PingRequest {
  schemaVersion: number;
  operationId: string;
}

export interface PingResponse {
  schemaVersion: number;
  operationId: string;
  status: string;
  message: string;
}

export interface IpcError {
  schemaVersion: number;
  code: string;
  message: string;
  operationId: string;
  retryable: boolean;
}

export interface AppEvent {
  schemaVersion: number;
  operationId: string;
  workspaceId: string | null;
  sequence: number;
  timestampUnixMs: number;
  kind: string;
}

export type ThemePreference = "dark" | "light";
export type DensityPreference = "comfortable" | "compact";

export interface UiPreferences {
  theme: ThemePreference;
  density: DensityPreference;
  editorFontSize: number;
  navigationCollapsed: boolean;
  inspectorCollapsed: boolean;
  inspectorWidth: number;
}

export interface PreferencesRequest {
  schemaVersion: number;
  operationId: string;
}

export interface UpdatePreferencesRequest extends PreferencesRequest {
  preferences: UiPreferences;
}

export interface PreferencesResponse {
  schemaVersion: number;
  operationId: string;
  preferences: UiPreferences;
}
