use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewComment {
    pub(crate) id: String,
    pub(crate) change_id: String,
    pub(crate) file_path: String,
    pub(crate) line_number: Option<i64>,
    pub(crate) body: String,
    pub(crate) resolved: bool,
    pub(crate) created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewDecision {
    pub(crate) id: String,
    pub(crate) change_id: String,
    pub(crate) source_digest: String,
    pub(crate) head_revision: String,
    pub(crate) decision: String,
    pub(crate) override_reason: Option<String>,
    pub(crate) created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationAttempt {
    pub(crate) id: String,
    pub(crate) change_id: String,
    pub(crate) project_id: String,
    pub(crate) base_head: String,
    pub(crate) approved_source_digest: String,
    pub(crate) commit_message: String,
    pub(crate) selected_paths: Vec<String>,
    pub(crate) status: String,
    pub(crate) commit_sha: Option<String>,
    pub(crate) error_detail: Option<String>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffPair {
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) kind: ProjectFileReadKind,
    pub(crate) original: Option<String>,
    pub(crate) modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangeReviewSnapshot {
    pub(crate) change: ChangeRecord,
    pub(crate) branch: Option<String>,
    pub(crate) head_revision: String,
    pub(crate) source_digest: String,
    pub(crate) changed_files: Vec<GitFileStatus>,
    pub(crate) git_operation_in_progress: bool,
    pub(crate) has_fresh_passing_check: bool,
    pub(crate) approval_valid: bool,
    pub(crate) approval_stale_reason: Option<String>,
    pub(crate) comments: Vec<ReviewComment>,
    pub(crate) latest_decision: Option<ReviewDecision>,
    pub(crate) latest_attempt: Option<IntegrationAttempt>,
    pub(crate) last_reviewed_digest: Option<String>,
    pub(crate) last_reviewed_at: Option<i64>,
    pub(crate) changed_since_last_review: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangeReviewRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    change_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiffPairRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    relative_path: String,
    #[serde(default)]
    change_id: Option<String>,
    #[serde(default)]
    baseline: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddCommentRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    change_id: String,
    file_path: String,
    #[serde(default)]
    line_number: Option<i64>,
    body: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToggleCommentRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    comment_id: String,
    resolved: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApproveReviewRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    change_id: String,
    expected_source_digest: String,
    #[serde(default)]
    override_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevisionRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    change_id: String,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrepareIntegrationRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    change_id: String,
    selected_paths: Vec<String>,
    commit_message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteIntegrationRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    change_id: String,
    attempt_id: String,
}

pub(crate) fn canonical_git_root(
    project_id: &str,
    operation_id: &str,
) -> Result<PathBuf, IpcError> {
    let root = fs::canonicalize(project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The Git workspace is no longer available.",
            operation_id,
        )
    })?;
    if !root.join(".git").exists() {
        return Err(terminal_error(
            "not_git_repository",
            "Review and integration require a Git repository.",
            operation_id,
        ));
    }
    Ok(root)
}

fn git_read_raw(
    root: &Path,
    args: &[&str],
    operation_id: &str,
) -> Result<std::process::Output, IpcError> {
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
        .output()
        .map_err(|_| {
            terminal_error(
                "git_unavailable",
                "Git could not be started. Install Git and try again.",
                operation_id,
            )
        })
}

fn git_write_raw(
    root: &Path,
    args: &[String],
    operation_id: &str,
) -> Result<std::process::Output, IpcError> {
    Command::new("git")
        .arg("-c")
        .arg("core.fsmonitor=false")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|_| {
            terminal_error(
                "git_unavailable",
                "Git could not be started. Install Git and try again.",
                operation_id,
            )
        })
}

fn read_git_head(root: &Path, operation_id: &str) -> Result<String, IpcError> {
    let output = git_read_raw(root, &["rev-parse", "--verify", "HEAD"], operation_id)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    } else {
        Ok("UNBORN".to_owned())
    }
}

fn git_operation_in_progress(root: &Path) -> bool {
    let git_dir = root.join(".git");
    if !git_dir.is_dir() {
        return false;
    }
    [
        "MERGE_HEAD",
        "rebase-merge",
        "rebase-apply",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
    ]
    .iter()
    .any(|marker| git_dir.join(marker).exists())
}

fn read_git_status_at(root: &Path, operation_id: &str) -> Result<GitStatusResponse, IpcError> {
    let output = git_read_raw(
        root,
        &["status", "--porcelain=v1", "-z", "--branch"],
        operation_id,
    )?;
    if !output.status.success() {
        return Err(terminal_error(
            "git_failed",
            "Git could not inspect workspace status.",
            operation_id,
        ));
    }
    parse_git_status(&output.stdout, operation_id)
}

pub(crate) fn validate_safe_relative_path(
    relative_path: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    let path = Path::new(relative_path);
    if relative_path.is_empty()
        || relative_path.contains('\0')
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(terminal_error(
            "invalid_relative_path",
            "Select a valid file inside the open repository.",
            operation_id,
        ));
    }
    Ok(())
}

pub(crate) fn read_git_file_diff_pair_at(
    root: &Path,
    relative_path: &str,
    operation_id: &str,
) -> Result<GitDiffPair, IpcError> {
    validate_safe_relative_path(relative_path, operation_id)?;
    let spec = format!("HEAD:{relative_path}");
    let head_output = git_read_raw(root, &["show", &spec], operation_id)?;
    let in_head = head_output.status.success();
    let original = if in_head {
        if head_output.stdout.len() as u64 > MAX_PROJECT_FILE_BYTES {
            return Ok(GitDiffPair {
                path: relative_path.to_owned(),
                status: "modified".to_owned(),
                kind: ProjectFileReadKind::TooLarge,
                original: None,
                modified: None,
            });
        }
        if head_output.stdout.contains(&0) {
            return Ok(GitDiffPair {
                path: relative_path.to_owned(),
                status: "modified".to_owned(),
                kind: ProjectFileReadKind::Binary,
                original: None,
                modified: None,
            });
        }
        match String::from_utf8(head_output.stdout) {
            Ok(text) => Some(text),
            Err(_) => {
                return Ok(GitDiffPair {
                    path: relative_path.to_owned(),
                    status: "modified".to_owned(),
                    kind: ProjectFileReadKind::Binary,
                    original: None,
                    modified: None,
                })
            }
        }
    } else {
        None
    };

    let full_path = root.join(relative_path);
    if !full_path.exists() {
        return Ok(GitDiffPair {
            path: relative_path.to_owned(),
            status: if in_head { "deleted" } else { "missing" }.to_owned(),
            kind: ProjectFileReadKind::Text,
            original: Some(original.unwrap_or_default()),
            modified: Some(String::new()),
        });
    }

    let disk = read_project_file_contents(&root.to_string_lossy(), relative_path)?;
    if disk.kind != ProjectFileReadKind::Text {
        return Ok(GitDiffPair {
            path: relative_path.to_owned(),
            status: if in_head { "modified" } else { "added" }.to_owned(),
            kind: disk.kind,
            original: None,
            modified: None,
        });
    }

    Ok(GitDiffPair {
        path: relative_path.to_owned(),
        status: if in_head { "modified" } else { "added" }.to_owned(),
        kind: ProjectFileReadKind::Text,
        original: Some(original.unwrap_or_default()),
        modified: Some(disk.content.unwrap_or_default()),
    })
}

fn parse_comment_row(
    row: &sqlx::sqlite::SqliteRow,
    operation_id: &str,
) -> Result<ReviewComment, IpcError> {
    let err = |_| {
        terminal_error(
            "review_record_invalid",
            "A stored review comment is invalid.",
            operation_id,
        )
    };
    Ok(ReviewComment {
        id: row.try_get("id").map_err(err)?,
        change_id: row.try_get("change_id").map_err(err)?,
        file_path: row.try_get("file_path").map_err(err)?,
        line_number: row.try_get("line_number").ok(),
        body: row.try_get("body").map_err(err)?,
        resolved: row.try_get::<i64, _>("resolved").unwrap_or(0) != 0,
        created_at: row.try_get("created_at").map_err(err)?,
    })
}

fn parse_decision_row(
    row: &sqlx::sqlite::SqliteRow,
    operation_id: &str,
) -> Result<ReviewDecision, IpcError> {
    let err = |_| {
        terminal_error(
            "review_record_invalid",
            "A stored review decision is invalid.",
            operation_id,
        )
    };
    Ok(ReviewDecision {
        id: row.try_get("id").map_err(err)?,
        change_id: row.try_get("change_id").map_err(err)?,
        source_digest: row.try_get("source_digest").map_err(err)?,
        head_revision: row.try_get("head_revision").map_err(err)?,
        decision: row.try_get("decision").map_err(err)?,
        override_reason: row.try_get("override_reason").ok(),
        created_at: row.try_get("created_at").map_err(err)?,
    })
}

fn parse_attempt_row(
    row: &sqlx::sqlite::SqliteRow,
    operation_id: &str,
) -> Result<IntegrationAttempt, IpcError> {
    let err = |_| {
        terminal_error(
            "review_record_invalid",
            "A stored integration attempt is invalid.",
            operation_id,
        )
    };
    let paths_json: String = row.try_get("selected_paths_json").map_err(err)?;
    let selected_paths: Vec<String> = serde_json::from_str(&paths_json).map_err(|_| {
        terminal_error(
            "review_record_invalid",
            "Stored integration file selection is invalid.",
            operation_id,
        )
    })?;
    Ok(IntegrationAttempt {
        id: row.try_get("id").map_err(err)?,
        change_id: row.try_get("change_id").map_err(err)?,
        project_id: row.try_get("project_id").map_err(err)?,
        base_head: row.try_get("base_head").map_err(err)?,
        approved_source_digest: row.try_get("approved_source_digest").map_err(err)?,
        commit_message: row.try_get("commit_message").map_err(err)?,
        selected_paths,
        status: row.try_get("status").map_err(err)?,
        commit_sha: row.try_get("commit_sha").ok(),
        error_detail: row.try_get("error_detail").ok(),
        created_at: row.try_get("created_at").map_err(err)?,
        updated_at: row.try_get("updated_at").map_err(err)?,
    })
}

