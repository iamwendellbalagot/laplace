use super::*;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
#[cfg(unix)]
use std::os::unix::process::CommandExt;

const MAX_RUN_OUTPUT_BYTES: usize = 256 * 1024;
const RUN_EVENT_NAME: &str = "laplace://run-event";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceLayoutInfo {
    pub(crate) package_manager: Option<String>,
    pub(crate) layout: String,
    pub(crate) workspace_packages: Vec<String>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunConfigSummary {
    pub(crate) name: String,
    pub(crate) source: String,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) port: Option<u16>,
    pub(crate) url: Option<String>,
    pub(crate) shared_services: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunConfigsResponse {
    pub(crate) layout: WorkspaceLayoutInfo,
    pub(crate) configs: Vec<RunConfigSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunInstance {
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) name: String,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) status: String,
    pub(crate) port: Option<u16>,
    pub(crate) detected_url: Option<String>,
    pub(crate) shared_services: Vec<String>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) output: String,
    pub(crate) started_at: i64,
    pub(crate) finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunEventPayload {
    pub(crate) schema_version: u16,
    pub(crate) instance_id: String,
    pub(crate) workspace_id: String,
    pub(crate) kind: String,
    pub(crate) chunk: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) detected_url: Option<String>,
    pub(crate) exit_code: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
struct RunTomlDefinition {
    version: u16,
    program: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    shared_services: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartRunRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    name: String,
    #[serde(default)]
    port_override: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StopRunRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    instance_id: String,
}

struct ManagedRun {
    state: Mutex<RunInstance>,
    child: Mutex<Option<std::process::Child>>,
    pid: AtomicU32,
}

#[derive(Default)]
pub(crate) struct RunProcesses(Mutex<HashMap<String, Arc<ManagedRun>>>);

impl RunProcesses {
    pub(crate) fn stop_all(&self) {
        let handles: Vec<Arc<ManagedRun>> = self
            .0
            .lock()
            .map(|guard| guard.values().cloned().collect())
            .unwrap_or_default();
        for handle in handles {
            terminate_managed_run(&handle);
        }
    }
}

fn terminate_managed_run(handle: &ManagedRun) {
    let pid = handle.pid.load(Ordering::Acquire);
    #[cfg(unix)]
    if pid > 0 {
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    if let Ok(mut guard) = handle.child.lock() {
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }
    handle.pid.store(0, Ordering::Release);
}

fn append_bounded_output(buffer: &mut String, chunk: &str) {
    buffer.push_str(chunk);
    if buffer.len() > MAX_RUN_OUTPUT_BYTES {
        let mut drain_to = buffer.len() - MAX_RUN_OUTPUT_BYTES;
        while drain_to < buffer.len() && !buffer.is_char_boundary(drain_to) {
            drain_to += 1;
        }
        buffer.drain(..drain_to);
    }
}

pub(crate) fn extract_local_url(line: &str) -> Option<String> {
    for prefix in [
        "http://localhost:",
        "https://localhost:",
        "http://127.0.0.1:",
        "https://127.0.0.1:",
    ] {
        if let Some(start) = line.find(prefix) {
            let tail = &line[start..];
            let end = tail
                .find(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | ')' | ']' | ','))
                .unwrap_or(tail.len());
            let candidate = tail[..end].trim_end_matches('.');
            if candidate.len() > prefix.len() {
                return Some(candidate.to_owned());
            }
        }
    }
    None
}

pub(crate) fn check_port_available(port: u16, operation_id: &str) -> Result<(), IpcError> {
    if TcpListener::bind(("127.0.0.1", port)).is_ok() {
        return Ok(());
    }
    let suggested = TcpListener::bind(("127.0.0.1", 0))
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port());
    let detail = match suggested {
        Some(alt) => format!(
            "Port {port} is already in use. Stop the existing server or override with port {alt}."
        ),
        None => format!("Port {port} is already in use. Stop the existing server first."),
    };
    Err(terminal_error("port_in_use", &detail, operation_id))
}

