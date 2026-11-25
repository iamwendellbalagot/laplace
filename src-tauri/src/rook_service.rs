use super::*;

pub(crate) static ROOK_DEV_SETTINGS_LOCK: Mutex<()> = Mutex::new(());

#[cfg(any(debug_assertions, test))]
pub(crate) fn write_rook_build_hmr_guard_at(
    marker_path: &Path,
    workspace_root: &Path,
    active: bool,
    timestamp_ms: i64,
) {
    let payload = if active {
        serde_json::json!({
            "workspacePath": workspace_root.to_string_lossy(),
            "active": true,
            "updatedAtMs": timestamp_ms,
        })
    } else {
        serde_json::json!({
            "workspacePath": workspace_root.to_string_lossy(),
            "active": false,
            "endedAtMs": timestamp_ms,
        })
    };
    if let Ok(bytes) = serde_json::to_vec(&payload) {
        let _ = fs::write(marker_path, bytes);
    }
}

#[cfg(debug_assertions)]
pub(crate) fn write_dev_rook_build_hmr_guard(workspace_root: &Path, active: bool) {
    let marker_path = std::env::temp_dir().join("laplace-dev-rook-build.json");
    write_rook_build_hmr_guard_at(&marker_path, workspace_root, active, now_ms());
}

#[cfg(not(debug_assertions))]
pub(crate) fn write_dev_rook_build_hmr_guard(_workspace_root: &Path, _active: bool) {}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RookMode {
    Ask,
    Build,
}

impl RookMode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Ask => "ask",
            Self::Build => "build",
        }
    }
}

#[derive(Default)]
pub(crate) struct RookProcesses(pub(crate) Mutex<HashMap<String, Arc<Mutex<RookProcess>>>>);

pub(crate) struct RookProcess {
    pub(crate) child: std::process::Child,
    pub(crate) stdin: std::process::ChildStdin,
    pub(crate) pending: Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<serde_json::Value>>>>,
    pub(crate) next_request: Arc<AtomicU64>,
    pub(crate) pending_auth_logins: HashSet<String>,
    pub(crate) workspace_path: PathBuf,
    pub(crate) session_storage: bool,
    pub(crate) mode: RookMode,
    pub(crate) active_run: Arc<AtomicBool>,
}

impl Drop for RookProcesses {
    fn drop(&mut self) {
        if let Ok(processes) = self.0.get_mut() {
            for process in processes.values() {
                if let Ok(mut process) = process.lock() {
                    if let Ok(mut pending) = process.pending.lock() {
                        pending.clear();
                    }
                    if process.mode == RookMode::Build && process.active_run.load(Ordering::SeqCst)
                    {
                        write_dev_rook_build_hmr_guard(&process.workspace_path, false);
                    }
                    let _ = process.child.kill();
                }
            }
        }
    }
}

impl RookProcesses {
    pub(crate) fn stop(&self, session_id: &str, operation_id: &str) -> Result<(), IpcError> {
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
            if let Ok(mut pending) = process.pending.lock() {
                pending.clear();
            }
            process.active_run.store(false, Ordering::SeqCst);
            if process.mode == RookMode::Build {
                write_dev_rook_build_hmr_guard(&process.workspace_path, false);
            }
            let _ = process.child.kill();
        }
        Ok(())
    }

    pub(crate) fn has_active_build(&self, workspace_root: &Path) -> bool {
        let Ok(processes) = self.0.lock() else {
            return false;
        };
        processes.values().any(|entry| {
            entry
                .lock()
                .map(|process| {
                    process.mode == RookMode::Build
                        && process.workspace_path == workspace_root
                        && process.active_run.load(Ordering::SeqCst)
                })
                .unwrap_or(false)
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookDevSettingsRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) checkout_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookDevSettings {
    pub(crate) enabled: bool,
    pub(crate) checkout_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) session_id: String,
    pub(crate) workspace_id: String,
    #[serde(default)]
    pub(crate) worktree_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookInitResponse {
    pub(crate) session_id: String,
    pub(crate) active_session_id: String,
    pub(crate) sessions: serde_json::Value,
    pub(crate) messages: serde_json::Value,
    pub(crate) host_session_storage: bool,
    pub(crate) mode: RookMode,
    #[serde(default)]
    pub(crate) sandbox: Option<serde_json::Value>,
    pub(crate) workspace_id: String,
    pub(crate) rook_version: String,
    pub(crate) capabilities: serde_json::Value,
    #[serde(default)]
    pub(crate) providers: Vec<RookProviderInfo>,
    #[serde(default)]
    pub(crate) current_model: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookProviderInfo {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) configured: bool,
    pub(crate) source: String,
    #[serde(default)]
    pub(crate) endpoint: Option<String>,
    #[serde(default)]
    pub(crate) auth_methods: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookPromptRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) session_id: String,
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookStopRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookCancelRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) session_id: String,
    pub(crate) run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookPermissionRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) session_id: String,
    pub(crate) permission_id: String,
    pub(crate) choice: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookProviderRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) session_id: String,
    pub(crate) method: String,
    pub(crate) params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookAuthPromptResponse {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) session_id: String,
    pub(crate) prompt_id: String,
    pub(crate) value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookAuthUrlRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) url: String,
}

