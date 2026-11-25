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
  | "inconclusive"
  | "stale";

export interface ProjectRecipeSummary {
  name: string;
  program: string;
  args: string[];
  cwd: string | null;
}

export interface ReviewComment {
  id: string;
  changeId: string;
  filePath: string;
  lineNumber: number | null;
  body: string;
  resolved: boolean;
  createdAt: number;
}

export interface ReviewDecision {
  id: string;
  changeId: string;
  sourceDigest: string;
  headRevision: string;
  decision: "approved" | "revision_requested";
  overrideReason: string | null;
  createdAt: number;
}

export interface IntegrationAttempt {
  id: string;
  changeId: string;
  projectId: string;
  baseHead: string;
  approvedSourceDigest: string;
  commitMessage: string;
  selectedPaths: string[];
  status: "prepared" | "committing" | "succeeded" | "failed" | "aborted";
  commitSha: string | null;
  errorDetail: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GitDiffPair {
  path: string;
  status: string;
  kind: ProjectFileReadKind;
  original: string | null;
  modified: string | null;
}

export interface ChangeReviewSnapshot {
  change: ChangeRecord;
  branch: string | null;
  headRevision: string;
  sourceDigest: string;
  changedFiles: GitFileStatus[];
  gitOperationInProgress: boolean;
  hasFreshPassingCheck: boolean;
  approvalValid: boolean;
  approvalStaleReason: string | null;
  comments: ReviewComment[];
  latestDecision: ReviewDecision | null;
  latestAttempt: IntegrationAttempt | null;
  lastReviewedDigest: string | null;
  lastReviewedAt: number | null;
  changedSinceLastReview: string[];
}

export type ReviewDiffBaseline = "head" | "last_review";

export type RevertTarget = "head" | "checkpoint";

export interface WorkspaceReviewSnapshot {
  reviewId: string;
  branch: string | null;
  headRevision: string;
  sourceDigest: string;
  changedFiles: GitFileStatus[];
  gitOperationInProgress: boolean;
  hasFreshPassingCheck: boolean;
  comments: ReviewComment[];
  lastCheckpointDigest: string | null;
  lastCheckpointLabel: string | null;
  lastCheckpointAt: number | null;
  changedSinceCheckpoint: string[];
  lastCommitSha: string | null;
}

export interface WorkspaceLayoutInfo {
  packageManager: "pnpm" | "npm" | "yarn" | null;
  layout:
    | "single_package"
    | "pnpm_workspace"
    | "npm_yarn_workspaces"
    | "unsupported_yarn_pnp"
    | "non_js"
    | string;
  workspacePackages: string[];
  warnings: string[];
}

export interface RunConfigSummary {
  name: string;
  source: string;
  program: string;
  args: string[];
  cwd: string | null;
  port: number | null;
  url: string | null;
  sharedServices: string[];
}

export interface RunConfigsResponse {
  layout: WorkspaceLayoutInfo;
  configs: RunConfigSummary[];
}

export interface RunInstance {
  id: string;
  workspaceId: string;
  name: string;
  program: string;
  args: string[];
  cwd: string | null;
  status: "running" | "stopped" | "failed" | string;
  port: number | null;
  detectedUrl: string | null;
  sharedServices: string[];
  exitCode: number | null;
  output: string;
  startedAt: number;
  finishedAt: number | null;
}

export interface RunEvent {
  schemaVersion: number;
  instanceId: string;
  workspaceId: string;
  kind: "output" | "exited";
  chunk: string | null;
  status: string | null;
  detectedUrl: string | null;
  exitCode: number | null;
}

export interface WorkspaceLayoutState {
  openTabs: string[];
  activeTab: string | null;
  splitTab: string | null;
  bottomTab: "terminal" | "run" | "git" | string;
  activePage: string;
  updatedAt: number;
}

export interface EditorDraftRecord {
  relativePath: string;
  savedDigest: string;
  draftContent: string;
  matchesDisk: boolean;
  updatedAt: number;
}

export interface WorkspaceContinuity {
  layout: WorkspaceLayoutState | null;
  drafts: EditorDraftRecord[];
}

export interface RookContextChip {
  id: string;
  kind:
    | "file"
    | "selection"
    | "verify_failure"
    | "run_failure"
    | "context_bundle";
  label: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  content: string;
  sourceSnapshot?: string;
}
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

export type ContextProvenance = "observed" | "inferred" | "developer_confirmed";

export interface EditorDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  source?: string;
}

export interface FileSymbol {
  name: string;
  kind: string;
  line: number;
  exported: boolean;
}

export interface SymbolReference {
  filePath: string;
  line: number;
  preview: string;
  provenance: ContextProvenance;
  evidence: string;
}

export interface ContextRelation {
  id: string;
  sourcePath: string;
  sourceLine: number | null;
  targetPath: string;
  relationKind: string;
  provenance: ContextProvenance;
  evidence: string;
  stale: boolean;
  pinnedLinkId: string | null;
}

export interface ContextAnnotationRecord {
  id: string;
  targetKind: "file" | "module" | string;
  targetKey: string;
  summary: string;
  provenance: ContextProvenance;
  sourceDigest: string;
  stale: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ContextPinnedLinkRecord {
  id: string;
  sourcePath: string;
  targetPath: string;
  relationKind: string;
  note: string;
  sourceDigest: string;
  stale: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FileContextSnapshot {
  filePath: string;
  language: string;
  fileDigest: string;
  symbols: FileSymbol[];
  activeSymbol: FileSymbol | null;
  queriedSymbol: string | null;
  symbolReferences: SymbolReference[];
  imports: ContextRelation[];
  importers: ContextRelation[];
  relatedTests: ContextRelation[];
  annotation: ContextAnnotationRecord | null;
  pinnedLinks: ContextPinnedLinkRecord[];
  indexedFileCount: number;
  truncated: boolean;
  cancelled: boolean;
}

export interface FileHistoryCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  committedAt: number;
}

export interface FileHistoryCheckpoint {
  id: string;
  label: string;
  sourceDigest: string;
  createdAt: number;
}

export interface FileHistoryCheck {
  id: string;
  command: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
}

export interface FileHistorySnapshot {
  filePath: string;
  commits: FileHistoryCommit[];
  checkpoints: FileHistoryCheckpoint[];
  notes: ReviewComment[];
  checks: FileHistoryCheck[];
}

export interface SystemModuleNode {
  key: string;
  label: string;
  primaryFile: string;
  files: string[];
  fileCount: number;
  incomingCount: number;
  outgoingCount: number;
  digest: string;
  annotation: ContextAnnotationRecord | null;
}

export interface SystemModuleEdge {
  id: string;
  sourceModule: string;
  targetModule: string;
  referenceCount: number;
  sampleSourcePath: string;
  sampleSourceLine: number | null;
  sampleTargetPath: string;
  provenance: ContextProvenance;
}

export interface SystemContextSnapshot {
  modules: SystemModuleNode[];
  edges: SystemModuleEdge[];
  relationships: ContextRelation[];
  annotations: ContextAnnotationRecord[];
  pinnedLinks: ContextPinnedLinkRecord[];
  recentCommits: FileHistoryCommit[];
  indexedFileCount: number;
  truncated: boolean;
  cancelled: boolean;
}