pub(crate) fn detect_workspace_layout_at(root: &Path) -> WorkspaceLayoutInfo {
    let mut warnings = Vec::new();
    let has_pnpm_lock = root.join("pnpm-lock.yaml").exists();
    let has_pnpm_ws = root.join("pnpm-workspace.yaml").exists();
    let has_yarn_lock = root.join("yarn.lock").exists();
    let has_npm_lock = root.join("package-lock.json").exists();
    let has_yarn_pnp = root.join(".pnp.cjs").exists() || root.join(".pnp.mjs").exists();
    let pkg_path = root.join("package.json");

    if !pkg_path.exists() {
        return WorkspaceLayoutInfo {
            package_manager: None,
            layout: "non_js".to_owned(),
            workspace_packages: Vec::new(),
            warnings: vec![
                "No package.json found. Define named runs in .laplace/recipes.toml under [runs.<name>].".to_owned(),
            ],
        };
    }

    let pkg_json: Option<serde_json::Value> = fs::read_to_string(&pkg_path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok());

    let package_manager_field = pkg_json
        .as_ref()
        .and_then(|doc| doc.get("packageManager"))
        .and_then(|value| value.as_str());

    let package_manager = if has_pnpm_lock
        || has_pnpm_ws
        || package_manager_field.is_some_and(|v| v.starts_with("pnpm@"))
    {
        Some("pnpm".to_owned())
    } else if has_yarn_lock || package_manager_field.is_some_and(|v| v.starts_with("yarn@")) {
        Some("yarn".to_owned())
    } else if has_npm_lock
        || package_manager_field.is_some_and(|v| v.starts_with("npm@"))
        || pkg_json.is_some()
    {
        Some("npm".to_owned())
    } else {
        None
    };

    if has_yarn_pnp {
        warnings.push(
            "Yarn Plug'n'Play (.pnp.cjs/.pnp.mjs) is not supported for automatic workspace resolution. Configure explicit [runs.<name>] entries in .laplace/recipes.toml.".to_owned(),
        );
        return WorkspaceLayoutInfo {
            package_manager,
            layout: "unsupported_yarn_pnp".to_owned(),
            workspace_packages: Vec::new(),
            warnings,
        };
    }

    let mut workspace_packages = Vec::new();
    let layout = if has_pnpm_ws {
        if let Ok(raw) = fs::read_to_string(root.join("pnpm-workspace.yaml")) {
            for line in raw.lines() {
                let trimmed = line.trim();
                if let Some(item) = trimmed.strip_prefix("- ") {
                    let cleaned = item.trim().trim_matches('\'').trim_matches('"');
                    if !cleaned.is_empty() {
                        workspace_packages.push(cleaned.to_owned());
                    }
                }
            }
        }
        "pnpm_workspace".to_owned()
    } else if let Some(workspaces) = pkg_json.as_ref().and_then(|doc| doc.get("workspaces")) {
        if let Some(arr) = workspaces.as_array() {
            for item in arr {
                if let Some(pattern) = item.as_str() {
                    workspace_packages.push(pattern.to_owned());
                }
            }
        } else if let Some(arr) = workspaces.get("packages").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(pattern) = item.as_str() {
                    workspace_packages.push(pattern.to_owned());
                }
            }
        }
        if workspace_packages.is_empty() {
            "single_package".to_owned()
        } else {
            "npm_yarn_workspaces".to_owned()
        }
    } else {
        "single_package".to_owned()
    };

    if pkg_json.is_none() {
        warnings.push("package.json could not be parsed as valid JSON.".to_owned());
    }

    WorkspaceLayoutInfo {
        package_manager,
        layout,
        workspace_packages,
        warnings,
    }
}

