use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    process::Stdio,
};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};
use tauri::{Emitter, Manager};

const IPC_SCHEMA_VERSION: u16 = 1;
const EVENT_NAME: &str = "app-event";
static EVENT_SEQUENCE: AtomicU32 = AtomicU32::new(1);
static PREFERENCES_LOCK: Mutex<()> = Mutex::new(());
static RECENT_PROJECTS_LOCK: Mutex<()> = Mutex::new(());
const MAX_RECENT_PROJECTS: usize = 12;
const MAX_DIRECTORY_ENTRIES: usize = 1_000;
const MAX_PROJECT_FILE_BYTES: u64 = 1_048_576;
const IGNORED_DIRECTORY_NAMES: &[&str] = &[".git", ".rook", "node_modules", "target", "dist"];
const TERMINAL_EVENT_NAME: &str = "terminal-event";
const MAX_TERMINAL_WRITE_BYTES: usize = 64 * 1024;
static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Default)]
struct DomainDatabase(Mutex<Option<SqlitePool>>);

#[derive(Default)]
struct RookProcesses(Mutex<HashMap<String, Arc<Mutex<RookProcess>>>>);

struct RookProcess {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
}

impl Drop for RookProcesses {
    fn drop(&mut self) {
        if let Ok(processes) = self.0.get_mut() {
            for process in processes.values() {
                if let Ok(mut process) = process.lock() {
                    let _ = process.child.kill();
                }
            }
        }
    }
}