async fn load_change(
    pool: &SqlitePool,
    project_id: &str,
    change_id: &str,
    operation_id: &str,
) -> Result<ChangeRecord, IpcError> {
    let row = sqlx::query(
        "SELECT id, project_id, objective, status, created_at, updated_at FROM changes WHERE id = ? AND project_id = ?",
    )
    .bind(change_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| terminal_error("change_read_failed", "The Change could not be loaded.", operation_id))?
    .ok_or_else(|| {
        terminal_error(
            "change_missing",
            "This Change no longer exists in the workspace.",
            operation_id,
        )
    })?;
    parse_change_row(&row, operation_id)
}

async fn has_fresh_passing_check(
    pool: &SqlitePool,
    project_id: &str,
    change_id: &str,
    source_digest: &str,
    operation_id: &str,
) -> Result<bool, IpcError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM executions WHERE project_id = ? AND (change_id = ? OR change_id IS NULL) AND status = 'passed' AND source_digest = ?",
    )
    .bind(project_id)
    .bind(change_id)
    .bind(source_digest)
    .fetch_one(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "check_read_failed",
            "Verification records could not be checked.",
            operation_id,
        )
    })?;
    Ok(count > 0)
}

async fn reconcile_committing_attempt(
    pool: &SqlitePool,
    root: &Path,
    attempt: &mut IntegrationAttempt,
    live_head: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    if attempt.status != "committing" {
        return Ok(());
    }
    let now = now_ms();
    let head_message = if live_head != attempt.base_head && live_head != "UNBORN" {
        git_read_raw(root, &["log", "-1", "--format=%B"], operation_id)
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
    } else {
        None
    };
    if head_message.as_deref() == Some(attempt.commit_message.trim()) {
        let mut tx = pool.begin().await.map_err(|_| {
            terminal_error(
                "integration_recovery_failed",
                "Interrupted integration could not be reconciled.",
                operation_id,
            )
        })?;
        sqlx::query(
            "UPDATE integration_attempts SET status = 'succeeded', commit_sha = ?, error_detail = NULL, updated_at = ? WHERE id = ?",
        )
        .bind(live_head)
        .bind(now)
        .bind(&attempt.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| {
            terminal_error(
                "integration_recovery_failed",
                "Interrupted integration could not be reconciled.",
                operation_id,
            )
        })?;
        sqlx::query("UPDATE changes SET status = 'integrated', updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(&attempt.change_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| {
                terminal_error(
                    "integration_recovery_failed",
                    "Change status could not be reconciled.",
                    operation_id,
                )
            })?;
        tx.commit().await.map_err(|_| {
            terminal_error(
                "integration_recovery_failed",
                "Interrupted integration could not be saved.",
                operation_id,
            )
        })?;
        attempt.status = "succeeded".to_owned();
        attempt.commit_sha = Some(live_head.to_owned());
        attempt.error_detail = None;
        attempt.updated_at = now;
    } else {
        let detail = "Integration was interrupted before Git created a commit. Your working tree files were preserved.".to_owned();
        sqlx::query(
            "UPDATE integration_attempts SET status = 'aborted', error_detail = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&detail)
        .bind(now)
        .bind(&attempt.id)
        .execute(pool)
        .await
        .map_err(|_| {
            terminal_error(
                "integration_recovery_failed",
                "Interrupted integration could not be reconciled.",
                operation_id,
            )
        })?;
        attempt.status = "aborted".to_owned();
        attempt.error_detail = Some(detail);
        attempt.updated_at = now;
    }
    Ok(())
}

pub(crate) async fn get_change_review_with_pool(
    pool: &SqlitePool,
    root: &Path,
    change_id: &str,
    operation_id: &str,
) -> Result<ChangeReviewSnapshot, IpcError> {
    let project_id = root.to_string_lossy().into_owned();
    let status = read_git_status_at(root, operation_id)?;
    let head_revision = read_git_head(root, operation_id)?;
    let (source_digest, _) = source_manifest(root)?;
    let op_in_progress = git_operation_in_progress(root);

    let attempt_row = sqlx::query(
        "SELECT id, change_id, project_id, base_head, approved_source_digest, commit_message, selected_paths_json, status, commit_sha, error_detail, created_at, updated_at FROM integration_attempts WHERE change_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(change_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "review_read_failed",
            "Integration records could not be loaded.",
            operation_id,
        )
    })?;
    let mut latest_attempt = attempt_row
        .as_ref()
        .map(|row| parse_attempt_row(row, operation_id))
        .transpose()?;
    if let Some(attempt) = latest_attempt.as_mut() {
        reconcile_committing_attempt(pool, root, attempt, &head_revision, operation_id).await?;
    }

    let change = load_change(pool, &project_id, change_id, operation_id).await?;
    let comment_rows = sqlx::query(
        "SELECT id, change_id, file_path, line_number, body, resolved, created_at FROM review_comments WHERE change_id = ? ORDER BY created_at ASC",
    )
    .bind(change_id)
    .fetch_all(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "review_read_failed",
            "Review comments could not be loaded.",
            operation_id,
        )
    })?;
    let comments = comment_rows
        .iter()
        .map(|row| parse_comment_row(row, operation_id))
        .collect::<Result<Vec<_>, _>>()?;

    let decision_row = sqlx::query(
        "SELECT id, change_id, source_digest, head_revision, decision, override_reason, created_at FROM review_decisions WHERE change_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(change_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "review_read_failed",
            "Review decisions could not be loaded.",
            operation_id,
        )
    })?;
    let latest_decision = decision_row
        .as_ref()
        .map(|row| parse_decision_row(row, operation_id))
        .transpose()?;

    let fresh_pass =
        has_fresh_passing_check(pool, &project_id, change_id, &source_digest, operation_id).await?;

    let (approval_valid, approval_stale_reason) = match latest_decision.as_ref() {
        Some(decision) if decision.decision == "approved" => {
            if decision.source_digest != source_digest {
                (
                    false,
                    Some(
                        "Source files changed after approval. Review the updated diff and approve again."
                            .to_owned(),
                    ),
                )
            } else if decision.head_revision != head_revision {
                (
                    false,
                    Some(
                        "The Git HEAD commit moved after approval. Re-review and approve again."
                            .to_owned(),
                    ),
                )
            } else {
                (true, None)
            }
        }
        _ => (false, None),
    };

    let (last_reviewed_digest, last_reviewed_at, changed_since_last_review) =
        load_last_review_delta(pool, root, change_id, &status.files, operation_id).await?;

    Ok(ChangeReviewSnapshot {
        change,
        branch: status.branch,
        head_revision,
        source_digest,
        changed_files: status.files,
        git_operation_in_progress: op_in_progress,
        has_fresh_passing_check: fresh_pass,
        approval_valid,
        approval_stale_reason,
        comments,
        latest_decision,
        latest_attempt,
        last_reviewed_digest,
        last_reviewed_at,
        changed_since_last_review,
    })
}

pub(crate) async fn capture_review_snapshot_with_pool(
    pool: &SqlitePool,
    root: &Path,
    change_id: &str,
    source_digest: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    let status = read_git_status_at(root, operation_id)?;
    let now = now_ms();
    let snapshot_id = format!(
        "snap-{}-{}",
        now,
        EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let project_id = root.to_string_lossy().into_owned();
    let mut tx = pool.begin().await.map_err(|_| {
        terminal_error(
            "review_snapshot_failed",
            "Review checkpoint could not be started.",
            operation_id,
        )
    })?;
    sqlx::query(
        "INSERT INTO review_snapshots (id, change_id, source_digest, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(&snapshot_id)
    .bind(change_id)
    .bind(source_digest)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        terminal_error(
            "review_snapshot_failed",
            "Review checkpoint could not be saved.",
            operation_id,
        )
    })?;

    for file in status.files.iter().take(250) {
        if validate_safe_relative_path(&file.path, operation_id).is_err() {
            continue;
        }
        let content = match read_project_file_contents(&project_id, &file.path) {
            Ok(read) if read.kind == ProjectFileReadKind::Text => read.content,
            _ => None,
        };
        sqlx::query(
            "INSERT INTO review_snapshot_files (snapshot_id, file_path, content) VALUES (?, ?, ?)",
        )
        .bind(&snapshot_id)
        .bind(&file.path)
        .bind(content)
        .execute(&mut *tx)
        .await
        .map_err(|_| {
            terminal_error(
                "review_snapshot_failed",
                "Review checkpoint file could not be saved.",
                operation_id,
            )
        })?;
    }

    // Keep latest 5 review snapshots per Change
    sqlx::query(
        "DELETE FROM review_snapshots WHERE change_id = ? AND id NOT IN (SELECT id FROM review_snapshots WHERE change_id = ? ORDER BY created_at DESC LIMIT 5)",
    )
    .bind(change_id)
    .bind(change_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        terminal_error(
            "review_snapshot_failed",
            "Older review checkpoints could not be pruned.",
            operation_id,
        )
    })?;

    tx.commit().await.map_err(|_| {
        terminal_error(
            "review_snapshot_failed",
            "Review checkpoint could not be committed.",
            operation_id,
        )
    })?;
    Ok(())
}

async fn load_last_review_delta(
    pool: &SqlitePool,
    root: &Path,
    change_id: &str,
    changed_files: &[GitFileStatus],
    operation_id: &str,
) -> Result<(Option<String>, Option<i64>, Vec<String>), IpcError> {
    let snap_row = sqlx::query(
        "SELECT id, source_digest, created_at FROM review_snapshots WHERE change_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(change_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "review_read_failed",
            "Review checkpoint could not be loaded.",
            operation_id,
        )
    })?;
    let Some(row) = snap_row else {
        return Ok((None, None, Vec::new()));
    };
    let snap_id: String = row.try_get("id").unwrap_or_default();
    let snap_digest: String = row.try_get("source_digest").unwrap_or_default();
    let snap_at: i64 = row.try_get("created_at").unwrap_or(0);
    let file_rows =
        sqlx::query("SELECT file_path, content FROM review_snapshot_files WHERE snapshot_id = ?")
            .bind(&snap_id)
            .fetch_all(pool)
            .await
            .map_err(|_| {
                terminal_error(
                    "review_read_failed",
                    "Review checkpoint files could not be loaded.",
                    operation_id,
                )
            })?;
    let mut previous_map: HashMap<String, Option<String>> = HashMap::new();
    for frow in file_rows {
        let path: String = frow.try_get("file_path").unwrap_or_default();
        let content: Option<String> = frow.try_get("content").ok().flatten();
        previous_map.insert(path, content);
    }
    let project_id = root.to_string_lossy().into_owned();
    let mut delta = Vec::new();
    for file in changed_files {
        let live_content = match read_project_file_contents(&project_id, &file.path) {
            Ok(read) if read.kind == ProjectFileReadKind::Text => read.content,
            _ => None,
        };
        match previous_map.get(&file.path) {
            Some(prev) if prev == &live_content => {}
            _ => delta.push(file.path.clone()),
        }
    }
    Ok((Some(snap_digest), Some(snap_at), delta))
}