fn read_toml_run_configs(
    root: &Path,
    operation_id: &str,
) -> Result<Vec<RunConfigSummary>, IpcError> {
    let settings_dir = root.join(".laplace");
    if settings_dir.exists()
        && (!settings_dir.is_dir()
            || fs::symlink_metadata(&settings_dir)
                .map(|meta| meta.file_type().is_symlink())
                .unwrap_or(true))
    {
        return Err(terminal_error(
            "run_config_path_unsafe",
            "The .laplace directory cannot be a symlink or file.",
            operation_id,
        ));
    }
    let path = settings_dir.join("recipes.toml");
    if !path.exists() {
        return Ok(Vec::new());
    }
    if fs::symlink_metadata(&path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(terminal_error(
            "run_config_path_unsafe",
            "The project recipes file cannot be a symlink.",
            operation_id,
        ));
    }
    let raw = fs::read_to_string(&path).map_err(|_| {
        terminal_error(
            "run_config_read_failed",
            "The project recipes file could not be read.",
            operation_id,
        )
    })?;
    let doc: toml::Value = toml::from_str(&raw).map_err(|_| {
        terminal_error(
            "run_config_invalid",
            "The project recipes file is not valid TOML.",
            operation_id,
        )
    })?;
    let Some(runs_value) = doc.get("runs") else {
        return Ok(Vec::new());
    };
    let parsed: HashMap<String, RunTomlDefinition> =
        runs_value.clone().try_into().map_err(|_| {
            terminal_error(
                "run_config_invalid",
                "The [runs] table in .laplace/recipes.toml is invalid.",
                operation_id,
            )
        })?;
    let root_str = root.to_string_lossy();
    let mut configs = Vec::new();
    for (name, def) in parsed {
        if !validate_operation_id(&name)
            || def.version != 1
            || def.program.is_empty()
            || def.program.contains('\0')
            || def.args.iter().any(|arg| arg.contains('\0'))
        {
            return Err(terminal_error(
                "run_config_invalid",
                "A [runs] entry has unsupported or invalid fields.",
                operation_id,
            ));
        }
        if let Some(cwd) = &def.cwd {
            resolve_project_directory(&root_str, cwd)?;
        }
        configs.push(RunConfigSummary {
            name,
            source: "recipes.toml".to_owned(),
            program: def.program,
            args: def.args,
            cwd: def.cwd,
            port: def.port,
            url: def.url,
            shared_services: def.shared_services,
        });
    }
    configs.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(configs)
}

fn discover_package_json_runs(root: &Path, layout: &WorkspaceLayoutInfo) -> Vec<RunConfigSummary> {
    if layout.layout == "unsupported_yarn_pnp" {
        return Vec::new();
    }
    let Some(pm) = layout.package_manager.as_deref() else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(root.join("package.json")) else {
        return Vec::new();
    };
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(scripts) = doc.get("scripts").and_then(|value| value.as_object()) else {
        return Vec::new();
    };
    let preferred = [
        "dev",
        "start",
        "preview",
        "serve",
        "watch",
        "tauri:dev",
        "dev:web-preview",
    ];
    let mut names: Vec<&String> = scripts
        .keys()
        .filter(|name| {
            preferred.contains(&name.as_str())
                || name.starts_with("dev:")
                || name.starts_with("start:")
        })
        .collect();
    names.sort();
    names
        .into_iter()
        .take(12)
        .map(|script_name| {
            let args = if pm == "yarn" {
                vec![script_name.clone()]
            } else {
                vec!["run".to_owned(), script_name.clone()]
            };
            RunConfigSummary {
                name: script_name.clone(),
                source: "package.json".to_owned(),
                program: pm.to_owned(),
                args,
                cwd: None,
                port: None,
                url: None,
                shared_services: Vec::new(),
            }
        })
        .collect()
}

pub(crate) fn list_run_configs_at(
    root: &Path,
    operation_id: &str,
) -> Result<RunConfigsResponse, IpcError> {
    let layout = detect_workspace_layout_at(root);
    let mut configs = read_toml_run_configs(root, operation_id)?;
    let existing: HashSet<String> = configs.iter().map(|c| c.name.clone()).collect();
    for discovered in discover_package_json_runs(root, &layout) {
        if !existing.contains(&discovered.name) {
            configs.push(discovered);
        }
    }
    Ok(RunConfigsResponse { layout, configs })
}