impl RookProcesses {
    fn stop(&self, session_id: &str, operation_id: &str) -> Result<(), IpcError> {
        let child = self
            .0
            .lock()
            .map_err(|_| {
                terminal_error(
                    "rook_busy",
                    "Rook sessions are temporarily unavailable.",
                    operation_id,
                )
            })?
            .remove(session_id);
        if let Some(child) = child {
            let mut process = child.lock().map_err(|_| {
                terminal_error(
                    "rook_busy",
                    "Rook session shutdown is temporarily unavailable.",
                    operation_id,
                )
            })?;
            let _ = writeln!(
                process.stdin,
                "{}",
                serde_json::json!({"jsonrpc":"2.0","id":99,"method":"shutdown"})
            );
            let _ = process.child.kill();
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ChangeStatus {
    Draft,
    Active,
    InReview,
    Approved,
    Integrated,
    Abandoned,
}

impl ChangeStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Active => "active",
            Self::InReview => "in_review",
            Self::Approved => "approved",
            Self::Integrated => "integrated",
            Self::Abandoned => "abandoned",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ChangeRecord {
    id: String,
    project_id: String,
    objective: String,
    status: ChangeStatus,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    change_id: Option<String>,
    objective: Option<String>,
    status: Option<ChangeStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunCheckRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    change_id: Option<String>,
    program: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ExecutionStatus {
    Running,
    Passed,
    Failed,
    Cancelled,
    TimedOut,
    StartFailed,
    Interrupted,
    Inconclusive,
    Stale,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ExecutionRecord {
    id: String,
    project_id: String,
    change_id: Option<String>,
    program: String,
    args: Vec<String>,
    source_digest: String,
    files: Vec<String>,
    file_digests: Vec<(String, String)>,
    status: ExecutionStatus,
    exit_code: Option<i64>,
    output: String,
    started_at: i64,
    finished_at: Option<i64>,
}

#[derive(Default)]
struct TerminalSessions(Mutex<HashMap<String, Arc<TerminalSession>>>);

#[derive(Default)]
struct TrustedWorkspaces(Mutex<HashSet<String>>);
static VERIFY_CANCELLED: AtomicBool = AtomicBool::new(false);
static VERIFY_RUNNING: AtomicBool = AtomicBool::new(false);

impl TrustedWorkspaces {
    fn contains(&self, path: &Path) -> Result<bool, IpcError> {
        let canonical = fs::canonicalize(path).map_err(|_| {
            terminal_error(
                "workspace_unavailable",
                "The workspace is no longer available.",
                "trust",
            )
        })?;
        Ok(self
            .0
            .lock()
            .map_err(|_| {
                terminal_error(
                    "trust_unavailable",
                    "Workspace trust is temporarily unavailable.",
                    "trust",
                )
            })?
            .contains(&canonical.to_string_lossy().into_owned()))
    }
}

impl Drop for TerminalSessions {
    fn drop(&mut self) {
        if let Ok(sessions) = self.0.get_mut() {
            for session in sessions.values() {
                if let Ok(mut killer) = session.killer.lock() {
                    let _ = killer.kill();
                }
            }
        }
    }
}

impl TerminalSessions {
    fn stop_workspace(&self, workspace_id: &str) {
        let sessions = self
            .0
            .lock()
            .ok()
            .map(|mut sessions| {
                let ids: Vec<String> = sessions
                    .iter()
                    .filter(|(_, session)| session.workspace_id == workspace_id)
                    .map(|(id, _)| id.clone())
                    .collect();
                ids.into_iter()
                    .filter_map(|id| sessions.remove(&id))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for session in sessions {
            if let Ok(mut killer) = session.killer.lock() {
                let _ = killer.kill();
            }
        }
    }
}

struct TerminalSession {
    workspace_id: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    output_bytes: AtomicU64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct TerminalRequest {
    schema_version: u16,
    operation_id: String,
    session_id: String,
    workspace_id: String,
    data: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct TerminalEvent {
    schema_version: u16,
    operation_id: String,
    session_id: String,
    workspace_id: String,
    kind: String,
    data: Option<String>,
    exit_code: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PingRequest {
    pub schema_version: u16,
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PingResponse {
    pub schema_version: u16,
    pub operation_id: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub schema_version: u16,
    pub code: String,
    pub message: String,
    pub operation_id: String,
    pub retryable: bool,
}

impl IpcError {
    fn new(code: &str, message: &str, operation_id: String, retryable: bool) -> Self {
        Self {
            schema_version: IPC_SCHEMA_VERSION,
            code: code.to_owned(),
            message: message.to_owned(),
            operation_id,
            retryable,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ThemePreference {
    Dark,
    Light,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DensityPreference {
    Comfortable,
    Compact,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferences {
    pub theme: ThemePreference,
    pub density: DensityPreference,
    pub editor_font_size: u8,
    pub navigation_collapsed: bool,
    pub inspector_collapsed: bool,
    pub inspector_width: u16,
}

impl Default for UiPreferences {
    fn default() -> Self {
        Self {
            theme: ThemePreference::Dark,
            density: DensityPreference::Comfortable,
            editor_font_size: 12,
            navigation_collapsed: false,
            inspector_collapsed: false,
            inspector_width: 286,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesRequest {
    pub schema_version: u16,
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferencesRequest {
    pub schema_version: u16,
    pub operation_id: String,
    pub preferences: UiPreferences,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesResponse {
    pub schema_version: u16,
    pub operation_id: String,
    pub preferences: UiPreferences,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_git_repository: bool,
    pub last_opened_unix_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectEntryKind {
    Directory,
    File,
    Symlink,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: ProjectEntryKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectRequest {
    pub schema_version: u16,
    pub operation_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsRequest {
    pub schema_version: u16,
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectEntriesRequest {
    pub schema_version: u16,
    pub operation_id: String,
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectResponse {
    pub schema_version: u16,
    pub operation_id: String,
    pub project: ProjectSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentProjectsResponse {
    pub schema_version: u16,
    pub operation_id: String,
    pub projects: Vec<ProjectSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntriesResponse {
    pub schema_version: u16,
    pub operation_id: String,
    pub entries: Vec<ProjectEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectFileReadKind {
    Text,
    Binary,
    TooLarge,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileRead {
    pub kind: ProjectFileReadKind,
    pub size_bytes: u64,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadProjectFileRequest {
    pub schema_version: u16,
    pub operation_id: String,
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadProjectFileResponse {
    pub schema_version: u16,
    pub operation_id: String,
    pub file: ProjectFileRead,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectFileRequest {
    pub schema_version: u16,
    pub operation_id: String,
    pub project_id: String,
    pub relative_path: String,
    pub expected_content: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectFileResponse {
    pub schema_version: u16,
    pub operation_id: String,
    pub saved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppEventKind {
    PingCompleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppEvent {
    pub schema_version: u16,
    pub operation_id: String,
    pub workspace_id: Option<String>,
    pub sequence: u32,
    pub timestamp_unix_ms: u64,
    pub kind: AppEventKind,
}

#[tauri::command]
async fn ping(app: tauri::AppHandle, request: PingRequest) -> Result<PingResponse, IpcError> {
    let response = validate_ping(request)?;
    let timestamp_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let event = AppEvent {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: response.operation_id.clone(),
        workspace_id: None,
        sequence: EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed),
        timestamp_unix_ms,
        kind: AppEventKind::PingCompleted,
    };
    app.emit(EVENT_NAME, event).map_err(|_| {
        IpcError::new(
            "event_delivery_failed",
            "The native event could not be delivered.",
            response.operation_id.clone(),
            true,
        )
    })?;
    Ok(response)
}

fn validate_ping(request: PingRequest) -> Result<PingResponse, IpcError> {
    let safe_operation_id = if (1..=64).contains(&request.operation_id.len())
        && request.operation_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        }) {
        request.operation_id.clone()
    } else {
        String::new()
    };

    if request.schema_version != IPC_SCHEMA_VERSION {
        return Err(IpcError::new(
            "unsupported_schema",
            "This frontend/backend IPC schema version is not supported.",
            safe_operation_id,
            false,
        ));
    }
    if safe_operation_id.is_empty() {
        return Err(IpcError::new(
            "invalid_operation_id",
            "operationId must contain 1–64 ASCII letters, digits, hyphens, or underscores.",
            String::new(),
            false,
        ));
    }

    Ok(PingResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: safe_operation_id,
        status: "ok".to_owned(),
        message: "Native command/event round trip succeeded.".to_owned(),
    })
}

fn validate_operation_id(operation_id: &str) -> bool {
    (1..=64).contains(&operation_id.len())
        && operation_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

fn validate_preferences(preferences: &UiPreferences) -> bool {
    (10..=24).contains(&preferences.editor_font_size)
        && (220..=480).contains(&preferences.inspector_width)
}

fn preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, IpcError> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("preferences.json"))
        .map_err(|_| {
            IpcError::new(
                "preferences_path_unavailable",
                "Laplace could not locate its preferences directory.",
                String::new(),
                true,
            )
        })
}

fn read_preferences(path: &std::path::Path) -> Result<UiPreferences, IpcError> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            IpcError::new(
                "preferences_invalid",
                "Laplace preferences could not be read. Existing data was left unchanged.",
                String::new(),
                false,
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(UiPreferences::default()),
        Err(_) => Err(IpcError::new(
            "preferences_read_failed",
            "Laplace preferences could not be read.",
            String::new(),
            true,
        )),
    }
}

fn write_preferences(
    path: &std::path::Path,
    preferences: &UiPreferences,
    operation_id: &str,
) -> Result<(), IpcError> {
    let _guard = PREFERENCES_LOCK.lock().map_err(|_| {
        IpcError::new(
            "preferences_busy",
            "Laplace preferences are temporarily unavailable.",
            operation_id.to_owned(),
            true,
        )
    })?;
    let parent = path.parent().ok_or_else(|| {
        IpcError::new(
            "preferences_path_invalid",
            "Laplace preferences could not be saved.",
            operation_id.to_owned(),
            false,
        )
    })?;
    fs::create_dir_all(parent).map_err(|_| {
        IpcError::new(
            "preferences_write_failed",
            "Laplace preferences could not be saved.",
            operation_id.to_owned(),
            true,
        )
    })?;

    let temporary_path = parent.join(format!(".preferences-{operation_id}.tmp"));
    let bytes = serde_json::to_vec_pretty(preferences).map_err(|_| {
        IpcError::new(
            "preferences_encode_failed",
            "Laplace preferences could not be saved.",
            operation_id.to_owned(),
            false,
        )
    })?;
    fs::write(&temporary_path, bytes).map_err(|_| {
        IpcError::new(
            "preferences_write_failed",
            "Laplace preferences could not be saved.",
            operation_id.to_owned(),
            true,
        )
    })?;

    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|_| {
            IpcError::new(
                "preferences_replace_failed",
                "Laplace preferences could not be replaced.",
                operation_id.to_owned(),
                true,
            )
        })?;
    }
    if fs::rename(&temporary_path, path).is_err() {
        let _ = fs::remove_file(&temporary_path);
        return Err(IpcError::new(
            "preferences_replace_failed",
            "Laplace preferences could not be saved.",
            operation_id.to_owned(),
            true,
        ));
    }
    Ok(())
}

fn preferences_error_with_operation(error: IpcError, operation_id: &str) -> IpcError {
    IpcError {
        operation_id: operation_id.to_owned(),
        ..error
    }
}

#[tauri::command]
async fn get_preferences(
    app: tauri::AppHandle,
    request: PreferencesRequest,
) -> Result<PreferencesResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION {
        return Err(IpcError::new(
            "unsupported_schema",
            "This frontend/backend IPC schema version is not supported.",
            request.operation_id,
            false,
        ));
    }
    if !validate_operation_id(&request.operation_id) {
        return Err(IpcError::new(
            "invalid_operation_id",
            "operationId must contain 1–64 ASCII letters, digits, hyphens, or underscores.",
            String::new(),
            false,
        ));
    }
    let path = preferences_path(&app)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    let preferences = read_preferences(&path)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    Ok(PreferencesResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        preferences,
    })
}

#[tauri::command]
async fn update_preferences(
    app: tauri::AppHandle,
    request: UpdatePreferencesRequest,
) -> Result<PreferencesResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION {
        return Err(IpcError::new(
            "unsupported_schema",
            "This frontend/backend IPC schema version is not supported.",
            request.operation_id,
            false,
        ));
    }
    if !validate_operation_id(&request.operation_id) {
        return Err(IpcError::new(
            "invalid_operation_id",
            "operationId must contain 1–64 ASCII letters, digits, hyphens, or underscores.",
            String::new(),
            false,
        ));
    }
    if !validate_preferences(&request.preferences) {
        return Err(IpcError::new(
            "preferences_out_of_range",
            "Preference values are outside supported ranges.",
            request.operation_id,
            false,
        ));
    }
    let path = preferences_path(&app)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    write_preferences(&path, &request.preferences, &request.operation_id)?;
    Ok(PreferencesResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        preferences: request.preferences,
    })
}

fn recent_projects_path(app: &tauri::AppHandle) -> Result<PathBuf, IpcError> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("recent-projects.json"))
        .map_err(|_| {
            IpcError::new(
                "projects_path_unavailable",
                "Laplace could not locate its project history directory.",
                String::new(),
                true,
            )
        })
}

fn read_recent_projects(path: &Path) -> Result<Vec<ProjectSummary>, IpcError> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            IpcError::new(
                "project_history_invalid",
                "Laplace project history could not be read. Existing data was left unchanged.",
                String::new(),
                false,
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err(IpcError::new(
            "project_history_read_failed",
            "Laplace project history could not be read.",
            String::new(),
            true,
        )),
    }
}

fn write_recent_projects(path: &Path, projects: &[ProjectSummary]) -> Result<(), IpcError> {
    let _guard = RECENT_PROJECTS_LOCK.lock().map_err(|_| {
        IpcError::new(
            "project_history_busy",
            "Laplace project history is temporarily unavailable.",
            String::new(),
            true,
        )
    })?;
    let parent = path.parent().ok_or_else(|| {
        IpcError::new(
            "projects_path_invalid",
            "Laplace project history could not be saved.",
            String::new(),
            false,
        )
    })?;
    fs::create_dir_all(parent).map_err(|_| {
        IpcError::new(
            "project_history_write_failed",
            "Laplace project history could not be saved.",
            String::new(),
            true,
        )
    })?;
    let temporary_path = parent.join(".recent-projects.tmp");
    let bytes = serde_json::to_vec_pretty(projects).map_err(|_| {
        IpcError::new(
            "project_history_encode_failed",
            "Laplace project history could not be saved.",
            String::new(),
            false,
        )
    })?;
    fs::write(&temporary_path, bytes).map_err(|_| {
        IpcError::new(
            "project_history_write_failed",
            "Laplace project history could not be saved.",
            String::new(),
            true,
        )
    })?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|_| {
            IpcError::new(
                "project_history_replace_failed",
                "Laplace project history could not be replaced.",
                String::new(),
                true,
            )
        })?;
    }
    if fs::rename(&temporary_path, path).is_err() {
        let _ = fs::remove_file(&temporary_path);
        return Err(IpcError::new(
            "project_history_replace_failed",
            "Laplace project history could not be saved.",
            String::new(),
            true,
        ));
    }
    Ok(())
}

fn path_text(path: &Path) -> Result<String, IpcError> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        IpcError::new(
            "path_encoding_unsupported",
            "This project path cannot be represented as Unicode on this platform.",
            String::new(),
            false,
        )
    })
}

fn detect_git_root(directory: &Path) -> PathBuf {
    let mut current = Some(directory);
    while let Some(path) = current {
        if path.join(".git").exists() {
            return path.to_path_buf();
        }
        current = path.parent();
    }
    directory.to_path_buf()
}

fn project_summary(path: &Path, last_opened_unix_ms: u64) -> Result<ProjectSummary, IpcError> {
    let canonical = fs::canonicalize(path).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The selected project folder is no longer available.",
            String::new(),
            true,
        )
    })?;
    if !canonical.is_dir() {
        return Err(IpcError::new(
            "project_not_directory",
            "Select a folder to open as a project.",
            String::new(),
            false,
        ));
    }
    let root = detect_git_root(&canonical);
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Project")
        .to_owned();
    let path = path_text(&root)?;
    Ok(ProjectSummary {
        id: path.clone(),
        name,
        path,
        is_git_repository: root.join(".git").exists(),
        last_opened_unix_ms,
    })
}

fn open_project_path(
    path: &Path,
    recent_projects: &mut Vec<ProjectSummary>,
) -> Result<ProjectSummary, IpcError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0);
    let project = project_summary(path, now)?;
    recent_projects.retain(|recent| recent.id != project.id);
    recent_projects.insert(0, project.clone());
    recent_projects.truncate(MAX_RECENT_PROJECTS);
    Ok(project)
}

fn resolve_project_directory(project_id: &str, relative_path: &str) -> Result<PathBuf, IpcError> {
    let root = fs::canonicalize(project_id).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The project folder is no longer available. Reopen it from the folder picker.",
            String::new(),
            true,
        )
    })?;
    if !root.is_dir() {
        return Err(IpcError::new(
            "project_not_directory",
            "The project location is not a folder.",
            String::new(),
            false,
        ));
    }
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(IpcError::new(
            "invalid_relative_path",
            "The requested folder must stay inside the open project.",
            String::new(),
            false,
        ));
    }
    let candidate = root.join(relative);
    let directory = fs::canonicalize(&candidate).map_err(|_| {
        IpcError::new(
            "project_path_unavailable",
            "That folder is no longer available inside the project.",
            String::new(),
            true,
        )
    })?;
    if !directory.starts_with(&root) {
        return Err(IpcError::new(
            "project_path_escape",
            "The requested folder resolves outside the open project.",
            String::new(),
            false,
        ));
    }
    if !directory.is_dir() {
        return Err(IpcError::new(
            "project_path_not_directory",
            "The requested project entry is not a folder.",
            String::new(),
            false,
        ));
    }
    Ok(directory)
}

fn read_project_entries(
    project_id: &str,
    relative_path: &str,
) -> Result<(Vec<ProjectEntry>, bool), IpcError> {
    let directory = resolve_project_directory(project_id, relative_path)?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in fs::read_dir(directory).map_err(|_| {
        IpcError::new(
            "project_directory_read_failed",
            "This project folder could not be read.",
            String::new(),
            true,
        )
    })? {
        if entries.len() == MAX_DIRECTORY_ENTRIES {
            truncated = true;
            break;
        }
        let entry = entry.map_err(|_| {
            IpcError::new(
                "project_entry_read_failed",
                "A project entry could not be read.",
                String::new(),
                true,
            )
        })?;
        let name = match entry.file_name().to_str() {
            Some(name) => name.to_owned(),
            None => continue,
        };
        if IGNORED_DIRECTORY_NAMES.contains(&name.as_str()) {
            continue;
        }
        let file_type = entry.file_type().map_err(|_| {
            IpcError::new(
                "project_entry_type_failed",
                "A project entry type could not be determined.",
                String::new(),
                true,
            )
        })?;
        let kind = if file_type.is_symlink() {
            ProjectEntryKind::Symlink
        } else if file_type.is_dir() {
            ProjectEntryKind::Directory
        } else {
            ProjectEntryKind::File
        };
        let entry_path = Path::new(relative_path).join(&name);
        entries.push(ProjectEntry {
            name,
            relative_path: path_text(&entry_path)?,
            kind,
        });
    }
    entries.sort_by(|left, right| {
        let left_directory = left.kind == ProjectEntryKind::Directory;
        let right_directory = right.kind == ProjectEntryKind::Directory;
        right_directory
            .cmp(&left_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok((entries, truncated))
}

fn read_project_file_contents(
    project_id: &str,
    relative_path: &str,
) -> Result<ProjectFileRead, IpcError> {
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(IpcError::new(
            "invalid_relative_path",
            "Select a file inside the open project.",
            String::new(),
            false,
        ));
    }
    let root = fs::canonicalize(project_id).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The project folder is no longer available. Reopen it from the folder picker.",
            String::new(),
            true,
        )
    })?;
    let mut path = root.clone();
    for component in relative.components() {
        if let Component::Normal(name) = component {
            path.push(name);
            let link_metadata = fs::symlink_metadata(&path).map_err(|_| {
                IpcError::new(
                    "project_file_unavailable",
                    "That file is no longer available inside the project.",
                    String::new(),
                    true,
                )
            })?;
            if link_metadata.file_type().is_symlink() {
                return Err(IpcError::new(
                    "project_file_symlink",
                    "Symbolic links are not followed by the project preview.",
                    String::new(),
                    false,
                ));
            }
        }
    }
    let canonical = fs::canonicalize(&path).map_err(|_| {
        IpcError::new(
            "project_file_unavailable",
            "That file is no longer available inside the project.",
            String::new(),
            true,
        )
    })?;
    if !canonical.starts_with(&root) {
        return Err(IpcError::new(
            "project_path_escape",
            "The requested file resolves outside the open project.",
            String::new(),
            false,
        ));
    }
    let metadata = fs::metadata(&canonical).map_err(|_| {
        IpcError::new(
            "project_file_read_failed",
            "This project file could not be inspected.",
            String::new(),
            true,
        )
    })?;
    if !metadata.is_file() {
        return Err(IpcError::new(
            "project_entry_not_file",
            "Select a regular file to preview.",
            String::new(),
            false,
        ));
    }
    if metadata.len() > MAX_PROJECT_FILE_BYTES {
        return Ok(ProjectFileRead {
            kind: ProjectFileReadKind::TooLarge,
            size_bytes: metadata.len(),
            content: None,
        });
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    let mut file = fs::File::open(canonical).map_err(|_| {
        IpcError::new(
            "project_file_read_failed",
            "This project file could not be read.",
            String::new(),
            true,
        )
    })?;
    Read::by_ref(&mut file)
        .take(MAX_PROJECT_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            IpcError::new(
                "project_file_read_failed",
                "This project file could not be read.",
                String::new(),
                true,
            )
        })?;
    if bytes.len() as u64 > MAX_PROJECT_FILE_BYTES {
        return Ok(ProjectFileRead {
            kind: ProjectFileReadKind::TooLarge,
            size_bytes: bytes.len() as u64,
            content: None,
        });
    }
    if bytes.contains(&0) {
        return Ok(ProjectFileRead {
            kind: ProjectFileReadKind::Binary,
            size_bytes: bytes.len() as u64,
            content: None,
        });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(ProjectFileRead {
            kind: ProjectFileReadKind::Text,
            size_bytes: content.len() as u64,
            content: Some(content),
        }),
        Err(error) => Ok(ProjectFileRead {
            kind: ProjectFileReadKind::Binary,
            size_bytes: error.as_bytes().len() as u64,
            content: None,
        }),
    }
}

fn save_project_file_contents(
    project_id: &str,
    relative_path: &str,
    expected_content: &str,
    content: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    if content.len() as u64 > MAX_PROJECT_FILE_BYTES {
        return Err(IpcError::new(
            "project_file_too_large",
            "Files larger than 1 MiB cannot be edited in Laplace yet.",
            operation_id.to_owned(),
            false,
        ));
    }
    let current = read_project_file_contents(project_id, relative_path)?;
    if current.kind != ProjectFileReadKind::Text {
        return Err(IpcError::new(
            "project_file_not_editable",
            "Only small UTF-8 text files can be edited in Laplace.",
            operation_id.to_owned(),
            false,
        ));
    }
    if current.content.as_deref() != Some(expected_content) {
        return Err(IpcError::new(
            "project_file_conflict",
            "This file changed on disk since it was opened. Copy or reload your edits before saving.",
            operation_id.to_owned(),
            false,
        ));
    }

    let root = fs::canonicalize(project_id).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The project folder is no longer available. Reopen it from the folder picker.",
            operation_id.to_owned(),
            true,
        )
    })?;
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(IpcError::new(
            "invalid_relative_path",
            "Select a file inside the open project.",
            operation_id.to_owned(),
            false,
        ));
    }
    let joined_path = root.join(relative);
    let parent = joined_path.parent().ok_or_else(|| {
        IpcError::new(
            "invalid_relative_path",
            "Select a file inside the open project.",
            operation_id.to_owned(),
            false,
        )
    })?;
    let canonical_parent = fs::canonicalize(parent).map_err(|_| {
        IpcError::new(
            "project_file_unavailable",
            "That file is no longer available inside the project.",
            operation_id.to_owned(),
            true,
        )
    })?;
    if !canonical_parent.starts_with(&root) {
        return Err(IpcError::new(
            "project_path_escape",
            "The requested file resolves outside the open project.",
            operation_id.to_owned(),
            false,
        ));
    }
    let filename = relative.file_name().ok_or_else(|| {
        IpcError::new(
            "invalid_relative_path",
            "Select a file inside the open project.",
            operation_id.to_owned(),
            false,
        )
    })?;
    let path = canonical_parent.join(filename);
    if fs::symlink_metadata(&path)
        .map_err(|_| {
            IpcError::new(
                "project_file_unavailable",
                "That file is no longer available inside the project.",
                operation_id.to_owned(),
                true,
            )
        })?
        .file_type()
        .is_symlink()
    {
        return Err(IpcError::new(
            "project_file_symlink",
            "Symbolic links are not followed by the project editor.",
            operation_id.to_owned(),
            false,
        ));
    }
    let permissions = fs::metadata(&path)
        .map_err(|_| {
            IpcError::new(
                "project_file_read_failed",
                "This project file could not be inspected.",
                operation_id.to_owned(),
                true,
            )
        })?
        .permissions();
    let temporary = canonical_parent.join(format!(".laplace-save-{operation_id}.tmp"));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| {
            IpcError::new(
                "project_file_write_failed",
                "This project file could not be saved.",
                operation_id.to_owned(),
                true,
            )
        })?;
    use std::io::Write;
    if file.write_all(content.as_bytes()).is_err()
        || fs::set_permissions(&temporary, permissions).is_err()
    {
        let _ = fs::remove_file(&temporary);
        return Err(IpcError::new(
            "project_file_write_failed",
            "This project file could not be saved.",
            operation_id.to_owned(),
            true,
        ));
    }
    drop(file);
    let current = match read_project_file_contents(project_id, relative_path) {
        Ok(current) => current,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
    };
    if current.content.as_deref() != Some(expected_content) {
        let _ = fs::remove_file(&temporary);
        return Err(IpcError::new(
            "project_file_conflict",
            "This file changed on disk since it was opened. Copy or reload your edits before saving.",
            operation_id.to_owned(),
            false,
        ));
    }
    #[cfg(windows)]
    if path.exists() {
        let backup = canonical_parent.join(format!(".laplace-backup-{operation_id}.tmp"));
        fs::rename(&path, &backup).map_err(|_| {
            let _ = fs::remove_file(&temporary);
            IpcError::new(
                "project_file_write_failed",
                "This project file could not be saved.",
                operation_id.to_owned(),
                true,
            )
        })?;
        if fs::rename(&temporary, &path).is_err() {
            let _ = fs::rename(&backup, &path);
            let _ = fs::remove_file(&temporary);
            return Err(IpcError::new(
                "project_file_write_failed",
                "This project file could not be saved.",
                operation_id.to_owned(),
                true,
            ));
        }
        let _ = fs::remove_file(backup);
        return Ok(());
    }
    if fs::rename(&temporary, &path).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(IpcError::new(
            "project_file_write_failed",
            "This project file could not be saved.",
            operation_id.to_owned(),
            true,
        ));
    }
    Ok(())
}

