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

export type ImpactRole =
  | "ui"
  | "state"
  | "api_service"
  | "backend"
  | "tests"
  | "config_docs"
  | string;

export interface ImpactedCaller {
  filePath: string;
  line: number | null;
  provenance: "observed" | "inferred" | string;
  evidence: string;
  alsoChanged: boolean;
}

export interface ImpactedTest {
  filePath: string;
  provenance: "observed" | "inferred" | string;
  evidence: string;
  alsoChanged: boolean;
}

export interface StaleContextNote {
  filePath: string;
  summary: string;
  updatedAt: number;
}

export interface ImpactFileAnalysis {
  path: string;
  role: ImpactRole;
  summary: string;
  directCallers: ImpactedCaller[];
  relatedTests: ImpactedTest[];
  staleNote: StaleContextNote | null;
}

export interface ImpactWarning {
  kind: string;
  severity: "high" | "medium" | "info" | string;
  message: string;
  paths: string[];
}

export interface RecommendedCheck {
  id: string;
  label: string;
  program: string;
  args: string[];
  recipeName: string | null;
  reason: string;
  latestStatus: ExecutionStatus | null;
  latestExecutionId: string | null;
  isFresh: boolean;
}

export interface WorkspaceImpactReport {
  projectId: string;
  sourceDigest: string;
  changedFilesCount: number;
  files: ImpactFileAnalysis[];
  warnings: ImpactWarning[];
  recommendedChecks: RecommendedCheck[];
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
export interface ExecutionEnvironment {
  os: string;
  arch: string;
  cwd: string;
  programVersion: string | null;
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
  environment?: ExecutionEnvironment | null;
}

export interface NormalizationRules {
  stripAnsi: boolean;
  stripTimestamps: boolean;
  stripDurations: boolean;
  trimTrailingWhitespace: boolean;
}

export type ComparisonOutcome =
  | "equal"
  | "different"
  | "regressed"
  | "fixed"
  | "baseline_failed"
  | "missing_artifact"
  | "inconclusive";

export interface ComparisonWarning {
  code: string;
  message: string;
}

export interface ComparisonDiffLine {
  kind: "context" | "removed" | "added" | string;
  baselineLine: number | null;
  candidateLine: number | null;
  text: string;
}

export interface ComparisonRunSummary {
  executionId: string;
  present: boolean;
  command: string;
  sourceDigest: string;
  status: string;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  environment: ExecutionEnvironment | null;
}

export interface BehaviorComparisonRecord {
  id: string;
  projectId: string;
  changeId: string | null;
  label: string;
  baselineExecutionId: string;
  candidateExecutionId: string;
  baseline: ComparisonRunSummary;
  candidate: ComparisonRunSummary;
  normalization: NormalizationRules;
  outcome: ComparisonOutcome;
  outputsEqual: boolean;
  warnings: ComparisonWarning[];
  sharedServices: string[];
  diffLines: ComparisonDiffLine[];
  diffTruncated: boolean;
  observedScope: string;
  notCheckedScope: string;
  createdAt: number;
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

export interface CapabilitySkillSummary {
  name: string;
  description: string;
  scope: "project" | "global" | string;
  precedence: "active" | "shadowed" | string;
  baseDir: string;
  skillFilePath: string;
  digest: string;
}

export interface CapabilityMcpServerSummary {
  name: string;
  scope: "global" | "project" | string;
  sourcePath: string;
  overridePath: string | null;
  transport: "stdio" | "http" | "invalid" | string;
  target: string;
  configured: "valid" | "invalid" | string;
  configEnabled: boolean;
  enabled: boolean;
  connected: boolean;
  connectionStatus:
    | "blocked_by_stdio_policy"
    | "disabled"
    | "untrusted_project"
    | "invalid_config"
    | string;
  connectionNote: string;
  authorizationPolicy: "approval_required" | string;
  authorizationNote: string;
  exposure: string;
  redactedHeaders: string[];
  errors: string[];
}

export interface CapabilityWorkspaceProviderSummary {
  id: string;
  endpoint: string | null;
  endpointFingerprint: string;
  missingEnvironmentVariables: string[];
  source: string;
}

export interface RookParityItem {
  id: string;
  feature: string;
  status: "native" | "terminal_handoff" | "blocked_protocol" | string;
  detail: string;
  terminalCommand?: string | null;
}

export interface CapabilityActivityRecord {
  id: string;
  projectId: string;
  sessionId: string | null;
  capabilityKind: string;
  capabilityName: string;
  sourceScope: string;
  decision: string;
  detail: string;
  createdAt: number;
}

export interface CapabilitiesSnapshot {
  runtimeSource: "rook_stdio" | "disk_fallback" | string;
  arbitraryMcpEnabled: boolean;
  projectTrusted: boolean;
  unreviewedProjectChanges: boolean;
  changedProjectAreas: string[];
  acknowledgedAt: number | null;
  skillDirectories: { project: string; global: string };
  mcpConfigPaths: { project: string; global: string };
  skills: CapabilitySkillSummary[];
  mcpServers: CapabilityMcpServerSummary[];
  mcpErrors: string[];
  workspaceProviders: CapabilityWorkspaceProviderSummary[];
  parityInventory: RookParityItem[];
  recentActivity: CapabilityActivityRecord[];
}

export interface SkillInspectResult {
  name: string;
  scope: string;
  skillFilePath: string;
  digest: string;
  content: string;
  truncated: boolean;
}

export interface McpServerUpdateInput {
  action: "toggle" | "add" | "remove";
  scope: "global" | "project";
  name: string;
  enabled?: boolean;
  transport?: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
}

export interface RuntimeDiagnostics {
  appVersion: string;
  os: string;
  arch: string;
  buildProfile: "development" | "release" | string;
  schemaVersion: number;
  expectedSchemaVersion: number;
  backupCount: number;
  rookSource: "bundled" | "dev_checkout" | string;
  rookVersion: string | null;
  nodeVersion: string | null;
  rookError: string | null;
  networkPolicy: string;
}

export interface WorkspacePulse {
  projectId: string;
  isGitRepository: boolean;
  branch: string | null;
  headSha: string | null;
  ahead: number;
  behind: number;
  dirtyCount: number;
  untrackedCount: number;
  latestExecutionStatus: string | null;
  latestExecutionCommand: string | null;
  latestExecutionDigest: string | null;
  latestExecutionAt: number | null;
  activeBuildRunning: boolean;
}

export interface WorkspaceFsChangedEvent {
  schemaVersion: number;
  projectId: string;
  paths: string[];
  rescanRequired: boolean;
  timestampMs: number;
}

export interface CreateProjectEntryRequest extends ProjectsRequest {
  projectId: string;
  relativePath: string;
  kind: "file" | "directory";
}

export interface CreateProjectEntryResponse {
  schemaVersion: number;
  operationId: string;
  entry: ProjectEntry;
}

export interface RenameProjectEntryRequest extends ProjectsRequest {
  projectId: string;
  fromRelativePath: string;
  toRelativePath: string;
}

export interface DeleteProjectEntryRequest extends ProjectsRequest {
  projectId: string;
  relativePath: string;
  recursive: boolean;
}

export interface DeleteProjectEntryResponse {
  schemaVersion: number;
  operationId: string;
  deleted: boolean;
}

export interface SearchProjectRequest extends ProjectsRequest {
  projectId: string;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  maxResults?: number;
}

export interface SearchMatch {
  line: number;
  column: number;
  matchLength: number;
  lineText: string;
}

export interface SearchFileMatches {
  relativePath: string;
  matches: SearchMatch[];
}

export interface SearchProjectResponse {
  schemaVersion: number;
  operationId: string;
  files: SearchFileMatches[];
  totalMatches: number;
  searchedFiles: number;
  truncated: boolean;
}

export interface ProjectSymbolEntry {
  name: string;
  kind: string;
  filePath: string;
  line: number;
}

export interface WorktreeChangedFile {
  path: string;
  status: string;
  conflictsWithMain: boolean;
  diff: string;
}

export interface WorktreeExperimentSnapshot {
  worktreePath: string;
  branch: string | null;
  files: WorktreeChangedFile[];
  conflictCount: number;
}

export interface WorktreeApplyResult {
  appliedFiles: string[];
  removedWorktree: boolean;
}