pub(crate) fn auth_url_is_safe(url: &str) -> bool {
    let Ok(url) = tauri::Url::parse(url) else {
        return false;
    };
    matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
}

pub(crate) fn validate_workspace_provider_config(root: &Path) -> Result<(), IpcError> {
    let path = root.join("models.json");
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => {
            return Err(terminal_error(
                "workspace_models_unavailable",
                "Workspace model configuration could not be read.",
                "rook-provider",
            ))
        }
    };
    if bytes.len() > 256 * 1024 {
        return Err(terminal_error(
            "workspace_models_invalid",
            "Workspace models.json exceeds the supported size limit.",
            "rook-provider",
        ));
    }
    let config: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
        terminal_error(
            "workspace_models_invalid",
            "Workspace models.json must contain valid JSON.",
            "rook-provider",
        )
    })?;
    if !workspace_provider_config_is_safe(&config) {
        return Err(terminal_error(
            "workspace_models_invalid",
            "Workspace provider settings are invalid; credentials and prompts are blocked.",
            "rook-provider",
        ));
    }
    for (id, provider) in config["providers"].as_object().into_iter().flatten() {
        let valid_http_url = |value: &str| {
            tauri::Url::parse(value).is_ok_and(|url| {
                matches!(url.scheme(), "http" | "https")
                    && url.username().is_empty()
                    && url.password().is_none()
            })
        };
        let key = provider["apiKey"].as_str();
        if key.is_some_and(|key| {
            let name = key.strip_prefix('$').unwrap_or("");
            let mut chars = name.chars();
            !chars
                .next()
                .is_some_and(|first| first == '_' || first.is_ascii_alphabetic())
                || !chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
                || key.len() != name.len() + 1
        }) || provider["baseUrl"]
            .as_str()
            .is_some_and(|url| !valid_http_url(url))
            || provider["models"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|model| {
                    model["id"].as_str().is_none()
                        || model["baseUrl"]
                            .as_str()
                            .is_some_and(|url| !valid_http_url(url))
                })
        {
            return Err(terminal_error(
                "workspace_models_invalid",
                &format!("Workspace models.json contains invalid settings for provider '{id}'."),
                "rook-provider",
            ));
        }
    }
    Ok(())
}

pub(crate) fn workspace_provider_config_is_safe(config: &serde_json::Value) -> bool {
    let Some(providers) = config["providers"].as_object() else {
        return true;
    };
    providers.values().all(|provider| {
        let http_url = |value: &str| {
            tauri::Url::parse(value).is_ok_and(|url| {
                matches!(url.scheme(), "https" | "http")
                    && url.username().is_empty()
                    && url.password().is_none()
            })
        };
        provider["apiKey"].as_str().is_none_or(|key| {
            let Some(name) = key.strip_prefix('$') else {
                return false;
            };
            let mut chars = name.chars();
            chars
                .next()
                .is_some_and(|first| first == '_' || first.is_ascii_alphabetic())
                && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
        }) && provider["baseUrl"].as_str().is_none_or(http_url)
            && provider["models"]
                .as_array()
                .into_iter()
                .flatten()
                .all(|model| {
                    model["id"].as_str().is_some() && model["baseUrl"].as_str().is_none_or(http_url)
                })
    })
}

pub(crate) fn rook_dev_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, IpcError> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("rook-dev-settings.json"))
        .map_err(|_| {
            IpcError::new(
                "rook_settings_unavailable",
                "Laplace could not locate its developer settings directory.",
                String::new(),
                true,
            )
        })
}

pub(crate) fn valid_rook_checkout(path: &Path) -> Option<PathBuf> {
    let checkout = fs::canonicalize(path).ok()?;
    let cli = checkout.join("bin/rook.mjs");
    if !checkout.is_dir()
        || !cli.is_file()
        || !checkout.join("dist/index.js").is_file()
        || !checkout.join("node_modules").is_dir()
    {
        return None;
    }
    let version = Command::new("node")
        .arg(cli)
        .arg("--version")
        .output()
        .ok()?;
    if !version.status.success() || !String::from_utf8_lossy(&version.stdout).starts_with("rook ") {
        return None;
    }
    Some(checkout)
}

pub(crate) fn read_rook_dev_settings(path: &Path) -> Result<RookDevSettings, IpcError> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            IpcError::new(
                "rook_settings_invalid",
                "Rook developer settings are invalid; choose the local Rook checkout again.",
                String::new(),
                false,
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(RookDevSettings {
            enabled: tauri::is_dev(),
            checkout_path: None,
        }),
        Err(_) => Err(IpcError::new(
            "rook_settings_read_failed",
            "Rook developer settings could not be read.",
            String::new(),
            true,
        )),
    }
}