#[tauri::command]
async fn open_project(
    app: tauri::AppHandle,
    request: OpenProjectRequest,
) -> Result<OpenProjectResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The project request is invalid or uses an unsupported schema.",
            request.operation_id,
            false,
        ));
    }
    let history_path = recent_projects_path(&app)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    let mut projects = read_recent_projects(&history_path)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    let project = open_project_path(Path::new(&request.path), &mut projects)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    write_recent_projects(&history_path, &projects)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    Ok(OpenProjectResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        project,
    })
}

#[tauri::command]
async fn get_recent_projects(
    app: tauri::AppHandle,
    request: ProjectsRequest,
) -> Result<RecentProjectsResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The project request is invalid or uses an unsupported schema.",
            request.operation_id,
            false,
        ));
    }
    let path = recent_projects_path(&app)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    let projects = read_recent_projects(&path)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    Ok(RecentProjectsResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        projects,
    })
}

#[tauri::command]
async fn list_project_entries(
    request: ListProjectEntriesRequest,
) -> Result<ProjectEntriesResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The project request is invalid or uses an unsupported schema.",
            request.operation_id,
            false,
        ));
    }
    let (entries, truncated) = read_project_entries(&request.project_id, &request.relative_path)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    Ok(ProjectEntriesResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        entries,
        truncated,
    })
}

#[tauri::command]
async fn read_project_file(
    request: ReadProjectFileRequest,
) -> Result<ReadProjectFileResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The project request is invalid or uses an unsupported schema.",
            request.operation_id,
            false,
        ));
    }
    let file = read_project_file_contents(&request.project_id, &request.relative_path)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    Ok(ReadProjectFileResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        file,
    })
}

#[tauri::command]
async fn save_project_file(
    request: SaveProjectFileRequest,
) -> Result<SaveProjectFileResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The project request is invalid or uses an unsupported schema.",
            request.operation_id,
            false,
        ));
    }
    save_project_file_contents(
        &request.project_id,
        &request.relative_path,
        &request.expected_content,
        &request.content,
        &request.operation_id,
    )?;
    Ok(SaveProjectFileResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        saved: true,
    })
}

fn terminal_error(code: &str, message: &str, operation_id: &str) -> IpcError {
    IpcError::new(code, message, operation_id.to_owned(), false)
}

#[tauri::command]
async fn start_terminal(
    app: tauri::AppHandle,
    sessions: tauri::State<'_, TerminalSessions>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    request: TerminalRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.session_id)
        || request.workspace_id.is_empty()
    {
        return Err(terminal_error(
            "invalid_terminal_request",
            "The terminal request is invalid.",
            &request.operation_id,
        ));
    }
    let cwd = fs::canonicalize(&request.workspace_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The terminal workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    if !cwd.is_dir() {
        return Err(terminal_error(
            "workspace_not_directory",
            "The terminal workspace must be a folder.",
            &request.operation_id,
        ));
    }
    let trusted_paths = trusted.0.lock().map_err(|_| {
        terminal_error(
            "trust_unavailable",
            "Workspace trust is temporarily unavailable.",
            &request.operation_id,
        )
    })?;
    if !trusted_paths.contains(&cwd.to_string_lossy().into_owned()) {
        return Err(terminal_error(
            "workspace_not_trusted",
            "Confirm trust for this project before starting a shell.",
            &request.operation_id,
        ));
    }
    drop(trusted_paths);
    let (program, args) = terminal_shell();
    let pty = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|_| {
            terminal_error(
                "terminal_start_failed",
                "A terminal could not be created on this system.",
                &request.operation_id,
            )
        })?;
    let mut command = CommandBuilder::new(program);
    command.args(args);
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");
    let child = pty.slave.spawn_command(command).map_err(|_| {
        terminal_error(
            "terminal_start_failed",
            "The configured shell could not be started.",
            &request.operation_id,
        )
    })?;
    drop(pty.slave);
    let killer = child.clone_killer();
    let session = Arc::new(TerminalSession {
        writer: Mutex::new(pty.master.take_writer().map_err(|_| {
            terminal_error(
                "terminal_start_failed",
                "The terminal input stream could not be opened.",
                &request.operation_id,
            )
        })?),
        master: Mutex::new(pty.master),
        killer: Mutex::new(killer),
        child: Mutex::new(child),
        workspace_id: request.workspace_id.clone(),
        output_bytes: AtomicU64::new(0),
    });
    {
        let mut map = sessions.0.lock().map_err(|_| {
            terminal_error(
                "terminal_busy",
                "Terminal sessions are temporarily unavailable.",
                &request.operation_id,
            )
        })?;
        if map.contains_key(&request.session_id) {
            return Err(terminal_error(
                "terminal_session_exists",
                "This terminal session already exists.",
                &request.operation_id,
            ));
        }
        map.insert(request.session_id.clone(), Arc::clone(&session));
    }
    let mut reader = session
        .master
        .lock()
        .map_err(|_| {
            terminal_error(
                "terminal_busy",
                "The terminal output stream is temporarily unavailable.",
                &request.operation_id,
            )
        })?
        .try_clone_reader()
        .map_err(|_| {
            terminal_error(
                "terminal_start_failed",
                "The terminal output stream could not be opened.",
                &request.operation_id,
            )
        })?;
    let app_output = app.clone();
    let child_session = Arc::clone(&session);
    let session_id = request.session_id.clone();
    let workspace_id = request.workspace_id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(length) => {
                    let before = child_session
                        .output_bytes
                        .fetch_add(length as u64, Ordering::Relaxed);
                    if before.saturating_add(length as u64) > 4 * 1024 * 1024 {
                        if let Ok(mut killer) = child_session.killer.lock() {
                            let _ = killer.kill();
                        }
                        let _ = app_output.emit(
                            TERMINAL_EVENT_NAME,
                            TerminalEvent {
                                schema_version: IPC_SCHEMA_VERSION,
                                operation_id: crypto_operation_id(),
                                session_id: session_id.clone(),
                                workspace_id: workspace_id.clone(),
                                kind: "output".to_owned(),
                                data: Some(
                                    "\r\n[output limit reached; process stopped]\r\n".to_owned(),
                                ),
                                exit_code: None,
                            },
                        );
                        break;
                    }
                    let event = TerminalEvent {
                        schema_version: IPC_SCHEMA_VERSION,
                        operation_id: crypto_operation_id(),
                        session_id: session_id.clone(),
                        workspace_id: workspace_id.clone(),
                        kind: "output".to_owned(),
                        data: Some(String::from_utf8_lossy(&buffer[..length]).into_owned()),
                        exit_code: None,
                    };
                    let _ = app_output.emit(TERMINAL_EVENT_NAME, event);
                }
            }
        }
        let exit_code = child_session
            .child
            .lock()
            .ok()
            .and_then(|mut child| child.wait().ok())
            .map(|status| status.exit_code());
        let _ = app_output.emit(
            TERMINAL_EVENT_NAME,
            TerminalEvent {
                schema_version: IPC_SCHEMA_VERSION,
                operation_id: crypto_operation_id(),
                session_id,
                workspace_id,
                kind: "exited".to_owned(),
                data: None,
                exit_code,
            },
        );
    });
    Ok(())
}

#[tauri::command]
async fn trust_workspace(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    request: GitRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_trust_request",
            "The workspace trust request is invalid.",
            &request.operation_id,
        ));
    }
    let canonical = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    if !canonical.is_dir() {
        return Err(terminal_error(
            "workspace_not_directory",
            "Select a project folder before granting trust.",
            &request.operation_id,
        ));
    }
    let pool = open_domain_database(&app, &db).await?;
    sqlx::query("INSERT INTO trusted_workspaces (project_id, trusted_at) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET trusted_at = excluded.trusted_at")
        .bind(canonical.to_string_lossy().as_ref())
        .bind(now_ms())
        .execute(&pool)
        .await
        .map_err(|_| terminal_error("trust_persist_failed", "Project trust could not be saved.", &request.operation_id))?;
    trusted
        .0
        .lock()
        .map_err(|_| {
            terminal_error(
                "trust_unavailable",
                "Workspace trust is temporarily unavailable.",
                &request.operation_id,
            )
        })?
        .insert(canonical.to_string_lossy().into_owned());
    Ok(())
}

#[tauri::command]
async fn untrust_workspace(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    terminals: tauri::State<'_, TerminalSessions>,
    request: GitRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_trust_request",
            "The workspace trust request is invalid.",
            &request.operation_id,
        ));
    }
    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    let pool = open_domain_database(&app, &db).await?;
    sqlx::query("DELETE FROM trusted_workspaces WHERE project_id = ?")
        .bind(root.to_string_lossy().as_ref())
        .execute(&pool)
        .await
        .map_err(|_| {
            terminal_error(
                "trust_persist_failed",
                "Project trust could not be revoked.",
                &request.operation_id,
            )
        })?;
    trusted
        .0
        .lock()
        .map_err(|_| {
            terminal_error(
                "trust_unavailable",
                "Workspace trust is temporarily unavailable.",
                &request.operation_id,
            )
        })?
        .remove(&root.to_string_lossy().into_owned());
    terminals.stop_workspace(&root.to_string_lossy());
    Ok(())
}

fn crypto_operation_id() -> String {
    format!("term-{}", EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed))
}

#[cfg(windows)]
fn terminal_shell() -> (OsString, Vec<OsString>) {
    (
        OsString::from("powershell.exe"),
        vec![OsString::from("-NoLogo")],
    )
}

#[cfg(not(windows))]
fn terminal_shell() -> (OsString, Vec<OsString>) {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "/bin/zsh".to_owned()
        } else {
            "/bin/sh".to_owned()
        }
    });
    let configured = PathBuf::from(&shell);
    let shell = if configured.is_absolute() && configured.is_file() {
        configured
    } else if cfg!(target_os = "macos") {
        PathBuf::from("/bin/zsh")
    } else {
        PathBuf::from("/bin/sh")
    };
    (shell.into_os_string(), vec![])
}

#[tauri::command]
async fn write_terminal(
    sessions: tauri::State<'_, TerminalSessions>,
    request: TerminalRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.session_id)
    {
        return Err(terminal_error(
            "invalid_terminal_request",
            "The terminal request is invalid.",
            &request.operation_id,
        ));
    }
    let session = terminal_session(&sessions, &request.session_id, &request.operation_id)?;
    if request.workspace_id != session.workspace_id {
        return Err(terminal_error(
            "terminal_workspace_mismatch",
            "This terminal belongs to a different workspace.",
            &request.operation_id,
        ));
    }
    if request.workspace_id.is_empty() || request.workspace_id != session.workspace_id {
        return Err(terminal_error(
            "terminal_workspace_mismatch",
            "This terminal belongs to a different workspace.",
            &request.operation_id,
        ));
    }
    if let Some(data) = request.data {
        if data.len() > MAX_TERMINAL_WRITE_BYTES {
            return Err(terminal_error(
                "terminal_input_too_large",
                "Terminal input exceeded the per-request limit.",
                &request.operation_id,
            ));
        }
        session
            .writer
            .lock()
            .map_err(|_| {
                terminal_error(
                    "terminal_busy",
                    "Terminal input is busy.",
                    &request.operation_id,
                )
            })?
            .write_all(data.as_bytes())
            .map_err(|_| {
                terminal_error(
                    "terminal_write_failed",
                    "Terminal input could not be sent.",
                    &request.operation_id,
                )
            })?;
    }
    if let (Some(rows), Some(cols)) = (request.rows, request.cols) {
        if !(1..=500).contains(&rows) || !(1..=500).contains(&cols) {
            return Err(terminal_error(
                "terminal_size_invalid",
                "Terminal size is outside supported limits.",
                &request.operation_id,
            ));
        }
        session
            .master
            .lock()
            .map_err(|_| {
                terminal_error(
                    "terminal_busy",
                    "Terminal resize is busy.",
                    &request.operation_id,
                )
            })?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|_| {
                terminal_error(
                    "terminal_resize_failed",
                    "The terminal could not be resized.",
                    &request.operation_id,
                )
            })?;
    }
    Ok(())
}

