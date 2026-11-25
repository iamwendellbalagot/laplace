use super::*;

pub(crate) static RECENT_PROJECTS_LOCK: Mutex<()> = Mutex::new(());
pub(crate) const MAX_RECENT_PROJECTS: usize = 12;
pub(crate) const MAX_DIRECTORY_ENTRIES: usize = 1_000;
pub(crate) const MAX_PROJECT_FILE_BYTES: u64 = 1_048_576;
pub(crate) const IGNORED_DIRECTORY_NAMES: &[&str] =
    &[".git", ".rook", "node_modules", "target", "dist"];

pub(crate) fn recent_projects_path(app: &tauri::AppHandle) -> Result<PathBuf, IpcError> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("recent-projects.json"))
        .map_err(|_| {
            IpcError::new(
                "projects_path_unavailable",
                "Laplace could not locate its project history directory.",
                String::new(),
                true,
            )
        })
}

pub(crate) fn read_recent_projects(path: &Path) -> Result<Vec<ProjectSummary>, IpcError> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            IpcError::new(
                "project_history_invalid",
                "Laplace project history could not be read. Existing data was left unchanged.",
                String::new(),
                false,
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err(IpcError::new(
            "project_history_read_failed",
            "Laplace project history could not be read.",
            String::new(),
            true,
        )),
    }
}

pub(crate) fn write_recent_projects(
    path: &Path,
    projects: &[ProjectSummary],
) -> Result<(), IpcError> {
    let _guard = RECENT_PROJECTS_LOCK.lock().map_err(|_| {
        IpcError::new(
            "project_history_busy",
            "Laplace project history is temporarily unavailable.",
            String::new(),
            true,
        )
    })?;
    let parent = path.parent().ok_or_else(|| {
        IpcError::new(
            "projects_path_invalid",
            "Laplace project history could not be saved.",
            String::new(),
            false,
        )
    })?;
    fs::create_dir_all(parent).map_err(|_| {
        IpcError::new(
            "project_history_write_failed",
            "Laplace project history could not be saved.",
            String::new(),
            true,
        )
    })?;
    let temporary_path = parent.join(".recent-projects.tmp");
    let bytes = serde_json::to_vec_pretty(projects).map_err(|_| {
        IpcError::new(
            "project_history_encode_failed",
            "Laplace project history could not be saved.",
            String::new(),
            false,
        )
    })?;
    fs::write(&temporary_path, bytes).map_err(|_| {
        IpcError::new(
            "project_history_write_failed",
            "Laplace project history could not be saved.",
            String::new(),
            true,
        )
    })?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|_| {
            IpcError::new(
                "project_history_replace_failed",
                "Laplace project history could not be replaced.",
                String::new(),
                true,
            )
        })?;
    }
    if fs::rename(&temporary_path, path).is_err() {
        let _ = fs::remove_file(&temporary_path);
        return Err(IpcError::new(
            "project_history_replace_failed",
            "Laplace project history could not be saved.",
            String::new(),
            true,
        ));
    }
    Ok(())
}

pub(crate) fn path_text(path: &Path) -> Result<String, IpcError> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        IpcError::new(
            "path_encoding_unsupported",
            "This project path cannot be represented as Unicode on this platform.",
            String::new(),
            false,
        )
    })
}

pub(crate) fn detect_git_root(directory: &Path) -> PathBuf {
    let mut current = Some(directory);
    while let Some(path) = current {
        if path.join(".git").exists() {
            return path.to_path_buf();
        }
        current = path.parent();
    }
    directory.to_path_buf()
}

pub(crate) fn project_summary(
    path: &Path,
    last_opened_unix_ms: u64,
) -> Result<ProjectSummary, IpcError> {
    let canonical = fs::canonicalize(path).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The selected project folder is no longer available.",
            String::new(),
            true,
        )
    })?;
    if !canonical.is_dir() {
        return Err(IpcError::new(
            "project_not_directory",
            "Select a folder to open as a project.",
            String::new(),
            false,
        ));
    }
    let root = detect_git_root(&canonical);
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Project")
        .to_owned();
    let path = path_text(&root)?;
    Ok(ProjectSummary {
        id: path.clone(),
        name,
        path,
        is_git_repository: root.join(".git").exists(),
        last_opened_unix_ms,
    })
}