pub(crate) fn write_rook_dev_settings(
    path: &Path,
    settings: &RookDevSettings,
    operation_id: &str,
) -> Result<(), IpcError> {
    let _guard = ROOK_DEV_SETTINGS_LOCK.lock().map_err(|_| {
        terminal_error(
            "rook_settings_busy",
            "Rook developer settings are temporarily unavailable.",
            operation_id,
        )
    })?;
    let parent = path.parent().ok_or_else(|| {
        terminal_error(
            "rook_settings_invalid",
            "Rook developer settings could not be saved.",
            operation_id,
        )
    })?;
    fs::create_dir_all(parent).map_err(|_| {
        terminal_error(
            "rook_settings_write_failed",
            "Rook developer settings could not be saved.",
            operation_id,
        )
    })?;
    let temporary_path = parent.join(format!(".rook-dev-settings-{operation_id}.tmp"));
    let bytes = serde_json::to_vec_pretty(settings).map_err(|_| {
        terminal_error(
            "rook_settings_write_failed",
            "Rook developer settings could not be saved.",
            operation_id,
        )
    })?;
    fs::write(&temporary_path, bytes).map_err(|_| {
        terminal_error(
            "rook_settings_write_failed",
            "Rook developer settings could not be saved.",
            operation_id,
        )
    })?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|_| {
            terminal_error(
                "rook_settings_write_failed",
                "Rook developer settings could not be replaced.",
                operation_id,
            )
        })?;
    }
    if fs::rename(&temporary_path, path).is_err() {
        let _ = fs::remove_file(&temporary_path);
        return Err(terminal_error(
            "rook_settings_write_failed",
            "Rook developer settings could not be saved.",
            operation_id,
        ));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_rook_dev_settings(
    app: tauri::AppHandle,
    request: PreferencesRequest,
) -> Result<RookDevSettings, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_rook_settings",
            "The Rook settings request is invalid.",
            &request.operation_id,
        ));
    }
    let mut settings = read_rook_dev_settings(&rook_dev_settings_path(&app)?)?;
    settings.enabled = tauri::is_dev();
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn set_rook_dev_checkout(
    app: tauri::AppHandle,
    request: RookDevSettingsRequest,
) -> Result<RookDevSettings, IpcError> {
    if !tauri::is_dev() {
        return Err(terminal_error(
            "rook_dev_settings_unavailable",
            "The Rook checkout setting is available only in development builds.",
            &request.operation_id,
        ));
    }
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_rook_settings",
            "The Rook settings request is invalid.",
            &request.operation_id,
        ));
    }
    let checkout_path = match request.checkout_path {
        Some(path) => Some(
            valid_rook_checkout(Path::new(&path))
                .ok_or_else(|| {
                    terminal_error(
                        "rook_checkout_invalid",
                        "Choose a Rook checkout containing the built bin/rook.mjs and dist/index.js files.",
                        &request.operation_id,
                    )
                })?
                .to_string_lossy()
                .into_owned(),
        ),
        None => None,
    };
    let settings = RookDevSettings {
        enabled: true,
        checkout_path,
    };
    write_rook_dev_settings(
        &rook_dev_settings_path(&app)?,
        &settings,
        &request.operation_id,
    )?;
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn start_rook_ask(
    app: tauri::AppHandle,
    processes: tauri::State<'_, RookProcesses>,
    database: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    request: RookRequest,
) -> Result<RookInitResponse, IpcError> {
    start_rook_session(app, processes, database, trusted, request, RookMode::Ask).await
}

#[tauri::command]
pub(crate) async fn start_rook_build(
    app: tauri::AppHandle,
    processes: tauri::State<'_, RookProcesses>,
    database: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    request: RookRequest,
) -> Result<RookInitResponse, IpcError> {
    start_rook_session(app, processes, database, trusted, request, RookMode::Build).await
}