#[tauri::command]
async fn stop_terminal(
    sessions: tauri::State<'_, TerminalSessions>,
    request: TerminalRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.session_id)
    {
        return Err(terminal_error(
            "invalid_terminal_request",
            "The terminal request is invalid.",
            &request.operation_id,
        ));
    }
    let session = terminal_session(&sessions, &request.session_id, &request.operation_id)?;
    if session.workspace_id != request.workspace_id {
        return Err(terminal_error(
            "terminal_workspace_mismatch",
            "This terminal belongs to a different workspace.",
            &request.operation_id,
        ));
    }
    let session = {
        let mut map = sessions.0.lock().map_err(|_| {
            terminal_error(
                "terminal_busy",
                "Terminal sessions are temporarily unavailable.",
                &request.operation_id,
            )
        })?;
        map.remove(&request.session_id)
    };
    if let Some(session) = session {
        session
            .killer
            .lock()
            .map_err(|_| {
                terminal_error(
                    "terminal_busy",
                    "Terminal shutdown is temporarily unavailable.",
                    &request.operation_id,
                )
            })?
            .kill()
            .map_err(|_| {
                terminal_error(
                    "terminal_stop_failed",
                    "The terminal process could not be stopped.",
                    &request.operation_id,
                )
            })?;
    }
    Ok(())
}

fn terminal_session(
    sessions: &TerminalSessions,
    session_id: &str,
    operation_id: &str,
) -> Result<Arc<TerminalSession>, IpcError> {
    sessions
        .0
        .lock()
        .map_err(|_| {
            terminal_error(
                "terminal_busy",
                "Terminal sessions are temporarily unavailable.",
                operation_id,
            )
        })?
        .get(session_id)
        .cloned()
        .ok_or_else(|| {
            terminal_error(
                "terminal_session_missing",
                "This terminal session is no longer active.",
                operation_id,
            )
        })
}

async fn open_domain_database(
    app: &tauri::AppHandle,
    state: &DomainDatabase,
) -> Result<SqlitePool, IpcError> {
    if let Some(pool) = state
        .0
        .lock()
        .map_err(|_| {
            terminal_error(
                "database_busy",
                "Laplace data is temporarily unavailable.",
                "database",
            )
        })?
        .clone()
    {
        return Ok(pool);
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| {
            terminal_error(
                "database_path_unavailable",
                "Laplace could not locate its data directory.",
                "database",
            )
        })?
        .join("laplace.sqlite3");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            terminal_error(
                "database_open_failed",
                "Laplace data storage could not be prepared.",
                "database",
            )
        })?;
    }
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .map_err(|_| {
            terminal_error(
                "database_open_failed",
                "Laplace data storage could not be opened.",
                "database",
            )
        })?;
    MIGRATOR.run(&pool).await.map_err(|_| {
        terminal_error(
            "database_migration_failed",
            "Laplace data storage could not be upgraded safely.",
            "database",
        )
    })?;
    sqlx::query(
        "UPDATE executions SET status = 'interrupted', finished_at = ? WHERE status = 'running'",
    )
    .bind(now_ms())
    .execute(&pool)
    .await
    .map_err(|_| {
        terminal_error(
            "database_recovery_failed",
            "Interrupted verification records could not be recovered.",
            "database",
        )
    })?;
    *state.0.lock().map_err(|_| {
        terminal_error(
            "database_busy",
            "Laplace data is temporarily unavailable.",
            "database",
        )
    })? = Some(pool.clone());
    Ok(pool)
}

#[tauri::command]
async fn list_changes(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: ChangeRequest,
) -> Result<Vec<ChangeRecord>, IpcError> {
    validate_change_request(&request)?;
    let pool = open_domain_database(&app, &db).await?;
    let rows = sqlx::query("SELECT id, project_id, objective, status, created_at, updated_at FROM changes WHERE project_id = ? ORDER BY updated_at DESC")
        .bind(request.project_id).fetch_all(&pool).await.map_err(|_| terminal_error("change_list_failed", "Changes could not be loaded.", &request.operation_id))?;
    rows.into_iter()
        .map(|row| parse_change_row(&row, &request.operation_id))
        .collect()
}

#[tauri::command]
async fn create_change(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: ChangeRequest,
) -> Result<ChangeRecord, IpcError> {
    validate_change_request(&request)?;
    let objective = request.objective.as_deref().unwrap_or("").trim();
    if objective.is_empty() || objective.len() > 500 {
        return Err(terminal_error(
            "change_objective_invalid",
            "A Change objective must be 1–500 UTF-8 bytes.",
            &request.operation_id,
        ));
    }
    let project = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    let project_id = project.to_string_lossy().into_owned();
    let id = crypto_operation_id();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let pool = open_domain_database(&app, &db).await?;
    let mut tx = pool.begin().await.map_err(|_| {
        terminal_error(
            "change_write_failed",
            "The Change could not be created.",
            &request.operation_id,
        )
    })?;
    sqlx::query("INSERT INTO changes (id, project_id, objective, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)").bind(&id).bind(&project_id).bind(objective).bind(now).bind(now).execute(&mut *tx).await.map_err(|_| terminal_error("change_write_failed", "The Change could not be created.", &request.operation_id))?;
    sqlx::query("INSERT INTO change_activity (change_id, kind, detail, created_at) VALUES (?, 'created', ?, ?)").bind(&id).bind(objective).bind(now).execute(&mut *tx).await.map_err(|_| terminal_error("change_write_failed", "The Change activity could not be recorded.", &request.operation_id))?;
    tx.commit().await.map_err(|_| {
        terminal_error(
            "change_write_failed",
            "The Change could not be saved.",
            &request.operation_id,
        )
    })?;
    Ok(ChangeRecord {
        id,
        project_id,
        objective: objective.to_owned(),
        status: ChangeStatus::Draft,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
async fn update_change(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: ChangeRequest,
) -> Result<ChangeRecord, IpcError> {
    validate_change_request(&request)?;
    let id = request.change_id.as_deref().ok_or_else(|| {
        terminal_error(
            "change_id_required",
            "A Change ID is required.",
            &request.operation_id,
        )
    })?;
    let pool = open_domain_database(&app, &db).await?;
    let row = sqlx::query("SELECT id, project_id, objective, status, created_at, updated_at FROM changes WHERE id = ? AND project_id = ?").bind(id).bind(&request.project_id).fetch_optional(&pool).await.map_err(|_| terminal_error("change_read_failed", "The Change could not be loaded.", &request.operation_id))?.ok_or_else(|| terminal_error("change_missing", "This Change no longer exists in the workspace.", &request.operation_id))?;
    let current = parse_change_row(&row, &request.operation_id)?;
    let objective = request
        .objective
        .as_deref()
        .unwrap_or(&current.objective)
        .trim();
    if objective.is_empty() || objective.len() > 500 {
        return Err(terminal_error(
            "change_objective_invalid",
            "A Change objective must be 1–500 UTF-8 bytes.",
            &request.operation_id,
        ));
    }
    let next = request.status.unwrap_or(current.status.clone());
    if !valid_change_transition(&current.status, &next) {
        return Err(terminal_error(
            "change_transition_invalid",
            "This Change status transition is not allowed.",
            &request.operation_id,
        ));
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let mut tx = pool.begin().await.map_err(|_| {
        terminal_error(
            "change_write_failed",
            "The Change could not be updated.",
            &request.operation_id,
        )
    })?;
    sqlx::query("UPDATE changes SET objective = ?, status = ?, updated_at = ? WHERE id = ?")
        .bind(objective)
        .bind(next.as_str())
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|_| {
            terminal_error(
                "change_write_failed",
                "The Change could not be updated.",
                &request.operation_id,
            )
        })?;
    if objective != current.objective || next != current.status {
        let detail = format!("{} | {}", next.as_str(), objective);
        sqlx::query("INSERT INTO change_activity (change_id, kind, detail, created_at) VALUES (?, 'updated', ?, ?)").bind(id).bind(detail).bind(now).execute(&mut *tx).await.map_err(|_| terminal_error("change_write_failed", "The Change activity could not be recorded.", &request.operation_id))?;
    }
    tx.commit().await.map_err(|_| {
        terminal_error(
            "change_write_failed",
            "The Change could not be saved.",
            &request.operation_id,
        )
    })?;
    Ok(ChangeRecord {
        id: current.id,
        project_id: current.project_id,
        objective: objective.to_owned(),
        status: next,
        created_at: current.created_at,
        updated_at: now,
    })
}

#[tauri::command]
async fn reopen_change_review(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: ChangeRequest,
) -> Result<ChangeRecord, IpcError> {
    let mut reopen = request;
    reopen.status = Some(ChangeStatus::InReview);
    update_change(app, db, reopen).await
}

fn validate_change_request(request: &ChangeRequest) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || request.project_id.is_empty()
    {
        return Err(terminal_error(
            "invalid_change_request",
            "The Change request is invalid.",
            &request.operation_id,
        ));
    }
    Ok(())
}

fn valid_change_transition(from: &ChangeStatus, to: &ChangeStatus) -> bool {
    if from == to {
        return true;
    }
    matches!(
        (from, to),
        (
            ChangeStatus::Draft,
            ChangeStatus::Active | ChangeStatus::Abandoned
        ) | (
            ChangeStatus::Active,
            ChangeStatus::InReview | ChangeStatus::Abandoned
        ) | (
            ChangeStatus::InReview,
            ChangeStatus::Active | ChangeStatus::Approved | ChangeStatus::Abandoned
        ) | (
            ChangeStatus::Approved,
            ChangeStatus::InReview | ChangeStatus::Integrated | ChangeStatus::Abandoned
        )
    )
}

fn parse_change_row(
    row: &sqlx::sqlite::SqliteRow,
    operation_id: &str,
) -> Result<ChangeRecord, IpcError> {
    let status = match row.try_get::<String, _>("status").ok().as_deref() {
        Some("draft") => ChangeStatus::Draft,
        Some("active") => ChangeStatus::Active,
        Some("in_review") => ChangeStatus::InReview,
        Some("approved") => ChangeStatus::Approved,
        Some("integrated") => ChangeStatus::Integrated,
        Some("abandoned") => ChangeStatus::Abandoned,
        _ => {
            return Err(terminal_error(
                "change_record_invalid",
                "A stored Change record is invalid.",
                operation_id,
            ))
        }
    };
    Ok(ChangeRecord {
        id: row.try_get("id").map_err(|_| {
            terminal_error(
                "change_record_invalid",
                "A stored Change record is invalid.",
                operation_id,
            )
        })?,
        project_id: row.try_get("project_id").map_err(|_| {
            terminal_error(
                "change_record_invalid",
                "A stored Change record is invalid.",
                operation_id,
            )
        })?,
        objective: row.try_get("objective").map_err(|_| {
            terminal_error(
                "change_record_invalid",
                "A stored Change record is invalid.",
                operation_id,
            )
        })?,
        status,
        created_at: row.try_get("created_at").map_err(|_| {
            terminal_error(
                "change_record_invalid",
                "A stored Change record is invalid.",
                operation_id,
            )
        })?,
        updated_at: row.try_get("updated_at").map_err(|_| {
            terminal_error(
                "change_record_invalid",
                "A stored Change record is invalid.",
                operation_id,
            )
        })?,
    })
}

#[tauri::command]
async fn git_status(request: GitRequest) -> Result<GitStatusResponse, IpcError> {
    run_git(&request, &["status", "--porcelain=v1", "-z", "--branch"])
        .and_then(|output| parse_git_status(&output.stdout, &request.operation_id))
}

const MAX_CHECK_FILES: usize = 5_000;
const MAX_CHECK_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_CHECK_OUTPUT_BYTES: usize = 1024 * 1024;

#[tauri::command]
async fn run_check(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    request: RunCheckRequest,
) -> Result<ExecutionRecord, IpcError> {
    validate_check_request(&request)?;
    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The verification workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    if !root.join(".git").exists() {
        return Err(terminal_error(
            "not_git_repository",
            "Verification manifests require a Git repository.",
            &request.operation_id,
        ));
    }
    let pool = open_domain_database(&app, &db).await?;
    if !trusted.contains(&root)? {
        let row = sqlx::query("SELECT project_id FROM trusted_workspaces WHERE project_id = ?")
            .bind(root.to_string_lossy().as_ref())
            .fetch_optional(&pool)
            .await
            .map_err(|_| {
                terminal_error(
                    "trust_read_failed",
                    "Project trust could not be checked.",
                    &request.operation_id,
                )
            })?;
        if row.is_some() {
            trusted
                .0
                .lock()
                .map_err(|_| {
                    terminal_error(
                        "trust_unavailable",
                        "Workspace trust is temporarily unavailable.",
                        &request.operation_id,
                    )
                })?
                .insert(root.to_string_lossy().into_owned());
        } else {
            return Err(terminal_error(
                "workspace_not_trusted",
                "Confirm project trust before running verification commands.",
                &request.operation_id,
            ));
        }
    }
    if VERIFY_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(terminal_error(
            "check_already_running",
            "Wait for the active verification check to finish.",
            &request.operation_id,
        ));
    }
    VERIFY_CANCELLED.store(false, Ordering::Release);
    let operation_id = request.operation_id.clone();
    let execution =
        tokio::task::spawn_blocking(move || execute_check(&root, request, &VERIFY_CANCELLED)).await;
    let record = match execution {
        Ok(Ok(record)) => record,
        Ok(Err(error)) => {
            VERIFY_RUNNING.store(false, Ordering::Release);
            return Err(error);
        }
        Err(_) => {
            VERIFY_RUNNING.store(false, Ordering::Release);
            return Err(terminal_error(
                "check_interrupted",
                "The verification process was interrupted.",
                &operation_id,
            ));
        }
    };
    VERIFY_RUNNING.store(false, Ordering::Release);
    persist_execution(&pool, &record).await?;
    Ok(record)
}

#[tauri::command]
async fn list_executions(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: GitRequest,
) -> Result<Vec<ExecutionRecord>, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_check_request",
            "The verification request is invalid.",
            &request.operation_id,
        ));
    }
    let pool = open_domain_database(&app, &db).await?;
    let rows = sqlx::query("SELECT id, project_id, change_id, command_json, source_digest, status, exit_code, output, started_at, finished_at FROM executions WHERE project_id = ? ORDER BY started_at DESC LIMIT 200").bind(&request.project_id).fetch_all(&pool).await.map_err(|_| terminal_error("check_list_failed", "Verification records could not be loaded.", &request.operation_id))?;
    let mut executions = Vec::new();
    for row in &rows {
        let mut record = parse_execution_row(row, &request.operation_id)?;
        if matches!(
            record.status,
            ExecutionStatus::Passed | ExecutionStatus::Failed
        ) {
            let root = fs::canonicalize(&record.project_id).map_err(|_| {
                terminal_error(
                    "workspace_unavailable",
                    "A verification workspace is unavailable.",
                    &request.operation_id,
                )
            })?;
            if source_manifest(&root)
                .map(|manifest| manifest.0 != record.source_digest)
                .unwrap_or(true)
            {
                record.status = ExecutionStatus::Stale;
                sqlx::query("UPDATE executions SET status = 'stale' WHERE id = ?")
                    .bind(&record.id)
                    .execute(&pool)
                    .await
                    .map_err(|_| {
                        terminal_error(
                            "check_stale_update_failed",
                            "Verification freshness could not be updated.",
                            &request.operation_id,
                        )
                    })?;
            }
        }
        let files =
            sqlx::query("SELECT path FROM source_files WHERE execution_id = ? ORDER BY path")
                .bind(&record.id)
                .fetch_all(&pool)
                .await
                .map_err(|_| {
                    terminal_error(
                        "check_record_invalid",
                        "The verification source manifest is invalid.",
                        &request.operation_id,
                    )
                })?;
        record.files = files
            .iter()
            .map(|file| {
                file.try_get("path").map_err(|_| {
                    terminal_error(
                        "check_record_invalid",
                        "A verification source path is invalid.",
                        &request.operation_id,
                    )
                })
            })
            .collect::<Result<_, _>>()?;
        executions.push(record);
    }
    Ok(executions)
}