pub(crate) fn open_project_path(
    path: &Path,
    recent_projects: &mut Vec<ProjectSummary>,
) -> Result<ProjectSummary, IpcError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0);
    let project = project_summary(path, now)?;
    recent_projects.retain(|recent| recent.id != project.id);
    recent_projects.insert(0, project.clone());
    recent_projects.truncate(MAX_RECENT_PROJECTS);
    Ok(project)
}

pub(crate) fn resolve_project_directory(
    project_id: &str,
    relative_path: &str,
) -> Result<PathBuf, IpcError> {
    let root = fs::canonicalize(project_id).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The project folder is no longer available. Reopen it from the folder picker.",
            String::new(),
            true,
        )
    })?;
    if !root.is_dir() {
        return Err(IpcError::new(
            "project_not_directory",
            "The project location is not a folder.",
            String::new(),
            false,
        ));
    }
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(IpcError::new(
            "invalid_relative_path",
            "The requested folder must stay inside the open project.",
            String::new(),
            false,
        ));
    }
    let candidate = root.join(relative);
    let directory = fs::canonicalize(&candidate).map_err(|_| {
        IpcError::new(
            "project_path_unavailable",
            "That folder is no longer available inside the project.",
            String::new(),
            true,
        )
    })?;
    if !directory.starts_with(&root) {
        return Err(IpcError::new(
            "project_path_escape",
            "The requested folder resolves outside the open project.",
            String::new(),
            false,
        ));
    }
    if !directory.is_dir() {
        return Err(IpcError::new(
            "project_path_not_directory",
            "The requested project entry is not a folder.",
            String::new(),
            false,
        ));
    }
    Ok(directory)
}

pub(crate) fn read_project_entries(
    project_id: &str,
    relative_path: &str,
) -> Result<(Vec<ProjectEntry>, bool), IpcError> {
    let directory = resolve_project_directory(project_id, relative_path)?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in fs::read_dir(directory).map_err(|_| {
        IpcError::new(
            "project_directory_read_failed",
            "This project folder could not be read.",
            String::new(),
            true,
        )
    })? {
        if entries.len() == MAX_DIRECTORY_ENTRIES {
            truncated = true;
            break;
        }
        let entry = entry.map_err(|_| {
            IpcError::new(
                "project_entry_read_failed",
                "A project entry could not be read.",
                String::new(),
                true,
            )
        })?;
        let name = match entry.file_name().to_str() {
            Some(name) => name.to_owned(),
            None => continue,
        };
        if IGNORED_DIRECTORY_NAMES.contains(&name.as_str()) {
            continue;
        }
        let file_type = entry.file_type().map_err(|_| {
            IpcError::new(
                "project_entry_type_failed",
                "A project entry type could not be determined.",
                String::new(),
                true,
            )
        })?;
        let kind = if file_type.is_symlink() {
            ProjectEntryKind::Symlink
        } else if file_type.is_dir() {
            ProjectEntryKind::Directory
        } else {
            ProjectEntryKind::File
        };
        let entry_path = Path::new(relative_path).join(&name);
        entries.push(ProjectEntry {
            name,
            relative_path: path_text(&entry_path)?,
            kind,
        });
    }
    entries.sort_by(|left, right| {
        let left_directory = left.kind == ProjectEntryKind::Directory;
        let right_directory = right.kind == ProjectEntryKind::Directory;
        right_directory
            .cmp(&left_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok((entries, truncated))
}

pub(crate) fn read_project_file_contents(
    project_id: &str,
    relative_path: &str,
) -> Result<ProjectFileRead, IpcError> {
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(IpcError::new(
            "invalid_relative_path",
            "Select a file inside the open project.",
            String::new(),
            false,
        ));
    }
    let root = fs::canonicalize(project_id).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The project folder is no longer available. Reopen it from the folder picker.",
            String::new(),
            true,
        )
    })?;
    let mut path = root.clone();
    for component in relative.components() {
        if let Component::Normal(name) = component {
            path.push(name);
            let link_metadata = fs::symlink_metadata(&path).map_err(|_| {
                IpcError::new(
                    "project_file_unavailable",
                    "That file is no longer available inside the project.",
                    String::new(),
                    true,
                )
            })?;
            if link_metadata.file_type().is_symlink() {
                return Err(IpcError::new(
                    "project_file_symlink",
                    "Symbolic links are not followed by the project preview.",
                    String::new(),
                    false,
                ));
            }
        }
    }
    let canonical = fs::canonicalize(&path).map_err(|_| {
        IpcError::new(
            "project_file_unavailable",
            "That file is no longer available inside the project.",
            String::new(),
            true,
        )
    })?;
    if !canonical.starts_with(&root) {
        return Err(IpcError::new(
            "project_path_escape",
            "The requested file resolves outside the open project.",
            String::new(),
            false,
        ));
    }
    let metadata = fs::metadata(&canonical).map_err(|_| {
        IpcError::new(
            "project_file_read_failed",
            "This project file could not be inspected.",
            String::new(),
            true,
        )
    })?;
    if !metadata.is_file() {
        return Err(IpcError::new(
            "project_entry_not_file",
            "Select a regular file to preview.",
            String::new(),
            false,
        ));
    }
    if metadata.len() > MAX_PROJECT_FILE_BYTES {
        return Ok(ProjectFileRead {
            kind: ProjectFileReadKind::TooLarge,
            size_bytes: metadata.len(),
            content: None,
        });
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    let mut file = fs::File::open(canonical).map_err(|_| {
        IpcError::new(
            "project_file_read_failed",
            "This project file could not be read.",
            String::new(),
            true,
        )
    })?;
    Read::by_ref(&mut file)
        .take(MAX_PROJECT_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            IpcError::new(
                "project_file_read_failed",
                "This project file could not be read.",
                String::new(),
                true,
            )
        })?;
    if bytes.len() as u64 > MAX_PROJECT_FILE_BYTES {
        return Ok(ProjectFileRead {
            kind: ProjectFileReadKind::TooLarge,
            size_bytes: bytes.len() as u64,
            content: None,
        });
    }
    if bytes.contains(&0) {
        return Ok(ProjectFileRead {
            kind: ProjectFileReadKind::Binary,
            size_bytes: bytes.len() as u64,
            content: None,
        });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(ProjectFileRead {
            kind: ProjectFileReadKind::Text,
            size_bytes: content.len() as u64,
            content: Some(content),
        }),
        Err(error) => Ok(ProjectFileRead {
            kind: ProjectFileReadKind::Binary,
            size_bytes: error.as_bytes().len() as u64,
            content: None,
        }),
    }
}