pub(crate) async fn start_rook_session(
    app: tauri::AppHandle,
    processes: tauri::State<'_, RookProcesses>,
    database: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    request: RookRequest,
    mode: RookMode,
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
    if mode == RookMode::Build {
        let mut is_trusted = trusted.contains(&root)?;
        if !is_trusted {
            let pool = open_domain_database(&app, &database).await?;
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
                if let Ok(mut guard) = trusted.0.lock() {
                    guard.insert(root.to_string_lossy().into_owned());
                }
                is_trusted = true;
            }
        }
        if !is_trusted {
            return Err(terminal_error(
                "workspace_not_trusted",
                "Trust this project before starting Rook Build.",
                &request.operation_id,
            ));
        }
    }
    let effective_root = match request.worktree_path.as_deref() {
        Some(wt) if !wt.trim().is_empty() => {
            git_service::resolve_candidate_worktree_path(&app, &root, wt, &request.operation_id)?
        }
        _ => root.clone(),
    };
    let runtime = rook_runtime::resolve_rook_runtime_for_launch(&app, &request.operation_id)?;
    let app_data_dir = app.path().app_data_dir().map_err(|_| {
        terminal_error(
            "rook_session_path_unavailable",
            "Laplace could not locate local Rook session storage.",
            &request.operation_id,
        )
    })?;
    let workspace_sessions_dir = app_data_dir.join("rook-sessions").join(format!(
        "{:x}",
        Sha256::digest(effective_root.to_string_lossy().as_bytes())
    ));
    fs::create_dir_all(&workspace_sessions_dir).map_err(|_| {
        terminal_error(
            "rook_session_path_unavailable",
            "Laplace could not prepare local Rook session storage.",
            &request.operation_id,
        )
    })?;
    let mut child = spawn_rook(
        &effective_root,
        &workspace_sessions_dir,
        &runtime,
        mode,
        &request.operation_id,
    )?;
    let pending: Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<serde_json::Value>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let next_request = Arc::new(AtomicU64::new(10));
    let active_run = Arc::new(AtomicBool::new(false));
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
        let _ = child.kill();
        terminal_error(
            "rook_protocol_invalid",
            if mode == RookMode::Build {
                "Rook returned an invalid initialization response. Update your Rook checkout for Build mode."
            } else {
                "Rook returned an invalid initialization response."
            },
            &request.operation_id,
        )
    })?;
    let parsed = match mode {
        RookMode::Ask => parse_rook_initialize_response(&value, &request.operation_id),
        RookMode::Build => parse_rook_build_initialize_response(&value, &request.operation_id),
    };
    let result = match parsed {
        Ok(result) => result,
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };
    let host_session_storage = result["capabilities"]["hostSessionStorage"] == true;
    let mut session_summaries = serde_json::json!([]);
    let (active_session_id, history_messages) = if host_session_storage {
        let pool = open_domain_database(&app, &database).await?;
        let prior_session_id: Option<String> = sqlx::query_scalar(
            "SELECT session_id FROM rook_workspace_sessions WHERE project_id = ?",
        )
        .bind(effective_root.to_string_lossy().as_ref())
        .fetch_optional(&pool)
        .await
        .map_err(|_| {
            terminal_error(
                "rook_session_read_failed",
                "The selected Rook session could not be loaded.",
                &request.operation_id,
            )
        })?;
        let session_list = rook_rpc(
            &mut stdin,
            &mut stdout,
            2,
            "session/list",
            serde_json::json!({}),
            &request.operation_id,
        )?;
        let sessions = session_list["sessions"].as_array().ok_or_else(|| {
            terminal_error(
                "rook_protocol_invalid",
                "Rook returned an invalid session list.",
                &request.operation_id,
            )
        })?;
        let restore = prior_session_id
            .as_deref()
            .filter(|saved| sessions.iter().any(|session| session["id"] == *saved));
        let session_id = if let Some(saved) = restore {
            let loaded = rook_rpc(
                &mut stdin,
                &mut stdout,
                3,
                "session/load",
                serde_json::json!({"sessionId": saved}),
                &request.operation_id,
            )?;
            if loaded["mode"] != mode.as_str() || loaded["sessionId"] != saved {
                let _ = child.kill();
                return Err(terminal_error(
                    "rook_session_failed",
                    "Rook could not reopen the selected session.",
                    &request.operation_id,
                ));
            }
            saved.to_owned()
        } else {
            let created = rook_rpc(
                &mut stdin,
                &mut stdout,
                3,
                "session/new",
                serde_json::json!({"mode": mode.as_str()}),
                &request.operation_id,
            )?;
            created["sessionId"]
                .as_str()
                .ok_or_else(|| {
                    terminal_error(
                        "rook_session_failed",
                        "Rook did not create a session.",
                        &request.operation_id,
                    )
                })?
                .to_owned()
        };
        let session_list = rook_rpc(
            &mut stdin,
            &mut stdout,
            4,
            "session/list",
            serde_json::json!({}),
            &request.operation_id,
        )?;
        session_summaries = session_list["sessions"].clone();
        let history = rook_rpc(
            &mut stdin,
            &mut stdout,
            5,
            "session/history",
            serde_json::json!({"limit":200}),
            &request.operation_id,
        )?;
        save_rook_workspace_session(&pool, &effective_root, &session_id, &request.operation_id)
            .await?;
        (session_id, history["messages"].clone())
    } else {
        let created = rook_rpc(
            &mut stdin,
            &mut stdout,
            2,
            "session/new",
            serde_json::json!({"mode": mode.as_str()}),
            &request.operation_id,
        )?;
        let id = created["sessionId"]
            .as_str()
            .ok_or_else(|| {
                terminal_error(
                    "rook_session_failed",
                    "Rook did not create a session.",
                    &request.operation_id,
                )
            })?
            .to_owned();
        (id, serde_json::json!([]))
    };
    let app_events = app.clone();
    let process_id = request.session_id.clone();
    let pending_events = Arc::clone(&pending);
    let active_run_events = Arc::clone(&active_run);
    let event_workspace_path = effective_root.clone();
    std::thread::spawn(move || {
        let mut line = String::new();
        while std::io::BufRead::read_line(&mut stdout, &mut line).unwrap_or(0) > 0 {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                if value["method"] == "session/update" {
                    if value["params"]["event"]["type"] == "run_settled" {
                        active_run_events.store(false, Ordering::SeqCst);
                        if mode == RookMode::Build {
                            write_dev_rook_build_hmr_guard(&event_workspace_path, false);
                        }
                    }
                    if let Some(request_id) = value["params"]["requestId"].as_u64() {
                        if let Ok(mut waiting) = pending_events.lock() {
                            if let Some(sender) = waiting.remove(&request_id) {
                                let _ = sender.send(value);
                                line.clear();
                                continue;
                            }
                        }
                    }
                }
                if let Some(id) = value["id"].as_u64() {
                    if let Ok(mut waiting) = pending_events.lock() {
                        if let Some(sender) = waiting.remove(&id) {
                            if value["result"]["settled"] == true {
                                active_run_events.store(false, Ordering::SeqCst);
                                if mode == RookMode::Build {
                                    write_dev_rook_build_hmr_guard(&event_workspace_path, false);
                                }
                                if let Some(run_id) = value["result"]["runId"].as_str() {
                                    let settled = serde_json::json!({
                                        "method": "session/update",
                                        "params": {
                                            "runId": run_id,
                                            "event": { "type": "run_settled", "aborted": false }
                                        }
                                    });
                                    let _ = app_events.emit(
                                        "rook-event",
                                        serde_json::json!({"sessionId":process_id,"message":settled}),
                                    );
                                }
                            } else if !value["error"].is_null() {
                                active_run_events.store(false, Ordering::SeqCst);
                                if mode == RookMode::Build {
                                    write_dev_rook_build_hmr_guard(&event_workspace_path, false);
                                }
                            }
                            let _ = sender.send(value);
                            line.clear();
                            continue;
                        }
                    }
                }
                if value["method"] == "provider/auth_prompt"
                    || value["method"] == "provider/auth_event"
                    || value["method"] == "workspace/providers_changed"
                {
                    let _ = app_events.emit(
                        "rook-event",
                        serde_json::json!({"sessionId":process_id,"message":value}),
                    );
                    line.clear();
                    continue;
                }
                let _ = app_events.emit(
                    "rook-event",
                    serde_json::json!({"sessionId":process_id,"message":value}),
                );
            }
            line.clear();
        }
        active_run_events.store(false, Ordering::SeqCst);
        if mode == RookMode::Build {
            write_dev_rook_build_hmr_guard(&event_workspace_path, false);
        }
    });
    let response = RookInitResponse {
        session_id: request.session_id.clone(),
        active_session_id: active_session_id.clone(),
        sessions: session_summaries,
        messages: history_messages,
        host_session_storage,
        mode,
        sandbox: result["capabilities"]
            .get("sandbox")
            .filter(|value| !value.is_null())
            .cloned(),
        workspace_id: result["workspaceId"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        rook_version: result["rookVersion"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        capabilities: result["capabilities"].clone(),
        providers: serde_json::from_value(result["providers"].clone()).unwrap_or_default(),
        current_model: result
            .get("currentModel")
            .filter(|value| !value.is_null())
            .cloned(),
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
            Arc::new(Mutex::new(RookProcess {
                child,
                stdin,
                pending,
                next_request,
                pending_auth_logins: HashSet::new(),
                workspace_path: effective_root.clone(),
                session_storage: host_session_storage,
                mode,
                active_run,
            })),
        );
    Ok(response)
}

pub(crate) fn parse_rook_initialize_response<'a>(
    value: &'a serde_json::Value,
    operation_id: &str,
) -> Result<&'a serde_json::Value, IpcError> {
    if !value["error"].is_null() {
        return Err(terminal_error(
            "rook_protocol_failed",
            value["error"]["message"]
                .as_str()
                .unwrap_or("Rook rejected initialization."),
            operation_id,
        ));
    }
    let result = &value["result"];
    if result["protocolVersion"] != 1
        || result["capabilities"]["buildSessions"] != false
        || result["capabilities"]["immutableReadOnlyTools"]
            .as_array()
            .is_none()
    {
        return Err(terminal_error(
            "rook_capability_mismatch",
            "Rook did not advertise the immutable read-only Ask capability.",
            operation_id,
        ));
    }
    Ok(result)
}

