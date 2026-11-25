use super::*;

const MAX_QUICK_OPEN_FILES: usize = 2_000;
const IGNORED_WALK_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    ".venv",
    "__pycache__",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceLayoutState {
    pub(crate) open_tabs: Vec<String>,
    pub(crate) active_tab: Option<String>,
    pub(crate) split_tab: Option<String>,
    pub(crate) bottom_tab: String,
    pub(crate) active_page: String,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorDraftRecord {
    pub(crate) relative_path: String,
    pub(crate) saved_digest: String,
    pub(crate) draft_content: String,
    pub(crate) matches_disk: bool,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceContinuity {
    pub(crate) layout: Option<WorkspaceLayoutState>,
    pub(crate) drafts: Vec<EditorDraftRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveWorkspaceLayoutRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    open_tabs: Vec<String>,
    #[serde(default)]
    active_tab: Option<String>,
    #[serde(default)]
    split_tab: Option<String>,
    bottom_tab: String,
    active_page: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveEditorDraftRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    relative_path: String,
    saved_content: String,
    draft_content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteEditorDraftRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    relative_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PruneExecutionsRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    #[serde(default)]
    keep_latest: Option<i64>,
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn validate_safe_rel_path(relative_path: &str, operation_id: &str) -> Result<(), IpcError> {
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
            "Select a valid file inside the open project.",
            operation_id,
        ));
    }
    Ok(())
}

pub(crate) fn list_project_files_at(
    root: &Path,
    operation_id: &str,
) -> Result<Vec<String>, IpcError> {
    if !root.is_dir() {
        return Err(terminal_error(
            "workspace_unavailable",
            "The project folder is no longer available.",
            operation_id,
        ));
    }
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if files.len() >= MAX_QUICK_OPEN_FILES {
            break;
        }
        let Ok(read_dir) = fs::read_dir(&dir) else {
            continue;
        };
        let mut children: Vec<PathBuf> = read_dir
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .collect();
        children.sort();
        for path in children {
            if files.len() >= MAX_QUICK_OPEN_FILES {
                break;
            }
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if meta.is_dir() {
                if IGNORED_WALK_DIRS.contains(&name) {
                    continue;
                }
                stack.push(path);
            } else if meta.is_file() {
                if let Ok(rel) = path.strip_prefix(root) {
                    let normalized = rel
                        .components()
                        .map(|component| component.as_os_str().to_string_lossy())
                        .collect::<Vec<_>>()
                        .join("/");
                    if !normalized.is_empty() {
                        files.push(normalized);
                    }
                }
            }
        }
    }
    files.sort();
    Ok(files)
}

#[tauri::command]
pub(crate) async fn list_project_files(request: GitRequest) -> Result<Vec<String>, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_project_request",
            "The project file index request is invalid.",
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
    let operation_id = request.operation_id.clone();
    tokio::task::spawn_blocking(move || list_project_files_at(&root, &operation_id))
        .await
        .map_err(|_| {
            terminal_error(
                "file_index_failed",
                "Project files could not be indexed.",
                &request.operation_id,
            )
        })?
}

