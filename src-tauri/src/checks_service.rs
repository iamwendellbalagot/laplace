use super::*;

pub(crate) const MAX_CHECK_FILES: usize = 5_000;
pub(crate) const MAX_CHECK_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
pub(crate) const MAX_CHECK_OUTPUT_BYTES: usize = 1024 * 1024;
pub(crate) static VERIFY_CANCELLED: AtomicBool = AtomicBool::new(false);
pub(crate) static VERIFY_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunCheckRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) project_id: String,
    pub(crate) change_id: Option<String>,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExecutionStatus {
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
pub(crate) struct ExecutionRecord {
    pub(crate) id: String,
    pub(crate) project_id: String,
    pub(crate) change_id: Option<String>,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) source_digest: String,
    pub(crate) files: Vec<String>,
    pub(crate) file_digests: Vec<(String, String)>,
    pub(crate) status: ExecutionStatus,
    pub(crate) exit_code: Option<i64>,
    pub(crate) output: String,
    pub(crate) started_at: i64,
    pub(crate) finished_at: Option<i64>,
    #[serde(default)]
    pub(crate) environment: Option<compare::ExecutionEnvironment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CancellationRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecipeDefinition {
    pub(crate) version: u16,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectRecipeSummary {
    pub(crate) name: String,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecipeRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) project_id: String,
    pub(crate) recipe_name: String,
    #[serde(default)]
    pub(crate) change_id: Option<String>,
}

pub(crate) fn validate_check_request(request: &RunCheckRequest) -> Result<(), IpcError> {
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

pub(crate) fn source_manifest(root: &Path) -> Result<(String, Vec<(String, String)>), IpcError> {
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

pub(crate) fn is_sensitive_manifest_path(path: &str) -> bool {
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

pub(crate) fn execute_check(
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
        .map(|bytes| redact::redact_secrets(&String::from_utf8_lossy(&bytes)))
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
    let environment = Some(compare::ExecutionEnvironment::capture(
        root,
        &request.program,
    ));
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
        environment,
    })
}

pub(crate) async fn persist_execution(
    pool: &SqlitePool,
    record: &ExecutionRecord,
) -> Result<(), IpcError> {
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
    let environment_json = record
        .environment
        .as_ref()
        .and_then(|env| serde_json::to_string(env).ok());
    sqlx::query("INSERT INTO executions (id, project_id, change_id, command_json, source_digest, status, exit_code, output, started_at, finished_at, environment_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(&record.id).bind(&record.project_id).bind(&record.change_id).bind(command).bind(&record.source_digest).bind(serde_json::to_string(&record.status).unwrap_or_default().trim_matches('"')).bind(record.exit_code).bind(&record.output).bind(record.started_at).bind(record.finished_at).bind(environment_json).execute(&mut *tx).await.map_err(|_| terminal_error("check_record_failed", "The verification result could not be recorded.", "check"))?;
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
    let _ = sqlx::query(
        "DELETE FROM executions WHERE project_id = ? AND id NOT IN (SELECT id FROM executions WHERE project_id = ? ORDER BY started_at DESC LIMIT 200)",
    )
    .bind(&record.project_id)
    .bind(&record.project_id)
    .execute(&mut *tx)
    .await;
    tx.commit().await.map_err(|_| {
        terminal_error(
            "check_record_failed",
            "The verification result could not be saved.",
            "check",
        )
    })?;
    Ok(())
}

pub(crate) fn parse_execution_row(
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
    let environment = row
        .try_get::<Option<String>, _>("environment_json")
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<compare::ExecutionEnvironment>(&raw).ok());
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
        environment,
    })
}