#[tauri::command]
pub(crate) async fn list_run_configs(request: GitRequest) -> Result<RunConfigsResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_run_request",
            "The Run configuration request is invalid.",
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
    list_run_configs_at(&root, &request.operation_id)
}

#[tauri::command]
pub(crate) async fn list_run_instances(
    runs: tauri::State<'_, RunProcesses>,
    request: GitRequest,
) -> Result<Vec<RunInstance>, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_run_request",
            "The Run instances request is invalid.",
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
    let workspace_id = root.to_string_lossy().into_owned();
    let handles: Vec<Arc<ManagedRun>> = runs
        .0
        .lock()
        .map_err(|_| {
            terminal_error(
                "runs_unavailable",
                "Run processes are temporarily unavailable.",
                &request.operation_id,
            )
        })?
        .values()
        .cloned()
        .collect();
    let mut items = Vec::new();
    for handle in handles {
        if let Ok(state) = handle.state.lock() {
            if state.workspace_id == workspace_id {
                items.push(state.clone());
            }
        }
    }
    items.sort_by_key(|left| std::cmp::Reverse(left.started_at));
    Ok(items)
}

async fn ensure_workspace_trusted(
    app: &tauri::AppHandle,
    db: &tauri::State<'_, DomainDatabase>,
    trusted: &tauri::State<'_, TrustedWorkspaces>,
    root: &Path,
    operation_id: &str,
) -> Result<(), IpcError> {
    if trusted.contains(root)? {
        return Ok(());
    }
    let pool = open_domain_database(app, db).await?;
    let row = sqlx::query("SELECT project_id FROM trusted_workspaces WHERE project_id = ?")
        .bind(root.to_string_lossy().as_ref())
        .fetch_optional(&pool)
        .await
        .map_err(|_| {
            terminal_error(
                "trust_read_failed",
                "Project trust could not be checked.",
                operation_id,
            )
        })?;
    if row.is_some() {
        if let Ok(mut guard) = trusted.0.lock() {
            guard.insert(root.to_string_lossy().into_owned());
        }
        return Ok(());
    }
    Err(terminal_error(
        "workspace_not_trusted",
        "Trust this project before starting a Run configuration.",
        operation_id,
    ))
}