pub(crate) async fn load_workspace_continuity_with_pool(
    pool: &SqlitePool,
    root: &Path,
    operation_id: &str,
) -> Result<WorkspaceContinuity, IpcError> {
    let project_id = root.to_string_lossy().into_owned();
    let layout_row = sqlx::query(
        "SELECT open_tabs_json, active_tab, split_tab, bottom_tab, active_page, updated_at FROM workspace_layout_state WHERE project_id = ?",
    )
    .bind(&project_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "continuity_read_failed",
            "Workspace layout state could not be loaded.",
            operation_id,
        )
    })?;
    let layout = if let Some(row) = layout_row {
        let tabs_json: String = row
            .try_get("open_tabs_json")
            .unwrap_or_else(|_| "[]".into());
        let open_tabs: Vec<String> = serde_json::from_str(&tabs_json).unwrap_or_default();
        Some(WorkspaceLayoutState {
            open_tabs,
            active_tab: row.try_get("active_tab").ok().flatten(),
            split_tab: row.try_get("split_tab").ok().flatten(),
            bottom_tab: row
                .try_get("bottom_tab")
                .unwrap_or_else(|_| "terminal".to_owned()),
            active_page: row
                .try_get("active_page")
                .unwrap_or_else(|_| "editor".to_owned()),
            updated_at: row.try_get("updated_at").unwrap_or(0),
        })
    } else {
        None
    };

    let draft_rows = sqlx::query(
        "SELECT relative_path, saved_digest, draft_content, updated_at FROM editor_drafts WHERE project_id = ? ORDER BY updated_at DESC LIMIT 64",
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "continuity_read_failed",
            "Saved editor drafts could not be loaded.",
            operation_id,
        )
    })?;

    let mut drafts = Vec::new();
    for row in draft_rows {
        let relative_path: String = row.try_get("relative_path").unwrap_or_default();
        let saved_digest: String = row.try_get("saved_digest").unwrap_or_default();
        let draft_content: String = row.try_get("draft_content").unwrap_or_default();
        let updated_at: i64 = row.try_get("updated_at").unwrap_or(0);
        if validate_safe_rel_path(&relative_path, operation_id).is_err() {
            continue;
        }
        let matches_disk = match read_project_file_contents(&project_id, &relative_path) {
            Ok(file) if file.kind == ProjectFileReadKind::Text => file
                .content
                .as_deref()
                .map(|content| sha256_hex(content.as_bytes()) == saved_digest)
                .unwrap_or(false),
            _ => false,
        };
        drafts.push(EditorDraftRecord {
            relative_path,
            saved_digest,
            draft_content,
            matches_disk,
            updated_at,
        });
    }

    Ok(WorkspaceContinuity { layout, drafts })
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn save_workspace_layout_with_pool(
    pool: &SqlitePool,
    root: &Path,
    open_tabs: &[String],
    active_tab: Option<&str>,
    split_tab: Option<&str>,
    bottom_tab: &str,
    active_page: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    let project_id = root.to_string_lossy().into_owned();
    let mut sanitized_tabs = Vec::new();
    for tab in open_tabs.iter().take(48) {
        if validate_safe_rel_path(tab, operation_id).is_ok() && !sanitized_tabs.contains(tab) {
            sanitized_tabs.push(tab.clone());
        }
    }
    let tabs_json = serde_json::to_string(&sanitized_tabs).map_err(|_| {
        terminal_error(
            "continuity_write_failed",
            "Workspace layout could not be serialized.",
            operation_id,
        )
    })?;
    let safe_bottom = match bottom_tab {
        "terminal" | "run" | "git" => bottom_tab,
        _ => "terminal",
    };
    let safe_page = match active_page {
        "home" | "editor" | "changes" | "verify" | "rook" | "settings" => active_page,
        _ => "editor",
    };
    let now = now_ms();
    sqlx::query(
        "INSERT INTO workspace_layout_state (project_id, open_tabs_json, active_tab, split_tab, bottom_tab, active_page, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET open_tabs_json = excluded.open_tabs_json, active_tab = excluded.active_tab, split_tab = excluded.split_tab, bottom_tab = excluded.bottom_tab, active_page = excluded.active_page, updated_at = excluded.updated_at",
    )
    .bind(&project_id)
    .bind(&tabs_json)
    .bind(active_tab.filter(|value| validate_safe_rel_path(value, operation_id).is_ok()))
    .bind(split_tab.filter(|value| validate_safe_rel_path(value, operation_id).is_ok()))
    .bind(safe_bottom)
    .bind(safe_page)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "continuity_write_failed",
            "Workspace layout could not be saved.",
            operation_id,
        )
    })?;
    Ok(())
}