pub(crate) async fn read_git_file_diff_pair_since_review_with_pool(
    pool: &SqlitePool,
    root: &Path,
    change_id: &str,
    relative_path: &str,
    operation_id: &str,
) -> Result<GitDiffPair, IpcError> {
    let mut pair = read_git_file_diff_pair_at(root, relative_path, operation_id)?;
    let snap_row = sqlx::query(
        "SELECT id FROM review_snapshots WHERE change_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(change_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "review_read_failed",
            "Review checkpoint could not be loaded.",
            operation_id,
        )
    })?;
    if let Some(row) = snap_row {
        let snap_id: String = row.try_get("id").unwrap_or_default();
        let file_row = sqlx::query(
            "SELECT content FROM review_snapshot_files WHERE snapshot_id = ? AND file_path = ?",
        )
        .bind(&snap_id)
        .bind(relative_path)
        .fetch_optional(pool)
        .await
        .map_err(|_| {
            terminal_error(
                "review_read_failed",
                "Review checkpoint file could not be loaded.",
                operation_id,
            )
        })?;
        if let Some(frow) = file_row {
            let prev: Option<String> = frow.try_get("content").ok().flatten();
            pair.original = prev;
        }
    }
    Ok(pair)
}

pub(crate) async fn approve_change_review_with_pool(
    pool: &SqlitePool,
    processes: &RookProcesses,
    root: &Path,
    change_id: &str,
    expected_source_digest: &str,
    override_reason: Option<&str>,
    operation_id: &str,
) -> Result<ChangeReviewSnapshot, IpcError> {
    if processes.has_active_build(root) {
        return Err(terminal_error(
            "build_run_active",
            "Stop Rook Build before approving this Change.",
            operation_id,
        ));
    }
    let project_id = root.to_string_lossy().into_owned();
    let change = load_change(pool, &project_id, change_id, operation_id).await?;
    if matches!(
        change.status,
        ChangeStatus::Integrated | ChangeStatus::Abandoned
    ) {
        return Err(terminal_error(
            "change_not_reviewable",
            "Integrated or abandoned Changes cannot be approved.",
            operation_id,
        ));
    }
    let (live_digest, _) = source_manifest(root)?;
    if live_digest != expected_source_digest {
        return Err(terminal_error(
            "source_changed_during_review",
            "Workspace files changed since this review loaded. Refresh the diff and approve the updated snapshot.",
            operation_id,
        ));
    }
    let head_revision = read_git_head(root, operation_id)?;
    let fresh_pass =
        has_fresh_passing_check(pool, &project_id, change_id, &live_digest, operation_id).await?;
    let trimmed_override = override_reason
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if !fresh_pass && trimmed_override.map(str::len).unwrap_or(0) < 3 {
        return Err(terminal_error(
            "verification_override_required",
            "No fresh passing verification check exists for this source state. Run Verify or enter an explicit override reason.",
            operation_id,
        ));
    }
    if let Some(reason) = trimmed_override {
        if reason.len() > 500 {
            return Err(terminal_error(
                "override_reason_too_long",
                "Override reason must be at most 500 characters.",
                operation_id,
            ));
        }
    }
    let now = now_ms();
    let decision_id = format!(
        "dec-{}-{}",
        now,
        EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let mut tx = pool.begin().await.map_err(|_| {
        terminal_error(
            "review_write_failed",
            "Approval could not be recorded.",
            operation_id,
        )
    })?;
    sqlx::query(
        "INSERT INTO review_decisions (id, change_id, source_digest, head_revision, decision, override_reason, created_at) VALUES (?, ?, ?, ?, 'approved', ?, ?)",
    )
    .bind(&decision_id)
    .bind(change_id)
    .bind(&live_digest)
    .bind(&head_revision)
    .bind(trimmed_override)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        terminal_error(
            "review_write_failed",
            "Approval could not be recorded.",
            operation_id,
        )
    })?;
    sqlx::query("UPDATE changes SET status = 'approved', updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(change_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| {
            terminal_error(
                "review_write_failed",
                "Change status could not be updated.",
                operation_id,
            )
        })?;
    let detail = match trimmed_override {
        Some(reason) => format!(
            "approved {} (override: {})",
            &live_digest[..live_digest.len().min(12)],
            reason
        ),
        None => format!("approved {}", &live_digest[..live_digest.len().min(12)]),
    };
    sqlx::query(
        "INSERT INTO change_activity (change_id, kind, detail, created_at) VALUES (?, 'approved', ?, ?)",
    )
    .bind(change_id)
    .bind(detail)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        terminal_error(
            "review_write_failed",
            "Approval activity could not be recorded.",
            operation_id,
        )
    })?;
    tx.commit().await.map_err(|_| {
        terminal_error(
            "review_write_failed",
            "Approval could not be saved.",
            operation_id,
        )
    })?;
    let _ =
        capture_review_snapshot_with_pool(pool, root, change_id, &live_digest, operation_id).await;
    get_change_review_with_pool(pool, root, change_id, operation_id).await
}

pub(crate) async fn prepare_change_integration_with_pool(
    pool: &SqlitePool,
    processes: &RookProcesses,
    root: &Path,
    change_id: &str,
    selected_paths: &[String],
    commit_message: &str,
    operation_id: &str,
) -> Result<IntegrationAttempt, IpcError> {
    if processes.has_active_build(root) {
        return Err(terminal_error(
            "build_run_active",
            "Stop Rook Build before preparing integration.",
            operation_id,
        ));
    }
    if git_operation_in_progress(root) {
        return Err(terminal_error(
            "git_operation_in_progress",
            "Finish or abort the active Git merge or rebase before integrating.",
            operation_id,
        ));
    }
    let message = commit_message.trim();
    if message.is_empty() || message.len() > 1000 {
        return Err(terminal_error(
            "invalid_commit_message",
            "Enter a commit message between 1 and 1,000 characters.",
            operation_id,
        ));
    }
    let snapshot = get_change_review_with_pool(pool, root, change_id, operation_id).await?;
    if snapshot.head_revision == "UNBORN" {
        return Err(terminal_error(
            "unborn_head",
            "Create an initial Git commit before integrating Changes.",
            operation_id,
        ));
    }
    if !snapshot.approval_valid {
        return Err(terminal_error(
            "approval_required",
            snapshot
                .approval_stale_reason
                .as_deref()
                .unwrap_or("Approve the current source snapshot before preparing integration."),
            operation_id,
        ));
    }
    if selected_paths.is_empty() {
        return Err(terminal_error(
            "no_files_selected",
            "Select at least one changed file to commit.",
            operation_id,
        ));
    }
    let changed_set: HashSet<&str> = snapshot
        .changed_files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    let mut normalized_paths = Vec::new();
    for path in selected_paths {
        validate_safe_relative_path(path, operation_id)?;
        if !changed_set.contains(path.as_str()) {
            return Err(terminal_error(
                "selected_path_not_changed",
                &format!("'{path}' has no pending changes to commit."),
                operation_id,
            ));
        }
        if !normalized_paths.contains(path) {
            normalized_paths.push(path.clone());
        }
    }
    normalized_paths.sort();

    let now = now_ms();
    let attempt_id = format!(
        "int-{}-{}",
        now,
        EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let paths_json = serde_json::to_string(&normalized_paths).map_err(|_| {
        terminal_error(
            "integration_write_failed",
            "Integration file list could not be encoded.",
            operation_id,
        )
    })?;
    let project_id = root.to_string_lossy().into_owned();
    sqlx::query(
        "INSERT INTO integration_attempts (id, change_id, project_id, base_head, approved_source_digest, commit_message, selected_paths_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)",
    )
    .bind(&attempt_id)
    .bind(change_id)
    .bind(&project_id)
    .bind(&snapshot.head_revision)
    .bind(&snapshot.source_digest)
    .bind(message)
    .bind(&paths_json)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "integration_write_failed",
            "Prepared integration could not be saved.",
            operation_id,
        )
    })?;

    Ok(IntegrationAttempt {
        id: attempt_id,
        change_id: change_id.to_owned(),
        project_id,
        base_head: snapshot.head_revision,
        approved_source_digest: snapshot.source_digest,
        commit_message: message.to_owned(),
        selected_paths: normalized_paths,
        status: "prepared".to_owned(),
        commit_sha: None,
        error_detail: None,
        created_at: now,
        updated_at: now,
    })
}