pub(crate) fn parse_rook_build_initialize_response<'a>(
    value: &'a serde_json::Value,
    operation_id: &str,
) -> Result<&'a serde_json::Value, IpcError> {
    if !value["error"].is_null() {
        return Err(terminal_error(
            "rook_protocol_failed",
            value["error"]["message"]
                .as_str()
                .unwrap_or("Rook rejected Build initialization."),
            operation_id,
        ));
    }
    let result = &value["result"];
    if result["protocolVersion"] != 1
        || result["capabilities"]["mode"] != "build"
        || result["capabilities"]["buildSessions"] != true
        || result["capabilities"]["buildTools"].as_array().is_none()
    {
        return Err(terminal_error(
            "rook_build_unsupported",
            "This Rook version does not advertise authorized Build sessions.",
            operation_id,
        ));
    }
    Ok(result)
}

pub(crate) fn spawn_rook(
    root: &Path,
    session_dir: &Path,
    runtime: &rook_runtime::RookRuntimeResolution,
    mode: RookMode,
    operation_id: &str,
) -> Result<std::process::Child, IpcError> {
    let mut command = Command::new(&runtime.node_bin);
    command.arg(&runtime.rook_entry);
    command.args(["--stdio", "--cwd"]).arg(root);
    if mode == RookMode::Build {
        command.args(["--mode", "build"]);
    }
    command
        .env("LAPLACE_ROOK_SESSION_DIR", session_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| {
            terminal_error(
                "rook_unavailable",
                "Rook could not be started from Laplace's runtime. Reinstall or repair Laplace.",
                operation_id,
            )
        })
}

