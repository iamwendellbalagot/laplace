use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
use tauri_plugin_opener::OpenerExt;

mod capabilities;
mod checks_service;
mod compare;
mod context;
mod db_recovery;
mod fs_service;
mod git_service;
mod impact;
mod pulse;
mod redact;
mod review;
mod rook_runtime;
mod rook_service;
mod runs;
mod search;
mod walkthrough;
mod watcher;
mod workspace_state;

use checks_service::*;
use fs_service::*;
use git_service::*;
use rook_service::*;

const IPC_SCHEMA_VERSION: u16 = 1;
const EVENT_NAME: &str = "app-event";
static EVENT_SEQUENCE: AtomicU32 = AtomicU32::new(1);
static PREFERENCES_LOCK: Mutex<()> = Mutex::new(());
const TERMINAL_EVENT_NAME: &str = "terminal-event";
const MAX_TERMINAL_WRITE_BYTES: usize = 64 * 1024;
static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Default)]
struct DomainDatabase(Mutex<Option<SqlitePool>>);

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

#[derive(Default)]
struct TerminalSessions(Mutex<HashMap<String, Arc<TerminalSession>>>);

impl TerminalSessions {
    fn stop_all(&self) {
        let sessions: Vec<Arc<TerminalSession>> = self
            .0
            .lock()
            .map(|mut guard| guard.drain().map(|(_, session)| session).collect())
            .unwrap_or_default();
        for session in sessions {
            if let Ok(mut killer) = session.killer.lock() {
                let _ = killer.kill();
            }
        }
    }
}

#[derive(Default)]
struct TrustedWorkspaces(Mutex<HashSet<String>>);

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explorer_collapsed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explorer_width: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom_drawer_collapsed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom_drawer_height: Option<u16>,
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
            explorer_collapsed: None,
            explorer_width: None,
            bottom_drawer_collapsed: None,
            bottom_drawer_height: None,
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
        && (220..=560).contains(&preferences.inspector_width)
        && preferences
            .explorer_width
            .is_none_or(|width| (170..=420).contains(&width))
        && preferences
            .bottom_drawer_height
            .is_none_or(|height| (140..=480).contains(&height))
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