pub(crate) fn map_file_write_error(error: &std::io::Error, operation_id: &str) -> IpcError {
    if error.kind() == std::io::ErrorKind::NotFound {
        return IpcError::new(
            "file_not_found",
            "The target file or directory no longer exists. Original file was not modified.",
            operation_id.to_owned(),
            false,
        );
    }
    #[cfg(unix)]
    let is_disk_full = error.raw_os_error() == Some(28);
    #[cfg(windows)]
    let is_disk_full = error.raw_os_error() == Some(112);
    #[cfg(not(any(unix, windows)))]
    let is_disk_full = false;
    if is_disk_full {
        return IpcError::new(
            "disk_full",
            "Disk is full. Save was aborted safely without truncating the existing file.",
            operation_id.to_owned(),
            false,
        );
    }
    IpcError::new(
        "project_file_write_failed",
        "This project file could not be saved.",
        operation_id.to_owned(),
        true,
    )
}

pub(crate) fn save_project_file_contents(
    project_id: &str,
    relative_path: &str,
    expected_content: &str,
    content: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    if content.len() as u64 > MAX_PROJECT_FILE_BYTES {
        return Err(IpcError::new(
            "project_file_too_large",
            "Files larger than 1 MiB cannot be edited in Laplace yet.",
            operation_id.to_owned(),
            false,
        ));
    }
    let current = read_project_file_contents(project_id, relative_path)?;
    if current.kind != ProjectFileReadKind::Text {
        return Err(IpcError::new(
            "project_file_not_editable",
            "Only small UTF-8 text files can be edited in Laplace.",
            operation_id.to_owned(),
            false,
        ));
    }
    if current.content.as_deref() != Some(expected_content) {
        return Err(IpcError::new(
            "project_file_conflict",
            "This file changed on disk since it was opened. Copy or reload your edits before saving.",
            operation_id.to_owned(),
            false,
        ));
    }

    let root = fs::canonicalize(project_id).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The project folder is no longer available. Reopen it from the folder picker.",
            operation_id.to_owned(),
            true,
        )
    })?;
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(IpcError::new(
            "invalid_relative_path",
            "Select a file inside the open project.",
            operation_id.to_owned(),
            false,
        ));
    }
    let joined_path = root.join(relative);
    let parent = joined_path.parent().ok_or_else(|| {
        IpcError::new(
            "invalid_relative_path",
            "Select a file inside the open project.",
            operation_id.to_owned(),
            false,
        )
    })?;
    let canonical_parent = fs::canonicalize(parent).map_err(|_| {
        IpcError::new(
            "project_file_unavailable",
            "That file is no longer available inside the project.",
            operation_id.to_owned(),
            true,
        )
    })?;
    if !canonical_parent.starts_with(&root) {
        return Err(IpcError::new(
            "project_path_escape",
            "The requested file resolves outside the open project.",
            operation_id.to_owned(),
            false,
        ));
    }
    let filename = relative.file_name().ok_or_else(|| {
        IpcError::new(
            "invalid_relative_path",
            "Select a file inside the open project.",
            operation_id.to_owned(),
            false,
        )
    })?;
    let path = canonical_parent.join(filename);
    if fs::symlink_metadata(&path)
        .map_err(|_| {
            IpcError::new(
                "project_file_unavailable",
                "That file is no longer available inside the project.",
                operation_id.to_owned(),
                true,
            )
        })?
        .file_type()
        .is_symlink()
    {
        return Err(IpcError::new(
            "project_file_symlink",
            "Symbolic links are not followed by the project editor.",
            operation_id.to_owned(),
            false,
        ));
    }
    let permissions = fs::metadata(&path)
        .map_err(|_| {
            IpcError::new(
                "project_file_read_failed",
                "This project file could not be inspected.",
                operation_id.to_owned(),
                true,
            )
        })?
        .permissions();
    let temporary = canonical_parent.join(format!(".laplace-save-{operation_id}.tmp"));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| map_file_write_error(&error, operation_id))?;
    if let Err(error) = file.write_all(content.as_bytes()) {
        let _ = fs::remove_file(&temporary);
        return Err(map_file_write_error(&error, operation_id));
    }
    if let Err(error) = fs::set_permissions(&temporary, permissions) {
        let _ = fs::remove_file(&temporary);
        return Err(map_file_write_error(&error, operation_id));
    }
    drop(file);
    let current = match read_project_file_contents(project_id, relative_path) {
        Ok(current) => current,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
    };
    if current.content.as_deref() != Some(expected_content) {
        let _ = fs::remove_file(&temporary);
        return Err(IpcError::new(
            "project_file_conflict",
            "This file changed on disk since it was opened. Copy or reload your edits before saving.",
            operation_id.to_owned(),
            false,
        ));
    }
    #[cfg(windows)]
    if path.exists() {
        let backup = canonical_parent.join(format!(".laplace-backup-{operation_id}.tmp"));
        fs::rename(&path, &backup).map_err(|_| {
            let _ = fs::remove_file(&temporary);
            IpcError::new(
                "project_file_write_failed",
                "This project file could not be saved.",
                operation_id.to_owned(),
                true,
            )
        })?;
        if fs::rename(&temporary, &path).is_err() {
            let _ = fs::rename(&backup, &path);
            let _ = fs::remove_file(&temporary);
            return Err(IpcError::new(
                "project_file_write_failed",
                "This project file could not be saved.",
                operation_id.to_owned(),
                true,
            ));
        }
        let _ = fs::remove_file(backup);
        return Ok(());
    }
    if fs::rename(&temporary, &path).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(IpcError::new(
            "project_file_write_failed",
            "This project file could not be saved.",
            operation_id.to_owned(),
            true,
        ));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_project(
    app: tauri::AppHandle,
    watchers: tauri::State<'_, watcher::WorkspaceWatchers>,
    request: OpenProjectRequest,
) -> Result<OpenProjectResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The project request is invalid or uses an unsupported schema.",
            request.operation_id,
            false,
        ));
    }
    let history_path = recent_projects_path(&app)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    let mut projects = read_recent_projects(&history_path)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    let project = open_project_path(Path::new(&request.path), &mut projects)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    write_recent_projects(&history_path, &projects)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    let _ = watcher::start_watcher_for_root(&app, &watchers, Path::new(&project.path));
    Ok(OpenProjectResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        project,
    })
}

