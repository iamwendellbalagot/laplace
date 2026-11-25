use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspacePulse {
    pub(crate) project_id: String,
    pub(crate) is_git_repository: bool,
    pub(crate) branch: Option<String>,
    pub(crate) head_sha: Option<String>,
    pub(crate) ahead: u32,
    pub(crate) behind: u32,
    pub(crate) dirty_count: u32,
    pub(crate) untracked_count: u32,
    pub(crate) latest_execution_status: Option<String>,
    pub(crate) latest_execution_command: Option<String>,
    pub(crate) latest_execution_digest: Option<String>,
    pub(crate) latest_execution_at: Option<i64>,
    pub(crate) active_build_running: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct GitPulseDetails {
    pub(crate) branch: Option<String>,
    pub(crate) head_sha: Option<String>,
    pub(crate) ahead: u32,
    pub(crate) behind: u32,
    pub(crate) dirty_count: u32,
    pub(crate) untracked_count: u32,
}

pub(crate) fn parse_git_branch_header(header: &str) -> (Option<String>, u32, u32) {
    let raw = header.strip_prefix("## ").unwrap_or(header).trim();
    if raw.starts_with("No commits yet on ") {
        let branch = raw.strip_prefix("No commits yet on ").map(str::to_owned);
        return (branch, 0, 0);
    }
    if raw.starts_with("HEAD (no branch)") {
        return (Some("DETACHED".to_owned()), 0, 0);
    }
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let main_part = if let Some(bracket_idx) = raw.rfind(" [") {
        let suffix = raw[bracket_idx + 2..].trim_end_matches(']');
        for token in suffix.split(',') {
            let trimmed = token.trim();
            if let Some(num) = trimmed.strip_prefix("ahead ") {
                ahead = num.parse::<u32>().unwrap_or(0);
            } else if let Some(num) = trimmed.strip_prefix("behind ") {
                behind = num.parse::<u32>().unwrap_or(0);
            }
        }
        &raw[..bracket_idx]
    } else {
        raw
    };
    let branch = main_part
        .split("...")
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    (branch, ahead, behind)
}

pub(crate) fn inspect_git_pulse(
    root: &Path,
    operation_id: &str,
) -> Result<GitPulseDetails, IpcError> {
    let output = Command::new("git")
        .arg("-c")
        .arg("core.fsmonitor=false")
        .args(["status", "--porcelain=v1", "-z", "--branch"])
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_PAGER", "cat")
        .output()
        .map_err(|_| {
            terminal_error("git_unavailable", "Git could not be started.", operation_id)
        })?;
    if !output.status.success() {
        return Err(terminal_error(
            "git_failed",
            "Git status could not be read.",
            operation_id,
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut fields = text.split('\0');
    let header = fields.next().unwrap_or_default();
    let (mut branch, ahead, behind) = parse_git_branch_header(header);
    let mut dirty_count = 0u32;
    let mut untracked_count = 0u32;
    while let Some(entry) = fields.next() {
        if entry.is_empty() {
            continue;
        }
        let bytes = entry.as_bytes();
        if bytes.len() >= 3 && bytes[2] == b' ' {
            if bytes[0] == b'?' && bytes[1] == b'?' {
                untracked_count += 1;
            } else {
                dirty_count += 1;
            }
            if matches!(bytes[0], b'R' | b'C') || matches!(bytes[1], b'R' | b'C') {
                let _ = fields.next();
            }
        }
    }
    let head_out = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
        .filter(|s| !s.is_empty());
    if branch.as_deref() == Some("DETACHED") {
        if let Some(sha) = &head_out {
            branch = Some(format!("detached@{sha}"));
        }
    }
    Ok(GitPulseDetails {
        branch,
        head_sha: head_out,
        ahead,
        behind,
        dirty_count,
        untracked_count,
    })
}

pub(crate) async fn compute_workspace_pulse(
    pool: &SqlitePool,
    root: &Path,
    active_build_running: bool,
    operation_id: &str,
) -> Result<WorkspacePulse, IpcError> {
    let project_id = root.to_string_lossy().into_owned();
    let is_git = root.join(".git").exists();
    let git_details = if is_git {
        let root_clone = root.to_path_buf();
        let op = operation_id.to_owned();
        tokio::task::spawn_blocking(move || inspect_git_pulse(&root_clone, &op))
            .await
            .map_err(|_| {
                terminal_error(
                    "pulse_failed",
                    "Workspace pulse could not be computed.",
                    operation_id,
                )
            })??
    } else {
        GitPulseDetails::default()
    };

    let row = sqlx::query(
        "SELECT id, project_id, change_id, command_json, source_digest, status, exit_code, output, started_at, finished_at, environment_json FROM executions WHERE project_id = ? ORDER BY started_at DESC LIMIT 1",
    )
    .bind(&project_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "pulse_read_failed",
            "Latest verification status could not be loaded.",
            operation_id,
        )
    })?;

    let (
        latest_execution_status,
        latest_execution_command,
        latest_execution_digest,
        latest_execution_at,
    ) = if let Some(row) = row {
        let mut record = parse_execution_row(&row, operation_id)?;
        if is_git
            && matches!(
                record.status,
                ExecutionStatus::Passed | ExecutionStatus::Failed
            )
        {
            let root_clone = root.to_path_buf();
            let manifest_changed = tokio::task::spawn_blocking(move || {
                source_manifest(&root_clone).map(|(digest, _)| digest).ok()
            })
            .await
            .ok()
            .flatten()
            .map(|digest| digest != record.source_digest)
            .unwrap_or(false);
            if manifest_changed {
                record.status = ExecutionStatus::Stale;
                let _ = sqlx::query("UPDATE executions SET status = 'stale' WHERE id = ?")
                    .bind(&record.id)
                    .execute(pool)
                    .await;
            }
        }
        let status_text = serde_json::to_string(&record.status)
            .unwrap_or_default()
            .trim_matches('"')
            .to_owned();
        let command_text = if record.args.is_empty() {
            record.program
        } else {
            format!("{} {}", record.program, record.args.join(" "))
        };
        (
            Some(status_text),
            Some(command_text),
            Some(record.source_digest),
            Some(record.started_at),
        )
    } else {
        (None, None, None, None)
    };

    Ok(WorkspacePulse {
        project_id,
        is_git_repository: is_git,
        branch: git_details.branch,
        head_sha: git_details.head_sha,
        ahead: git_details.ahead,
        behind: git_details.behind,
        dirty_count: git_details.dirty_count,
        untracked_count: git_details.untracked_count,
        latest_execution_status,
        latest_execution_command,
        latest_execution_digest,
        latest_execution_at,
        active_build_running,
    })
}

#[tauri::command]
pub(crate) async fn get_workspace_pulse(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    processes: tauri::State<'_, RookProcesses>,
    request: GitRequest,
) -> Result<WorkspacePulse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_pulse_request",
            "The workspace pulse request is invalid.",
            &request.operation_id,
        ));
    }
    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The project folder is no longer available.",
            &request.operation_id,
        )
    })?;
    let pool = open_domain_database(&app, &db).await?;
    let active_build_running = processes.has_active_build(&root);
    compute_workspace_pulse(&pool, &root, active_build_running, &request.operation_id).await
}