fn terminal_error(code: &str, message: &str, operation_id: &str) -> IpcError {
    IpcError::new(code, message, operation_id.to_owned(), false)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
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
async fn get_workspace_trust(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    request: GitRequest,
) -> Result<bool, IpcError> {
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
    if trusted.contains(&root)? {
        return Ok(true);
    }
    let pool = open_domain_database(&app, &db).await?;
    let row = sqlx::query("SELECT project_id FROM trusted_workspaces WHERE project_id = ?")
        .bind(root.to_string_lossy().as_ref())
        .fetch_optional(&pool)
        .await
        .map_err(|_| {
            terminal_error(
                "trust_read_failed",
                "Workspace trust could not be checked.",
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
        return Ok(true);
    }
    Ok(false)
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
    if let Some(processes) = app.try_state::<RookProcesses>() {
        if let Ok(processes) = processes.0.lock() {
            for process in processes.values() {
                if let Ok(mut process) = process.lock() {
                    if process.workspace_path == root {
                        if let Ok(mut pending) = process.pending.lock() {
                            pending.clear();
                        }
                        process.active_run.store(false, Ordering::SeqCst);
                        let _ = process.child.kill();
                    }
                }
            }
        }
    }
    Ok(())
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
    db_recovery::check_and_backup_before_migrate(&path, &pool).await?;
    MIGRATOR.run(&pool).await.map_err(|_| {
        terminal_error(
            "database_migration_failed",
            "Laplace data storage could not be upgraded safely. A pre-upgrade backup was kept in the backups folder.",
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
    let now = now_ms();
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
    let now = now_ms();
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

pub fn run() {
    let app = tauri::Builder::default()
        .manage(TerminalSessions::default())
        .manage(TrustedWorkspaces::default())
        .manage(DomainDatabase::default())
        .manage(RookProcesses::default())
        .manage(watcher::WorkspaceWatchers::default())
        .manage(runs::RunProcesses::default())
        .manage(context::ContextIndexState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            get_preferences,
            update_preferences,
            rook_service::get_rook_dev_settings,
            rook_service::set_rook_dev_checkout,
            fs_service::open_project,
            fs_service::get_recent_projects,
            fs_service::list_project_entries,
            workspace_state::list_project_files,
            workspace_state::load_workspace_continuity,
            workspace_state::save_workspace_layout,
            workspace_state::save_editor_draft,
            workspace_state::delete_editor_draft,
            workspace_state::prune_project_executions,
            fs_service::read_project_file,
            fs_service::save_project_file,
            fs_service::create_project_entry,
            fs_service::rename_project_entry,
            fs_service::delete_project_entry,
            search::search_project_text,
            start_terminal,
            write_terminal,
            stop_terminal,
            runs::list_run_configs,
            runs::list_run_instances,
            runs::start_run_config,
            runs::stop_run_config,
            context::get_file_context,
            context::get_file_history,
            context::get_system_context,
            context::list_project_symbols,
            context::cancel_context_index,
            context::save_context_annotation,
            context::delete_context_annotation,
            context::save_context_pinned_link,
            context::delete_context_pinned_link,
            get_workspace_trust,
            trust_workspace,
            untrust_workspace,
            list_changes,
            create_change,
            update_change,
            reopen_change_review,
            review::get_change_review,
            review::get_workspace_review,
            review::read_git_file_diff_pair,
            review::save_review_checkpoint,
            review::save_workspace_checkpoint,
            review::add_review_comment,
            review::add_workspace_review_comment,
            review::toggle_review_comment_resolved,
            review::revert_workspace_file,
            review::revert_workspace_hunk,
            review::commit_workspace_review,
            review::approve_change_review,
            review::request_change_revision,
            review::prepare_change_integration,
            review::execute_change_integration,
            impact::get_workspace_impact_report,
            walkthrough::get_workspace_walkthrough,
            git_service::git_status,
            git_service::git_diff,
            git_service::create_candidate_worktree,
            git_service::inspect_worktree_experiment,
            git_service::apply_worktree_experiment,
            git_service::discard_worktree_experiment,
            checks_service::run_check,
            checks_service::list_executions,
            compare::compare_executions,
            compare::list_behavior_comparisons,
            compare::delete_behavior_comparison,
            checks_service::list_project_recipes,
            checks_service::run_project_recipe,
            checks_service::cancel_check,
            rook_service::start_rook_ask,
            rook_service::start_rook_build,
            rook_service::prompt_rook_ask,
            rook_service::stop_rook_ask,
            rook_service::cancel_rook_ask,
            rook_service::respond_rook_permission,
            rook_service::rook_provider_request,
            rook_service::respond_rook_auth_prompt,
            rook_service::open_rook_auth_url,
            capabilities::get_capabilities_snapshot,
            capabilities::inspect_skill_source,
            capabilities::update_mcp_server_config,
            capabilities::acknowledge_workspace_capabilities,
            capabilities::record_capability_activity,
            rook_runtime::get_runtime_diagnostics,
            pulse::get_workspace_pulse,
            watcher::start_workspace_watcher,
            watcher::stop_workspace_watcher
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Laplace desktop application");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            app_handle.state::<watcher::WorkspaceWatchers>().stop_all();
            app_handle.state::<runs::RunProcesses>().stop_all();
            app_handle.state::<TerminalSessions>().stop_all();
        }
    });
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
        let runtime = rook_runtime::RookRuntimeResolution {
            node_bin: PathBuf::from("/laplace-test/missing-node"),
            rook_entry: PathBuf::from("/laplace-test/missing-rook.mjs"),
            source: "bundled".to_owned(),
            rook_version: None,
            node_version: None,
        };
        let error = spawn_rook(
            Path::new("/tmp"),
            Path::new("/tmp/laplace-test-rook-sessions"),
            &runtime,
            RookMode::Ask,
            "rook-test-op",
        )
        .unwrap_err();
        assert_eq!(error.code, "rook_unavailable");
        assert!(error.message.contains("Reinstall or repair Laplace"));
        assert!(!error.message.contains("LAPLACE_ROOK_BIN"));
        assert_eq!(error.operation_id, "rook-test-op");
    }

    #[test]
    fn prompt_message_uses_empty_string_context() {
        let message = rook_prompt_message("Explain this project", "");
        assert_eq!(message["params"]["text"], "Explain this project");
        assert_eq!(message["params"]["context"], "");
    }

    #[test]
    fn local_checkout_requires_built_cli_and_dependencies() {
        let checkout =
            std::env::temp_dir().join(format!("laplace-rook-checkout-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&checkout);
        fs::create_dir_all(checkout.join("bin")).unwrap();
        fs::create_dir_all(checkout.join("dist")).unwrap();
        fs::write(checkout.join("bin/rook.mjs"), "").unwrap();
        fs::write(checkout.join("dist/index.js"), "").unwrap();
        assert!(valid_rook_checkout(&checkout).is_none());
        fs::create_dir_all(checkout.join("node_modules")).unwrap();
        fs::write(
            checkout.join("bin/rook.mjs"),
            "console.log('rook 0.1.6');\n",
        )
        .unwrap();
        assert_eq!(
            valid_rook_checkout(&checkout).as_deref(),
            Some(fs::canonicalize(&checkout).unwrap().as_path())
        );
        fs::remove_dir_all(checkout).unwrap();
    }

    #[test]
    fn local_checkout_setting_round_trips() {
        let directory =
            std::env::temp_dir().join(format!("laplace-rook-settings-test-{}", std::process::id()));
        let path = directory.join("rook-dev-settings.json");
        let _ = fs::remove_dir_all(&directory);
        let settings = RookDevSettings {
            enabled: true,
            checkout_path: Some("/work/rook".to_owned()),
        };
        write_rook_dev_settings(&path, &settings, "rook-settings-test").unwrap();
        assert_eq!(read_rook_dev_settings(&path).unwrap(), settings);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn auth_browser_links_require_credential_free_http_urls() {
        assert!(auth_url_is_safe("https://auth.example.com/device"));
        assert!(auth_url_is_safe("http://localhost:3000/callback"));
        assert!(!auth_url_is_safe("file:///etc/passwd"));
        assert!(!auth_url_is_safe("javascript:alert(1)"));
        assert!(!auth_url_is_safe("https://user:pass@example.com/"));
    }

    #[test]
    fn initialize_surfaces_json_rpc_error_instead_of_capability_mismatch() {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": { "code": -32020, "message": "PLYTH is not installed." }
        });
        let error = parse_rook_initialize_response(&response, "rook-init-err").unwrap_err();
        assert_eq!(error.code, "rook_protocol_failed");
        assert_eq!(error.message, "PLYTH is not installed.");
        assert_eq!(error.operation_id, "rook-init-err");
    }

    #[test]
    fn initialize_rejects_missing_immutable_read_only_tools() {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "protocolVersion": 1,
                "capabilities": { "buildSessions": false }
            }
        });
        let error = parse_rook_initialize_response(&response, "rook-init-cap").unwrap_err();
        assert_eq!(error.code, "rook_capability_mismatch");
    }

    #[test]
    fn build_initialize_accepts_build_capabilities_and_rejects_ask_only() {
        let build_ok = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "protocolVersion": 1,
                "capabilities": {
                    "mode": "build",
                    "buildSessions": true,
                    "buildTools": ["read", "edit", "write", "bash"],
                    "sandbox": { "enabled": true, "runtime": "seatbelt", "available": true }
                }
            }
        });
        let parsed = parse_rook_build_initialize_response(&build_ok, "rook-build-ok").unwrap();
        assert_eq!(parsed["capabilities"]["mode"], "build");
        assert_eq!(
            parse_rook_initialize_response(&build_ok, "rook-ask-reject")
                .unwrap_err()
                .code,
            "rook_capability_mismatch"
        );
        let ask_only = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "protocolVersion": 1,
                "capabilities": {
                    "mode": "ask",
                    "buildSessions": false,
                    "immutableReadOnlyTools": ["read"]
                }
            }
        });
        assert_eq!(
            parse_rook_build_initialize_response(&ask_only, "rook-build-old")
                .unwrap_err()
                .code,
            "rook_build_unsupported"
        );
    }

    #[test]
    fn active_build_guard_blocks_only_running_build_workspace() {
        let processes = RookProcesses::default();
        let workspace = PathBuf::from("/tmp/laplace-build-guard");
        let active_run = Arc::new(AtomicBool::new(true));
        let child = Command::new("/bin/sh")
            .args(["-c", "sleep 5"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut child = child;
        let stdin = child.stdin.take().unwrap();
        processes.0.lock().unwrap().insert(
            "build-1".to_owned(),
            Arc::new(Mutex::new(RookProcess {
                child,
                stdin,
                pending: Arc::new(Mutex::new(HashMap::new())),
                next_request: Arc::new(AtomicU64::new(10)),
                pending_auth_logins: HashSet::new(),
                workspace_path: workspace.clone(),
                session_storage: false,
                mode: RookMode::Build,
                active_run: Arc::clone(&active_run),
            })),
        );
        assert!(processes.has_active_build(&workspace));
        assert!(!processes.has_active_build(Path::new("/tmp/other")));
        active_run.store(false, Ordering::SeqCst);
        assert!(!processes.has_active_build(&workspace));
        processes.stop("build-1", "op-stop").unwrap();
    }
}

#[cfg(test)]
mod recipe_tests {
    use super::*;

    #[test]
    fn list_project_recipes_returns_empty_when_missing_and_parses_sorted_v1() {
        let root = std::env::temp_dir().join(format!(
            "laplace-recipe-test-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("packages/app")).unwrap();
        let canonical = fs::canonicalize(&root).unwrap();

        assert!(list_project_recipes_at(&canonical, "recipe-empty")
            .unwrap()
            .is_empty());

        fs::create_dir_all(canonical.join(".laplace")).unwrap();
        fs::write(
            canonical.join(".laplace/recipes.toml"),
            r#"
[recipes.typecheck]
version = 1
program = "pnpm"
args = ["typecheck"]

[recipes.app-test]
version = 1
program = "pnpm"
args = ["test"]
cwd = "packages/app"
"#,
        )
        .unwrap();

        let listed = list_project_recipes_at(&canonical, "recipe-list").unwrap();
        assert_eq!(
            listed,
            vec![
                ProjectRecipeSummary {
                    name: "app-test".to_owned(),
                    program: "pnpm".to_owned(),
                    args: vec!["test".to_owned()],
                    cwd: Some("packages/app".to_owned()),
                },
                ProjectRecipeSummary {
                    name: "typecheck".to_owned(),
                    program: "pnpm".to_owned(),
                    args: vec!["typecheck".to_owned()],
                    cwd: None,
                },
            ]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_project_recipes_rejects_traversal_cwd() {
        let root = std::env::temp_dir().join(format!(
            "laplace-recipe-escape-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".laplace")).unwrap();
        let canonical = fs::canonicalize(&root).unwrap();
        fs::write(
            canonical.join(".laplace/recipes.toml"),
            r#"
[recipes.bad]
version = 1
program = "echo"
args = ["hi"]
cwd = "../outside"
"#,
        )
        .unwrap();

        let error = list_project_recipes_at(&canonical, "recipe-bad").unwrap_err();
        assert_eq!(error.code, "invalid_relative_path");
        let _ = fs::remove_dir_all(&root);
    }
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
        let invalid_explorer_width = UiPreferences {
            explorer_width: Some(120),
            ..UiPreferences::default()
        };
        let invalid_drawer_height = UiPreferences {
            bottom_drawer_height: Some(800),
            ..UiPreferences::default()
        };
        let valid_workspace_panels = UiPreferences {
            explorer_collapsed: Some(true),
            explorer_width: Some(260),
            bottom_drawer_collapsed: Some(false),
            bottom_drawer_height: Some(220),
            ..UiPreferences::default()
        };

        assert!(!validate_preferences(&invalid_font_size));
        assert!(!validate_preferences(&invalid_inspector_width));
        assert!(!validate_preferences(&invalid_explorer_width));
        assert!(!validate_preferences(&invalid_drawer_height));
        assert!(validate_preferences(&valid_workspace_panels));
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
