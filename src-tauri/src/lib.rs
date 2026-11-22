use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const IPC_SCHEMA_VERSION: u16 = 1;
const EVENT_NAME: &str = "app-event";
static EVENT_SEQUENCE: AtomicU32 = AtomicU32::new(1);
static PREFERENCES_LOCK: Mutex<()> = Mutex::new(());
static RECENT_PROJECTS_LOCK: Mutex<()> = Mutex::new(());
const MAX_RECENT_PROJECTS: usize = 12;
const MAX_DIRECTORY_ENTRIES: usize = 1_000;
const IGNORED_DIRECTORY_NAMES: &[&str] = &[".git", ".rook", "node_modules", "target", "dist"];

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            get_preferences,
            update_preferences,
            open_project,
            get_recent_projects,
            list_project_entries
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
            "laplace-project-test-{}-unicode folder",
            std::process::id()
        ));
        let history_path = directory.with_extension("history.json");
        let _ = fs::remove_dir_all(&directory);
        let _ = fs::remove_file(&history_path);
        fs::create_dir_all(&directory).unwrap();

        let mut projects = Vec::new();
        let project = open_project_path(&directory, &mut projects).unwrap();
        assert_eq!(
            project.id,
            fs::canonicalize(&directory).unwrap().to_str().unwrap()
        );
        assert!(project.name.ends_with("unicode folder"));
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
}
