use super::*;
use std::collections::BTreeSet;
use std::sync::mpsc;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};

const WATCHER_EVENT_NAME: &str = "workspace:fs_changed";
const MAX_WATCHED_PATHS_PER_BATCH: usize = 64;
const WATCHER_DEBOUNCE_MS: u64 = 150;

#[derive(Default)]
pub(crate) struct WorkspaceWatchers(Mutex<Option<ActiveWatcher>>);

struct ActiveWatcher {
    project_id: String,
    shutdown: Arc<AtomicBool>,
    _watcher: RecommendedWatcher,
}

impl Drop for WorkspaceWatchers {
    fn drop(&mut self) {
        self.stop_all();
    }
}

impl WorkspaceWatchers {
    pub(crate) fn stop_all(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(active) = guard.take() {
                active.shutdown.store(true, Ordering::Release);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceFsChangedEvent {
    pub(crate) schema_version: u16,
    pub(crate) project_id: String,
    pub(crate) paths: Vec<String>,
    pub(crate) rescan_required: bool,
    pub(crate) timestamp_ms: i64,
}

pub(crate) fn should_ignore_watch_path(relative: &str) -> bool {
    if relative.is_empty() {
        return true;
    }
    let normalized = relative.replace('\\', "/");
    if normalized.contains(".laplace-save-") || normalized.contains(".laplace-backup-") {
        return true;
    }
    let segments: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    let Some(first) = segments.first().copied() else {
        return true;
    };
    if first == ".git" {
        let rest = segments.get(1).copied().unwrap_or("");
        return !matches!(
            rest,
            "HEAD" | "index" | "MERGE_HEAD" | "REBASE_HEAD" | "refs"
        );
    }
    if segments.iter().any(|segment| {
        matches!(
            *segment,
            ".rook"
                | "node_modules"
                | "target"
                | "dist"
                | "build"
                | ".next"
                | ".turbo"
                | ".cache"
                | ".venv"
                | "__pycache__"
                | ".DS_Store"
        )
    }) {
        return true;
    }
    normalized.ends_with(".swp") || normalized.ends_with(".tmp") || normalized.ends_with('~')
}

pub(crate) fn normalize_watched_paths(root: &Path, paths: &[PathBuf]) -> (Vec<String>, bool) {
    let mut unique = BTreeSet::new();
    let mut rescan_required = false;
    for path in paths {
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let rel_str = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        if should_ignore_watch_path(&rel_str) {
            continue;
        }
        if rel_str == ".git" || rel_str.starts_with(".git/") {
            rescan_required = true;
            continue;
        }
        unique.insert(rel_str);
        if unique.len() >= MAX_WATCHED_PATHS_PER_BATCH {
            rescan_required = true;
            break;
        }
    }
    (unique.into_iter().collect(), rescan_required)
}

pub(crate) fn start_watcher_for_root(
    app: &tauri::AppHandle,
    watchers: &WorkspaceWatchers,
    root: &Path,
) -> Result<(), IpcError> {
    let canonical = fs::canonicalize(root).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The project folder is no longer available.",
            "watcher",
        )
    })?;
    let project_id = canonical.to_string_lossy().into_owned();
    let mut guard = watchers.0.lock().map_err(|_| {
        terminal_error(
            "watcher_busy",
            "Workspace watcher is temporarily unavailable.",
            "watcher",
        )
    })?;
    if let Some(existing) = guard.as_ref() {
        if existing.project_id == project_id {
            return Ok(());
        }
    }
    if let Some(previous) = guard.take() {
        previous.shutdown.store(true, Ordering::Release);
    }

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .map_err(|_| {
        terminal_error(
            "watcher_start_failed",
            "Native filesystem watcher could not be started.",
            "watcher",
        )
    })?;
    watcher
        .watch(&canonical, RecursiveMode::Recursive)
        .map_err(|_| {
            terminal_error(
                "watcher_start_failed",
                "Native filesystem watcher could not watch this project.",
                "watcher",
            )
        })?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_thread = Arc::clone(&shutdown);
    let app_handle = app.clone();
    let watch_root = canonical.clone();
    let watch_project_id = project_id.clone();

