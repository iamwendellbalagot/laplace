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