pub(crate) fn rook_rpc(
    stdin: &mut std::process::ChildStdin,
    stdout: &mut std::io::BufReader<std::process::ChildStdout>,
    id: u64,
    method: &str,
    params: serde_json::Value,
    operation_id: &str,
) -> Result<serde_json::Value, IpcError> {
    writeln!(
        stdin,
        "{}",
        serde_json::json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
    )
    .map_err(|_| {
        terminal_error(
            "rook_protocol_failed",
            "The Rook session request could not be sent.",
            operation_id,
        )
    })?;
    let mut line = String::new();
    std::io::BufRead::read_line(stdout, &mut line).map_err(|_| {
        terminal_error(
            "rook_protocol_failed",
            "Rook returned no session response.",
            operation_id,
        )
    })?;
    let response: serde_json::Value = serde_json::from_str(&line).map_err(|_| {
        terminal_error(
            "rook_protocol_invalid",
            "Rook returned an invalid session response.",
            operation_id,
        )
    })?;
    if !response["error"].is_null() || response["id"] != id {
        return Err(terminal_error(
            "rook_session_failed",
            response["error"]["message"]
                .as_str()
                .unwrap_or("Rook rejected the session request."),
            operation_id,
        ));
    }
    Ok(response["result"].clone())
}

pub(crate) async fn save_rook_workspace_session(
    pool: &SqlitePool,
    root: &Path,
    session_id: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    sqlx::query("INSERT INTO rook_workspace_sessions (project_id, session_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at")
        .bind(root.to_string_lossy().as_ref())
        .bind(session_id)
        .bind(now_ms())
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|_| {
            terminal_error(
                "rook_session_write_failed",
                "The selected Rook session could not be saved.",
                operation_id,
            )
        })
}

#[tauri::command]
pub(crate) async fn prompt_rook_ask(
    processes: tauri::State<'_, RookProcesses>,
    request: RookPromptRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.session_id)
        || request.text.trim().is_empty()
        || request.text.len() > 64_000
        || request.context.as_deref().map(str::len).unwrap_or(0) > 32_000
    {
        return Err(terminal_error(
            "invalid_rook_prompt",
            "The Ask prompt exceeds supported limits.",
            &request.operation_id,
        ));
    }
    let process = {
        let processes = processes.0.lock().map_err(|_| {
            terminal_error(
                "rook_busy",
                "Rook sessions are temporarily unavailable.",
                &request.operation_id,
            )
        })?;
        Arc::clone(processes.get(&request.session_id).ok_or_else(|| {
            terminal_error(
                "rook_session_missing",
                "This Rook Ask session is no longer active.",
                &request.operation_id,
            )
        })?)
    };
    let workspace_path = process
        .lock()
        .map_err(|_| {
            terminal_error(
                "rook_busy",
                "This Rook session is temporarily unavailable.",
                &request.operation_id,
            )
        })?
        .workspace_path
        .clone();
    validate_workspace_provider_config(&workspace_path)?;
    let mut process = process.lock().map_err(|_| {
        terminal_error(
            "rook_busy",
            "This Rook session is temporarily unavailable.",
            &request.operation_id,
        )
    })?;
    let prompt = rook_prompt_message(&request.text, request.context.as_deref().unwrap_or(""));
    process.next_request.fetch_max(10, Ordering::Relaxed);
    let mut prompt = prompt;
    let request_id = process.next_request.fetch_add(1, Ordering::Relaxed);
    prompt["id"] = serde_json::json!(request_id);
    process
        .pending
        .lock()
        .map_err(|_| {
            terminal_error(
                "rook_busy",
                "Rook responses are temporarily unavailable.",
                &request.operation_id,
            )
        })?
        .insert(request_id, tokio::sync::oneshot::channel().0);
    process.active_run.store(true, Ordering::SeqCst);
    if process.mode == RookMode::Build {
        write_dev_rook_build_hmr_guard(&process.workspace_path, true);
    }
    if writeln!(process.stdin, "{}", prompt).is_err() {
        process.active_run.store(false, Ordering::SeqCst);
        if process.mode == RookMode::Build {
            write_dev_rook_build_hmr_guard(&process.workspace_path, false);
        }
        if let Ok(mut pending) = process.pending.lock() {
            pending.remove(&request_id);
        }
        return Err(terminal_error(
            "rook_protocol_failed",
            "The prompt could not be sent.",
            &request.operation_id,
        ));
    }
    Ok(())
}

pub(crate) fn rook_prompt_message(text: &str, context: &str) -> serde_json::Value {
    serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"text":text,"context":context}})
}