    std::thread::spawn(move || {
        let mut pending_paths: BTreeSet<String> = BTreeSet::new();
        let mut pending_rescan = false;
        let timeout = Duration::from_millis(WATCHER_DEBOUNCE_MS);
        while !shutdown_thread.load(Ordering::Acquire) {
            match rx.recv_timeout(timeout) {
                Ok(Ok(event)) => {
                    let (paths, rescan) = normalize_watched_paths(&watch_root, &event.paths);
                    if rescan {
                        pending_rescan = true;
                    }
                    for path in paths {
                        if pending_paths.len() < MAX_WATCHED_PATHS_PER_BATCH {
                            pending_paths.insert(path);
                        } else {
                            pending_rescan = true;
                            break;
                        }
                    }
                }
                Ok(Err(_)) => {
                    pending_rescan = true;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if !pending_paths.is_empty() || pending_rescan {
                        let payload = WorkspaceFsChangedEvent {
                            schema_version: IPC_SCHEMA_VERSION,
                            project_id: watch_project_id.clone(),
                            paths: std::mem::take(&mut pending_paths).into_iter().collect(),
                            rescan_required: pending_rescan,
                            timestamp_ms: now_ms(),
                        };
                        pending_rescan = false;
                        let _ = app_handle.emit(WATCHER_EVENT_NAME, payload);
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    *guard = Some(ActiveWatcher {
        project_id,
        shutdown,
        _watcher: watcher,
    });
    Ok(())
}

#[tauri::command]
pub(crate) async fn start_workspace_watcher(
    app: tauri::AppHandle,
    watchers: tauri::State<'_, WorkspaceWatchers>,
    request: GitRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_watcher_request",
            "The workspace watcher request is invalid.",
            &request.operation_id,
        ));
    }
    start_watcher_for_root(&app, &watchers, Path::new(&request.project_id))
}

#[tauri::command]
pub(crate) async fn stop_workspace_watcher(
    watchers: tauri::State<'_, WorkspaceWatchers>,
    request: PreferencesRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_watcher_request",
            "The workspace watcher request is invalid.",
            &request.operation_id,
        ));
    }
    watchers.stop_all();
    Ok(())
}

#[cfg(test)]
mod watcher_tests {
    use super::*;

    #[test]
    fn ignores_noisy_directories_and_git_objects_but_keeps_refs() {
        assert!(should_ignore_watch_path("node_modules/react/index.js"));
        assert!(should_ignore_watch_path("src-tauri/target/debug/laplace"));
        assert!(should_ignore_watch_path(".git/objects/ab/1234"));
        assert!(should_ignore_watch_path("src/.laplace-save-1.tmp"));
        assert!(!should_ignore_watch_path(".git/HEAD"));
        assert!(!should_ignore_watch_path(".git/index"));
        assert!(!should_ignore_watch_path(".git/refs/heads/main"));
        assert!(!should_ignore_watch_path("src/App.tsx"));
    }

    #[test]
    fn batches_and_caps_paths_with_rescan_flag() {
        let root = PathBuf::from("/tmp/project");
        let mut input = Vec::new();
        for i in 0..80 {
            input.push(root.join(format!("src/file-{i:02}.ts")));
        }
        input.push(root.join("node_modules/ignored.js"));
        let (paths, rescan) = normalize_watched_paths(&root, &input);
        assert_eq!(paths.len(), MAX_WATCHED_PATHS_PER_BATCH);
        assert!(rescan);
        assert!(paths.iter().all(|p| !p.contains("node_modules")));
    }

    #[test]
    fn real_watcher_detects_git_ref_rescan_and_file_edits() {
        let root = std::env::temp_dir().join(format!(
            "laplace-watcher-test-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".git/refs/heads")).unwrap();
        let canonical = fs::canonicalize(&root).unwrap();
        let (paths, rescan) = normalize_watched_paths(
            &canonical,
            &[canonical.join(".git/HEAD"), canonical.join("src/index.ts")],
        );
        assert!(rescan);
        assert_eq!(paths, vec!["src/index.ts"]);

        let (tx, rx) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        })
        .unwrap();
        watcher.watch(&canonical, RecursiveMode::Recursive).unwrap();
        fs::write(canonical.join("hello.txt"), "world").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let mut saw_hello = false;
        while std::time::Instant::now() < deadline {
            if let Ok(Ok(event)) = rx.recv_timeout(Duration::from_millis(100)) {
                let (detected, _) = normalize_watched_paths(&canonical, &event.paths);
                if detected.iter().any(|p| p == "hello.txt") {
                    saw_hello = true;
                    break;
                }
            }
        }
        assert!(saw_hello);
        let _ = fs::remove_dir_all(&root);
    }
}