#[tauri::command]
async fn cancel_check(request: CancellationRequest) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_check_request",
            "The verification cancellation request is invalid.",
            &request.operation_id,
        ));
    }
    if !VERIFY_RUNNING.load(Ordering::Acquire) {
        return Err(terminal_error(
            "check_not_running",
            "There is no active verification check to cancel.",
            &request.operation_id,
        ));
    }
    VERIFY_CANCELLED.store(true, Ordering::Release);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancellationRequest {
    schema_version: u16,
    operation_id: String,
}

#[tauri::command]
async fn start_rook_ask(
    app: tauri::AppHandle,
    processes: tauri::State<'_, RookProcesses>,
    request: RookRequest,
) -> Result<RookInitResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.session_id)
    {
        return Err(terminal_error(
            "invalid_rook_request",
            "The Rook request is invalid.",
            &request.operation_id,
        ));
    }
    let root = fs::canonicalize(&request.workspace_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The Rook workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    if !root.is_dir() {
        return Err(terminal_error(
            "workspace_not_directory",
            "Rook requires a project folder.",
            &request.operation_id,
        ));
    }
    let rook_bin = std::env::var("LAPLACE_ROOK_BIN").ok();
    let mut child = spawn_rook(&root, rook_bin.as_deref(), &request.operation_id)?;
    let mut stdin = child.stdin.take().ok_or_else(|| {
        terminal_error(
            "rook_start_failed",
            "Rook input could not be opened.",
            &request.operation_id,
        )
    })?;
    let mut stdout = std::io::BufReader::new(child.stdout.take().ok_or_else(|| {
        terminal_error(
            "rook_start_failed",
            "Rook output could not be opened.",
            &request.operation_id,
        )
    })?);
    let init = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}});
    writeln!(stdin, "{}", init).map_err(|_| {
        terminal_error(
            "rook_protocol_failed",
            "The Rook connection could not be initialized.",
            &request.operation_id,
        )
    })?;
    let mut line = String::new();
    std::io::BufRead::read_line(&mut stdout, &mut line).map_err(|_| {
        terminal_error(
            "rook_protocol_failed",
            "Rook returned no initialization response.",
            &request.operation_id,
        )
    })?;
    let value: serde_json::Value = serde_json::from_str(&line).map_err(|_| {
        terminal_error(
            "rook_protocol_invalid",
            "Rook returned an invalid initialization response.",
            &request.operation_id,
        )
    })?;
    let result = &value["result"];
    if result["protocolVersion"] != 1
        || result["capabilities"]["buildSessions"] != false
        || result["capabilities"]["immutableReadOnlyTools"]
            .as_array()
            .is_none()
    {
        let _ = child.kill();
        return Err(terminal_error(
            "rook_capability_mismatch",
            "Rook did not advertise the immutable read-only Ask capability.",
            &request.operation_id,
        ));
    }
    let session_new =
        serde_json::json!({"jsonrpc":"2.0","id":2,"method":"session/new","params":{"mode":"ask"}});
    writeln!(stdin, "{}", session_new).map_err(|_| {
        terminal_error(
            "rook_protocol_failed",
            "The Rook Ask session could not be created.",
            &request.operation_id,
        )
    })?;
    line.clear();
    std::io::BufRead::read_line(&mut stdout, &mut line).map_err(|_| {
        terminal_error(
            "rook_protocol_failed",
            "Rook returned no Ask session response.",
            &request.operation_id,
        )
    })?;
    let session_response: serde_json::Value = serde_json::from_str(&line).map_err(|_| {
        terminal_error(
            "rook_protocol_invalid",
            "Rook returned an invalid Ask session response.",
            &request.operation_id,
        )
    })?;
    if session_response["result"]["mode"] != "ask" {
        let _ = child.kill();
        return Err(terminal_error(
            "rook_session_failed",
            "Rook did not create an Ask session.",
            &request.operation_id,
        ));
    }
    let app_events = app.clone();
    let session_id = request.session_id.clone();
    std::thread::spawn(move || {
        let mut line = String::new();
        while std::io::BufRead::read_line(&mut stdout, &mut line).unwrap_or(0) > 0 {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                let _ = app_events.emit(
                    "rook-event",
                    serde_json::json!({"sessionId":session_id,"message":value}),
                );
            }
            line.clear();
        }
    });
    let response = RookInitResponse {
        session_id: request.session_id.clone(),
        workspace_id: result["workspaceId"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        rook_version: result["rookVersion"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        capabilities: result["capabilities"].clone(),
    };
    processes
        .0
        .lock()
        .map_err(|_| {
            terminal_error(
                "rook_busy",
                "Rook sessions are temporarily unavailable.",
                &request.operation_id,
            )
        })?
        .insert(
            request.session_id,
            Arc::new(Mutex::new(RookProcess { child, stdin })),
        );
    Ok(response)
}

fn spawn_rook(
    root: &Path,
    rook_bin: Option<&str>,
    operation_id: &str,
) -> Result<std::process::Child, IpcError> {
    let mut command = if let Some(path) = rook_bin.filter(|path| path.ends_with(".mjs")) {
        let mut command = Command::new("node");
        command.arg(path);
        command
    } else if let Some(path) = rook_bin {
        Command::new(path)
    } else {
        Command::new("rook")
    };
    command
        .args(["--stdio", "--cwd"])
        .arg(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| {
            terminal_error(
                "rook_unavailable",
                "Install Rook or set LAPLACE_ROOK_BIN to its executable path.",
                operation_id,
            )
        })
}

#[tauri::command]
async fn prompt_rook_ask(
    processes: tauri::State<'_, RookProcesses>,
    request: RookPromptRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.session_id)
        || request.text.trim().is_empty()
        || request.text.len() > 64_000
        || request
            .context
            .as_ref()
            .is_some_and(|context| context.len() > 32_000)
    {
        return Err(terminal_error(
            "invalid_rook_prompt",
            "The Ask prompt or context exceeds supported limits.",
            &request.operation_id,
        ));
    }
    let processes = processes.0.lock().map_err(|_| {
        terminal_error(
            "rook_busy",
            "Rook sessions are temporarily unavailable.",
            &request.operation_id,
        )
    })?;
    let process = processes.get(&request.session_id).ok_or_else(|| {
        terminal_error(
            "rook_session_missing",
            "This Rook Ask session is no longer active.",
            &request.operation_id,
        )
    })?;
    let mut process = process.lock().map_err(|_| {
        terminal_error(
            "rook_busy",
            "This Rook session is temporarily unavailable.",
            &request.operation_id,
        )
    })?;
    let stdin = &mut process.stdin;
    let prompt = serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"text":request.text,"context":request.context}});
    writeln!(stdin, "{}", prompt).map_err(|_| {
        terminal_error(
            "rook_protocol_failed",
            "The Ask prompt could not be sent.",
            &request.operation_id,
        )
    })?;
    Ok(())
}

#[tauri::command]
async fn stop_rook_ask(
    processes: tauri::State<'_, RookProcesses>,
    request: RookStopRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.session_id)
    {
        return Err(terminal_error(
            "invalid_rook_request",
            "The Rook stop request is invalid.",
            &request.operation_id,
        ));
    }
    processes.stop(&request.session_id, &request.operation_id)
}

#[tauri::command]
async fn cancel_rook_ask(
    processes: tauri::State<'_, RookProcesses>,
    request: RookCancelRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.session_id)
        || !validate_operation_id(&request.run_id)
    {
        return Err(terminal_error(
            "invalid_rook_request",
            "The Rook cancel request is invalid.",
            &request.operation_id,
        ));
    }
    let processes = processes.0.lock().map_err(|_| {
        terminal_error(
            "rook_busy",
            "Rook sessions are temporarily unavailable.",
            &request.operation_id,
        )
    })?;
    let process = processes.get(&request.session_id).ok_or_else(|| {
        terminal_error(
            "rook_session_missing",
            "This Rook Ask session is no longer active.",
            &request.operation_id,
        )
    })?;
    let mut process = process.lock().map_err(|_| {
        terminal_error(
            "rook_busy",
            "This Rook session is temporarily unavailable.",
            &request.operation_id,
        )
    })?;
    let stdin = &mut process.stdin;
    writeln!(stdin, "{}", serde_json::json!({"jsonrpc":"2.0","id":5,"method":"session/cancel","params":{"runId":request.run_id}})).map_err(|_| terminal_error("rook_protocol_failed", "The Ask run could not be cancelled.", &request.operation_id))?;
    Ok(())
}