#[tauri::command]
pub(crate) async fn start_run_config(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    runs: tauri::State<'_, RunProcesses>,
    request: StartRunRequest,
) -> Result<RunInstance, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || request.name.trim().is_empty()
    {
        return Err(terminal_error(
            "invalid_run_request",
            "The Run request is invalid.",
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
    ensure_workspace_trusted(&app, &db, &trusted, &root, &request.operation_id).await?;
    let configs = list_run_configs_at(&root, &request.operation_id)?;
    let config = configs
        .configs
        .into_iter()
        .find(|item| item.name == request.name)
        .ok_or_else(|| {
            terminal_error(
                "run_config_missing",
                "That Run configuration was not found in this workspace.",
                &request.operation_id,
            )
        })?;

    let effective_port = request.port_override.or(config.port);
    if let Some(port) = effective_port {
        check_port_available(port, &request.operation_id)?;
    }

    let workspace_id = root.to_string_lossy().into_owned();
    let cwd = match &config.cwd {
        Some(relative) => resolve_project_directory(&workspace_id, relative)?,
        None => root.clone(),
    };

    // Stop any previous running instance of the same (workspace, name) to avoid duplicates
    let existing_to_stop: Vec<Arc<ManagedRun>> = {
        let guard = runs.0.lock().map_err(|_| {
            terminal_error(
                "runs_unavailable",
                "Run processes are temporarily unavailable.",
                &request.operation_id,
            )
        })?;
        guard
            .values()
            .filter(|handle| {
                handle
                    .state
                    .lock()
                    .map(|state| {
                        state.workspace_id == workspace_id
                            && state.name == config.name
                            && state.status == "running"
                    })
                    .unwrap_or(false)
            })
            .cloned()
            .collect()
    };
    for handle in existing_to_stop {
        terminate_managed_run(&handle);
        if let Ok(mut state) = handle.state.lock() {
            state.status = "stopped".to_owned();
            state.finished_at = Some(now_ms());
        }
    }

    let mut command = Command::new(&config.program);
    command
        .args(&config.args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(port) = effective_port {
        command.env("PORT", port.to_string());
    }
    #[cfg(unix)]
    {
        command.process_group(0);
    }

    let mut child = command.spawn().map_err(|error| {
        terminal_error(
            "run_start_failed",
            &format!("Could not start '{}': {error}", config.program),
            &request.operation_id,
        )
    })?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let now = now_ms();
    let instance_id = format!(
        "run-{}-{}",
        now,
        EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let initial = RunInstance {
        id: instance_id.clone(),
        workspace_id: workspace_id.clone(),
        name: config.name.clone(),
        program: config.program.clone(),
        args: config.args.clone(),
        cwd: config.cwd.clone(),
        status: "running".to_owned(),
        port: effective_port,
        detected_url: config.url.clone(),
        shared_services: config.shared_services.clone(),
        exit_code: None,
        output: String::new(),
        started_at: now,
        finished_at: None,
    };

    let managed = Arc::new(ManagedRun {
        state: Mutex::new(initial.clone()),
        child: Mutex::new(Some(child)),
        pid: AtomicU32::new(pid),
    });

    runs.0
        .lock()
        .map_err(|_| {
            terminal_error(
                "runs_unavailable",
                "Run processes are temporarily unavailable.",
                &request.operation_id,
            )
        })?
        .insert(instance_id.clone(), Arc::clone(&managed));

    // Stream stdout & stderr in lightweight background threads
    for reader in [
        stdout.map(|s| Box::new(s) as Box<dyn Read + Send>),
        stderr.map(|s| Box::new(s) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let app_handle = app.clone();
        let managed_ref = Arc::clone(&managed);
        let id_copy = instance_id.clone();
        let ws_copy = workspace_id.clone();
        std::thread::spawn(move || {
            let mut buffered = BufReader::new(reader);
            let mut line = String::new();
            while let Ok(read_bytes) = buffered.read_line(&mut line) {
                if read_bytes == 0 {
                    break;
                }
                let detected_url = extract_local_url(&line);
                if let Ok(mut state) = managed_ref.state.lock() {
                    append_bounded_output(&mut state.output, &line);
                    if state.detected_url.is_none() && detected_url.is_some() {
                        state.detected_url = detected_url.clone();
                    }
                }
                let _ = app_handle.emit(
                    RUN_EVENT_NAME,
                    RunEventPayload {
                        schema_version: IPC_SCHEMA_VERSION,
                        instance_id: id_copy.clone(),
                        workspace_id: ws_copy.clone(),
                        kind: "output".to_owned(),
                        chunk: Some(line.clone()),
                        status: None,
                        detected_url,
                        exit_code: None,
                    },
                );
                line.clear();
            }
        });
    }

    // Monitor exit cleanly
    {
        let app_handle = app.clone();
        let managed_ref = Arc::clone(&managed);
        let id_copy = instance_id.clone();
        let ws_copy = workspace_id.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(120));
            let exit_outcome = {
                let Ok(mut guard) = managed_ref.child.lock() else {
                    break;
                };
                match guard.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(Some(status)) => {
                            *guard = None;
                            Some(status.code())
                        }
                        Ok(None) => None,
                        Err(_) => {
                            *guard = None;
                            Some(None)
                        }
                    },
                    None => break,
                }
            };
            if let Some(code) = exit_outcome {
                managed_ref.pid.store(0, Ordering::Release);
                let final_status = {
                    let mut state = match managed_ref.state.lock() {
                        Ok(guard) => guard,
                        Err(_) => break,
                    };
                    if state.status == "stopped" {
                        "stopped".to_owned()
                    } else if code == Some(0) {
                        state.status = "stopped".to_owned();
                        "stopped".to_owned()
                    } else {
                        state.status = "failed".to_owned();
                        "failed".to_owned()
                    }
                };
                if let Ok(mut state) = managed_ref.state.lock() {
                    state.exit_code = code;
                    state.finished_at = Some(now_ms());
                }
                let _ = app_handle.emit(
                    RUN_EVENT_NAME,
                    RunEventPayload {
                        schema_version: IPC_SCHEMA_VERSION,
                        instance_id: id_copy,
                        workspace_id: ws_copy,
                        kind: "exited".to_owned(),
                        chunk: None,
                        status: Some(final_status),
                        detected_url: None,
                        exit_code: code,
                    },
                );
                break;
            }
        });
    }

    Ok(initial)
}

