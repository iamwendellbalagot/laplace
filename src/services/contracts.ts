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

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  isGitRepository: boolean;
  lastOpenedUnixMs: number;
}

export type ProjectEntryKind = "directory" | "file" | "symlink";

export interface ProjectEntry {
  name: string;
  relativePath: string;
  kind: ProjectEntryKind;
}

export interface ProjectsRequest {
  schemaVersion: number;
  operationId: string;
}

export interface OpenProjectRequest extends ProjectsRequest {
  path: string;
}

export interface ListProjectEntriesRequest extends ProjectsRequest {
  projectId: string;
  relativePath: string;
}

export interface OpenProjectResponse {
  schemaVersion: number;
  operationId: string;
  project: ProjectSummary;
}

export interface RecentProjectsResponse {
  schemaVersion: number;
  operationId: string;
  projects: ProjectSummary[];
}

export interface ProjectEntriesResponse {
  schemaVersion: number;
  operationId: string;
  entries: ProjectEntry[];
  truncated: boolean;
}

export interface ProjectDirectoryListing {
  entries: ProjectEntry[];
  truncated: boolean;
}

export type ProjectFileReadKind = "text" | "binary" | "too_large";

export interface ProjectFileRead {
  kind: ProjectFileReadKind;
  sizeBytes: number;
  content: string | null;
}

export interface ReadProjectFileRequest extends ProjectsRequest {
  projectId: string;
  relativePath: string;
}

export interface ReadProjectFileResponse {
  schemaVersion: number;
  operationId: string;
  file: ProjectFileRead;
}

export interface SaveProjectFileRequest extends ProjectsRequest {
  projectId: string;
  relativePath: string;
  expectedContent: string;
  content: string;
}

export interface SaveProjectFileResponse {
  schemaVersion: number;
  operationId: string;
  saved: boolean;
}
