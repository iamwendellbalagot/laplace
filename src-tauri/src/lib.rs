use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const IPC_SCHEMA_VERSION: u16 = 1;
const EVENT_NAME: &str = "app-event";
static EVENT_SEQUENCE: AtomicU32 = AtomicU32::new(1);
static PREFERENCES_LOCK: Mutex<()> = Mutex::new(());

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

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            ping,
            get_preferences,
            update_preferences
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
}