#[tauri::command]
async fn respond_rook_permission(
    processes: tauri::State<'_, RookProcesses>,
    request: RookPermissionRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.session_id)
        || !request.permission_id.starts_with("rook:permission:")
        || request.permission_id.len() > 64
    {
        return Err(terminal_error(
            "invalid_rook_permission",
            "The Rook permission response is invalid.",
            &request.operation_id,
        ));
    }
    let choice = match request.choice.as_str() {
        "once" | "session" | "deny" => request.choice,
        _ => {
            return Err(terminal_error(
                "invalid_rook_permission",
                "Choose once, session, or deny.",
                &request.operation_id,
            ))
        }
    };
    let processes = processes.0.lock().map_err(|_| {
        terminal_error(
            "rook_busy",
            "Rook sessions are temporarily unavailable.",
            &request.operation_id,
        )
    })?;
    let process = processes.get(&request.session_id).ok_or_else(|| {
        terminal_error(
            "rook_session_missing",
            "This Rook Ask session is no longer active.",
            &request.operation_id,
        )
    })?;
    let mut process = process.lock().map_err(|_| {
        terminal_error(
            "rook_busy",
            "This Rook session is temporarily unavailable.",
            &request.operation_id,
        )
    })?;
    let stdin = &mut process.stdin;
    writeln!(
        stdin,
        "{}",
        serde_json::json!({"jsonrpc":"2.0","id":request.permission_id,"result":{"choice":choice}})
    )
    .map_err(|_| {
        terminal_error(
            "rook_protocol_failed",
            "The Rook permission response could not be sent.",
            &request.operation_id,
        )
    })?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RookRequest {
    schema_version: u16,
    operation_id: String,
    session_id: String,
    workspace_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RookInitResponse {
    session_id: String,
    workspace_id: String,
    rook_version: String,
    capabilities: serde_json::Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RookPromptRequest {
    schema_version: u16,
    operation_id: String,
    session_id: String,
    text: String,
    context: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RookStopRequest {
    schema_version: u16,
    operation_id: String,
    session_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RookCancelRequest {
    schema_version: u16,
    operation_id: String,
    session_id: String,
    run_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RookPermissionRequest {
    schema_version: u16,
    operation_id: String,
    session_id: String,
    permission_id: String,
    choice: String,
}

fn validate_check_request(request: &RunCheckRequest) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || request.program.trim().is_empty()
        || request.program.contains('\0')
        || request.args.iter().any(|arg| arg.contains('\0'))
    {
        return Err(terminal_error(
            "invalid_check_request",
            "The verification command is invalid.",
            &request.operation_id,
        ));
    }
    let project = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The verification workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    let _ = project;
    Ok(())
}

fn source_manifest(root: &Path) -> Result<(String, Vec<(String, String)>), IpcError> {
    let listing = Command::new("git")
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .current_dir(root)
        .output()
        .map_err(|_| {
            terminal_error(
                "git_unavailable",
                "Git is required to identify verification source.",
                "check",
            )
        })?;
    if !listing.status.success() {
        return Err(terminal_error(
            "manifest_failed",
            "Source files could not be listed.",
            "check",
        ));
    }
    let mut paths: Vec<String> = String::from_utf8_lossy(&listing.stdout)
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .collect();
    paths.sort();
    paths.dedup();
    if paths.len() > MAX_CHECK_FILES {
        return Err(terminal_error(
            "manifest_too_large",
            "The source manifest exceeds 5,000 files.",
            "check",
        ));
    }
    let mut total = 0u64;
    let mut entry_count = 0usize;
    let mut entries = Vec::new();
    let mut manifest = Sha256::new();
    for relative in paths {
        if is_sensitive_manifest_path(&relative) {
            continue;
        }
        let file_path = Path::new(&relative);
        if file_path.is_absolute()
            || file_path
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            continue;
        }
        let mut full = root.to_path_buf();
        let mut safe = true;
        for component in file_path.components() {
            if let Component::Normal(name) = component {
                full.push(name);
                if fs::symlink_metadata(&full)
                    .map(|meta| meta.file_type().is_symlink())
                    .unwrap_or(true)
                {
                    safe = false;
                    break;
                }
            }
        }
        if !safe || !full.is_file() {
            continue;
        }
        entry_count += 1;
        if entry_count > MAX_CHECK_FILES {
            return Err(terminal_error(
                "manifest_too_large",
                "The source manifest exceeds 5,000 eligible files.",
                "check",
            ));
        }
        let metadata = fs::metadata(&full).map_err(|_| {
            terminal_error(
                "manifest_read_failed",
                "A source file could not be inspected.",
                "check",
            )
        })?;
        total = total.saturating_add(metadata.len());
        if total > MAX_CHECK_SOURCE_BYTES {
            return Err(terminal_error(
                "manifest_too_large",
                "The source manifest exceeds 256 MiB.",
                "check",
            ));
        }
        let bytes = fs::read(&full).map_err(|_| {
            terminal_error(
                "manifest_read_failed",
                "A source file could not be read.",
                "check",
            )
        })?;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        manifest.update((relative.len() as u64).to_be_bytes());
        manifest.update(relative.as_bytes());
        manifest.update(digest.as_bytes());
        entries.push((relative, digest));
    }
    Ok((format!("{:x}", manifest.finalize()), entries))
}

fn is_sensitive_manifest_path(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    name == ".env"
        || name.starts_with(".env.")
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.contains("secret")
        || name.contains("credential")
        || name == "id_rsa"
        || name == "id_ed25519"
}

fn execute_check(
    root: &Path,
    request: RunCheckRequest,
    cancelled: &AtomicBool,
) -> Result<ExecutionRecord, IpcError> {
    let (source_digest, files) = source_manifest(root)?;
    let started_at = now_ms();
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(10 * 60 * 1000)
        .clamp(1_000, 60 * 60 * 1000);
    let mut child = Command::new(&request.program)
        .args(&request.args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("CI", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| {
            terminal_error(
                "check_start_failed",
                "The verification command could not be started.",
                &request.operation_id,
            )
        })?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let output = Arc::new(Mutex::new(Vec::new()));
    let truncated = Arc::new(AtomicU32::new(0));
    let read_stream = |mut stream: Box<dyn Read + Send>,
                       output: Arc<Mutex<Vec<u8>>>,
                       truncated: Arc<AtomicU32>| {
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            while let Ok(n) = stream.read(&mut buf) {
                if n == 0 {
                    break;
                }
                if let Ok(mut stored) = output.lock() {
                    let remaining = MAX_CHECK_OUTPUT_BYTES.saturating_sub(stored.len());
                    stored.extend_from_slice(&buf[..n.min(remaining)]);
                    if n > remaining {
                        truncated.store(1, Ordering::Relaxed);
                    }
                }
            }
        })
    };
    let out_thread = read_stream(
        Box::new(stdout),
        Arc::clone(&output),
        Arc::clone(&truncated),
    );
    let err_thread = read_stream(
        Box::new(stderr),
        Arc::clone(&output),
        Arc::clone(&truncated),
    );
    let start = std::time::Instant::now();
    let mut timed_out = false;
    let mut was_cancelled = false;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| {
            terminal_error(
                "check_failed",
                "The verification process status could not be read.",
                &request.operation_id,
            )
        })? {
            break status;
        }
        if start.elapsed().as_millis() as u64 >= timeout_ms {
            timed_out = true;
            let _ = child.kill();
            break child.wait().map_err(|_| {
                terminal_error(
                    "check_failed",
                    "The timed-out process could not be stopped.",
                    &request.operation_id,
                )
            })?;
        }
        if cancelled.load(Ordering::Acquire) {
            was_cancelled = true;
            let _ = child.kill();
            break child.wait().map_err(|_| {
                terminal_error(
                    "check_failed",
                    "The cancelled process could not be stopped.",
                    &request.operation_id,
                )
            })?;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    let _ = out_thread.join();
    let _ = err_thread.join();
    let mut output = output
        .lock()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default();
    if truncated.load(Ordering::Relaxed) != 0 {
        output.push_str("\n[output truncated at 1 MiB]");
    }
    let current = source_manifest(root)?;
    let unchanged = current.0 == source_digest;
    let final_status = if !unchanged {
        ExecutionStatus::Inconclusive
    } else if was_cancelled {
        ExecutionStatus::Cancelled
    } else if timed_out {
        ExecutionStatus::TimedOut
    } else if status.success() {
        ExecutionStatus::Passed
    } else {
        ExecutionStatus::Failed
    };
    Ok(ExecutionRecord {
        id: crypto_operation_id(),
        project_id: request.project_id,
        change_id: request.change_id,
        program: request.program,
        args: request.args,
        source_digest,
        files: files.into_iter().map(|(path, _)| path).collect(),
        file_digests: current.1,
        status: final_status,
        exit_code: status.code().map(i64::from),
        output,
        started_at,
        finished_at: Some(now_ms()),
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

async fn persist_execution(pool: &SqlitePool, record: &ExecutionRecord) -> Result<(), IpcError> {
    let command =
        serde_json::to_string(&(record.program.as_str(), &record.args)).map_err(|_| {
            terminal_error(
                "check_record_failed",
                "The verification command could not be recorded.",
                "check",
            )
        })?;
    let mut tx = pool.begin().await.map_err(|_| {
        terminal_error(
            "check_record_failed",
            "The verification result could not be recorded.",
            "check",
        )
    })?;
    sqlx::query("INSERT INTO executions (id, project_id, change_id, command_json, source_digest, status, exit_code, output, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(&record.id).bind(&record.project_id).bind(&record.change_id).bind(command).bind(&record.source_digest).bind(serde_json::to_string(&record.status).unwrap_or_default().trim_matches('"')).bind(record.exit_code).bind(&record.output).bind(record.started_at).bind(record.finished_at).execute(&mut *tx).await.map_err(|_| terminal_error("check_record_failed", "The verification result could not be recorded.", "check"))?;
    for (relative, digest) in &record.file_digests {
        sqlx::query("INSERT INTO source_files (execution_id, path, digest) VALUES (?, ?, ?)")
            .bind(&record.id)
            .bind(relative)
            .bind(digest)
            .execute(&mut *tx)
            .await
            .map_err(|_| {
                terminal_error(
                    "check_record_failed",
                    "The source manifest could not be recorded.",
                    "check",
                )
            })?;
    }
    tx.commit().await.map_err(|_| {
        terminal_error(
            "check_record_failed",
            "The verification result could not be saved.",
            "check",
        )
    })
}

fn parse_execution_row(
    row: &sqlx::sqlite::SqliteRow,
    operation_id: &str,
) -> Result<ExecutionRecord, IpcError> {
    let command: (String, Vec<String>) =
        serde_json::from_str(&row.try_get::<String, _>("command_json").map_err(|_| {
            terminal_error(
                "check_record_invalid",
                "A verification record is invalid.",
                operation_id,
            )
        })?)
        .map_err(|_| {
            terminal_error(
                "check_record_invalid",
                "A verification command record is invalid.",
                operation_id,
            )
        })?;
    let status = match row.try_get::<String, _>("status").ok().as_deref() {
        Some("passed") => ExecutionStatus::Passed,
        Some("failed") => ExecutionStatus::Failed,
        Some("cancelled") => ExecutionStatus::Cancelled,
        Some("timed_out") => ExecutionStatus::TimedOut,
        Some("start_failed") => ExecutionStatus::StartFailed,
        Some("interrupted") => ExecutionStatus::Interrupted,
        Some("inconclusive") => ExecutionStatus::Inconclusive,
        Some("stale") => ExecutionStatus::Stale,
        _ => ExecutionStatus::Running,
    };
    let id: String = row.try_get("id").map_err(|_| {
        terminal_error(
            "check_record_invalid",
            "A verification record is invalid.",
            operation_id,
        )
    })?;
    Ok(ExecutionRecord {
        id,
        project_id: row.try_get("project_id").unwrap_or_default(),
        change_id: row.try_get("change_id").ok(),
        program: command.0,
        args: command.1,
        source_digest: row.try_get("source_digest").unwrap_or_default(),
        files: Vec::new(),
        file_digests: Vec::new(),
        status,
        exit_code: row.try_get("exit_code").ok(),
        output: row.try_get("output").unwrap_or_default(),
        started_at: row.try_get("started_at").unwrap_or_default(),
        finished_at: row.try_get("finished_at").ok(),
    })
}

#[tauri::command]
async fn create_candidate_worktree(
    app: tauri::AppHandle,
    request: WorktreeRequest,
) -> Result<WorktreeResponse, IpcError> {
    validate_worktree_request(&request)?;
    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The Git workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    let parent = app
        .path()
        .app_data_dir()
        .map_err(|_| {
            terminal_error(
                "worktree_path_unavailable",
                "Laplace could not locate its candidate storage directory.",
                &request.operation_id,
            )
        })?
        .join("worktrees")
        .join(format!(
            "{:x}",
            Sha256::digest(root.to_string_lossy().as_bytes())
        ));
    let operation = request.operation_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        create_candidate_worktree_at(&request, &parent)
    })
    .await
    .map_err(|_| {
        terminal_error(
            "worktree_create_failed",
            "The candidate worktree operation was interrupted.",
            &operation,
        )
    })?;
    result
}

#[cfg(test)]
fn create_candidate_worktree_sync(request: &WorktreeRequest) -> Result<WorktreeResponse, IpcError> {
    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The Git workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    let parent = std::env::temp_dir()
        .join("laplace-test-worktrees")
        .join(format!(
            "{:x}",
            Sha256::digest(root.to_string_lossy().as_bytes())
        ));
    create_candidate_worktree_at(request, &parent)
}

fn create_candidate_worktree_at(
    request: &WorktreeRequest,
    parent: &Path,
) -> Result<WorktreeResponse, IpcError> {
    validate_worktree_request(request)?;
    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The Git workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    if !root.join(".git").exists() {
        return Err(terminal_error(
            "not_git_repository",
            "A candidate requires a Git repository.",
            &request.operation_id,
        ));
    }
    let base = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&root)
        .output()
        .map_err(|_| {
            terminal_error(
                "git_unavailable",
                "Git could not be started.",
                &request.operation_id,
            )
        })?;
    if !base.status.success() {
        return Err(terminal_error(
            "git_failed",
            "The base revision could not be read.",
            &request.operation_id,
        ));
    }
    let base_revision = String::from_utf8_lossy(&base.stdout).trim().to_owned();
    let path = parent.join(&request.change_id);
    if path.exists() {
        return Err(terminal_error(
            "worktree_exists",
            "This Change already has a candidate worktree.",
            &request.operation_id,
        ));
    }
    fs::create_dir_all(path.parent().expect("worktree has parent")).map_err(|_| {
        terminal_error(
            "worktree_prepare_failed",
            "The candidate directory could not be prepared.",
            &request.operation_id,
        )
    })?;
    let branch = format!("laplace/{}", request.change_id);
    let output = Command::new("git")
        .args(["worktree", "add", "-b", &branch])
        .arg(&path)
        .arg(&base_revision)
        .current_dir(&root)
        .output()
        .map_err(|_| {
            terminal_error(
                "git_unavailable",
                "Git could not be started.",
                &request.operation_id,
            )
        })?;
    if !output.status.success() {
        return Err(terminal_error(
            "worktree_create_failed",
            "Git could not create a candidate worktree. Check for an existing branch or path.",
            &request.operation_id,
        ));
    }
    Ok(WorktreeResponse {
        change_id: request.change_id.clone(),
        path: path.to_string_lossy().into_owned(),
        branch,
        base_revision,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    change_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorktreeResponse {
    change_id: String,
    path: String,
    branch: String,
    base_revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecipeDefinition {
    version: u16,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecipeRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    recipe_name: String,
}

#[tauri::command]
async fn run_project_recipe(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    request: RecipeRequest,
) -> Result<ExecutionRecord, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.recipe_name)
    {
        return Err(terminal_error(
            "invalid_recipe_request",
            "The recipe request is invalid.",
            &request.operation_id,
        ));
    }
    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The recipe workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    if !trusted.contains(&root)? {
        return Err(terminal_error(
            "workspace_not_trusted",
            "Confirm project trust before running project recipes.",
            &request.operation_id,
        ));
    }
    let settings_dir = root.join(".laplace");
    if settings_dir.exists()
        && (!settings_dir.is_dir()
            || fs::symlink_metadata(&settings_dir)
                .map(|meta| meta.file_type().is_symlink())
                .unwrap_or(true))
    {
        return Err(terminal_error(
            "recipe_path_unsafe",
            "The .laplace recipe directory cannot be a symlink or file.",
            &request.operation_id,
        ));
    }
    let recipe_path = settings_dir.join("recipes.toml");
    if fs::symlink_metadata(&recipe_path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(terminal_error(
            "recipe_path_unsafe",
            "The project recipe file cannot be a symlink.",
            &request.operation_id,
        ));
    }
    let bytes = fs::read(&recipe_path).map_err(|_| {
        terminal_error(
            "recipe_missing",
            "No approved project recipes file was found.",
            &request.operation_id,
        )
    })?;
    let recipe_doc: toml::Value = toml::from_str(std::str::from_utf8(&bytes).map_err(|_| {
        terminal_error(
            "recipe_invalid",
            "The project recipes file must be UTF-8.",
            &request.operation_id,
        )
    })?)
    .map_err(|_| {
        terminal_error(
            "recipe_invalid",
            "The project recipes file is invalid.",
            &request.operation_id,
        )
    })?;
    let recipes: HashMap<String, RecipeDefinition> = recipe_doc
        .get("recipes")
        .cloned()
        .ok_or_else(|| {
            terminal_error(
                "recipe_invalid",
                "The project recipes file must have a recipes table.",
                &request.operation_id,
            )
        })
        .and_then(|value| {
            value.try_into().map_err(|_| {
                terminal_error(
                    "recipe_invalid",
                    "The project recipes file is invalid.",
                    &request.operation_id,
                )
            })
        })?;
    let recipe = recipes.get(&request.recipe_name).ok_or_else(|| {
        terminal_error(
            "recipe_missing",
            "This named project recipe is not defined.",
            &request.operation_id,
        )
    })?;
    if recipe.version != 1
        || recipe.program.is_empty()
        || recipe.program.contains('\0')
        || recipe.args.iter().any(|arg| arg.contains('\0'))
    {
        return Err(terminal_error(
            "recipe_invalid",
            "The project recipe has unsupported or invalid fields.",
            &request.operation_id,
        ));
    }
    let cwd = if let Some(relative) = &recipe.cwd {
        resolve_project_directory(&request.project_id, relative)?
    } else {
        root.clone()
    };
    let check = RunCheckRequest {
        schema_version: request.schema_version,
        operation_id: request.operation_id.clone(),
        project_id: root.to_string_lossy().into_owned(),
        change_id: None,
        program: recipe.program.clone(),
        args: recipe.args.clone(),
        timeout_ms: Some(10 * 60 * 1000),
    };
    let pool = open_domain_database(&app, &db).await?;
    let result = tokio::task::spawn_blocking(move || execute_check(&cwd, check, &VERIFY_CANCELLED))
        .await
        .map_err(|_| {
            terminal_error(
                "recipe_interrupted",
                "The project recipe was interrupted.",
                &request.operation_id,
            )
        })??;
    persist_execution(&pool, &result).await?;
    Ok(result)
}
fn validate_worktree_request(request: &WorktreeRequest) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.change_id)
    {
        return Err(terminal_error(
            "invalid_worktree_request",
            "The candidate worktree request is invalid.",
            &request.operation_id,
        ));
    }
    Ok(())
}

#[tauri::command]
async fn git_diff(request: GitRequest) -> Result<String, IpcError> {
    let args = if request.untracked_path.is_some() {
        return Err(terminal_error(
            "git_diff_unsupported",
            "Untracked file previews are not available in this version.",
            &request.operation_id,
        ));
    } else {
        vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "HEAD",
            "--",
        ]
    };
    run_git(&request, &args).map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct GitRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    untracked_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct GitFileStatus {
    path: String,
    index_status: char,
    worktree_status: char,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct GitStatusResponse {
    branch: Option<String>,
    files: Vec<GitFileStatus>,
}

fn run_git(request: &GitRequest, args: &[&str]) -> Result<std::process::Output, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_git_request",
            "The Git request is invalid.",
            &request.operation_id,
        ));
    }
    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The Git workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    if !root.join(".git").exists() {
        return Err(terminal_error(
            "not_git_repository",
            "The open workspace is not a Git repository.",
            &request.operation_id,
        ));
    }
    Command::new("git")
        .arg("-c")
        .arg("core.fsmonitor=false")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_PAGER", "cat")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|child| child.wait_with_output())
        .map_err(|_| {
            terminal_error(
                "git_unavailable",
                "Git could not be started. Install Git and try again.",
                &request.operation_id,
            )
        })
        .and_then(|output| {
            if output.status.success() {
                Ok(output)
            } else {
                Err(terminal_error(
                    "git_failed",
                    "Git could not inspect this workspace.",
                    &request.operation_id,
                ))
            }
        })
}

