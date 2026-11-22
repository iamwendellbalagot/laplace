use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Emitter;

const IPC_SCHEMA_VERSION: u16 = 1;
const EVENT_NAME: &str = "app-event";
static EVENT_SEQUENCE: AtomicU32 = AtomicU32::new(1);

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

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
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
}