#[tauri::command]
pub(crate) async fn get_recent_projects(
    app: tauri::AppHandle,
    request: ProjectsRequest,
) -> Result<RecentProjectsResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The project request is invalid or uses an unsupported schema.",
            request.operation_id,
            false,
        ));
    }
    let path = recent_projects_path(&app)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    let projects = read_recent_projects(&path)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    Ok(RecentProjectsResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        projects,
    })
}

#[tauri::command]
pub(crate) async fn list_project_entries(
    request: ListProjectEntriesRequest,
) -> Result<ProjectEntriesResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The project request is invalid or uses an unsupported schema.",
            request.operation_id,
            false,
        ));
    }
    let (entries, truncated) = read_project_entries(&request.project_id, &request.relative_path)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    Ok(ProjectEntriesResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        entries,
        truncated,
    })
}

#[tauri::command]
pub(crate) async fn read_project_file(
    request: ReadProjectFileRequest,
) -> Result<ReadProjectFileResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The project request is invalid or uses an unsupported schema.",
            request.operation_id,
            false,
        ));
    }
    let file = read_project_file_contents(&request.project_id, &request.relative_path)
        .map_err(|error| preferences_error_with_operation(error, &request.operation_id))?;
    Ok(ReadProjectFileResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        file,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectEntryRequest {
    pub schema_version: u16,
    pub operation_id: String,
    pub project_id: String,
    pub relative_path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectEntryResponse {
    pub schema_version: u16,
    pub operation_id: String,
    pub entry: ProjectEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenameProjectEntryRequest {
    pub schema_version: u16,
    pub operation_id: String,
    pub project_id: String,
    pub from_relative_path: String,
    pub to_relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectEntryRequest {
    pub schema_version: u16,
    pub operation_id: String,
    pub project_id: String,
    pub relative_path: String,
    pub recursive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectEntryResponse {
    pub schema_version: u16,
    pub operation_id: String,
    pub deleted: bool,
}

fn ensure_no_active_build(
    processes: &RookProcesses,
    project_id: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    if let Ok(canonical) = fs::canonicalize(project_id) {
        if processes.has_active_build(&canonical) {
            return Err(IpcError::new(
                "build_run_active",
                "Stop Rook Build before modifying files in this workspace.",
                operation_id.to_owned(),
                true,
            ));
        }
    }
    Ok(())
}

fn validate_safe_relative_path<'a>(
    relative_path: &'a str,
    operation_id: &str,
) -> Result<&'a Path, IpcError> {
    let relative = Path::new(relative_path.trim());
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(IpcError::new(
            "invalid_relative_path",
            "Use a relative path inside the open project.",
            operation_id.to_owned(),
            false,
        ));
    }
    if relative
        .components()
        .next()
        .and_then(|c| c.as_os_str().to_str())
        == Some(".git")
    {
        return Err(IpcError::new(
            "protected_git_path",
            "Git internal files cannot be modified from the explorer.",
            operation_id.to_owned(),
            false,
        ));
    }
    Ok(relative)
}

fn verify_ancestors_without_symlinks(
    root: &Path,
    relative: &Path,
    operation_id: &str,
) -> Result<(), IpcError> {
    let mut cursor = root.to_path_buf();
    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        let Component::Normal(part) = component else {
            continue;
        };
        cursor.push(part);
        if let Ok(meta) = fs::symlink_metadata(&cursor) {
            if meta.file_type().is_symlink() {
                return Err(IpcError::new(
                    "project_file_symlink",
                    "Symbolic links cannot be traversed or modified by the explorer.",
                    operation_id.to_owned(),
                    false,
                ));
            }
            if components.peek().is_some() && !meta.is_dir() {
                return Err(IpcError::new(
                    "invalid_parent_path",
                    "Parent path already exists and is not a folder.",
                    operation_id.to_owned(),
                    false,
                ));
            }
        }
    }
    Ok(())
}

pub(crate) fn create_project_entry_at(
    project_id: &str,
    relative_path: &str,
    kind: &str,
    operation_id: &str,
) -> Result<ProjectEntry, IpcError> {
    if kind != "file" && kind != "directory" {
        return Err(IpcError::new(
            "invalid_entry_kind",
            "Entry kind must be 'file' or 'directory'.",
            operation_id.to_owned(),
            false,
        ));
    }
    let root = fs::canonicalize(project_id).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The project folder is no longer available.",
            operation_id.to_owned(),
            true,
        )
    })?;
    let relative = validate_safe_relative_path(relative_path, operation_id)?;
    verify_ancestors_without_symlinks(&root, relative, operation_id)?;
    let target = root.join(relative);
    if fs::symlink_metadata(&target).is_ok() {
        return Err(IpcError::new(
            "entry_already_exists",
            "A file or folder already exists at that path.",
            operation_id.to_owned(),
            false,
        ));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| map_file_write_error(&error, operation_id))?;
        let canonical_parent =
            fs::canonicalize(parent).map_err(|error| map_file_write_error(&error, operation_id))?;
        if !canonical_parent.starts_with(&root) {
            return Err(IpcError::new(
                "project_path_escape",
                "The target resolves outside the open project.",
                operation_id.to_owned(),
                false,
            ));
        }
    }
    if kind == "directory" {
        fs::create_dir(&target).map_err(|error| map_file_write_error(&error, operation_id))?;
    } else {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| map_file_write_error(&error, operation_id))?;
    }
    let name = relative
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(relative_path)
        .to_owned();
    let normalized = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    Ok(ProjectEntry {
        name,
        relative_path: normalized,
        kind: if kind == "directory" {
            ProjectEntryKind::Directory
        } else {
            ProjectEntryKind::File
        },
    })
}