pub(crate) async fn execute_change_integration_with_pool(
    pool: &SqlitePool,
    processes: &RookProcesses,
    root: &Path,
    change_id: &str,
    attempt_id: &str,
    operation_id: &str,
) -> Result<IntegrationAttempt, IpcError> {
    if processes.has_active_build(root) {
        return Err(terminal_error(
            "build_run_active",
            "Stop Rook Build before committing changes.",
            operation_id,
        ));
    }
    if git_operation_in_progress(root) {
        return Err(terminal_error(
            "git_operation_in_progress",
            "Finish or abort the active Git merge or rebase before integrating.",
            operation_id,
        ));
    }
    let project_id = root.to_string_lossy().into_owned();
    let row = sqlx::query(
        "SELECT id, change_id, project_id, base_head, approved_source_digest, commit_message, selected_paths_json, status, commit_sha, error_detail, created_at, updated_at FROM integration_attempts WHERE id = ? AND change_id = ? AND project_id = ?",
    )
    .bind(attempt_id)
    .bind(change_id)
    .bind(&project_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "integration_read_failed",
            "The prepared integration record could not be loaded.",
            operation_id,
        )
    })?
    .ok_or_else(|| {
        terminal_error(
            "integration_missing",
            "The prepared integration record was not found.",
            operation_id,
        )
    })?;
    let mut attempt = parse_attempt_row(&row, operation_id)?;
    if attempt.status != "prepared" {
        return Err(terminal_error(
            "integration_not_prepared",
            "Prepare a fresh integration attempt before committing.",
            operation_id,
        ));
    }
    let live_head = read_git_head(root, operation_id)?;
    if live_head != attempt.base_head {
        return Err(terminal_error(
            "destination_branch_advanced",
            "The destination branch advanced after this integration was prepared. Refresh review, re-approve, and prepare again.",
            operation_id,
        ));
    }
    let (live_digest, _) = source_manifest(root)?;
    if live_digest != attempt.approved_source_digest {
        return Err(terminal_error(
            "source_changed_after_approval",
            "Workspace files changed after approval. Re-review and approve the updated source before committing.",
            operation_id,
        ));
    }

    let committing_at = now_ms();
    sqlx::query(
        "UPDATE integration_attempts SET status = 'committing', updated_at = ? WHERE id = ?",
    )
    .bind(committing_at)
    .bind(&attempt.id)
    .execute(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "integration_write_failed",
            "Integration progress could not be recorded.",
            operation_id,
        )
    })?;

    let mut add_args = vec!["add".to_owned(), "-A".to_owned(), "--".to_owned()];
    add_args.extend(attempt.selected_paths.iter().cloned());
    let add_out = git_write_raw(root, &add_args, operation_id)?;
    if !add_out.status.success() {
        let stderr = String::from_utf8_lossy(&add_out.stderr).trim().to_owned();
        let detail = if stderr.is_empty() {
            "Git could not stage the selected files.".to_owned()
        } else {
            stderr.chars().take(2000).collect()
        };
        let failed_at = now_ms();
        let _ = sqlx::query(
            "UPDATE integration_attempts SET status = 'failed', error_detail = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&detail)
        .bind(failed_at)
        .bind(&attempt.id)
        .execute(pool)
        .await;
        return Err(terminal_error(
            "integration_git_failed",
            &detail,
            operation_id,
        ));
    }

    let mut commit_args = vec![
        "commit".to_owned(),
        "-m".to_owned(),
        attempt.commit_message.clone(),
        "--only".to_owned(),
        "--".to_owned(),
    ];
    commit_args.extend(attempt.selected_paths.iter().cloned());
    let commit_out = git_write_raw(root, &commit_args, operation_id)?;
    if !commit_out.status.success() {
        let stderr = String::from_utf8_lossy(&commit_out.stderr)
            .trim()
            .to_owned();
        let stdout = String::from_utf8_lossy(&commit_out.stdout)
            .trim()
            .to_owned();
        let combined = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "Git commit failed. Your files were not modified or discarded.".to_owned()
        };
        let detail: String = combined.chars().take(2000).collect();
        let failed_at = now_ms();
        let _ = sqlx::query(
            "UPDATE integration_attempts SET status = 'failed', error_detail = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&detail)
        .bind(failed_at)
        .bind(&attempt.id)
        .execute(pool)
        .await;
        return Err(terminal_error(
            "integration_git_failed",
            &detail,
            operation_id,
        ));
    }

    let commit_sha = read_git_head(root, operation_id)?;
    let finished_at = now_ms();
    let mut tx = pool.begin().await.map_err(|_| {
        terminal_error(
            "integration_write_failed",
            "Git created the commit, but Laplace could not record the completion.",
            operation_id,
        )
    })?;
    sqlx::query(
        "UPDATE integration_attempts SET status = 'succeeded', commit_sha = ?, error_detail = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(&commit_sha)
    .bind(finished_at)
    .bind(&attempt.id)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        terminal_error(
            "integration_write_failed",
            "Integration completion could not be saved.",
            operation_id,
        )
    })?;
    sqlx::query("UPDATE changes SET status = 'integrated', updated_at = ? WHERE id = ?")
        .bind(finished_at)
        .bind(change_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| {
            terminal_error(
                "integration_write_failed",
                "Change status could not be updated to integrated.",
                operation_id,
            )
        })?;
    sqlx::query(
        "INSERT INTO change_activity (change_id, kind, detail, created_at) VALUES (?, 'integrated', ?, ?)",
    )
    .bind(change_id)
    .bind(format!("integrated {commit_sha}"))
    .bind(finished_at)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        terminal_error(
            "integration_write_failed",
            "Integration activity could not be saved.",
            operation_id,
        )
    })?;
    tx.commit().await.map_err(|_| {
        terminal_error(
            "integration_write_failed",
            "Integration result could not be saved.",
            operation_id,
        )
    })?;

    attempt.status = "succeeded".to_owned();
    attempt.commit_sha = Some(commit_sha);
    attempt.error_detail = None;
    attempt.updated_at = finished_at;
    Ok(attempt)
}

#[tauri::command]
pub(crate) async fn get_change_review(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: ChangeReviewRequest,
) -> Result<ChangeReviewSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.change_id)
    {
        return Err(terminal_error(
            "invalid_review_request",
            "The review request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    get_change_review_with_pool(&pool, &root, &request.change_id, &request.operation_id).await
}

#[tauri::command]
pub(crate) async fn read_git_file_diff_pair(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: DiffPairRequest,
) -> Result<GitDiffPair, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_diff_request",
            "The diff request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    if request.baseline.as_deref() == Some("last_review") {
        let pool = open_domain_database(&app, &db).await?;
        let target_id = match request.change_id.as_deref() {
            Some(change_id) if validate_operation_id(change_id) => change_id.to_owned(),
            _ => ensure_workspace_review_id(&pool, &root, &request.operation_id).await?,
        };
        return read_git_file_diff_pair_since_review_with_pool(
            &pool,
            &root,
            &target_id,
            &request.relative_path,
            &request.operation_id,
        )
        .await;
    }
    read_git_file_diff_pair_at(&root, &request.relative_path, &request.operation_id)
}

#[tauri::command]
pub(crate) async fn save_review_checkpoint(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: ChangeReviewRequest,
) -> Result<ChangeReviewSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.change_id)
    {
        return Err(terminal_error(
            "invalid_review_request",
            "The review checkpoint request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    let project_id = root.to_string_lossy().into_owned();
    let _ = load_change(
        &pool,
        &project_id,
        &request.change_id,
        &request.operation_id,
    )
    .await?;
    let (live_digest, _) = source_manifest(&root)?;
    capture_review_snapshot_with_pool(
        &pool,
        &root,
        &request.change_id,
        &live_digest,
        &request.operation_id,
    )
    .await?;
    get_change_review_with_pool(&pool, &root, &request.change_id, &request.operation_id).await
}

#[tauri::command]
pub(crate) async fn add_review_comment(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: AddCommentRequest,
) -> Result<ReviewComment, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.change_id)
    {
        return Err(terminal_error(
            "invalid_comment_request",
            "The review comment request is invalid.",
            &request.operation_id,
        ));
    }
    validate_safe_relative_path(&request.file_path, &request.operation_id)?;
    let body = request.body.trim();
    if body.is_empty() || body.len() > 2000 {
        return Err(terminal_error(
            "invalid_comment_body",
            "Review comments must be between 1 and 2,000 characters.",
            &request.operation_id,
        ));
    }
    if let Some(line) = request.line_number {
        if !(1..=1_000_000).contains(&line) {
            return Err(terminal_error(
                "invalid_comment_line",
                "Line number must be a positive integer.",
                &request.operation_id,
            ));
        }
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    let _ = load_change(
        &pool,
        &root.to_string_lossy(),
        &request.change_id,
        &request.operation_id,
    )
    .await?;
    let now = now_ms();
    let id = format!(
        "cmt-{}-{}",
        now,
        EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    sqlx::query(
        "INSERT INTO review_comments (id, change_id, file_path, line_number, body, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
    )
    .bind(&id)
    .bind(&request.change_id)
    .bind(&request.file_path)
    .bind(request.line_number)
    .bind(body)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|_| {
        terminal_error(
            "comment_write_failed",
            "The review comment could not be saved.",
            &request.operation_id,
        )
    })?;
    Ok(ReviewComment {
        id,
        change_id: request.change_id,
        file_path: request.file_path,
        line_number: request.line_number,
        body: body.to_owned(),
        resolved: false,
        created_at: now,
    })
}

#[tauri::command]
pub(crate) async fn toggle_review_comment_resolved(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: ToggleCommentRequest,
) -> Result<ReviewComment, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.comment_id)
    {
        return Err(terminal_error(
            "invalid_comment_request",
            "The comment update request is invalid.",
            &request.operation_id,
        ));
    }
    let _ = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    sqlx::query("UPDATE review_comments SET resolved = ? WHERE id = ?")
        .bind(if request.resolved { 1 } else { 0 })
        .bind(&request.comment_id)
        .execute(&pool)
        .await
        .map_err(|_| {
            terminal_error(
                "comment_write_failed",
                "The review comment could not be updated.",
                &request.operation_id,
            )
        })?;
    let row = sqlx::query(
        "SELECT id, change_id, file_path, line_number, body, resolved, created_at FROM review_comments WHERE id = ?",
    )
    .bind(&request.comment_id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| {
        terminal_error(
            "comment_read_failed",
            "The review comment could not be loaded.",
            &request.operation_id,
        )
    })?
    .ok_or_else(|| {
        terminal_error(
            "comment_missing",
            "That review comment no longer exists.",
            &request.operation_id,
        )
    })?;
    parse_comment_row(&row, &request.operation_id)
}