pub(crate) async fn save_editor_draft_with_pool(
    pool: &SqlitePool,
    root: &Path,
    relative_path: &str,
    saved_content: &str,
    draft_content: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    validate_safe_rel_path(relative_path, operation_id)?;
    if draft_content.len() as u64 > MAX_PROJECT_FILE_BYTES
        || saved_content.len() as u64 > MAX_PROJECT_FILE_BYTES
    {
        return Err(terminal_error(
            "draft_too_large",
            "Draft exceeds the 1 MiB crash-recovery limit.",
            operation_id,
        ));
    }
    let project_id = root.to_string_lossy().into_owned();
    let saved_digest = sha256_hex(saved_content.as_bytes());
    let now = now_ms();
    sqlx::query(
        "INSERT INTO editor_drafts (project_id, relative_path, saved_digest, draft_content, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, relative_path) DO UPDATE SET saved_digest = excluded.saved_digest, draft_content = excluded.draft_content, updated_at = excluded.updated_at",
    )
    .bind(&project_id)
    .bind(relative_path)
    .bind(&saved_digest)
    .bind(draft_content)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "draft_write_failed",
            "Unsaved draft could not be persisted.",
            operation_id,
        )
    })?;
    Ok(())
}

pub(crate) async fn delete_editor_draft_with_pool(
    pool: &SqlitePool,
    root: &Path,
    relative_path: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    validate_safe_rel_path(relative_path, operation_id)?;
    let project_id = root.to_string_lossy().into_owned();
    sqlx::query("DELETE FROM editor_drafts WHERE project_id = ? AND relative_path = ?")
        .bind(&project_id)
        .bind(relative_path)
        .execute(pool)
        .await
        .map_err(|_| {
            terminal_error(
                "draft_delete_failed",
                "Unsaved draft could not be cleared.",
                operation_id,
            )
        })?;
    Ok(())
}

pub(crate) async fn prune_project_executions_with_pool(
    pool: &SqlitePool,
    project_id: &str,
    keep_latest: i64,
    operation_id: &str,
) -> Result<u64, IpcError> {
    let keep = keep_latest.clamp(10, 500);
    let result = sqlx::query(
        "DELETE FROM executions WHERE project_id = ? AND id NOT IN (SELECT id FROM executions WHERE project_id = ? ORDER BY started_at DESC LIMIT ?)",
    )
    .bind(project_id)
    .bind(project_id)
    .bind(keep)
    .execute(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "prune_executions_failed",
            "Older verification records could not be pruned.",
            operation_id,
        )
    })?;
    Ok(result.rows_affected())
}

#[tauri::command]
pub(crate) async fn load_workspace_continuity(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: GitRequest,
) -> Result<WorkspaceContinuity, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_continuity_request",
            "The continuity request is invalid.",
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
    load_workspace_continuity_with_pool(&pool, &root, &request.operation_id).await
}