pub(crate) fn rename_project_entry_at(
    project_id: &str,
    from_relative_path: &str,
    to_relative_path: &str,
    operation_id: &str,
) -> Result<ProjectEntry, IpcError> {
    let root = fs::canonicalize(project_id).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The project folder is no longer available.",
            operation_id.to_owned(),
            true,
        )
    })?;
    let from_rel = validate_safe_relative_path(from_relative_path, operation_id)?;
    let to_rel = validate_safe_relative_path(to_relative_path, operation_id)?;
    verify_ancestors_without_symlinks(&root, from_rel, operation_id)?;
    verify_ancestors_without_symlinks(&root, to_rel, operation_id)?;
    let from_target = root.join(from_rel);
    let from_meta = fs::symlink_metadata(&from_target)
        .map_err(|error| map_file_write_error(&error, operation_id))?;
    if from_meta.file_type().is_symlink() {
        return Err(IpcError::new(
            "project_file_symlink",
            "Symbolic links cannot be renamed from the explorer.",
            operation_id.to_owned(),
            false,
        ));
    }
    let to_target = root.join(to_rel);
    if fs::symlink_metadata(&to_target).is_ok() {
        return Err(IpcError::new(
            "entry_already_exists",
            "A file or folder already exists at the destination path.",
            operation_id.to_owned(),
            false,
        ));
    }
    if let Some(parent) = to_target.parent() {
        fs::create_dir_all(parent).map_err(|error| map_file_write_error(&error, operation_id))?;
        let canonical_parent =
            fs::canonicalize(parent).map_err(|error| map_file_write_error(&error, operation_id))?;
        if !canonical_parent.starts_with(&root) {
            return Err(IpcError::new(
                "project_path_escape",
                "The destination resolves outside the open project.",
                operation_id.to_owned(),
                false,
            ));
        }
    }
    fs::rename(&from_target, &to_target)
        .map_err(|error| map_file_write_error(&error, operation_id))?;
    let name = to_rel
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(to_relative_path)
        .to_owned();
    let normalized = to_rel
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    Ok(ProjectEntry {
        name,
        relative_path: normalized,
        kind: if from_meta.is_dir() {
            ProjectEntryKind::Directory
        } else {
            ProjectEntryKind::File
        },
    })
}