#[tauri::command]
pub(crate) async fn approve_change_review(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    processes: tauri::State<'_, RookProcesses>,
    request: ApproveReviewRequest,
) -> Result<ChangeReviewSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.change_id)
        || request.expected_source_digest.trim().is_empty()
    {
        return Err(terminal_error(
            "invalid_review_request",
            "The approval request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    approve_change_review_with_pool(
        &pool,
        &processes,
        &root,
        &request.change_id,
        &request.expected_source_digest,
        request.override_reason.as_deref(),
        &request.operation_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn request_change_revision(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: RevisionRequest,
) -> Result<ChangeReviewSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.change_id)
    {
        return Err(terminal_error(
            "invalid_review_request",
            "The revision request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    let project_id = root.to_string_lossy().into_owned();
    let change = load_change(
        &pool,
        &project_id,
        &request.change_id,
        &request.operation_id,
    )
    .await?;
    if matches!(
        change.status,
        ChangeStatus::Integrated | ChangeStatus::Abandoned
    ) {
        return Err(terminal_error(
            "change_not_reviewable",
            "Integrated or abandoned Changes cannot request revisions.",
            &request.operation_id,
        ));
    }
    let (live_digest, _) = source_manifest(&root)?;
    let head_revision = read_git_head(&root, &request.operation_id)?;
    let now = now_ms();
    let id = format!(
        "dec-{}-{}",
        now,
        EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let note = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut tx = pool.begin().await.map_err(|_| {
        terminal_error(
            "review_write_failed",
            "Revision request could not be saved.",
            &request.operation_id,
        )
    })?;
    sqlx::query(
        "INSERT INTO review_decisions (id, change_id, source_digest, head_revision, decision, override_reason, created_at) VALUES (?, ?, ?, ?, 'revision_requested', ?, ?)",
    )
    .bind(&id)
    .bind(&request.change_id)
    .bind(&live_digest)
    .bind(&head_revision)
    .bind(note)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        terminal_error(
            "review_write_failed",
            "Revision request could not be saved.",
            &request.operation_id,
        )
    })?;
    sqlx::query("UPDATE changes SET status = 'active', updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(&request.change_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| {
            terminal_error(
                "review_write_failed",
                "Change status could not be returned to active.",
                &request.operation_id,
            )
        })?;
    sqlx::query(
        "INSERT INTO change_activity (change_id, kind, detail, created_at) VALUES (?, 'revision_requested', ?, ?)",
    )
    .bind(&request.change_id)
    .bind(note.unwrap_or("revision requested"))
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| {
        terminal_error(
            "review_write_failed",
            "Revision activity could not be saved.",
            &request.operation_id,
        )
    })?;
    tx.commit().await.map_err(|_| {
        terminal_error(
            "review_write_failed",
            "Revision request could not be committed.",
            &request.operation_id,
        )
    })?;
    let _ = capture_review_snapshot_with_pool(
        &pool,
        &root,
        &request.change_id,
        &live_digest,
        &request.operation_id,
    )
    .await;
    get_change_review_with_pool(&pool, &root, &request.change_id, &request.operation_id).await
}

#[tauri::command]
pub(crate) async fn prepare_change_integration(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    processes: tauri::State<'_, RookProcesses>,
    request: PrepareIntegrationRequest,
) -> Result<IntegrationAttempt, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.change_id)
    {
        return Err(terminal_error(
            "invalid_integration_request",
            "The integration preparation request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    prepare_change_integration_with_pool(
        &pool,
        &processes,
        &root,
        &request.change_id,
        &request.selected_paths,
        &request.commit_message,
        &request.operation_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn execute_change_integration(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    processes: tauri::State<'_, RookProcesses>,
    request: ExecuteIntegrationRequest,
) -> Result<IntegrationAttempt, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !validate_operation_id(&request.change_id)
        || !validate_operation_id(&request.attempt_id)
    {
        return Err(terminal_error(
            "invalid_integration_request",
            "The integration execution request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    execute_change_integration_with_pool(
        &pool,
        &processes,
        &root,
        &request.change_id,
        &request.attempt_id,
        &request.operation_id,
    )
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceReviewSnapshot {
    pub(crate) review_id: String,
    pub(crate) branch: Option<String>,
    pub(crate) head_revision: String,
    pub(crate) source_digest: String,
    pub(crate) changed_files: Vec<GitFileStatus>,
    pub(crate) git_operation_in_progress: bool,
    pub(crate) has_fresh_passing_check: bool,
    pub(crate) comments: Vec<ReviewComment>,
    pub(crate) last_checkpoint_digest: Option<String>,
    pub(crate) last_checkpoint_label: Option<String>,
    pub(crate) last_checkpoint_at: Option<i64>,
    pub(crate) changed_since_checkpoint: Vec<String>,
    pub(crate) last_commit_sha: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveWorkspaceCheckpointRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    #[serde(default)]
    label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddWorkspaceCommentRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    file_path: String,
    #[serde(default)]
    line_number: Option<i64>,
    body: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevertFileRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    relative_path: String,
    target: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevertHunkRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    relative_path: String,
    #[serde(default)]
    baseline: Option<String>,
    old_start: usize,
    old_count: usize,
    new_start: usize,
    new_count: usize,
    expected_modified: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitWorkspaceReviewRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    selected_paths: Vec<String>,
    commit_message: String,
    expected_source_digest: String,
    #[serde(default)]
    allow_unverified: bool,
}

pub(crate) async fn ensure_workspace_review_id(
    pool: &SqlitePool,
    root: &Path,
    operation_id: &str,
) -> Result<String, IpcError> {
    let project_id = root.to_string_lossy().into_owned();
    let hash = format!("{:x}", Sha256::digest(project_id.as_bytes()));
    let review_id = format!("ws-rev-{}", &hash[..12]);
    let now = now_ms();
    sqlx::query(
        "INSERT OR IGNORE INTO changes (id, project_id, objective, status, created_at, updated_at) VALUES (?, ?, 'Working tree review', 'in_review', ?, ?)",
    )
    .bind(&review_id)
    .bind(&project_id)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "review_init_failed",
            "Workspace review session could not be prepared.",
            operation_id,
        )
    })?;
    Ok(review_id)
}

pub(crate) async fn get_workspace_review_with_pool(
    pool: &SqlitePool,
    root: &Path,
    operation_id: &str,
) -> Result<WorkspaceReviewSnapshot, IpcError> {
    let review_id = ensure_workspace_review_id(pool, root, operation_id).await?;
    let snapshot = get_change_review_with_pool(pool, root, &review_id, operation_id).await?;
    let label_row = sqlx::query(
        "SELECT detail FROM change_activity WHERE change_id = ? AND kind = 'checkpoint' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&review_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "review_read_failed",
            "Checkpoint metadata could not be loaded.",
            operation_id,
        )
    })?;
    let last_checkpoint_label = label_row
        .and_then(|row| row.try_get::<String, _>("detail").ok())
        .filter(|value| !value.trim().is_empty());
    let last_commit_sha = snapshot
        .latest_attempt
        .as_ref()
        .filter(|attempt| attempt.status == "succeeded")
        .and_then(|attempt| attempt.commit_sha.clone());

    Ok(WorkspaceReviewSnapshot {
        review_id,
        branch: snapshot.branch,
        head_revision: snapshot.head_revision,
        source_digest: snapshot.source_digest,
        changed_files: snapshot.changed_files,
        git_operation_in_progress: snapshot.git_operation_in_progress,
        has_fresh_passing_check: snapshot.has_fresh_passing_check,
        comments: snapshot.comments,
        last_checkpoint_digest: snapshot.last_reviewed_digest,
        last_checkpoint_label,
        last_checkpoint_at: snapshot.last_reviewed_at,
        changed_since_checkpoint: snapshot.changed_since_last_review,
        last_commit_sha,
    })
}

pub(crate) async fn save_workspace_checkpoint_with_pool(
    pool: &SqlitePool,
    root: &Path,
    label: Option<&str>,
    operation_id: &str,
) -> Result<WorkspaceReviewSnapshot, IpcError> {
    let review_id = ensure_workspace_review_id(pool, root, operation_id).await?;
    let (live_digest, _) = source_manifest(root)?;
    capture_review_snapshot_with_pool(pool, root, &review_id, &live_digest, operation_id).await?;
    let clean_label = label
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("Manual checkpoint");
    let now = now_ms();
    let _ = sqlx::query(
        "INSERT INTO change_activity (change_id, kind, detail, created_at) VALUES (?, 'checkpoint', ?, ?)",
    )
    .bind(&review_id)
    .bind(clean_label)
    .bind(now)
    .execute(pool)
    .await;
    get_workspace_review_with_pool(pool, root, operation_id).await
}

pub(crate) async fn revert_workspace_file_with_pool(
    pool: &SqlitePool,
    processes: &RookProcesses,
    root: &Path,
    relative_path: &str,
    target: &str,
    operation_id: &str,
) -> Result<WorkspaceReviewSnapshot, IpcError> {
    if processes.has_active_build(root) {
        return Err(terminal_error(
            "build_run_active",
            "Stop Rook Build before reverting files.",
            operation_id,
        ));
    }
    if git_operation_in_progress(root) {
        return Err(terminal_error(
            "git_operation_in_progress",
            "Finish or abort the active Git merge or rebase before reverting files.",
            operation_id,
        ));
    }
    validate_safe_relative_path(relative_path, operation_id)?;
    let full_path = root.join(relative_path);
    if let Ok(meta) = fs::symlink_metadata(&full_path) {
        if meta.file_type().is_symlink() {
            return Err(terminal_error(
                "project_file_symlink",
                "Symbolic links cannot be reverted from Review.",
                operation_id,
            ));
        }
    }

    match target {
        "head" => {
            let spec = format!("HEAD:{relative_path}");
            let in_head = git_read_raw(root, &["cat-file", "-e", &spec], operation_id)?
                .status
                .success();
            if in_head {
                let output = git_write_raw(
                    root,
                    &[
                        "checkout".to_owned(),
                        "HEAD".to_owned(),
                        "--".to_owned(),
                        relative_path.to_owned(),
                    ],
                    operation_id,
                )?;
                if !output.status.success() {
                    let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
                    return Err(terminal_error(
                        "revert_failed",
                        if detail.is_empty() {
                            "Git could not revert this file to HEAD."
                        } else {
                            &detail
                        },
                        operation_id,
                    ));
                }
            } else if full_path.is_file() {
                fs::remove_file(&full_path).map_err(|_| {
                    terminal_error(
                        "revert_failed",
                        "Untracked file could not be removed.",
                        operation_id,
                    )
                })?;
            }
        }
        "checkpoint" => {
            let review_id = ensure_workspace_review_id(pool, root, operation_id).await?;
            let snap_row = sqlx::query(
                "SELECT id FROM review_snapshots WHERE change_id = ? ORDER BY created_at DESC LIMIT 1",
            )
            .bind(&review_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| {
                terminal_error(
                    "revert_failed",
                    "Last checkpoint could not be read.",
                    operation_id,
                )
            })?
            .ok_or_else(|| {
                terminal_error(
                    "checkpoint_missing",
                    "No review checkpoint exists yet to revert to.",
                    operation_id,
                )
            })?;
            let snap_id: String = snap_row.try_get("id").unwrap_or_default();
            let file_row = sqlx::query(
                "SELECT content FROM review_snapshot_files WHERE snapshot_id = ? AND file_path = ?",
            )
            .bind(&snap_id)
            .bind(relative_path)
            .fetch_optional(pool)
            .await
            .map_err(|_| {
                terminal_error(
                    "revert_failed",
                    "Checkpoint file content could not be read.",
                    operation_id,
                )
            })?;
            if let Some(row) = file_row {
                let saved_text: Option<String> = row.try_get("content").ok().flatten();
                match saved_text {
                    Some(content) => {
                        if let Some(parent) = full_path.parent() {
                            let _ = fs::create_dir_all(parent);
                        }
                        fs::write(&full_path, content.as_bytes()).map_err(|_| {
                            terminal_error(
                                "revert_failed",
                                "Could not restore file content from the last checkpoint.",
                                operation_id,
                            )
                        })?;
                    }
                    None => {
                        if full_path.is_file() {
                            let _ = fs::remove_file(&full_path);
                        }
                    }
                }
            } else {
                // File wasn't modified at checkpoint time -> either tracked at HEAD or created after checkpoint
                let spec = format!("HEAD:{relative_path}");
                let in_head = git_read_raw(root, &["cat-file", "-e", &spec], operation_id)?
                    .status
                    .success();
                if in_head {
                    let output = git_write_raw(
                        root,
                        &[
                            "checkout".to_owned(),
                            "HEAD".to_owned(),
                            "--".to_owned(),
                            relative_path.to_owned(),
                        ],
                        operation_id,
                    )?;
                    if !output.status.success() {
                        return Err(terminal_error(
                            "revert_failed",
                            "Git could not restore this file to its pre-checkpoint state.",
                            operation_id,
                        ));
                    }
                } else if full_path.is_file() {
                    fs::remove_file(&full_path).map_err(|_| {
                        terminal_error(
                            "revert_failed",
                            "New file created after the checkpoint could not be removed.",
                            operation_id,
                        )
                    })?;
                }
            }
        }
        _ => {
            return Err(terminal_error(
                "invalid_revert_target",
                "Revert target must be 'head' or 'checkpoint'.",
                operation_id,
            ));
        }
    }

    get_workspace_review_with_pool(pool, root, operation_id).await
}