fn parse_git_status(bytes: &[u8], operation_id: &str) -> Result<GitStatusResponse, IpcError> {
    let text = std::str::from_utf8(bytes).map_err(|_| {
        terminal_error(
            "git_output_invalid",
            "Git returned invalid status data.",
            operation_id,
        )
    })?;
    let mut fields = text.split('\0');
    let header = fields.next().unwrap_or_default();
    if !header.starts_with("## ") {
        return Err(terminal_error(
            "git_output_invalid",
            "Git returned an unrecognized status header.",
            operation_id,
        ));
    }
    let branch = header
        .strip_prefix("## ")
        .map(|branch| branch.split("...").next().unwrap_or(branch).to_owned());
    let mut files = Vec::new();
    while let Some(entry) = fields.next() {
        if entry.is_empty() {
            continue;
        }
        let status = entry.as_bytes();
        if status.len() < 3 || status[2] != b' ' {
            return Err(terminal_error(
                "git_output_invalid",
                "Git returned an unrecognized status entry.",
                operation_id,
            ));
        }
        files.push(GitFileStatus {
            index_status: status[0] as char,
            worktree_status: status[1] as char,
            path: entry[3..].to_owned(),
        });
        if status[0] == b'R' || status[0] == b'C' || status[1] == b'R' || status[1] == b'C' {
            let _old_path = fields.next();
        }
    }
    Ok(GitStatusResponse { branch, files })
}

#[cfg(test)]
mod plan06_tests {
    use super::*;

    #[test]
    fn parses_porcelain_status_paths_with_spaces_and_renames() {
        let response = parse_git_status(
            b"## topic...origin/topic\0 M file with spaces.ts\0R  new name.ts\0old name.ts\0?? untracked.ts\0",
            "git-test-1",
        )
        .unwrap();
        assert_eq!(response.branch.as_deref(), Some("topic"));
        assert_eq!(response.files.len(), 3);
        assert_eq!(response.files[0].path, "file with spaces.ts");
        assert_eq!(response.files[1].path, "new name.ts");
        assert_eq!(response.files[2].path, "untracked.ts");
    }

    #[test]
    fn rejects_malformed_git_status_output() {
        assert_eq!(
            parse_git_status(b"??missing-space\0", "git-test-2")
                .unwrap_err()
                .code,
            "git_output_invalid"
        );
    }

    #[test]
    fn excludes_common_secret_paths_from_verification_manifests() {
        assert!(is_sensitive_manifest_path(".env"));
        assert!(is_sensitive_manifest_path("config/.env.production"));
        assert!(is_sensitive_manifest_path("keys/private.pem"));
        assert!(is_sensitive_manifest_path("credentials.json"));
        assert!(!is_sensitive_manifest_path("src/main.rs"));
    }