#[tauri::command]
pub(crate) async fn stop_rook_ask(
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
pub(crate) async fn cancel_rook_ask(
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
    writeln!(
        stdin,
        "{}",
        serde_json::json!({"jsonrpc":"2.0","id":5,"method":"session/cancel","params":{"runId":request.run_id}})
    )
    .map_err(|_| {
        terminal_error(
            "rook_protocol_failed",
            "The Ask run could not be cancelled.",
            &request.operation_id,
        )
    })?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn respond_rook_permission(
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

#[tauri::command]
pub(crate) async fn rook_provider_request(
    app: tauri::AppHandle,
    processes: tauri::State<'_, RookProcesses>,
    database: tauri::State<'_, DomainDatabase>,
    request: RookProviderRequest,
) -> Result<serde_json::Value, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.session_id)
        || !matches!(
            request.method.as_str(),
            "provider/list"
                | "provider/login"
                | "provider/logout"
                | "provider/auth_cancel"
                | "model/list"
                | "model/select"
                | "session/prompt"
                | "session/list"
                | "session/new"
                | "session/load"
                | "session/history"
        )
    {
        return Err(terminal_error(
            "invalid_rook_provider_request",
            "The provider or model request is invalid.",
            &request.operation_id,
        ));
    }
    if request.method == "provider/auth_cancel" {
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
        let params = request.params;
        let login_id = params["loginId"].as_str().ok_or_else(|| {
            terminal_error(
                "invalid_rook_provider_request",
                "loginId is required.",
                &request.operation_id,
            )
        })?;
        let id = process.next_request.fetch_add(1, Ordering::Relaxed);
        if !process.pending_auth_logins.contains(login_id) {
            return Ok(serde_json::json!({"accepted":false}));
        }
        writeln!(
            process.stdin,
            "{}",
            serde_json::json!({"jsonrpc":"2.0","id":id,"method":"provider/auth_cancel","params":params})
        )
        .map_err(|_| {
            terminal_error(
                "rook_protocol_failed",
                "Sign-in cancellation could not be sent.",
                &request.operation_id,
            )
        })?;
        return Ok(serde_json::json!({"accepted":true}));
    }
    let process = {
        let processes = processes.0.lock().map_err(|_| {
            terminal_error(
                "rook_busy",
                "Rook sessions are temporarily unavailable.",
                &request.operation_id,
            )
        })?;
        Arc::clone(processes.get(&request.session_id).ok_or_else(|| {
            terminal_error(
                "rook_session_missing",
                "This Rook Ask session is no longer active.",
                &request.operation_id,
            )
        })?)
    };
    let (workspace_path, session_storage) = {
        let process = process.lock().map_err(|_| {
            terminal_error(
                "rook_busy",
                "This Rook session is temporarily unavailable.",
                &request.operation_id,
            )
        })?;
        (process.workspace_path.clone(), process.session_storage)
    };
    validate_workspace_provider_config(&workspace_path)?;
    let login_id = request.params["loginId"].as_str().map(str::to_owned);
    let (id, receiver) = {
        let mut process = process.lock().map_err(|_| {
            terminal_error(
                "rook_busy",
                "This Rook session is temporarily unavailable.",
                &request.operation_id,
            )
        })?;

        let id = process.next_request.fetch_add(1, Ordering::Relaxed);
        if request.method == "provider/login" {
            if let Some(login_id) = login_id.as_deref() {
                process.pending_auth_logins.insert(login_id.to_owned());
            }
        }
        let (sender, receiver) = tokio::sync::oneshot::channel();
        process
            .pending
            .lock()
            .map_err(|_| {
                terminal_error(
                    "rook_busy",
                    "Rook responses are temporarily unavailable.",
                    &request.operation_id,
                )
            })?
            .insert(id, sender);
        let mut params = request.params;
        if request.method == "session/prompt" {
            params["context"] = serde_json::json!("");
            process.active_run.store(true, Ordering::SeqCst);
            if process.mode == RookMode::Build {
                write_dev_rook_build_hmr_guard(&process.workspace_path, true);
            }
        } else if request.method == "session/new" && params.get("mode").is_none() {
            params["mode"] = serde_json::json!(process.mode.as_str());
        }
        let message =
            serde_json::json!({"jsonrpc":"2.0","id":id,"method":request.method,"params":params});
        if writeln!(process.stdin, "{message}").is_err() {
            if request.method == "session/prompt" {
                process.active_run.store(false, Ordering::SeqCst);
                if process.mode == RookMode::Build {
                    write_dev_rook_build_hmr_guard(&process.workspace_path, false);
                }
            }
            process
                .pending
                .lock()
                .ok()
                .map(|mut waiting| waiting.remove(&id));
            if request.method == "provider/login" {
                if let Some(login_id) = login_id.as_deref() {
                    process.pending_auth_logins.remove(login_id);
                }
            }
            return Err(terminal_error(
                "rook_protocol_failed",
                "The provider or model request could not be sent.",
                &request.operation_id,
            ));
        }
        (id, receiver)
    };
    let response = match tokio::time::timeout(std::time::Duration::from_secs(300), receiver).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => {
            process.lock().ok().and_then(|mut process| {
                if request.method == "provider/login" {
                    if let Some(login_id) = login_id.as_deref() {
                        process.pending_auth_logins.remove(login_id);
                    }
                }
                process
                    .pending
                    .lock()
                    .ok()
                    .map(|mut pending| pending.remove(&id))
            });
            return Err(terminal_error(
                "rook_protocol_failed",
                "Rook disconnected before completing the provider or model request.",
                &request.operation_id,
            ));
        }
        Err(_) => {
            process.lock().ok().and_then(|mut process| {
                if request.method == "provider/login" {
                    if let Some(login_id) = login_id.as_deref() {
                        process.pending_auth_logins.remove(login_id);
                    }
                }
                process
                    .pending
                    .lock()
                    .ok()
                    .map(|mut pending| pending.remove(&id))
            });
            return Err(terminal_error(
                "rook_protocol_timeout",
                "Rook did not answer the provider or model request.",
                &request.operation_id,
            ));
        }
    };
    if let Some(error) = response.get("error") {
        return Err(terminal_error(
            "rook_provider_error",
            error["message"]
                .as_str()
                .unwrap_or("Rook rejected the provider or model request."),
            &request.operation_id,
        ));
    }
    let result = response
        .get("result")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    if session_storage && matches!(request.method.as_str(), "session/new" | "session/load") {
        if let Some(active) = result["sessionId"].as_str() {
            let pool = open_domain_database(&app, &database).await?;
            save_rook_workspace_session(&pool, &workspace_path, active, &request.operation_id)
                .await?;
        }
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn respond_rook_auth_prompt(
    processes: tauri::State<'_, RookProcesses>,
    mut request: RookAuthPromptResponse,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.session_id)
        || !request.prompt_id.starts_with("rook:auth:")
        || request.prompt_id.len() > 128
        || request.value.len() > 16_384
    {
        return Err(terminal_error(
            "invalid_rook_auth_response",
            "The sign-in response is invalid.",
            &request.operation_id,
        ));
    }
    if request.value.contains('\0') {
        return Err(terminal_error(
            "invalid_rook_auth_response",
            "The sign-in response contains an invalid character.",
            &request.operation_id,
        ));
    }
    let login_id = request
        .prompt_id
        .split(':')
        .nth(2)
        .unwrap_or_default()
        .to_owned();
    let encoded =
        serde_json::json!({"jsonrpc":"2.0","id":request.prompt_id,"result":{"value":request.value}})
            .to_string();
    let process = {
        let processes = processes.0.lock().map_err(|_| {
            terminal_error(
                "rook_busy",
                "Rook sessions are temporarily unavailable.",
                &request.operation_id,
            )
        })?;
        Arc::clone(processes.get(&request.session_id).ok_or_else(|| {
            terminal_error(
                "rook_session_missing",
                "This Rook Ask session is no longer active.",
                &request.operation_id,
            )
        })?)
    };
    let mut process = process.lock().map_err(|_| {
        terminal_error(
            "rook_busy",
            "This Rook session is temporarily unavailable.",
            &request.operation_id,
        )
    })?;
    process.pending_auth_logins.insert(login_id);
    let result = writeln!(process.stdin, "{encoded}").map_err(|_| {
        terminal_error(
            "rook_protocol_failed",
            "The sign-in response could not be sent.",
            &request.operation_id,
        )
    });
    request.value.clear();
    result
}

#[tauri::command]
pub(crate) async fn open_rook_auth_url(
    app: tauri::AppHandle,
    request: RookAuthUrlRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_auth_url",
            "The sign-in link request is invalid.",
            &request.operation_id,
        ));
    }
    let parsed = tauri::Url::parse(&request.url).map_err(|_| {
        terminal_error(
            "invalid_auth_url",
            "The sign-in link is invalid.",
            &request.operation_id,
        )
    })?;
    if !auth_url_is_safe(&request.url) {
        return Err(terminal_error(
            "invalid_auth_url",
            "Only HTTP(S) sign-in links without embedded credentials may be opened.",
            &request.operation_id,
        ));
    }
    app.opener()
        .open_url(parsed.as_str(), None::<String>)
        .map_err(|_| {
            terminal_error(
                "opener_failed",
                "The system browser could not open the sign-in link.",
                &request.operation_id,
            )
        })
}

#[cfg(test)]
mod rook_build_hmr_guard_tests {
    use super::*;

    #[test]
    fn writes_active_and_inactive_hmr_guard_markers() {
        let marker = std::env::temp_dir().join(format!(
            "laplace-hmr-guard-test-{}-{}.json",
            std::process::id(),
            now_ms()
        ));
        let workspace = PathBuf::from("/tmp/laplace-self");

        write_rook_build_hmr_guard_at(&marker, &workspace, true, 1_000);
        let active_json: serde_json::Value =
            serde_json::from_slice(&fs::read(&marker).unwrap()).unwrap();
        assert_eq!(active_json["workspacePath"], "/tmp/laplace-self");
        assert_eq!(active_json["active"], true);
        assert_eq!(active_json["updatedAtMs"], 1_000);

        write_rook_build_hmr_guard_at(&marker, &workspace, false, 2_500);
        let inactive_json: serde_json::Value =
            serde_json::from_slice(&fs::read(&marker).unwrap()).unwrap();
        assert_eq!(inactive_json["workspacePath"], "/tmp/laplace-self");
        assert_eq!(inactive_json["active"], false);
        assert_eq!(inactive_json["endedAtMs"], 2_500);

        let _ = fs::remove_file(&marker);
    }
}