#[tauri::command]
pub(crate) async fn run_check(
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
pub(crate) async fn list_executions(
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
    let rows = sqlx::query("SELECT id, project_id, change_id, command_json, source_digest, status, exit_code, output, started_at, finished_at, environment_json FROM executions WHERE project_id = ? ORDER BY started_at DESC LIMIT 200").bind(&request.project_id).fetch_all(&pool).await.map_err(|_| terminal_error("check_list_failed", "Verification records could not be loaded.", &request.operation_id))?;
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
pub(crate) async fn cancel_check(request: CancellationRequest) -> Result<(), IpcError> {
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

pub(crate) fn read_project_recipes(
    root: &Path,
    operation_id: &str,
) -> Result<Option<HashMap<String, RecipeDefinition>>, IpcError> {
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
            operation_id,
        ));
    }
    let recipe_path = settings_dir.join("recipes.toml");
    if !recipe_path.exists() {
        return Ok(None);
    }
    if fs::symlink_metadata(&recipe_path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(terminal_error(
            "recipe_path_unsafe",
            "The project recipe file cannot be a symlink.",
            operation_id,
        ));
    }
    let bytes = fs::read(&recipe_path).map_err(|_| {
        terminal_error(
            "recipe_missing",
            "No approved project recipes file was found.",
            operation_id,
        )
    })?;
    let recipe_doc: toml::Value = toml::from_str(std::str::from_utf8(&bytes).map_err(|_| {
        terminal_error(
            "recipe_invalid",
            "The project recipes file must be UTF-8.",
            operation_id,
        )
    })?)
    .map_err(|_| {
        terminal_error(
            "recipe_invalid",
            "The project recipes file is invalid.",
            operation_id,
        )
    })?;
    let recipes: HashMap<String, RecipeDefinition> = recipe_doc
        .get("recipes")
        .cloned()
        .ok_or_else(|| {
            terminal_error(
                "recipe_invalid",
                "The project recipes file must have a recipes table.",
                operation_id,
            )
        })
        .and_then(|value| {
            value.try_into().map_err(|_| {
                terminal_error(
                    "recipe_invalid",
                    "The project recipes file is invalid.",
                    operation_id,
                )
            })
        })?;
    let root_str = root.to_string_lossy();
    for (name, recipe) in &recipes {
        if !validate_operation_id(name)
            || recipe.version != 1
            || recipe.program.is_empty()
            || recipe.program.contains('\0')
            || recipe.args.iter().any(|arg| arg.contains('\0'))
        {
            return Err(terminal_error(
                "recipe_invalid",
                "The project recipe has unsupported or invalid fields.",
                operation_id,
            ));
        }
        if let Some(relative) = &recipe.cwd {
            resolve_project_directory(&root_str, relative)?;
        }
    }
    Ok(Some(recipes))
}

pub(crate) fn list_project_recipes_at(
    root: &Path,
    operation_id: &str,
) -> Result<Vec<ProjectRecipeSummary>, IpcError> {
    let Some(recipes) = read_project_recipes(root, operation_id)? else {
        return Ok(Vec::new());
    };
    let mut items: Vec<ProjectRecipeSummary> = recipes
        .into_iter()
        .map(|(name, recipe)| ProjectRecipeSummary {
            name,
            program: recipe.program,
            args: recipe.args,
            cwd: recipe.cwd,
        })
        .collect();
    items.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(items)
}

#[tauri::command]
pub(crate) async fn list_project_recipes(
    request: GitRequest,
) -> Result<Vec<ProjectRecipeSummary>, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
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
    list_project_recipes_at(&root, &request.operation_id)
}

#[tauri::command]
pub(crate) async fn run_project_recipe(
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
                "Confirm project trust before running project recipes.",
                &request.operation_id,
            ));
        }
    }
    let recipes = read_project_recipes(&root, &request.operation_id)?.ok_or_else(|| {
        terminal_error(
            "recipe_missing",
            "No approved project recipes file was found.",
            &request.operation_id,
        )
    })?;
    let recipe = recipes.get(&request.recipe_name).ok_or_else(|| {
        terminal_error(
            "recipe_missing",
            "This named project recipe is not defined.",
            &request.operation_id,
        )
    })?;
    let cwd = if let Some(relative) = &recipe.cwd {
        resolve_project_directory(&root.to_string_lossy(), relative)?
    } else {
        root.clone()
    };
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
    let check = RunCheckRequest {
        schema_version: request.schema_version,
        operation_id: request.operation_id.clone(),
        project_id: root.to_string_lossy().into_owned(),
        change_id: request.change_id.clone(),
        program: recipe.program.clone(),
        args: recipe.args.clone(),
        timeout_ms: Some(10 * 60 * 1000),
    };
    let execution =
        tokio::task::spawn_blocking(move || execute_check(&cwd, check, &VERIFY_CANCELLED)).await;
    let result = match execution {
        Ok(Ok(record)) => record,
        Ok(Err(error)) => {
            VERIFY_RUNNING.store(false, Ordering::Release);
            return Err(error);
        }
        Err(_) => {
            VERIFY_RUNNING.store(false, Ordering::Release);
            return Err(terminal_error(
                "recipe_interrupted",
                "The project recipe was interrupted.",
                &request.operation_id,
            ));
        }
    };
    VERIFY_RUNNING.store(false, Ordering::Release);
    persist_execution(&pool, &result).await?;
    Ok(result)
}