pub(crate) fn delete_project_entry_at(
    project_id: &str,
    relative_path: &str,
    recursive: bool,
    operation_id: &str,
) -> Result<(), IpcError> {
    let root = fs::canonicalize(project_id).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The project folder is no longer available.",
            operation_id.to_owned(),
            true,
        )
    })?;
    let rel = validate_safe_relative_path(relative_path, operation_id)?;
    verify_ancestors_without_symlinks(&root, rel, operation_id)?;
    let target = root.join(rel);
    let meta = fs::symlink_metadata(&target)
        .map_err(|error| map_file_write_error(&error, operation_id))?;
    if meta.file_type().is_symlink() {
        return Err(IpcError::new(
            "project_file_symlink",
            "Symbolic links cannot be deleted from the explorer.",
            operation_id.to_owned(),
            false,
        ));
    }
    if meta.is_dir() {
        if recursive {
            fs::remove_dir_all(&target)
                .map_err(|error| map_file_write_error(&error, operation_id))?;
        } else {
            fs::remove_dir(&target).map_err(|error| map_file_write_error(&error, operation_id))?;
        }
    } else {
        fs::remove_file(&target).map_err(|error| map_file_write_error(&error, operation_id))?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn save_project_file(
    processes: tauri::State<'_, RookProcesses>,
    request: SaveProjectFileRequest,
) -> Result<SaveProjectFileResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The project request is invalid or uses an unsupported schema.",
            request.operation_id,
            false,
        ));
    }
    ensure_no_active_build(&processes, &request.project_id, &request.operation_id)?;
    save_project_file_contents(
        &request.project_id,
        &request.relative_path,
        &request.expected_content,
        &request.content,
        &request.operation_id,
    )?;
    Ok(SaveProjectFileResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        saved: true,
    })
}