#[tauri::command]
pub(crate) async fn stop_run_config(
    app: tauri::AppHandle,
    runs: tauri::State<'_, RunProcesses>,
    request: StopRunRequest,
) -> Result<RunInstance, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.instance_id)
    {
        return Err(terminal_error(
            "invalid_run_request",
            "The stop Run request is invalid.",
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
    let expected_workspace = root.to_string_lossy().into_owned();
    let handle = runs
        .0
        .lock()
        .map_err(|_| {
            terminal_error(
                "runs_unavailable",
                "Run processes are temporarily unavailable.",
                &request.operation_id,
            )
        })?
        .get(&request.instance_id)
        .cloned()
        .ok_or_else(|| {
            terminal_error(
                "run_instance_missing",
                "That Run instance is no longer tracked.",
                &request.operation_id,
            )
        })?;
    if let Ok(state) = handle.state.lock() {
        if state.workspace_id != expected_workspace {
            return Err(terminal_error(
                "run_workspace_mismatch",
                "That Run instance belongs to a different workspace.",
                &request.operation_id,
            ));
        }
    }
    if let Ok(mut state) = handle.state.lock() {
        state.status = "stopped".to_owned();
        state.finished_at = Some(now_ms());
    }
    terminate_managed_run(&handle);
    let snapshot = handle
        .state
        .lock()
        .map_err(|_| {
            terminal_error(
                "runs_unavailable",
                "Run state could not be read.",
                &request.operation_id,
            )
        })?
        .clone();
    let _ = app.emit(
        RUN_EVENT_NAME,
        RunEventPayload {
            schema_version: IPC_SCHEMA_VERSION,
            instance_id: snapshot.id.clone(),
            workspace_id: snapshot.workspace_id.clone(),
            kind: "exited".to_owned(),
            chunk: None,
            status: Some("stopped".to_owned()),
            detected_url: None,
            exit_code: snapshot.exit_code,
        },
    );
    Ok(snapshot)
}

#[cfg(test)]
mod runs_tests {
    use super::*;

    #[test]
    fn detect_workspace_layout_handles_npm_pnpm_yarn_workspaces_and_pnp() {
        let base = std::env::temp_dir().join(format!("laplace-layouts-{}", now_ms()));

        // 1. npm single package
        let npm_dir = base.join("npm-single");
        fs::create_dir_all(&npm_dir).unwrap();
        fs::write(
            npm_dir.join("package.json"),
            r#"{"name":"app","scripts":{"dev":"vite","test":"vitest"}}"#,
        )
        .unwrap();
        fs::write(npm_dir.join("package-lock.json"), "{}").unwrap();
        let npm_layout = detect_workspace_layout_at(&npm_dir);
        assert_eq!(npm_layout.package_manager.as_deref(), Some("npm"));
        assert_eq!(npm_layout.layout, "single_package");

        // 2. pnpm workspace
        let pnpm_dir = base.join("pnpm-ws");
        fs::create_dir_all(&pnpm_dir).unwrap();
        fs::write(
            pnpm_dir.join("package.json"),
            r#"{"name":"root","scripts":{"dev":"turbo dev"}}"#,
        )
        .unwrap();
        fs::write(
            pnpm_dir.join("pnpm-workspace.yaml"),
            "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
        )
        .unwrap();
        let pnpm_layout = detect_workspace_layout_at(&pnpm_dir);
        assert_eq!(pnpm_layout.package_manager.as_deref(), Some("pnpm"));
        assert_eq!(pnpm_layout.layout, "pnpm_workspace");
        assert_eq!(pnpm_layout.workspace_packages, vec!["packages/*", "apps/*"]);

        // 3. yarn workspace
        let yarn_dir = base.join("yarn-ws");
        fs::create_dir_all(&yarn_dir).unwrap();
        fs::write(
            yarn_dir.join("package.json"),
            r#"{"name":"root","workspaces":["packages/*"],"scripts":{"start":"node index.js"}}"#,
        )
        .unwrap();
        fs::write(yarn_dir.join("yarn.lock"), "").unwrap();
        let yarn_layout = detect_workspace_layout_at(&yarn_dir);
        assert_eq!(yarn_layout.package_manager.as_deref(), Some("yarn"));
        assert_eq!(yarn_layout.layout, "npm_yarn_workspaces");

        // 4. Yarn PnP unsupported disclosure
        let pnp_dir = base.join("yarn-pnp");
        fs::create_dir_all(&pnp_dir).unwrap();
        fs::write(
            pnp_dir.join("package.json"),
            r#"{"name":"pnp","scripts":{"dev":"vite"}}"#,
        )
        .unwrap();
        fs::write(pnp_dir.join(".pnp.cjs"), "module.exports = {};").unwrap();
        let pnp_layout = detect_workspace_layout_at(&pnp_dir);
        assert_eq!(pnp_layout.layout, "unsupported_yarn_pnp");
        assert!(!pnp_layout.warnings.is_empty());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn list_run_configs_merges_toml_runs_and_package_scripts() {
        let root = std::env::temp_dir().join(format!("laplace-runs-cfg-{}", now_ms()));
        fs::create_dir_all(root.join(".laplace")).unwrap();
        fs::write(
            root.join("package.json"),
            r#"{"name":"demo","scripts":{"dev":"vite","preview":"vite preview","lint":"eslint ."}}"#,
        )
        .unwrap();
        fs::write(root.join("pnpm-lock.yaml"), "lockfileVersion: '9.0'\n").unwrap();
        fs::write(
            root.join(".laplace/recipes.toml"),
            "[runs.dev]\nversion = 1\nprogram = \"pnpm\"\nargs = [\"dev\", \"--port\", \"5174\"]\nport = 5174\nshared_services = [\"Local Postgres :5432\"]\n",
        )
        .unwrap();
        let canonical = fs::canonicalize(&root).unwrap();
        let response = list_run_configs_at(&canonical, "op-runs").unwrap();
        assert_eq!(response.configs.len(), 2);
        assert_eq!(response.configs[0].name, "dev");
        assert_eq!(response.configs[0].source, "recipes.toml");
        assert_eq!(response.configs[0].port, Some(5174));
        assert_eq!(
            response.configs[0].shared_services,
            vec!["Local Postgres :5432"]
        );
        assert_eq!(response.configs[1].name, "preview");
        assert_eq!(response.configs[1].source, "package.json");
        assert_eq!(response.configs[1].program, "pnpm");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn check_port_available_reports_collision_with_suggestion() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let occupied_port = listener.local_addr().unwrap().port();
        let err = check_port_available(occupied_port, "op-port").unwrap_err();
        assert_eq!(err.code, "port_in_use");
        assert!(err.message.contains(&occupied_port.to_string()));
        drop(listener);
    }

    #[test]
    fn extract_local_url_matches_localhost_and_ignores_remote() {
        assert_eq!(
            extract_local_url("  ➜  Local:   http://localhost:5173/  "),
            Some("http://localhost:5173/".to_owned())
        );
        assert_eq!(
            extract_local_url("Listening on http://127.0.0.1:3000"),
            Some("http://127.0.0.1:3000".to_owned())
        );
        assert_eq!(extract_local_url("Docs at https://example.com/guide"), None);
    }
}