pub(crate) fn apply_hunk_revert_text(
    original: &str,
    modified: &str,
    old_start: usize,
    old_count: usize,
    new_start: usize,
    new_count: usize,
    operation_id: &str,
) -> Result<String, IpcError> {
    let uses_crlf = modified.contains("\r\n");
    let had_trailing_nl = modified.ends_with('\n');
    let orig_had_trailing_nl = original.ends_with('\n');

    fn split_lines(text: &str) -> Vec<String> {
        let normalized = text.replace("\r\n", "\n");
        let trimmed = normalized.strip_suffix('\n').unwrap_or(&normalized);
        if normalized.is_empty() {
            Vec::new()
        } else {
            trimmed.split('\n').map(str::to_owned).collect()
        }
    }

    let orig_lines = split_lines(original);
    let mut mod_lines = split_lines(modified);

    let orig_start = if old_count == 0 {
        0
    } else {
        old_start.checked_sub(1).ok_or_else(|| {
            terminal_error(
                "invalid_hunk_range",
                "Original hunk line range is out of bounds.",
                operation_id,
            )
        })?
    };
    let orig_end = orig_start.checked_add(old_count).ok_or_else(|| {
        terminal_error(
            "invalid_hunk_range",
            "Original hunk line range overflows.",
            operation_id,
        )
    })?;

    let mod_start = if new_count == 0 {
        new_start
    } else {
        new_start.checked_sub(1).ok_or_else(|| {
            terminal_error(
                "invalid_hunk_range",
                "Modified hunk line range is out of bounds.",
                operation_id,
            )
        })?
    };
    let mod_end = mod_start.checked_add(new_count).ok_or_else(|| {
        terminal_error(
            "invalid_hunk_range",
            "Modified hunk line range overflows.",
            operation_id,
        )
    })?;

    if orig_end > orig_lines.len() || mod_end > mod_lines.len() {
        return Err(terminal_error(
            "hunk_out_of_range",
            "Hunk coordinates no longer match the current diff. Refresh Review and try again.",
            operation_id,
        ));
    }

    let replacement: Vec<String> = orig_lines[orig_start..orig_end].to_vec();
    mod_lines.splice(mod_start..mod_end, replacement);

    if mod_lines.is_empty() {
        return Ok(String::new());
    }

    let separator = if uses_crlf { "\r\n" } else { "\n" };
    let mut next = mod_lines.join(separator);
    if had_trailing_nl || orig_had_trailing_nl {
        next.push_str(separator);
    }
    Ok(next)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn revert_workspace_hunk_with_pool(
    pool: &SqlitePool,
    processes: &RookProcesses,
    root: &Path,
    relative_path: &str,
    baseline: Option<&str>,
    old_start: usize,
    old_count: usize,
    new_start: usize,
    new_count: usize,
    expected_modified: &str,
    operation_id: &str,
) -> Result<WorkspaceReviewSnapshot, IpcError> {
    if processes.has_active_build(root) {
        return Err(terminal_error(
            "build_run_active",
            "Stop Rook Build before reverting a hunk.",
            operation_id,
        ));
    }
    if git_operation_in_progress(root) {
        return Err(terminal_error(
            "git_operation_in_progress",
            "Finish or abort the active Git merge or rebase before reverting a hunk.",
            operation_id,
        ));
    }
    validate_safe_relative_path(relative_path, operation_id)?;
    let full_path = root.join(relative_path);
    if let Ok(meta) = fs::symlink_metadata(&full_path) {
        if meta.file_type().is_symlink() {
            return Err(terminal_error(
                "project_file_symlink",
                "Symbolic links cannot be reverted from Review.",
                operation_id,
            ));
        }
    }

    let pair = match baseline {
        Some("last_review") => {
            let review_id = ensure_workspace_review_id(pool, root, operation_id).await?;
            read_git_file_diff_pair_since_review_with_pool(
                pool,
                root,
                &review_id,
                relative_path,
                operation_id,
            )
            .await?
        }
        _ => read_git_file_diff_pair_at(root, relative_path, operation_id)?,
    };
    if pair.kind != ProjectFileReadKind::Text {
        return Err(terminal_error(
            "hunk_revert_unsupported",
            "Only UTF-8 text files under 1 MiB support hunk revert.",
            operation_id,
        ));
    }

    let current_modified = pair.modified.unwrap_or_default();
    if current_modified != expected_modified {
        return Err(terminal_error(
            "file_modified_since_read",
            "This file changed on disk since the diff loaded. Refresh Review before reverting a hunk.",
            operation_id,
        ));
    }

    let original = pair.original.unwrap_or_default();
    let updated = apply_hunk_revert_text(
        &original,
        &current_modified,
        old_start,
        old_count,
        new_start,
        new_count,
        operation_id,
    )?;

    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            terminal_error(
                "revert_failed",
                "Parent directory could not be prepared for hunk revert.",
                operation_id,
            )
        })?;
    }
    let tmp_path = full_path.with_file_name(format!(
        ".{}.laplace-hunk.tmp",
        full_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
    ));
    fs::write(&tmp_path, updated.as_bytes()).map_err(|_| {
        terminal_error(
            "revert_failed",
            "Reverted hunk could not be written to disk.",
            operation_id,
        )
    })?;
    fs::rename(&tmp_path, &full_path).map_err(|_| {
        let _ = fs::remove_file(&tmp_path);
        terminal_error(
            "revert_failed",
            "Reverted hunk could not replace the target file.",
            operation_id,
        )
    })?;

    get_workspace_review_with_pool(pool, root, operation_id).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn commit_workspace_review_with_pool(
    pool: &SqlitePool,
    processes: &RookProcesses,
    root: &Path,
    selected_paths: &[String],
    commit_message: &str,
    expected_source_digest: &str,
    allow_unverified: bool,
    operation_id: &str,
) -> Result<IntegrationAttempt, IpcError> {
    if processes.has_active_build(root) {
        return Err(terminal_error(
            "build_run_active",
            "Stop Rook Build before committing files.",
            operation_id,
        ));
    }
    if git_operation_in_progress(root) {
        return Err(terminal_error(
            "git_operation_in_progress",
            "Finish or abort the active Git merge or rebase before committing.",
            operation_id,
        ));
    }
    let message = commit_message.trim();
    if message.is_empty() || message.len() > 1000 {
        return Err(terminal_error(
            "invalid_commit_message",
            "Enter a commit message between 1 and 1,000 characters.",
            operation_id,
        ));
    }
    if selected_paths.is_empty() {
        return Err(terminal_error(
            "no_files_selected",
            "Select at least one changed file to commit.",
            operation_id,
        ));
    }

    let review_id = ensure_workspace_review_id(pool, root, operation_id).await?;
    let status = read_git_status_at(root, operation_id)?;
    let head_revision = read_git_head(root, operation_id)?;
    if head_revision == "UNBORN" {
        return Err(terminal_error(
            "unborn_head",
            "Create an initial Git commit before committing from Review.",
            operation_id,
        ));
    }
    let (live_digest, _) = source_manifest(root)?;
    if live_digest != expected_source_digest {
        return Err(terminal_error(
            "source_changed_during_review",
            "Workspace files changed since Review loaded. Refresh the diff before committing.",
            operation_id,
        ));
    }
    let project_id = root.to_string_lossy().into_owned();
    let fresh_pass =
        has_fresh_passing_check(pool, &project_id, &review_id, &live_digest, operation_id).await?;
    if !fresh_pass && !allow_unverified {
        return Err(terminal_error(
            "verification_required",
            "No fresh passing check exists for this diff. Run a check or check 'Commit without fresh check'.",
            operation_id,
        ));
    }

    let changed_map: HashMap<&str, &GitFileStatus> = status
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    let mut normalized_paths = Vec::new();
    let mut untracked_selected = Vec::new();
    for path in selected_paths {
        validate_safe_relative_path(path, operation_id)?;
        let Some(entry) = changed_map.get(path.as_str()) else {
            return Err(terminal_error(
                "selected_path_not_changed",
                &format!("'{path}' has no pending changes to commit."),
                operation_id,
            ));
        };
        if !normalized_paths.contains(path) {
            normalized_paths.push(path.clone());
            if entry.index_status == '?' && entry.worktree_status == '?' {
                untracked_selected.push(path.clone());
            }
        }
    }
    normalized_paths.sort();

    let now = now_ms();
    let attempt_id = format!(
        "int-{}-{}",
        now,
        EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let paths_json = serde_json::to_string(&normalized_paths).unwrap_or_else(|_| "[]".into());
    sqlx::query(
        "INSERT INTO integration_attempts (id, change_id, project_id, base_head, approved_source_digest, commit_message, selected_paths_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'committing', ?, ?)",
    )
    .bind(&attempt_id)
    .bind(&review_id)
    .bind(&project_id)
    .bind(&head_revision)
    .bind(&live_digest)
    .bind(message)
    .bind(&paths_json)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "integration_write_failed",
            "Commit attempt could not be recorded.",
            operation_id,
        )
    })?;

    if !untracked_selected.is_empty() {
        let mut add_args = vec!["add".to_owned(), "--".to_owned()];
        add_args.extend(untracked_selected.iter().cloned());
        let add_output = git_write_raw(root, &add_args, operation_id)?;
        if !add_output.status.success() {
            let detail = String::from_utf8_lossy(&add_output.stderr)
                .trim()
                .to_owned();
            let _ = sqlx::query(
                "UPDATE integration_attempts SET status = 'failed', error_detail = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&detail)
            .bind(now_ms())
            .bind(&attempt_id)
            .execute(pool)
            .await;
            return Err(terminal_error(
                "git_commit_failed",
                if detail.is_empty() {
                    "Git could not stage selected new files. Your edits were preserved."
                } else {
                    &detail
                },
                operation_id,
            ));
        }
    }

    let mut commit_args = vec![
        "commit".to_owned(),
        "--only".to_owned(),
        "-m".to_owned(),
        message.to_owned(),
        "--".to_owned(),
    ];
    commit_args.extend(normalized_paths.iter().cloned());
    let commit_output = git_write_raw(root, &commit_args, operation_id)?;
    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr)
            .trim()
            .to_owned();
        let stdout = String::from_utf8_lossy(&commit_output.stdout)
            .trim()
            .to_owned();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        let _ = sqlx::query(
            "UPDATE integration_attempts SET status = 'failed', error_detail = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&detail)
        .bind(now_ms())
        .bind(&attempt_id)
        .execute(pool)
        .await;
        return Err(terminal_error(
            "git_commit_failed",
            if detail.is_empty() {
                "Git commit failed (for example, a pre-commit hook rejected the change). Your files were preserved."
            } else {
                &detail
            },
            operation_id,
        ));
    }

    let commit_sha = read_git_head(root, operation_id)?;
    let finished_at = now_ms();
    let _ = sqlx::query(
        "UPDATE integration_attempts SET status = 'succeeded', commit_sha = ?, error_detail = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(&commit_sha)
    .bind(finished_at)
    .bind(&attempt_id)
    .execute(pool)
    .await;

    for committed_path in &normalized_paths {
        let _ = sqlx::query(
            "UPDATE review_comments SET resolved = 1 WHERE change_id = ? AND file_path = ?",
        )
        .bind(&review_id)
        .bind(committed_path)
        .execute(pool)
        .await;
    }

    Ok(IntegrationAttempt {
        id: attempt_id,
        change_id: review_id,
        project_id,
        base_head: head_revision,
        approved_source_digest: live_digest,
        commit_message: message.to_owned(),
        selected_paths: normalized_paths,
        status: "succeeded".to_owned(),
        commit_sha: Some(commit_sha),
        error_detail: None,
        created_at: now,
        updated_at: finished_at,
    })
}