#[tauri::command]
pub(crate) async fn create_project_entry(
    processes: tauri::State<'_, RookProcesses>,
    request: CreateProjectEntryRequest,
) -> Result<CreateProjectEntryResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The create entry request is invalid.",
            request.operation_id,
            false,
        ));
    }
    ensure_no_active_build(&processes, &request.project_id, &request.operation_id)?;
    let entry = create_project_entry_at(
        &request.project_id,
        &request.relative_path,
        &request.kind,
        &request.operation_id,
    )?;
    Ok(CreateProjectEntryResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        entry,
    })
}

#[tauri::command]
pub(crate) async fn rename_project_entry(
    processes: tauri::State<'_, RookProcesses>,
    request: RenameProjectEntryRequest,
) -> Result<CreateProjectEntryResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The rename request is invalid.",
            request.operation_id,
            false,
        ));
    }
    ensure_no_active_build(&processes, &request.project_id, &request.operation_id)?;
    let entry = rename_project_entry_at(
        &request.project_id,
        &request.from_relative_path,
        &request.to_relative_path,
        &request.operation_id,
    )?;
    Ok(CreateProjectEntryResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        entry,
    })
}

#[tauri::command]
pub(crate) async fn delete_project_entry(
    processes: tauri::State<'_, RookProcesses>,
    request: DeleteProjectEntryRequest,
) -> Result<DeleteProjectEntryResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_project_request",
            "The delete request is invalid.",
            request.operation_id,
            false,
        ));
    }
    ensure_no_active_build(&processes, &request.project_id, &request.operation_id)?;
    delete_project_entry_at(
        &request.project_id,
        &request.relative_path,
        request.recursive,
        &request.operation_id,
    )?;
    Ok(DeleteProjectEntryResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        deleted: true,
    })
}

#[cfg(test)]
mod fs_crud_tests {
    use super::*;

    #[test]
    fn creates_renames_and_deletes_entries_safely() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("laplace-fs-crud-{nanos}"));
        fs::create_dir_all(&root).unwrap();
        let root_str = root.to_str().unwrap();

        let dir_entry =
            create_project_entry_at(root_str, "src/utils", "directory", "op-1").unwrap();
        assert_eq!(dir_entry.kind, ProjectEntryKind::Directory);
        let file_entry =
            create_project_entry_at(root_str, "src/utils/helper.ts", "file", "op-2").unwrap();
        assert_eq!(file_entry.relative_path, "src/utils/helper.ts");

        // Duplicate rejection
        let dup = create_project_entry_at(root_str, "src/utils/helper.ts", "file", "op-3");
        assert!(dup.is_err());

        // Path escape and .git rejection
        assert!(create_project_entry_at(root_str, "../escape.ts", "file", "op-4").is_err());
        assert!(create_project_entry_at(root_str, ".git/config", "file", "op-5").is_err());

        // Rename cleanly
        let renamed =
            rename_project_entry_at(root_str, "src/utils/helper.ts", "src/utils/math.ts", "op-6")
                .unwrap();
        assert_eq!(renamed.relative_path, "src/utils/math.ts");
        assert!(root.join("src/utils/math.ts").is_file());

        // Recursive directory removal
        delete_project_entry_at(root_str, "src", true, "op-7").unwrap();
        assert!(!root.join("src").exists());

        let _ = fs::remove_dir_all(&root);
    }
}
