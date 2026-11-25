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

export interface RookDevSettings {
  enabled: boolean;
  checkoutPath: string | null;
}

export interface RookDevSettingsRequest extends PreferencesRequest {
  checkoutPath: string | null;
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

export interface GitFileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}

export interface GitStatus {
  branch: string | null;
  files: GitFileStatus[];
}

export interface TerminalEvent {
  schemaVersion: number;
  operationId: string;
  sessionId: string;
  workspaceId: string;
  kind: "output" | "exited";
  data: string | null;
  exitCode: number | null;
}

export type ChangeStatus =
  | "draft"
  | "active"
  | "in_review"
  | "approved"
  | "integrated"
  | "abandoned";
export interface ChangeRecord {
  id: string;
  projectId: string;
  objective: string;
  status: ChangeStatus;
  createdAt: number;
  updatedAt: number;
}

export interface WorktreeRecord {
  changeId: string;
  path: string;
  branch: string;
  baseRevision: string;
}

export type ExecutionStatus =
  | "running"
  | "passed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "start_failed"
  | "interrupted"
  | "inconclusive";
export interface ExecutionRecord {
  id: string;
  projectId: string;
  changeId: string | null;
  program: string;
  args: string[];
  sourceDigest: string;
  files: string[];
  status: ExecutionStatus;
  exitCode: number | null;
  output: string;
  startedAt: number;
  finishedAt: number | null;
}

export type RookMode = "ask" | "build";

export interface RookSandboxStatus {
  enabled: boolean;
  runtime: "seatbelt" | "bwrap" | null;
  available: boolean;
}

export interface RookInitResponse {
  sessionId: string;
  activeSessionId?: string;
  sessions?: RookSessionSummary[];
  messages?: RookSessionMessage[];
  hostSessionStorage?: boolean;
  mode?: RookMode;
  sandbox?: RookSandboxStatus | null;
  workspaceId: string;
  rookVersion: string;
  capabilities: Record<string, unknown>;
  providers: RookProvider[];
  currentModel: RookModel | null;
}

export interface RookSessionSummary {
  id: string;
  name: string | null;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

export interface RookSessionMessage {
  role: "user" | "assistant";
  text: string;
}

export interface RookProvider {
  id: string;
  name: string;
  configured: boolean;
  source: "provider" | "workspace";
  endpoint?: string;
  endpointFingerprint?: string;
  missingEnvironmentVariables?: string[];
  authMethods: {
    type: "api_key" | "oauth";
    name: string;
    isSubscription?: boolean;
    loginLabel?: string;
  }[];
}

export interface RookModel {
  provider: string;
  id: string;
  name: string;
  source?: "provider" | "workspace";
  endpoint?: string | null;
  configured?: boolean;
  missingEnvironmentVariables?: string[];
}

export interface RookAuthPrompt {
  type: "text" | "secret" | "manual_code" | "select";
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
}

export interface RookAuthEvent {
  loginId?: string;
  type: "info" | "auth_url" | "device_code" | "progress";
  message?: string;
  url?: string;
  instructions?: string;
  links?: { url: string; label?: string }[];
  userCode?: string;
  verificationUri?: string;
  openBrowserOnConfirm?: boolean;
  copyCodeOnConfirm?: boolean;
  intervalSeconds?: number;
  expiresInSeconds?: number;
}

export interface RookEvent {
  sessionId: string;
  message: Record<string, unknown>;
}
export type RookPermissionChoice = "once" | "session" | "deny";