#[tauri::command]
pub(crate) async fn get_workspace_review(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: GitRequest,
) -> Result<WorkspaceReviewSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_review_request",
            "The review request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    get_workspace_review_with_pool(&pool, &root, &request.operation_id).await
}

#[tauri::command]
pub(crate) async fn save_workspace_checkpoint(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: SaveWorkspaceCheckpointRequest,
) -> Result<WorkspaceReviewSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_review_request",
            "The checkpoint request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    save_workspace_checkpoint_with_pool(
        &pool,
        &root,
        request.label.as_deref(),
        &request.operation_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn add_workspace_review_comment(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: AddWorkspaceCommentRequest,
) -> Result<ReviewComment, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_comment_request",
            "The review note request is invalid.",
            &request.operation_id,
        ));
    }
    validate_safe_relative_path(&request.file_path, &request.operation_id)?;
    let body = request.body.trim();
    if body.is_empty() || body.len() > 2000 {
        return Err(terminal_error(
            "invalid_comment_body",
            "Review notes must be between 1 and 2,000 characters.",
            &request.operation_id,
        ));
    }
    if let Some(line) = request.line_number {
        if !(1..=1_000_000).contains(&line) {
            return Err(terminal_error(
                "invalid_comment_line",
                "Line number must be a positive integer.",
                &request.operation_id,
            ));
        }
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    let review_id = ensure_workspace_review_id(&pool, &root, &request.operation_id).await?;
    let now = now_ms();
    let id = format!(
        "cmt-{}-{}",
        now,
        EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    sqlx::query(
        "INSERT INTO review_comments (id, change_id, file_path, line_number, body, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
    )
    .bind(&id)
    .bind(&review_id)
    .bind(&request.file_path)
    .bind(request.line_number)
    .bind(body)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|_| {
        terminal_error(
            "comment_write_failed",
            "The review note could not be saved.",
            &request.operation_id,
        )
    })?;
    Ok(ReviewComment {
        id,
        change_id: review_id,
        file_path: request.file_path,
        line_number: request.line_number,
        body: body.to_owned(),
        resolved: false,
        created_at: now,
    })
}

#[tauri::command]
pub(crate) async fn revert_workspace_file(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    processes: tauri::State<'_, RookProcesses>,
    request: RevertFileRequest,
) -> Result<WorkspaceReviewSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_revert_request",
            "The revert request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let _hmr_guard = rook_service::DevHmrGuard::acquire(&root);
    let pool = open_domain_database(&app, &db).await?;
    revert_workspace_file_with_pool(
        &pool,
        &processes,
        &root,
        &request.relative_path,
        &request.target,
        &request.operation_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn revert_workspace_hunk(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    processes: tauri::State<'_, RookProcesses>,
    request: RevertHunkRequest,
) -> Result<WorkspaceReviewSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_revert_request",
            "The hunk revert request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let _hmr_guard = rook_service::DevHmrGuard::acquire(&root);
    let pool = open_domain_database(&app, &db).await?;
    revert_workspace_hunk_with_pool(
        &pool,
        &processes,
        &root,
        &request.relative_path,
        request.baseline.as_deref(),
        request.old_start,
        request.old_count,
        request.new_start,
        request.new_count,
        &request.expected_modified,
        &request.operation_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn commit_workspace_review(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    processes: tauri::State<'_, RookProcesses>,
    request: CommitWorkspaceReviewRequest,
) -> Result<IntegrationAttempt, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_commit_request",
            "The commit request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    commit_workspace_review_with_pool(
        &pool,
        &processes,
        &root,
        &request.selected_paths,
        &request.commit_message,
        &request.expected_source_digest,
        request.allow_unverified,
        &request.operation_id,
    )
    .await
}

#[cfg(test)]
mod review_tests {
    use super::*;

    async fn setup_fixture() -> (PathBuf, PathBuf, SqlitePool, String) {
        let base = std::env::temp_dir().join(format!(
            "laplace-review-test-{}-{}",
            std::process::id(),
            EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&base);
        let repo = base.join("repo");
        fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| {
            let out = Command::new("git")
                .args(args)
                .current_dir(&repo)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&out.stderr)
            );
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.name", "Laplace Test"]);
        git(&["config", "user.email", "test@laplace.local"]);
        git(&["config", "commit.gpgsign", "false"]);
        fs::write(repo.join("app.ts"), "export const version = 1;\n").unwrap();
        fs::write(repo.join("other.ts"), "export const other = 1;\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-m", "initial commit"]);

