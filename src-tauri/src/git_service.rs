use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) project_id: String,
    pub(crate) untracked_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitFileStatus {
    pub(crate) path: String,
    pub(crate) index_status: char,
    pub(crate) worktree_status: char,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatusResponse {
    pub(crate) branch: Option<String>,
    pub(crate) files: Vec<GitFileStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorktreeRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) project_id: String,
    pub(crate) change_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorktreeResponse {
    pub(crate) change_id: String,
    pub(crate) path: String,
    pub(crate) branch: String,
    pub(crate) base_revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorktreeInspectRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) project_id: String,
    pub(crate) worktree_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorktreeApplyRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) project_id: String,
    pub(crate) worktree_path: String,
    pub(crate) change_id: String,
    #[serde(default)]
    pub(crate) remove_after_apply: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorktreeDiscardRequest {
    pub(crate) schema_version: u16,
    pub(crate) operation_id: String,
    pub(crate) project_id: String,
    pub(crate) worktree_path: String,
    pub(crate) change_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorktreeChangedFile {
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) conflicts_with_main: bool,
    pub(crate) diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorktreeExperimentSnapshot {
    pub(crate) worktree_path: String,
    pub(crate) branch: Option<String>,
    pub(crate) files: Vec<WorktreeChangedFile>,
    pub(crate) conflict_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorktreeApplyResult {
    pub(crate) applied_files: Vec<String>,
    pub(crate) removed_worktree: bool,
}

#[tauri::command]
pub(crate) async fn git_status(request: GitRequest) -> Result<GitStatusResponse, IpcError> {
    run_git(&request, &["status", "--porcelain=v1", "-z", "--branch"])
        .and_then(|output| parse_git_status(&output.stdout, &request.operation_id))
}

#[tauri::command]
pub(crate) async fn git_diff(request: GitRequest) -> Result<String, IpcError> {
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

pub(crate) fn run_git(
    request: &GitRequest,
    args: &[&str],
) -> Result<std::process::Output, IpcError> {
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

pub(crate) fn parse_git_status(
    bytes: &[u8],
    operation_id: &str,
) -> Result<GitStatusResponse, IpcError> {
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

pub(crate) fn validate_worktree_request(request: &WorktreeRequest) -> Result<(), IpcError> {
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
pub(crate) async fn create_candidate_worktree(
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
pub(crate) fn create_candidate_worktree_sync(
    request: &WorktreeRequest,
) -> Result<WorktreeResponse, IpcError> {
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

pub(crate) fn create_candidate_worktree_at(
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

pub(crate) fn resolve_candidate_worktree_path(
    app: &tauri::AppHandle,
    root: &Path,
    worktree_path: &str,
    operation_id: &str,
) -> Result<PathBuf, IpcError> {
    let base_parent = app
        .path()
        .app_data_dir()
        .map_err(|_| {
            terminal_error(
                "worktree_path_unavailable",
                "Laplace could not locate its candidate storage directory.",
                operation_id,
            )
        })?
        .join("worktrees")
        .join(format!(
            "{:x}",
            Sha256::digest(root.to_string_lossy().as_bytes())
        ));
    let canon_parent = fs::canonicalize(&base_parent).map_err(|_| {
        terminal_error(
            "worktree_unavailable",
            "The candidate worktree is no longer available.",
            operation_id,
        )
    })?;
    let canon_wt = fs::canonicalize(worktree_path).map_err(|_| {
        terminal_error(
            "worktree_unavailable",
            "The candidate worktree is no longer available.",
            operation_id,
        )
    })?;
    if !canon_wt.starts_with(&canon_parent) || canon_wt == canon_parent || !canon_wt.is_dir() {
        return Err(terminal_error(
            "invalid_worktree_path",
            "The requested worktree does not belong to this workspace.",
            operation_id,
        ));
    }
    Ok(canon_wt)
}

fn ensure_no_symlinks(
    root: &Path,
    relative_path: &str,
    operation_id: &str,
) -> Result<PathBuf, IpcError> {
    let mut cur = root.to_path_buf();
    for component in Path::new(relative_path).components() {
        let std::path::Component::Normal(part) = component else {
            return Err(terminal_error(
                "invalid_path",
                "Worktree paths must stay inside the workspace.",
                operation_id,
            ));
        };
        cur.push(part);
        if let Ok(meta) = fs::symlink_metadata(&cur) {
            if meta.file_type().is_symlink() {
                return Err(terminal_error(
                    "symlink_blocked",
                    "Symlink paths are not modified during worktree application.",
                    operation_id,
                ));
            }
        }
    }
    Ok(cur)
}

fn git_status_in(dir: &Path, operation_id: &str) -> Result<GitStatusResponse, IpcError> {
    let output = Command::new("git")
        .args(["status", "--porcelain=v1", "-z", "--branch"])
        .current_dir(dir)
        .output()
        .map_err(|_| {
            terminal_error("git_unavailable", "Git could not be started.", operation_id)
        })?;
    if !output.status.success() {
        return Err(terminal_error(
            "git_failed",
            "Git status could not be read for this worktree.",
            operation_id,
        ));
    }
    parse_git_status(&output.stdout, operation_id)
}

fn render_worktree_file_diff(worktree_root: &Path, relative_path: &str, status: &str) -> String {
    if status == "untracked" {
        let target = worktree_root.join(relative_path);
        return match fs::read(&target) {
            Ok(bytes) => {
                if bytes.contains(&0) {
                    return "Binary file added in candidate worktree.".to_owned();
                }
                let text = String::from_utf8_lossy(&bytes);
                let lines: Vec<String> = text.lines().take(250).map(|l| format!("+{l}")).collect();
                let mut header = format!(
                    "--- /dev/null\n+++ b/{relative_path}\n@@ -0,0 +1,{} @@\n{}",
                    lines.len(),
                    lines.join("\n")
                );
                if text.lines().count() > 250 {
                    header.push_str("\n… diff truncated for preview …");
                }
                header
            }
            Err(_) => String::new(),
        };
    }
    let output = Command::new("git")
        .args(["diff", "HEAD", "--", relative_path])
        .current_dir(worktree_root)
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            if text.len() > 24 * 1024 {
                let end = text.floor_char_boundary(24 * 1024);
                format!("{}\n… diff truncated for preview …", &text[..end])
            } else {
                text.into_owned()
            }
        }
        _ => String::new(),
    }
}

pub(crate) fn inspect_worktree_experiment_at(
    root: &Path,
    worktree_root: &Path,
    operation_id: &str,
) -> Result<WorktreeExperimentSnapshot, IpcError> {
    let wt_status = git_status_in(worktree_root, operation_id)?;
    let main_status = git_status_in(root, operation_id)?;
    let dirty_in_main: HashSet<String> = main_status.files.into_iter().map(|f| f.path).collect();

    let mut files = Vec::new();
    let mut conflict_count = 0usize;
    for entry in wt_status.files {
        let status_label = if entry.index_status == '?' && entry.worktree_status == '?' {
            "untracked"
        } else if entry.index_status == 'D' || entry.worktree_status == 'D' {
            "deleted"
        } else if entry.index_status == 'A' {
            "added"
        } else {
            "modified"
        }
        .to_owned();
        let conflicts_with_main = dirty_in_main.contains(&entry.path);
        if conflicts_with_main {
            conflict_count += 1;
        }
        let diff = render_worktree_file_diff(worktree_root, &entry.path, &status_label);
        files.push(WorktreeChangedFile {
            path: entry.path,
            status: status_label,
            conflicts_with_main,
            diff,
        });
    }

    Ok(WorktreeExperimentSnapshot {
        worktree_path: worktree_root.to_string_lossy().into_owned(),
        branch: wt_status.branch,
        files,
        conflict_count,
    })
}

pub(crate) fn discard_worktree_experiment_at(
    root: &Path,
    worktree_root: &Path,
    change_id: &str,
    operation_id: &str,
) -> Result<bool, IpcError> {
    if !validate_operation_id(change_id) {
        return Err(terminal_error(
            "invalid_worktree_request",
            "The candidate worktree identifier is invalid.",
            operation_id,
        ));
    }
    let remove = Command::new("git")
        .args(["worktree", "remove", "--force"])
        .arg(worktree_root)
        .current_dir(root)
        .output()
        .map_err(|_| {
            terminal_error("git_unavailable", "Git could not be started.", operation_id)
        })?;
    if !remove.status.success() {
        return Err(terminal_error(
            "worktree_remove_failed",
            "The candidate worktree could not be removed.",
            operation_id,
        ));
    }
    let branch = format!("laplace/{change_id}");
    let _ = Command::new("git")
        .args(["branch", "-D", &branch])
        .current_dir(root)
        .output();
    Ok(true)
}

pub(crate) fn apply_worktree_experiment_at(
    root: &Path,
    worktree_root: &Path,
    change_id: &str,
    remove_after_apply: bool,
    operation_id: &str,
) -> Result<WorktreeApplyResult, IpcError> {
    if !validate_operation_id(change_id) {
        return Err(terminal_error(
            "invalid_worktree_request",
            "The candidate worktree identifier is invalid.",
            operation_id,
        ));
    }
    let snapshot = inspect_worktree_experiment_at(root, worktree_root, operation_id)?;
    if snapshot.conflict_count > 0 {
        return Err(terminal_error(
            "worktree_apply_conflict",
            "Commit, stash, or revert overlapping dirty files in the main workspace before applying this experiment.",
            operation_id,
        ));
    }
    if snapshot.files.is_empty() {
        return Err(terminal_error(
            "worktree_no_changes",
            "This candidate worktree has no edits to apply.",
            operation_id,
        ));
    }

    let mut applied_files = Vec::with_capacity(snapshot.files.len());
    for file in &snapshot.files {
        review::validate_safe_relative_path(&file.path, operation_id)?;
        let src_path = ensure_no_symlinks(worktree_root, &file.path, operation_id)?;
        let dst_path = ensure_no_symlinks(root, &file.path, operation_id)?;

        if file.status == "deleted" {
            if dst_path.exists() {
                fs::remove_file(&dst_path).map_err(|_| {
                    terminal_error(
                        "worktree_apply_failed",
                        "A deleted candidate file could not be removed from the workspace.",
                        operation_id,
                    )
                })?;
            }
        } else {
            let bytes = fs::read(&src_path).map_err(|_| {
                terminal_error(
                    "worktree_apply_failed",
                    "A candidate file could not be read.",
                    operation_id,
                )
            })?;
            let parent = dst_path.parent().ok_or_else(|| {
                terminal_error(
                    "worktree_apply_failed",
                    "Destination parent folder is invalid.",
                    operation_id,
                )
            })?;
            fs::create_dir_all(parent).map_err(|_| {
                terminal_error(
                    "worktree_apply_failed",
                    "Destination folder could not be created.",
                    operation_id,
                )
            })?;
            let name = dst_path
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("file");
            let temp = parent.join(format!(".{name}.laplace-wt-{}", std::process::id()));
            fs::write(&temp, &bytes).map_err(|_| {
                terminal_error(
                    "worktree_apply_failed",
                    "Failed to write candidate changes atomically.",
                    operation_id,
                )
            })?;
            if let Err(_err) = fs::rename(&temp, &dst_path) {
                let _ = fs::remove_file(&temp);
                return Err(terminal_error(
                    "worktree_apply_failed",
                    "Failed to replace workspace file with candidate version.",
                    operation_id,
                ));
            }
        }
        applied_files.push(file.path.clone());
    }

    let removed_worktree = if remove_after_apply {
        discard_worktree_experiment_at(root, worktree_root, change_id, operation_id)?
    } else {
        false
    };

    Ok(WorktreeApplyResult {
        applied_files,
        removed_worktree,
    })
}

#[tauri::command]
pub(crate) async fn inspect_worktree_experiment(
    app: tauri::AppHandle,
    request: WorktreeInspectRequest,
) -> Result<WorktreeExperimentSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_worktree_request",
            "The candidate worktree inspect request is invalid.",
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
    let wt_root = resolve_candidate_worktree_path(
        &app,
        &root,
        &request.worktree_path,
        &request.operation_id,
    )?;
    let op = request.operation_id.clone();
    tokio::task::spawn_blocking(move || inspect_worktree_experiment_at(&root, &wt_root, &op))
        .await
        .map_err(|_| {
            terminal_error(
                "worktree_inspect_failed",
                "The candidate worktree inspection was interrupted.",
                &request.operation_id,
            )
        })?
}

#[tauri::command]
pub(crate) async fn apply_worktree_experiment(
    app: tauri::AppHandle,
    processes: tauri::State<'_, rook_service::RookProcesses>,
    request: WorktreeApplyRequest,
) -> Result<WorktreeApplyResult, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_worktree_request",
            "The candidate worktree apply request is invalid.",
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
    let wt_root = resolve_candidate_worktree_path(
        &app,
        &root,
        &request.worktree_path,
        &request.operation_id,
    )?;
    let _hmr_guard = rook_service::DevHmrGuard::acquire(&root);
    if let Ok(guard) = processes.0.lock() {
        for process in guard.values() {
            if let Ok(proc_guard) = process.lock() {
                if proc_guard.workspace_path == root && proc_guard.active_run.load(Ordering::SeqCst)
                {
                    return Err(terminal_error(
                        "rook_run_active",
                        "Wait for the active main-workspace Rook run to settle before applying an experiment.",
                        &request.operation_id,
                    ));
                }
            }
        }
    }
    let op = request.operation_id.clone();
    let change_id = request.change_id.clone();
    let remove = request.remove_after_apply;
    tokio::task::spawn_blocking(move || {
        apply_worktree_experiment_at(&root, &wt_root, &change_id, remove, &op)
    })
    .await
    .map_err(|_| {
        terminal_error(
            "worktree_apply_failed",
            "Applying the candidate worktree was interrupted.",
            &request.operation_id,
        )
    })?
}

#[tauri::command]
pub(crate) async fn discard_worktree_experiment(
    app: tauri::AppHandle,
    request: WorktreeDiscardRequest,
) -> Result<bool, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_worktree_request",
            "The candidate worktree discard request is invalid.",
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
    let wt_root = resolve_candidate_worktree_path(
        &app,
        &root,
        &request.worktree_path,
        &request.operation_id,
    )?;
    let op = request.operation_id.clone();
    let change_id = request.change_id.clone();
    tokio::task::spawn_blocking(move || {
        discard_worktree_experiment_at(&root, &wt_root, &change_id, &op)
    })
    .await
    .map_err(|_| {
        terminal_error(
            "worktree_remove_failed",
            "Removing the candidate worktree was interrupted.",
            &request.operation_id,
        )
    })?
}

#[cfg(test)]
mod worktree_experiment_tests {
    use super::*;

    #[test]
    fn worktree_experiment_roundtrip_and_conflict_guard() {
        let root = std::env::temp_dir().join(format!(
            "laplace-wt-exp-test-{}-{}",
            std::process::id(),
            now_ms()
        ));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/lib.rs"), "pub fn value() -> i32 { 1 }\n").unwrap();
        let git = |args: &[&str]| {
            Command::new("git")
                .args(args)
                .current_dir(&root)
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
        assert!(git(&["add", "."]).status.success());
        assert!(git(&["commit", "-m", "Initial"]).status.success());

        let wt_parent = root.parent().unwrap().join(format!(
            "laplace-wt-exp-parent-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let candidate = create_candidate_worktree_at(
            &WorktreeRequest {
                schema_version: IPC_SCHEMA_VERSION,
                operation_id: "op-wt-1".into(),
                project_id: root.to_string_lossy().into_owned(),
                change_id: "exp-1".into(),
            },
            &wt_parent,
        )
        .unwrap();
        let wt_path = PathBuf::from(&candidate.path);
        fs::write(wt_path.join("src/lib.rs"), "pub fn value() -> i32 { 42 }\n").unwrap();
        fs::write(
            wt_path.join("src/new_helper.rs"),
            "pub fn ok() -> bool { true }\n",
        )
        .unwrap();

        let snap = inspect_worktree_experiment_at(&root, &wt_path, "op-wt-2").unwrap();
        assert_eq!(snap.files.len(), 2);
        assert_eq!(snap.conflict_count, 0);

        // Dirtying same file in main triggers conflict guard
        fs::write(root.join("src/lib.rs"), "pub fn value() -> i32 { 99 }\n").unwrap();
        let conflict = inspect_worktree_experiment_at(&root, &wt_path, "op-wt-3").unwrap();
        assert_eq!(conflict.conflict_count, 1);
        assert_eq!(
            apply_worktree_experiment_at(&root, &wt_path, "exp-1", true, "op-wt-4")
                .unwrap_err()
                .code,
            "worktree_apply_conflict"
        );

        // Restore main file, then apply & remove cleanly
        assert!(git(&["checkout", "--", "src/lib.rs"]).status.success());
        let applied =
            apply_worktree_experiment_at(&root, &wt_path, "exp-1", true, "op-wt-5").unwrap();
        assert!(applied.removed_worktree);
        assert_eq!(applied.applied_files.len(), 2);
        assert_eq!(
            fs::read_to_string(root.join("src/lib.rs")).unwrap(),
            "pub fn value() -> i32 { 42 }\n"
        );
        assert!(root.join("src/new_helper.rs").exists());
        assert!(!wt_path.exists());

        let _ = fs::remove_dir_all(&wt_parent);
        let _ = fs::remove_dir_all(&root);
    }
}