    #[test]
    fn git_status_and_diff_use_real_repository_state() {
        let root = std::env::temp_dir().join(format!("laplace-git-fixture-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let run = |args: &[&str]| {
            Command::new("git")
                .args(args)
                .current_dir(&root)
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .output()
                .unwrap()
        };
        assert!(run(&["init", "-b", "main"]).status.success());
        assert!(run(&["config", "user.email", "laplace@example.invalid"])
            .status
            .success());
        assert!(run(&["config", "user.name", "Laplace Test"])
            .status
            .success());
        fs::write(root.join("tracked.txt"), "before\n").unwrap();
        assert!(run(&["add", "tracked.txt"]).status.success());
        assert!(run(&["commit", "-m", "fixture"]).status.success());
        fs::write(root.join("tracked.txt"), "after\n").unwrap();
        fs::write(root.join("untracked name.txt"), "new\n").unwrap();
        let request = GitRequest {
            schema_version: IPC_SCHEMA_VERSION,
            operation_id: "git-fixture-1".to_owned(),
            project_id: root.to_string_lossy().into_owned(),
            untracked_path: None,
        };
        let status = run_git(&request, &["status", "--porcelain=v1", "-z", "--branch"])
            .and_then(|output| parse_git_status(&output.stdout, &request.operation_id))
            .unwrap();
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert!(status.files.iter().any(|file| file.path == "tracked.txt"));
        assert!(status
            .files
            .iter()
            .any(|file| file.path == "untracked name.txt"));
        let diff = run_git(
            &request,
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "HEAD",
                "--",
            ],
        )
        .unwrap();
        let diff = String::from_utf8_lossy(&diff.stdout);
        assert!(diff.contains("-before"));
        assert!(diff.contains("+after"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn change_ids_are_safe_for_worktree_path_components() {
        for invalid in ["../escape", "nested/change", "change name", "", "a\\b"] {
            let request = WorktreeRequest {
                schema_version: IPC_SCHEMA_VERSION,
                operation_id: "valid-op".into(),
                project_id: "/tmp/project".into(),
                change_id: invalid.into(),
            };
            assert_eq!(
                validate_worktree_request(&request).unwrap_err().code,
                "invalid_worktree_request"
            );
        }
    }

    #[test]
    fn change_status_machine_rejects_skipped_review_and_terminal_reopening() {
        assert!(valid_change_transition(
            &ChangeStatus::Draft,
            &ChangeStatus::Active
        ));
        assert!(!valid_change_transition(
            &ChangeStatus::Draft,
            &ChangeStatus::Integrated
        ));
        assert!(valid_change_transition(
            &ChangeStatus::Active,
            &ChangeStatus::InReview
        ));
        assert!(!valid_change_transition(
            &ChangeStatus::Integrated,
            &ChangeStatus::Active
        ));
        assert!(!valid_change_transition(
            &ChangeStatus::Abandoned,
            &ChangeStatus::Draft
        ));
    }
}

#[cfg(test)]
mod plan07_tests {
    use super::*;

    #[tokio::test]
    async fn sqlite_change_migration_persists_records_and_enforces_transition_rule() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        MIGRATOR.run(&pool).await.unwrap();
        sqlx::query("INSERT INTO changes (id, project_id, objective, status, created_at, updated_at) VALUES ('c1', '/p', 'test', 'draft', 1, 1)").execute(&pool).await.unwrap();
        let row = sqlx::query("SELECT id, project_id, objective, status, created_at, updated_at FROM changes WHERE id = 'c1'").fetch_one(&pool).await.unwrap();
        let change = parse_change_row(&row, "test-op").unwrap();
        assert_eq!(change.status, ChangeStatus::Draft);
        assert!(valid_change_transition(
            &change.status,
            &ChangeStatus::Active
        ));
        assert!(!valid_change_transition(
            &change.status,
            &ChangeStatus::Integrated
        ));
        pool.close().await;
    }

    #[tokio::test]
    async fn change_activity_and_status_update_are_transactional() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        MIGRATOR.run(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("INSERT INTO changes (id, project_id, objective, status, created_at, updated_at) VALUES ('c2', '/p', 'initial', 'draft', 1, 1)").execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO change_activity (change_id, kind, detail, created_at) VALUES ('c2', 'created', 'initial', 1)").execute(&mut *tx).await.unwrap();
        tx.commit().await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("UPDATE changes SET objective = 'updated', status = 'active', updated_at = 2 WHERE id = 'c2'").execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO change_activity (change_id, kind, detail, created_at) VALUES ('c2', 'updated', 'active | updated', 2)").execute(&mut *tx).await.unwrap();
        tx.commit().await.unwrap();
        let row = sqlx::query("SELECT id, project_id, objective, status, created_at, updated_at FROM changes WHERE id = 'c2'").fetch_one(&pool).await.unwrap();
        assert_eq!(
            parse_change_row(&row, "test-op").unwrap().status,
            ChangeStatus::Active
        );
        let count: i64 = sqlx::query("SELECT count(*) FROM change_activity WHERE change_id = 'c2'")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get(0);
        assert_eq!(count, 2);
    }
}

#[cfg(test)]
mod plan10_tests {
    use super::*;

    fn check_fixture() -> (PathBuf, RunCheckRequest) {
        let root = std::env::temp_dir().join(format!(
            "laplace-check-fixture-{}-{}",
            std::process::id(),
            EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let git = |args: &[&str]| {
            Command::new("git")
                .args(args)
                .current_dir(&root)
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .output()
                .unwrap()
        };
        assert!(git(&["init", "-b", "main"]).status.success());
        assert!(git(&["config", "user.email", "laplace@example.invalid"])
            .status
            .success());
        assert!(git(&["config", "user.name", "Laplace Test"])
            .status
            .success());
        fs::write(root.join("source.txt"), "stable\n").unwrap();
        assert!(git(&["add", "source.txt"]).status.success());
        assert!(git(&["commit", "-m", "fixture"]).status.success());
        let request = RunCheckRequest {
            schema_version: IPC_SCHEMA_VERSION,
            operation_id: "check-fixture-1".into(),
            project_id: root.to_string_lossy().into_owned(),
            change_id: None,
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "printf check-output".into()],
            timeout_ms: Some(10_000),
        };
        (root, request)
    }

    #[test]
    fn successful_check_records_command_manifest_exit_and_output() {
        let (root, request) = check_fixture();
        let result = execute_check(&root, request, &AtomicBool::new(false)).unwrap();
        assert_eq!(result.status, ExecutionStatus::Passed);
        assert_eq!(result.exit_code, Some(0));
        assert_eq!(result.output, "check-output");
        assert_eq!(result.files, vec!["source.txt"]);
        assert_eq!(result.file_digests.len(), 1);
        assert_eq!(result.file_digests[0].0, "source.txt");
        assert!(!result.file_digests[0].1.is_empty());
        assert!(!result.source_digest.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn source_changes_during_check_make_result_inconclusive() {
        let (root, mut request) = check_fixture();
        request.args = vec!["-c".into(), "sleep 0.1; printf changed > source.txt".into()];
        let result = execute_check(&root, request, &AtomicBool::new(false)).unwrap();
        assert_eq!(result.status, ExecutionStatus::Inconclusive);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn check_timeout_is_distinct_and_output_is_bounded() {
        let (root, mut request) = check_fixture();
        request.args = vec!["-c".into(), "sleep 2".into()];
        request.timeout_ms = Some(1_000);
        let result = execute_check(&root, request, &AtomicBool::new(false)).unwrap();
        assert_eq!(result.status, ExecutionStatus::TimedOut);
        let _ = fs::remove_dir_all(root);
    }
}

#[cfg(test)]
mod plan09_tests {
    use super::*;

    #[test]
    fn creates_change_bound_candidate_from_head_without_touching_primary_work() {
        let root = std::env::temp_dir().join(format!(
            "laplace-worktree-fixture-{}-{}",
            std::process::id(),
            EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let run = |args: &[&str]| {
            Command::new("git")
                .args(args)
                .current_dir(&root)
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .output()
                .unwrap()
        };
        assert!(run(&["init", "-b", "main"]).status.success());
        assert!(run(&["config", "user.email", "laplace@example.invalid"])
            .status
            .success());
        assert!(run(&["config", "user.name", "Laplace Test"])
            .status
            .success());
        fs::write(root.join("base.txt"), "base\n").unwrap();
        assert!(run(&["add", "base.txt"]).status.success());
        assert!(run(&["commit", "-m", "base"]).status.success());
        fs::write(root.join("uncommitted.txt"), "preserve\n").unwrap();
        let request = WorktreeRequest {
            schema_version: IPC_SCHEMA_VERSION,
            operation_id: "op-worktree-1".into(),
            project_id: root.to_string_lossy().into_owned(),
            change_id: "change1".into(),
        };
        let candidate = create_candidate_worktree_sync(&request).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("uncommitted.txt")).unwrap(),
            "preserve\n"
        );
        assert!(Path::new(&candidate.path).join("base.txt").exists());
        assert!(!Path::new(&candidate.path).join("uncommitted.txt").exists());
        assert!(candidate.path.contains("laplace-test-worktrees"));
        assert!(!candidate.path.starts_with(root.to_string_lossy().as_ref()));
        let _ = Command::new("git")
            .args(["worktree", "remove", "--force"])
            .arg(&candidate.path)
            .current_dir(&root)
            .output();
        let _ = Command::new("git")
            .args(["branch", "-D", &candidate.branch])
            .current_dir(&root)
            .output();
        let _ = fs::remove_dir_all(std::env::temp_dir().join("laplace-test-worktrees"));
        let _ = fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod rook_start_tests {
    use super::*;

    #[test]
    fn missing_rook_executable_returns_actionable_error() {
        let error = spawn_rook(
            Path::new("/tmp"),
            Some("/laplace-test/missing-rook"),
            "rook-test-op",
        )
        .unwrap_err();
        assert_eq!(error.code, "rook_unavailable");
        assert!(error.message.contains("Install Rook"));
        assert_eq!(error.operation_id, "rook-test-op");
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(TerminalSessions::default())
        .manage(TrustedWorkspaces::default())
        .manage(DomainDatabase::default())
        .manage(RookProcesses::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            get_preferences,
            update_preferences,
            open_project,
            get_recent_projects,
            list_project_entries,
            read_project_file,
            save_project_file,
            start_terminal,
            write_terminal,
            stop_terminal,
            trust_workspace,
            untrust_workspace,
            list_changes,
            create_change,
            update_change,
            reopen_change_review,
            git_status,
            git_diff,
            create_candidate_worktree,
            run_check,
            list_executions,
            run_project_recipe,
            cancel_check,
            start_rook_ask,
            prompt_rook_ask,
            stop_rook_ask,
            cancel_rook_ask,
            respond_rook_permission
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Laplace desktop application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn rust_wire_types_match_shared_typescript_fixtures() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../contracts/ipc-fixtures.json"))
                .expect("fixture JSON is valid");
        let request = PingRequest {
            schema_version: 1,
            operation_id: "op-fixture-1".to_owned(),
        };
        let response = PingResponse {
            schema_version: 1,
            operation_id: "op-fixture-1".to_owned(),
            status: "ok".to_owned(),
            message: "Native command/event round trip succeeded.".to_owned(),
        };
        let error = IpcError::new(
            "invalid_operation_id",
            "operationId must contain 1–64 ASCII letters, digits, hyphens, or underscores.",
            String::new(),
            false,
        );
        let event = AppEvent {
            schema_version: 1,
            operation_id: "op-fixture-1".to_owned(),
            workspace_id: None,
            sequence: 1,
            timestamp_unix_ms: 1_700_000_000_000,
            kind: AppEventKind::PingCompleted,
        };
        let preferences = UiPreferences::default();
        let project = ProjectSummary {
            id: "/fixture/project".to_owned(),
            name: "project".to_owned(),
            path: "/fixture/project".to_owned(),
            is_git_repository: true,
            last_opened_unix_ms: 1_700_000_000_000,
        };
        let project_entry = ProjectEntry {
            name: "src".to_owned(),
            relative_path: "src".to_owned(),
            kind: ProjectEntryKind::Directory,
        };
        let project_file_read = ProjectFileRead {
            kind: ProjectFileReadKind::Text,
            size_bytes: 11,
            content: Some("export {};\n".to_owned()),
        };

        assert_eq!(
            serde_json::to_value(request).unwrap(),
            fixture["pingRequest"]
        );
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            fixture["pingResponse"]
        );
        assert_eq!(serde_json::to_value(error).unwrap(), fixture["ipcError"]);
        assert_eq!(serde_json::to_value(event).unwrap(), fixture["appEvent"]);
        assert_eq!(
            serde_json::to_value(preferences).unwrap(),
            fixture["uiPreferences"]
        );
        assert_eq!(
            serde_json::to_value(project).unwrap(),
            fixture["projectSummary"]
        );
        assert_eq!(
            serde_json::to_value(project_entry).unwrap(),
            fixture["projectEntry"]
        );
        assert_eq!(
            serde_json::to_value(project_file_read).unwrap(),
            fixture["projectFileRead"]
        );
    }

    #[test]
    fn rejects_unsupported_schema_and_malformed_operation_ids() {
        let wrong_schema = PingRequest {
            schema_version: 2,
            operation_id: "op-1".to_owned(),
        };
        assert_eq!(
            validate_ping(wrong_schema).unwrap_err().code,
            "unsupported_schema"
        );

        let malformed_id = PingRequest {
            schema_version: 1,
            operation_id: "not an operation id".to_owned(),
        };
        let error = validate_ping(malformed_id).unwrap_err();
        assert_eq!(error.code, "invalid_operation_id");
        assert!(error.operation_id.is_empty());
    }

    #[test]
    fn preferences_default_when_missing_and_round_trip_through_disk() {
        let directory =
            std::env::temp_dir().join(format!("laplace-preferences-test-{}", std::process::id()));
        let path = directory.join("preferences.json");
        let _ = fs::remove_dir_all(&directory);

        assert_eq!(read_preferences(&path).unwrap(), UiPreferences::default());
        let preferences = UiPreferences {
            theme: ThemePreference::Light,
            density: DensityPreference::Compact,
            inspector_width: 340,
            ..UiPreferences::default()
        };
        write_preferences(&path, &preferences, "settings-test-1").unwrap();
        assert_eq!(read_preferences(&path).unwrap(), preferences);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn preferences_reject_unsupported_sizes() {
        let invalid_font_size = UiPreferences {
            editor_font_size: 9,
            ..UiPreferences::default()
        };
        let invalid_inspector_width = UiPreferences {
            inspector_width: 600,
            ..UiPreferences::default()
        };

        assert!(!validate_preferences(&invalid_font_size));
        assert!(!validate_preferences(&invalid_inspector_width));
        assert!(validate_preferences(&UiPreferences::default()));
    }

    #[test]
    fn opens_non_git_folder_with_canonical_identity_and_remembers_recently() {
        let directory = std::env::temp_dir().join(format!(
            "laplace-project-test-{}-unicode café folder",
            std::process::id()
        ));
        let missing_directory = directory.with_extension("missing");
        let history_path = directory.with_extension("history.json");
        let _ = fs::remove_dir_all(&directory);
        let _ = fs::remove_dir_all(&missing_directory);
        let _ = fs::remove_file(&history_path);
        fs::create_dir_all(&directory).unwrap();

        assert_eq!(
            project_summary(&missing_directory, 0).unwrap_err().code,
            "project_unavailable"
        );
        let mut projects = Vec::new();
        let project = open_project_path(&directory, &mut projects).unwrap();
        assert_eq!(
            project.id,
            fs::canonicalize(&directory).unwrap().to_str().unwrap()
        );
        assert!(project.name.ends_with("unicode café folder"));
        assert!(!project.is_git_repository);
        assert_eq!(projects, vec![project.clone()]);

        write_recent_projects(&history_path, &projects).unwrap();
        assert_eq!(read_recent_projects(&history_path).unwrap(), projects);
        let _ = fs::remove_dir_all(&directory);
        let _ = fs::remove_file(history_path);
    }

    #[test]
    fn detects_git_worktree_metadata_and_lists_only_one_directory_level() {
        let directory =
            std::env::temp_dir().join(format!("laplace-git-worktree-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(directory.join("src/nested")).unwrap();
        fs::create_dir_all(directory.join(".git")).unwrap();
        fs::create_dir_all(directory.join("node_modules/package")).unwrap();
        fs::write(directory.join("README.md"), "not executed").unwrap();
        fs::write(directory.join("src/main.ts"), "export {};").unwrap();

        let mut projects = Vec::new();
        let project = open_project_path(&directory.join("src"), &mut projects).unwrap();
        assert!(project.is_git_repository);
        assert_eq!(
            project.path,
            fs::canonicalize(&directory).unwrap().to_str().unwrap()
        );

        let (entries, truncated) = read_project_entries(&project.id, "").unwrap();
        assert!(!truncated);
        assert_eq!(
            entries,
            vec![
                ProjectEntry {
                    name: "src".to_owned(),
                    relative_path: "src".to_owned(),
                    kind: ProjectEntryKind::Directory,
                },
                ProjectEntry {
                    name: "README.md".to_owned(),
                    relative_path: "README.md".to_owned(),
                    kind: ProjectEntryKind::File,
                },
            ]
        );

        let (nested, nested_truncated) = read_project_entries(&project.id, "src").unwrap();
        assert!(!nested_truncated);
        assert_eq!(nested.len(), 2);
        assert!(nested
            .iter()
            .all(|entry| entry.relative_path != "src/nested/main.ts"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_project_paths_that_escape_the_root() {
        let directory = std::env::temp_dir().join(format!(
            "laplace-project-boundary-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();

        assert_eq!(
            resolve_project_directory(directory.to_str().unwrap(), "../outside")
                .unwrap_err()
                .code,
            "invalid_relative_path"
        );
        assert_eq!(
            resolve_project_directory(directory.to_str().unwrap(), directory.to_str().unwrap())
                .unwrap_err()
                .code,
            "invalid_relative_path"
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinks_outside_a_project() {
        use std::os::unix::fs::symlink;

        let directory = std::env::temp_dir().join(format!(
            "laplace-project-symlink-test-{}",
            std::process::id()
        ));
        let outside = directory.with_extension("outside");
        let _ = fs::remove_dir_all(&directory);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&directory).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "not exposed").unwrap();
        symlink(&outside, directory.join("external")).unwrap();

        let (entries, truncated) = read_project_entries(directory.to_str().unwrap(), "").unwrap();
        assert!(!truncated);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, ProjectEntryKind::Symlink);
        assert_eq!(
            read_project_entries(directory.to_str().unwrap(), "external")
                .unwrap_err()
                .code,
            "project_path_escape"
        );
        assert_eq!(
            read_project_file_contents(directory.to_str().unwrap(), "external/secret.txt")
                .unwrap_err()
                .code,
            "project_file_symlink"
        );
        let _ = fs::remove_dir_all(directory);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn bounds_large_directory_listings() {
        let directory = std::env::temp_dir().join(format!(
            "laplace-project-large-list-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        for index in 0..=MAX_DIRECTORY_ENTRIES {
            fs::write(directory.join(format!("file-{index:04}.txt")), "").unwrap();
        }

        let (entries, truncated) = read_project_entries(directory.to_str().unwrap(), "").unwrap();
        assert_eq!(entries.len(), MAX_DIRECTORY_ENTRIES);
        assert!(truncated);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn reads_bounded_utf8_and_classifies_binary_and_oversized_files() {
        let directory = std::env::temp_dir().join(format!(
            "laplace-project-file-read-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("source.ts"), "const café = true;\n").unwrap();
        fs::write(directory.join("image.bin"), [0, 1, 2, 3]).unwrap();
        fs::write(
            directory.join("large.dat"),
            vec![b'x'; (MAX_PROJECT_FILE_BYTES + 1) as usize],
        )
        .unwrap();

        let text = read_project_file_contents(directory.to_str().unwrap(), "source.ts").unwrap();
        assert_eq!(text.kind, ProjectFileReadKind::Text);
        assert_eq!(text.content.as_deref(), Some("const café = true;\n"));
        let binary = read_project_file_contents(directory.to_str().unwrap(), "image.bin").unwrap();
        assert_eq!(binary.kind, ProjectFileReadKind::Binary);
        assert_eq!(binary.content, None);
        let large = read_project_file_contents(directory.to_str().unwrap(), "large.dat").unwrap();
        assert_eq!(large.kind, ProjectFileReadKind::TooLarge);
        assert_eq!(large.size_bytes, MAX_PROJECT_FILE_BYTES + 1);
        assert_eq!(
            read_project_file_contents(directory.to_str().unwrap(), "../outside")
                .unwrap_err()
                .code,
            "invalid_relative_path"
        );

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn saves_utf8_only_when_disk_content_matches_the_open_version() {
        let directory =
            std::env::temp_dir().join(format!("laplace-project-save-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("source.ts");
        fs::write(&path, "before\n").unwrap();

        save_project_file_contents(
            directory.to_str().unwrap(),
            "source.ts",
            "before\n",
            "after\n",
            "save-test-1",
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "after\n");
        assert_eq!(
            save_project_file_contents(
                directory.to_str().unwrap(),
                "source.ts",
                "before\n",
                "lost update\n",
                "save-test-2",
            )
            .unwrap_err()
            .code,
            "project_file_conflict"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "after\n");
        let _ = fs::remove_dir_all(directory);
    }
}