        let root = fs::canonicalize(&repo).unwrap();
        let db_path = base.join("laplace.db");
        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        MIGRATOR.run(&pool).await.unwrap();
        let change_id = "ch-review-1".to_owned();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO changes (id, project_id, objective, status, created_at, updated_at) VALUES (?, ?, 'Update app version', 'in_review', ?, ?)",
        )
        .bind(&change_id)
        .bind(root.to_string_lossy().as_ref())
        .bind(now)
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();
        (base, root, pool, change_id)
    }

    #[tokio::test]
    async fn approval_binds_to_snapshot_requires_override_and_invalidates_on_edit() {
        let (base, root, pool, change_id) = setup_fixture().await;
        let processes = RookProcesses::default();
        fs::write(root.join("app.ts"), "export const version = 2;\n").unwrap();

        let snapshot = get_change_review_with_pool(&pool, &root, &change_id, "op-1")
            .await
            .unwrap();
        assert!(!snapshot.approval_valid);
        assert!(!snapshot.has_fresh_passing_check);

        let err = approve_change_review_with_pool(
            &pool,
            &processes,
            &root,
            &change_id,
            &snapshot.source_digest,
            None,
            "op-2",
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, "verification_override_required");

        let approved = approve_change_review_with_pool(
            &pool,
            &processes,
            &root,
            &change_id,
            &snapshot.source_digest,
            Some("Manual review verified version bump"),
            "op-3",
        )
        .await
        .unwrap();
        assert!(approved.approval_valid);
        assert_eq!(approved.change.status, ChangeStatus::Approved);

        // Editing source invalidates approval and blocks integration preparation.
        fs::write(root.join("app.ts"), "export const version = 3;\n").unwrap();
        let stale = get_change_review_with_pool(&pool, &root, &change_id, "op-4")
            .await
            .unwrap();
        assert!(!stale.approval_valid);
        assert!(stale.approval_stale_reason.is_some());

        let prep_err = prepare_change_integration_with_pool(
            &pool,
            &processes,
            &root,
            &change_id,
            &["app.ts".to_owned()],
            "Bump version",
            "op-5",
        )
        .await
        .unwrap_err();
        assert_eq!(prep_err.code, "approval_required");

        let _ = fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn guarded_integration_commits_only_selected_files_and_guards_advancing_head() {
        let (base, root, pool, change_id) = setup_fixture().await;
        let processes = RookProcesses::default();
        fs::write(root.join("app.ts"), "export const version = 2;\n").unwrap();
        fs::write(root.join("other.ts"), "export const other = 99;\n").unwrap();

        let pair = read_git_file_diff_pair_at(&root, "app.ts", "op-diff").unwrap();
        assert_eq!(pair.status, "modified");
        assert_eq!(
            pair.original.as_deref(),
            Some("export const version = 1;\n")
        );
        assert_eq!(
            pair.modified.as_deref(),
            Some("export const version = 2;\n")
        );

        let snapshot = get_change_review_with_pool(&pool, &root, &change_id, "op-1")
            .await
            .unwrap();
        approve_change_review_with_pool(
            &pool,
            &processes,
            &root,
            &change_id,
            &snapshot.source_digest,
            Some("Reviewed targeted change"),
            "op-2",
        )
        .await
        .unwrap();

        let prepared = prepare_change_integration_with_pool(
            &pool,
            &processes,
            &root,
            &change_id,
            &["app.ts".to_owned()],
            "Update app version to 2",
            "op-3",
        )
        .await
        .unwrap();
        let integrated = execute_change_integration_with_pool(
            &pool,
            &processes,
            &root,
            &change_id,
            &prepared.id,
            "op-4",
        )
        .await
        .unwrap();
        assert_eq!(integrated.status, "succeeded");
        let sha = integrated.commit_sha.unwrap();
        assert_eq!(read_git_head(&root, "op-head").unwrap(), sha);

        // Verify commit touched ONLY app.ts and preserved dirty other.ts.
        let committed_files = git_read_raw(
            &root,
            &["show", "--pretty=", "--name-only", &sha],
            "op-show",
        )
        .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&committed_files.stdout).trim(),
            "app.ts"
        );
        let status = read_git_status_at(&root, "op-status").unwrap();
        assert_eq!(status.files.len(), 1);
        assert_eq!(status.files[0].path, "other.ts");

        // Verify advancing HEAD externally blocks execution of a prepared attempt.
        let ch2 = "ch-review-2".to_owned();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO changes (id, project_id, objective, status, created_at, updated_at) VALUES (?, ?, 'Second change', 'in_review', ?, ?)",
        )
        .bind(&ch2)
        .bind(root.to_string_lossy().as_ref())
        .bind(now)
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();
        let snap2 = get_change_review_with_pool(&pool, &root, &ch2, "op-5")
            .await
            .unwrap();
        approve_change_review_with_pool(
            &pool,
            &processes,
            &root,
            &ch2,
            &snap2.source_digest,
            Some("Override for test"),
            "op-6",
        )
        .await
        .unwrap();
        let prep2 = prepare_change_integration_with_pool(
            &pool,
            &processes,
            &root,
            &ch2,
            &["other.ts".to_owned()],
            "Update other",
            "op-7",
        )
        .await
        .unwrap();
        // Advance HEAD with an empty commit externally.
        let advance = Command::new("git")
            .args(["commit", "--allow-empty", "-m", "external advance"])
            .current_dir(&root)
            .output()
            .unwrap();
        assert!(advance.status.success());

        let err =
            execute_change_integration_with_pool(&pool, &processes, &root, &ch2, &prep2.id, "op-8")
                .await
                .unwrap_err();
        assert_eq!(err.code, "destination_branch_advanced");
        assert_eq!(
            fs::read_to_string(root.join("other.ts")).unwrap(),
            "export const other = 99;\n"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn interrupted_committing_attempt_reconciles_from_git_state() {
        let (base, root, pool, change_id) = setup_fixture().await;
        let head = read_git_head(&root, "op-h").unwrap();
        let (digest, _) = source_manifest(&root).unwrap();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO integration_attempts (id, change_id, project_id, base_head, approved_source_digest, commit_message, selected_paths_json, status, created_at, updated_at) VALUES ('int-crash', ?, ?, ?, ?, 'Never committed', '[\"app.ts\"]', 'committing', ?, ?)",
        )
        .bind(&change_id)
        .bind(root.to_string_lossy().as_ref())
        .bind(&head)
        .bind(&digest)
        .bind(now)
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();

        let recovered = get_change_review_with_pool(&pool, &root, &change_id, "op-rec")
            .await
            .unwrap();
        assert_eq!(
            recovered.latest_attempt.as_ref().map(|a| a.status.as_str()),
            Some("aborted")
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn review_checkpoint_and_incremental_diff_tracks_only_post_review_changes() {
        let (base, root, pool, change_id) = setup_fixture().await;
        fs::write(root.join("app.ts"), "export const a = 2;\n").unwrap();
        let (digest_v1, _) = source_manifest(&root).unwrap();
        capture_review_snapshot_with_pool(&pool, &root, &change_id, &digest_v1, "op-snap-1")
            .await
            .unwrap();

        let snap_before = get_change_review_with_pool(&pool, &root, &change_id, "op-rev-1")
            .await
            .unwrap();
        assert_eq!(
            snap_before.last_reviewed_digest.as_deref(),
            Some(digest_v1.as_str())
        );
        assert!(snap_before.changed_since_last_review.is_empty());

        // Revise app.ts after the checkpoint
        fs::write(root.join("app.ts"), "export const a = 3;\n").unwrap();
        let snap_after = get_change_review_with_pool(&pool, &root, &change_id, "op-rev-2")
            .await
            .unwrap();
        assert_eq!(snap_after.changed_since_last_review, vec!["app.ts"]);

        let inc_pair = read_git_file_diff_pair_since_review_with_pool(
            &pool, &root, &change_id, "app.ts", "op-inc",
        )
        .await
        .unwrap();
        assert_eq!(inc_pair.original.as_deref(), Some("export const a = 2;\n"));
        assert_eq!(inc_pair.modified.as_deref(), Some("export const a = 3;\n"));

        let _ = fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn workspace_review_checkpoint_and_revert_preserves_prior_edits() {
        let (base, root, pool, _) = setup_fixture().await;
        let processes = RookProcesses::default();

        // User makes an initial edit
        fs::write(root.join("app.ts"), "export const a = 2;\n").unwrap();
        let cp =
            save_workspace_checkpoint_with_pool(&pool, &root, Some("Before Rook Build"), "op-cp")
                .await
                .unwrap();
        assert_eq!(
            cp.last_checkpoint_label.as_deref(),
            Some("Before Rook Build")
        );

        // Rook Build edits app.ts and creates a new file extra.ts
        fs::write(root.join("app.ts"), "export const a = 999;\n").unwrap();
        fs::write(root.join("extra.ts"), "export const extra = true;\n").unwrap();

        let after_rook = get_workspace_review_with_pool(&pool, &root, "op-get")
            .await
            .unwrap();
        assert!(after_rook
            .changed_since_checkpoint
            .contains(&"app.ts".to_owned()));
        assert!(after_rook
            .changed_since_checkpoint
            .contains(&"extra.ts".to_owned()));

        // Revert app.ts to checkpoint -> restores user's prior edit (2), NOT HEAD (1)
        let _ = revert_workspace_file_with_pool(
            &pool,
            &processes,
            &root,
            "app.ts",
            "checkpoint",
            "op-rev-cp",
        )
        .await
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("app.ts")).unwrap(),
            "export const a = 2;\n"
        );

        // Revert untracked extra.ts to checkpoint -> removes it cleanly
        let _ = revert_workspace_file_with_pool(
            &pool,
            &processes,
            &root,
            "extra.ts",
            "checkpoint",
            "op-rev-extra",
        )
        .await
        .unwrap();
        assert!(!root.join("extra.ts").exists());

        // Revert app.ts to HEAD -> restores HEAD content (1)
        let _ = revert_workspace_file_with_pool(
            &pool,
            &processes,
            &root,
            "app.ts",
            "head",
            "op-rev-head",
        )
        .await
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("app.ts")).unwrap(),
            "export const version = 1;\n"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn workspace_review_direct_selective_commit_enforces_guards_and_preserves_unselected() {
        let (base, root, pool, _) = setup_fixture().await;
        let processes = RookProcesses::default();
        fs::write(root.join("app.ts"), "export const a = 42;\n").unwrap();
        fs::write(root.join("other.ts"), "export const other = 7;\n").unwrap();

        let snap = get_workspace_review_with_pool(&pool, &root, "op-ws-1")
            .await
            .unwrap();

        // Without fresh check and allow_unverified = false -> blocked
        let blocked = commit_workspace_review_with_pool(
            &pool,
            &processes,
            &root,
            &["app.ts".to_owned()],
            "Update app",
            &snap.source_digest,
            false,
            "op-ws-2",
        )
        .await
        .unwrap_err();
        assert_eq!(blocked.code, "verification_required");

        // Stale digest -> blocked even with allow_unverified = true
        let stale = commit_workspace_review_with_pool(
            &pool,
            &processes,
            &root,
            &["app.ts".to_owned()],
            "Update app",
            "stale-digest",
            true,
            "op-ws-3",
        )
        .await
        .unwrap_err();
        assert_eq!(stale.code, "source_changed_during_review");

        // Valid commit of ONLY app.ts -> succeeds and leaves other.ts uncommitted
        let committed = commit_workspace_review_with_pool(
            &pool,
            &processes,
            &root,
            &["app.ts".to_owned()],
            "Update app only",
            &snap.source_digest,
            true,
            "op-ws-4",
        )
        .await
        .unwrap();
        assert_eq!(committed.status, "succeeded");
        assert!(committed.commit_sha.is_some());

        let after = get_workspace_review_with_pool(&pool, &root, "op-ws-5")
            .await
            .unwrap();
        assert_eq!(after.changed_files.len(), 1);
        assert_eq!(after.changed_files[0].path, "other.ts");

        let _ = fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn hunk_revert_restores_targeted_slice_and_detects_drift() {
        let (base, root, pool, _change_id) = setup_fixture().await;
        let processes = RookProcesses::default();

        fs::write(
            root.join("app.ts"),
            "line 1\nline 2\nline 3\nline 4\nline 5\n",
        )
        .unwrap();
        let git_commit = Command::new("git")
            .args(["commit", "-am", "multi-line baseline"])
            .current_dir(&root)
            .output()
            .unwrap();
        assert!(git_commit.status.success());

        let modified = "line 1\nline TWO\nline 3\nline FOUR\nline 5\n";
        fs::write(root.join("app.ts"), modified).unwrap();

        // Drift guard rejects stale expected_modified
        let stale = revert_workspace_hunk_with_pool(
            &pool,
            &processes,
            &root,
            "app.ts",
            Some("head"),
            2,
            1,
            2,
            1,
            "stale content",
            "op-hunk-stale",
        )
        .await
        .unwrap_err();
        assert_eq!(stale.code, "file_modified_since_read");

        // Revert only the first modified hunk (line 2 -> "line TWO")
        revert_workspace_hunk_with_pool(
            &pool,
            &processes,
            &root,
            "app.ts",
            Some("head"),
            2,
            1,
            2,
            1,
            modified,
            "op-hunk-1",
        )
        .await
        .unwrap();

        let disk_after = fs::read_to_string(root.join("app.ts")).unwrap();
        assert_eq!(disk_after, "line 1\nline 2\nline 3\nline FOUR\nline 5\n");

        let _ = fs::remove_dir_all(&base);
    }
}