#[tauri::command]
pub(crate) async fn save_workspace_layout(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: SaveWorkspaceLayoutRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_continuity_request",
            "The layout save request is invalid.",
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
    save_workspace_layout_with_pool(
        &pool,
        &root,
        &request.open_tabs,
        request.active_tab.as_deref(),
        request.split_tab.as_deref(),
        &request.bottom_tab,
        &request.active_page,
        &request.operation_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn save_editor_draft(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: SaveEditorDraftRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_continuity_request",
            "The draft save request is invalid.",
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
    save_editor_draft_with_pool(
        &pool,
        &root,
        &request.relative_path,
        &request.saved_content,
        &request.draft_content,
        &request.operation_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn delete_editor_draft(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: DeleteEditorDraftRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_continuity_request",
            "The draft delete request is invalid.",
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
    delete_editor_draft_with_pool(&pool, &root, &request.relative_path, &request.operation_id).await
}

#[tauri::command]
pub(crate) async fn prune_project_executions(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: PruneExecutionsRequest,
) -> Result<u64, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_prune_request",
            "The execution cleanup request is invalid.",
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
    prune_project_executions_with_pool(
        &pool,
        &root.to_string_lossy(),
        request.keep_latest.unwrap_or(100),
        &request.operation_id,
    )
    .await
}

#[cfg(test)]
mod workspace_state_tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    async fn test_pool(dir: &Path) -> SqlitePool {
        let db_path = dir.join("laplace.db");
        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[test]
    fn list_project_files_skips_ignored_dirs_and_returns_sorted_paths() {
        let root = std::env::temp_dir().join(format!("laplace-files-{}", now_ms()));
        fs::create_dir_all(root.join("src/utils")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join(".git/objects")).unwrap();
        fs::write(root.join("src/main.ts"), "export const x = 1;\n").unwrap();
        fs::write(root.join("src/utils/a.ts"), "export const a = 1;\n").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "ignored").unwrap();
        fs::write(root.join(".git/objects/abc"), "ignored").unwrap();

        let files = list_project_files_at(&root, "op-files").unwrap();
        assert_eq!(files, vec!["src/main.ts", "src/utils/a.ts"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn continuity_saves_restores_layout_drafts_and_detects_disk_drift() {
        let root = std::env::temp_dir().join(format!("laplace-cont-{}", now_ms()));
        let db_dir = root.join(".db");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(&db_dir).unwrap();
        fs::write(root.join("src/app.ts"), "const v = 1;\n").unwrap();
        let canonical = fs::canonicalize(&root).unwrap();
        let pool = test_pool(&db_dir).await;

        save_workspace_layout_with_pool(
            &pool,
            &canonical,
            &["src/app.ts".to_owned(), "../escape.ts".to_owned()],
            Some("src/app.ts"),
            None,
            "run",
            "editor",
            "op-layout",
        )
        .await
        .unwrap();
        save_editor_draft_with_pool(
            &pool,
            &canonical,
            "src/app.ts",
            "const v = 1;\n",
            "const v = 2;\n",
            "op-draft",
        )
        .await
        .unwrap();

        let loaded = load_workspace_continuity_with_pool(&pool, &canonical, "op-load")
            .await
            .unwrap();
        let layout = loaded.layout.expect("layout restored");
        assert_eq!(layout.open_tabs, vec!["src/app.ts"]);
        assert_eq!(layout.bottom_tab, "run");
        assert_eq!(loaded.drafts.len(), 1);
        assert!(loaded.drafts[0].matches_disk);
        assert_eq!(loaded.drafts[0].draft_content, "const v = 2;\n");

        // External disk modification flips matches_disk to false
        fs::write(canonical.join("src/app.ts"), "const v = 99;\n").unwrap();
        let after_drift = load_workspace_continuity_with_pool(&pool, &canonical, "op-load-2")
            .await
            .unwrap();
        assert!(!after_drift.drafts[0].matches_disk);

        delete_editor_draft_with_pool(&pool, &canonical, "src/app.ts", "op-del")
            .await
            .unwrap();
        let after_delete = load_workspace_continuity_with_pool(&pool, &canonical, "op-load-3")
            .await
            .unwrap();
        assert!(after_delete.drafts.is_empty());

        let _ = fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn prune_project_executions_keeps_newest_records() {
        let root = std::env::temp_dir().join(format!("laplace-prune-{}", now_ms()));
        fs::create_dir_all(&root).unwrap();
        let pool = test_pool(&root).await;
        let project = root.to_string_lossy().into_owned();
        for idx in 0..15_i64 {
            sqlx::query(
                "INSERT INTO executions (id, project_id, change_id, command_json, source_digest, status, exit_code, output, started_at, finished_at) VALUES (?, ?, NULL, '[\"echo\",[]]', 'd', 'passed', 0, '', ?, ?)",
            )
            .bind(format!("exec-{idx}"))
            .bind(&project)
            .bind(1_000 + idx)
            .bind(1_001 + idx)
            .execute(&pool)
            .await
            .unwrap();
        }
        let removed = prune_project_executions_with_pool(&pool, &project, 10, "op-prune")
            .await
            .unwrap();
        assert_eq!(removed, 5);
        let remaining: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM executions WHERE project_id = ?")
                .bind(&project)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(remaining, 10);
        let _ = fs::remove_dir_all(&root);
    }
}