#[cfg(test)]
mod git_pulse_tests {
    use super::*;

    #[test]
    fn parses_branch_ahead_behind_and_unborn_headers() {
        assert_eq!(
            parse_git_branch_header("## main...origin/main [ahead 2, behind 1]"),
            (Some("main".to_owned()), 2, 1)
        );
        assert_eq!(
            parse_git_branch_header("## feat/redesign...origin/feat/redesign [ahead 3]"),
            (Some("feat/redesign".to_owned()), 3, 0)
        );
        assert_eq!(
            parse_git_branch_header("## No commits yet on main"),
            (Some("main".to_owned()), 0, 0)
        );
        assert_eq!(
            parse_git_branch_header("## HEAD (no branch)"),
            (Some("DETACHED".to_owned()), 0, 0)
        );
    }

    #[tokio::test]
    async fn computes_pulse_for_real_git_repo_and_marks_stale_check() {
        let root = std::env::temp_dir().join(format!(
            "laplace-pulse-test-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let canonical = fs::canonicalize(&root).unwrap();

        let git = |args: &[&str]| {
            let status = Command::new("git")
                .args(args)
                .current_dir(&canonical)
                .status()
                .unwrap();
            assert!(status.success(), "git {:?} failed", args);
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.name", "Laplace Test"]);
        git(&["config", "user.email", "test@laplace.local"]);
        fs::write(canonical.join("a.ts"), "export const a = 1;\n").unwrap();
        git(&["add", "a.ts"]);
        git(&["commit", "-m", "init"]);
        fs::write(canonical.join("a.ts"), "export const a = 2;\n").unwrap();
        fs::write(canonical.join("new.ts"), "export const b = 3;\n").unwrap();

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        MIGRATOR.run(&pool).await.unwrap();

        let record = ExecutionRecord {
            id: "exec-pulse-1".to_owned(),
            project_id: canonical.to_string_lossy().into_owned(),
            change_id: None,
            program: "pnpm".to_owned(),
            args: vec!["test".to_owned()],
            source_digest: "outdated-digest".to_owned(),
            files: vec!["a.ts".to_owned()],
            file_digests: vec![("a.ts".to_owned(), "old".to_owned())],
            status: ExecutionStatus::Passed,
            exit_code: Some(0),
            output: "ok".to_owned(),
            started_at: 1000,
            finished_at: Some(1100),
            environment: None,
        };
        persist_execution(&pool, &record).await.unwrap();

        let pulse = compute_workspace_pulse(&pool, &canonical, true, "pulse-1")
            .await
            .unwrap();
        assert!(pulse.is_git_repository);
        assert_eq!(pulse.branch.as_deref(), Some("main"));
        assert!(pulse.head_sha.is_some());
        assert_eq!(pulse.dirty_count, 1);
        assert_eq!(pulse.untracked_count, 1);
        assert_eq!(pulse.latest_execution_status.as_deref(), Some("stale"));
        assert_eq!(pulse.latest_execution_command.as_deref(), Some("pnpm test"));
        assert!(pulse.active_build_running);

        let _ = fs::remove_dir_all(&root);
    }
}
