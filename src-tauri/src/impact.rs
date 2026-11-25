use super::*;
use crate::checks_service::list_project_recipes_at;
use crate::context::{
    is_test_file, load_annotations_for_project, normalized_stem, resolve_import,
    update_workspace_index, ContextIndexState,
};
use crate::review::{
    canonical_git_root, get_workspace_review_with_pool, validate_safe_relative_path,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImpactedCaller {
    pub(crate) file_path: String,
    pub(crate) line: Option<usize>,
    pub(crate) provenance: String,
    pub(crate) evidence: String,
    pub(crate) also_changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImpactedTest {
    pub(crate) file_path: String,
    pub(crate) provenance: String,
    pub(crate) evidence: String,
    pub(crate) also_changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StaleContextNote {
    pub(crate) file_path: String,
    pub(crate) summary: String,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImpactFileAnalysis {
    pub(crate) path: String,
    pub(crate) role: String,
    pub(crate) summary: String,
    pub(crate) direct_callers: Vec<ImpactedCaller>,
    pub(crate) related_tests: Vec<ImpactedTest>,
    pub(crate) stale_note: Option<StaleContextNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImpactWarning {
    pub(crate) kind: String,
    pub(crate) severity: String,
    pub(crate) message: String,
    pub(crate) paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecommendedCheck {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) recipe_name: Option<String>,
    pub(crate) reason: String,
    pub(crate) latest_status: Option<String>,
    pub(crate) latest_execution_id: Option<String>,
    pub(crate) is_fresh: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceImpactReport {
    pub(crate) project_id: String,
    pub(crate) source_digest: String,
    pub(crate) changed_files_count: usize,
    pub(crate) files: Vec<ImpactFileAnalysis>,
    pub(crate) warnings: Vec<ImpactWarning>,
    pub(crate) recommended_checks: Vec<RecommendedCheck>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceImpactRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    #[serde(default)]
    changed_paths: Option<Vec<String>>,
}

pub(crate) fn classify_file_role(relative_path: &str) -> &'static str {
    let lower = relative_path.to_ascii_lowercase();
    if is_test_file(relative_path) || lower.ends_with("_tests.rs") {
        return "tests";
    }
    if lower.starts_with("src-tauri/")
        || lower.ends_with(".rs")
        || lower.ends_with(".sql")
        || lower.starts_with("server/")
        || lower.starts_with("backend/")
        || lower.starts_with("migrations/")
    {
        return "backend";
    }
    if lower.starts_with("src/state/")
        || lower.contains("/state/")
        || lower.ends_with("store.ts")
        || lower.ends_with("-store.ts")
    {
        return "state";
    }
    if lower.starts_with("src/services/")
        || lower.contains("/services/")
        || lower.contains("/api/")
        || lower.ends_with("contracts.ts")
        || lower.ends_with("service.ts")
    {
        return "api_service";
    }
    let name = Path::new(&lower)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    if name == "package.json"
        || name == "pnpm-lock.yaml"
        || name == "cargo.toml"
        || name == "cargo.lock"
        || name.starts_with("tsconfig")
        || name.starts_with(".env")
        || lower.starts_with(".laplace/")
        || lower.ends_with(".toml")
        || lower.ends_with(".json")
        || lower.ends_with(".md")
        || lower.ends_with(".yml")
        || lower.ends_with(".yaml")
    {
        return "config_docs";
    }
    "ui"
}

pub(crate) fn is_sensitive_config_path(relative_path: &str) -> bool {
    let lower = relative_path.to_ascii_lowercase();
    let name = Path::new(&lower)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    name == "package.json"
        || name == "cargo.toml"
        || name == "cargo.lock"
        || name == "pnpm-lock.yaml"
        || name.starts_with(".env")
        || lower.starts_with(".laplace/")
        || lower.contains("/migrations/")
        || lower.starts_with("migrations/")
}

#[derive(Debug, Clone)]
struct RecordedExecutionRow {
    id: String,
    program: String,
    args: Vec<String>,
    status: String,
    source_digest: String,
}

async fn load_recent_executions(pool: &SqlitePool, project_id: &str) -> Vec<RecordedExecutionRow> {
    let Ok(rows) = sqlx::query(
        "SELECT id, program, args_json, status, source_digest FROM executions WHERE project_id = ? ORDER BY COALESCE(finished_at, started_at) DESC LIMIT 80",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    else {
        return Vec::new();
    };
    rows.into_iter()
        .filter_map(|row| {
            let args_json: String = row.try_get("args_json").ok()?;
            let args: Vec<String> = serde_json::from_str(&args_json).ok()?;
            Some(RecordedExecutionRow {
                id: row.try_get("id").ok()?,
                program: row.try_get("program").ok()?,
                args,
                status: row.try_get("status").ok()?,
                source_digest: row.try_get("source_digest").ok()?,
            })
        })
        .collect()
}

fn match_latest_execution<'a>(
    executions: &'a [RecordedExecutionRow],
    program: &str,
    args: &[String],
) -> Option<&'a RecordedExecutionRow> {
    executions
        .iter()
        .find(|row| row.program == program && row.args == args)
}

fn build_recommended_checks(
    root: &Path,
    changed_paths: &[String],
    executions: &[RecordedExecutionRow],
    live_digest: &str,
    operation_id: &str,
) -> Vec<RecommendedCheck> {
    let mut out = Vec::new();
    let mut seen_commands: HashSet<String> = HashSet::new();

    let mut push_check = |id: String,
                          label: String,
                          program: String,
                          args: Vec<String>,
                          recipe_name: Option<String>,
                          reason: String| {
        let cmd_key = format!("{} {}", program, args.join(" "));
        if !seen_commands.insert(cmd_key) {
            return;
        }
        let latest = match_latest_execution(executions, &program, &args);
        let (latest_status, latest_execution_id, is_fresh) = match latest {
            Some(row) => {
                let fresh = row.source_digest == live_digest && row.status == "passed";
                (Some(row.status.clone()), Some(row.id.clone()), fresh)
            }
            None => (None, None, false),
        };
        out.push(RecommendedCheck {
            id,
            label,
            program,
            args,
            recipe_name,
            reason,
            latest_status,
            latest_execution_id,
            is_fresh,
        });
    };

    let has_rust = changed_paths
        .iter()
        .any(|p| p.ends_with(".rs") || p.ends_with("Cargo.toml") || p.starts_with("src-tauri/"));
    let has_frontend = changed_paths.iter().any(|p| {
        p.ends_with(".ts")
            || p.ends_with(".tsx")
            || p.ends_with(".js")
            || p.ends_with(".jsx")
            || p.ends_with(".css")
            || p.ends_with("package.json")
    });

    if let Ok(recipes) = list_project_recipes_at(root, operation_id) {
        for recipe in recipes {
            let reason = format!("Project recipe `{}`", recipe.name);
            push_check(
                format!("recipe:{}", recipe.name),
                recipe.name.clone(),
                recipe.program,
                recipe.args,
                Some(recipe.name),
                reason,
            );
        }
    }

    if has_frontend && root.join("package.json").is_file() {
        let package_mgr = if root.join("pnpm-lock.yaml").is_file() {
            "pnpm"
        } else {
            "npm"
        };
        if let Ok(pkg_text) = fs::read_to_string(root.join("package.json")) {
            if let Ok(pkg_json) = serde_json::from_str::<serde_json::Value>(&pkg_text) {
                if let Some(scripts) = pkg_json.get("scripts").and_then(|s| s.as_object()) {
                    for (script_key, label, reason) in [
                        (
                            "typecheck",
                            "Typecheck",
                            "Frontend TypeScript files changed",
                        ),
                        ("test", "Frontend tests", "TypeScript/React code changed"),
                        ("build", "Frontend build", "Bundle & asset compilation"),
                    ] {
                        if scripts.contains_key(script_key) {
                            let args = if package_mgr == "pnpm" {
                                vec![script_key.to_owned()]
                            } else {
                                vec!["run".to_owned(), script_key.to_owned()]
                            };
                            push_check(
                                format!("script:{script_key}"),
                                label.to_owned(),
                                package_mgr.to_owned(),
                                args,
                                None,
                                reason.to_owned(),
                            );
                        }
                    }
                }
            }
        }
    }

    if has_rust
        && (root.join("Cargo.toml").is_file() || root.join("src-tauri/Cargo.toml").is_file())
    {
        let mut cargo_test_args = vec!["test".to_owned(), "--locked".to_owned()];
        let mut clippy_args = vec!["clippy".to_owned(), "--locked".to_owned()];
        if !root.join("Cargo.toml").is_file() && root.join("src-tauri/Cargo.toml").is_file() {
            cargo_test_args.extend([
                "--manifest-path".to_owned(),
                "src-tauri/Cargo.toml".to_owned(),
            ]);
            clippy_args.extend([
                "--manifest-path".to_owned(),
                "src-tauri/Cargo.toml".to_owned(),
            ]);
        }
        clippy_args.extend([
            "--all-targets".to_owned(),
            "--".to_owned(),
            "-D".to_owned(),
            "warnings".to_owned(),
        ]);
        push_check(
            "cargo:test".to_owned(),
            "Rust unit tests".to_owned(),
            "cargo".to_owned(),
            cargo_test_args,
            None,
            "Rust backend files changed".to_owned(),
        );
        push_check(
            "cargo:clippy".to_owned(),
            "Rust clippy".to_owned(),
            "cargo".to_owned(),
            clippy_args,
            None,
            "Rust lint & compiler checks".to_owned(),
        );
    }

    out.truncate(6);
    out
}

pub(crate) async fn get_workspace_impact_report_with_pool(
    pool: &SqlitePool,
    context_state: &ContextIndexState,
    root: &Path,
    changed_paths_override: Option<Vec<String>>,
    operation_id: &str,
) -> Result<WorkspaceImpactReport, IpcError> {
    let review = get_workspace_review_with_pool(pool, root, operation_id).await?;
    let target_paths: Vec<String> = match changed_paths_override {
        Some(paths) if !paths.is_empty() => {
            let mut valid = Vec::new();
            let mut seen = HashSet::new();
            for raw in paths {
                if validate_safe_relative_path(&raw, operation_id).is_ok()
                    && seen.insert(raw.clone())
                {
                    valid.push(raw);
                }
            }
            valid
        }
        _ => review
            .changed_files
            .iter()
            .map(|f| f.path.clone())
            .collect(),
    };

    let changed_set: HashSet<String> = target_paths.iter().cloned().collect();
    let workspace_key = root.to_string_lossy().into_owned();

    let (token, gen_id) = context_state.begin_generation(&workspace_key);
    let root_owned = root.to_path_buf();
    let state_cloned = context_state.clone();
    let (cache, _cancelled) = tokio::task::spawn_blocking(move || {
        update_workspace_index(&root_owned, &state_cloned, &token, gen_id)
    })
    .await
    .map_err(|_| {
        terminal_error(
            "impact_index_failed",
            "Workspace impact index failed.",
            operation_id,
        )
    })?;

    let file_set: HashSet<String> = cache.files.keys().cloned().collect();
    let mut sorted_indexed: Vec<&String> = cache.files.keys().collect();
    sorted_indexed.sort();

    let annotations = load_annotations_for_project(pool, &workspace_key, operation_id).await?;
    let recent_executions = load_recent_executions(pool, &workspace_key).await;

    let mut files = Vec::with_capacity(target_paths.len());
    let mut untouched_caller_paths: Vec<String> = Vec::new();
    let mut covered_test_count = 0usize;
    let mut logic_files_missing_tests: Vec<String> = Vec::new();
    let mut sensitive_paths: Vec<String> = Vec::new();
    let mut stale_note_paths: Vec<String> = Vec::new();
    let mut touched_dirs: HashSet<String> = HashSet::new();

    for path in &target_paths {
        let role = classify_file_role(path).to_owned();
        if role == "tests" {
            covered_test_count += 1;
        }
        if is_sensitive_config_path(path) {
            sensitive_paths.push(path.clone());
        }
        let dir = Path::new(path)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_owned();
        touched_dirs.insert(dir);

        // Find observed direct importers / callers
        let mut direct_callers = Vec::new();
        let mut seen_callers = HashSet::new();
        for other_path in &sorted_indexed {
            if other_path.as_str() == path {
                continue;
            }
            let Some(other) = cache.files.get(*other_path) else {
                continue;
            };
            for raw in &other.raw_imports {
                if let Some(target) =
                    resolve_import(other_path, &other.language, &raw.specifier, &file_set)
                {
                    if target == *path && seen_callers.insert((*other_path).clone()) {
                        let also_changed = changed_set.contains(*other_path);
                        if !also_changed && !is_test_file(other_path) {
                            untouched_caller_paths.push((*other_path).clone());
                        }
                        direct_callers.push(ImpactedCaller {
                            file_path: (*other_path).clone(),
                            line: Some(raw.line),
                            provenance: "observed".to_owned(),
                            evidence: format!("Imports `{path}` at line {}", raw.line),
                            also_changed,
                        });
                        break;
                    }
                }
            }
        }
        direct_callers.truncate(20);

        // Related tests (inline #[cfg(test)], observed test callers, or filename stem heuristic)
        let mut related_tests = Vec::new();
        let mut seen_tests = HashSet::new();
        let entry_opt = cache.files.get(path);
        if entry_opt.map(|e| e.has_inline_rust_tests).unwrap_or(false) {
            seen_tests.insert(path.clone());
            related_tests.push(ImpactedTest {
                file_path: path.clone(),
                provenance: "observed".to_owned(),
                evidence: "Inline #[cfg(test)] module".to_owned(),
                also_changed: changed_set.contains(path),
            });
        }
        for caller in &direct_callers {
            if is_test_file(&caller.file_path) && seen_tests.insert(caller.file_path.clone()) {
                related_tests.push(ImpactedTest {
                    file_path: caller.file_path.clone(),
                    provenance: "observed".to_owned(),
                    evidence: caller.evidence.clone(),
                    also_changed: caller.also_changed,
                });
            }
        }
        if !is_test_file(path) {
            let stem = normalized_stem(path);
            if stem.len() >= 3 && stem != "index" && stem != "mod" {
                for candidate in &sorted_indexed {
                    let candidate_str = (*candidate).as_str();
                    if is_test_file(candidate_str)
                        && !seen_tests.contains(candidate_str)
                        && normalized_stem(candidate_str) == stem
                    {
                        seen_tests.insert(candidate_str.to_owned());
                        related_tests.push(ImpactedTest {
                            file_path: candidate_str.to_owned(),
                            provenance: "inferred".to_owned(),
                            evidence: "Filename stem match".to_owned(),
                            also_changed: changed_set.contains(candidate_str),
                        });
                    }
                }
            }
        }

        // Check developer context note staleness
        let live_digest = entry_opt.map(|e| e.digest.clone()).unwrap_or_default();
        let stale_note = annotations
            .iter()
            .find(|a| a.target_kind == "file" && a.target_key == *path)
            .and_then(|note| {
                if !live_digest.is_empty() && note.source_digest != live_digest {
                    stale_note_paths.push(path.clone());
                    Some(StaleContextNote {
                        file_path: path.clone(),
                        summary: note.summary.clone(),
                        updated_at: note.updated_at,
                    })
                } else {
                    None
                }
            });

        if matches!(role.as_str(), "backend" | "api_service" | "state")
            && related_tests.iter().all(|t| !t.also_changed)
        {
            logic_files_missing_tests.push(path.clone());
        }

        let summary = format!(
            "{} caller(s) · {} test(s){}",
            direct_callers.len(),
            related_tests.len(),
            if stale_note.is_some() {
                " · stale note"
            } else {
                ""
            }
        );

        files.push(ImpactFileAnalysis {
            path: path.clone(),
            role,
            summary,
            direct_callers,
            related_tests,
            stale_note,
        });
    }

    let mut warnings = Vec::new();
    untouched_caller_paths.sort();
    untouched_caller_paths.dedup();
    if !untouched_caller_paths.is_empty() {
        warnings.push(ImpactWarning {
            kind: "untouched_callers".to_owned(),
            severity: "medium".to_owned(),
            message: format!(
                "{} downstream caller(s) import modified file(s) and were not edited — verify signatures & types.",
                untouched_caller_paths.len()
            ),
            paths: untouched_caller_paths.into_iter().take(6).collect(),
        });
    }
    if !logic_files_missing_tests.is_empty() && covered_test_count == 0 {
        warnings.push(ImpactWarning {
            kind: "untested_logic_edits".to_owned(),
            severity: "high".to_owned(),
            message: format!(
                "{} logic/service/state file(s) modified with no test files touched in this changeset.",
                logic_files_missing_tests.len()
            ),
            paths: logic_files_missing_tests.into_iter().take(6).collect(),
        });
    }
    if !sensitive_paths.is_empty() {
        warnings.push(ImpactWarning {
            kind: "sensitive_config_touched".to_owned(),
            severity: "medium".to_owned(),
            message: format!(
                "Manifest, lockfile, or config edited ({}) — review dependencies & scripts carefully.",
                sensitive_paths.join(", ")
            ),
            paths: sensitive_paths,
        });
    }
    if !stale_note_paths.is_empty() {
        warnings.push(ImpactWarning {
            kind: "stale_context_notes".to_owned(),
            severity: "info".to_owned(),
            message: format!(
                "{} file(s) have saved System context notes whose source digest is now stale.",
                stale_note_paths.len()
            ),
            paths: stale_note_paths,
        });
    }
    if target_paths.len() >= 10 || touched_dirs.len() >= 6 {
        warnings.push(ImpactWarning {
            kind: "wide_scope".to_owned(),
            severity: "medium".to_owned(),
            message: format!(
                "Wide edit footprint: {} files across {} folders. Consider committing focused subsets.",
                target_paths.len(),
                touched_dirs.len()
            ),
            paths: Vec::new(),
        });
    }

    let recommended_checks = build_recommended_checks(
        root,
        &target_paths,
        &recent_executions,
        &review.source_digest,
        operation_id,
    );

    Ok(WorkspaceImpactReport {
        project_id: workspace_key,
        source_digest: review.source_digest,
        changed_files_count: target_paths.len(),
        files,
        warnings,
        recommended_checks,
    })
}

#[tauri::command]
pub(crate) async fn get_workspace_impact_report(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    context_state: tauri::State<'_, ContextIndexState>,
    request: WorkspaceImpactRequest,
) -> Result<WorkspaceImpactReport, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_impact_request",
            "The workspace impact request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    get_workspace_impact_report_with_pool(
        &pool,
        &context_state,
        &root,
        request.changed_paths,
        &request.operation_id,
    )
    .await
}

#[cfg(test)]
mod impact_tests {
    use super::*;

    #[tokio::test]
    async fn reports_roles_callers_tests_and_warnings() {
        let base = std::env::temp_dir().join(format!(
            "laplace-impact-test-{}-{}",
            std::process::id(),
            EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&base);
        let repo = base.join("repo");
        fs::create_dir_all(repo.join("src/services")).unwrap();
        fs::create_dir_all(repo.join("src/features")).unwrap();

        let git = |args: &[&str]| {
            let out = Command::new("git")
                .args(args)
                .current_dir(&repo)
                .output()
                .unwrap();
            assert!(out.status.success());
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.name", "Laplace Test"]);
        git(&["config", "user.email", "test@laplace.local"]);
        git(&["config", "commit.gpgsign", "false"]);

        fs::write(
            repo.join("package.json"),
            r#"{"name":"app","scripts":{"typecheck":"tsc --noEmit","test":"vitest run"}}"#,
        )
        .unwrap();
        fs::write(
            repo.join("src/services/auth.ts"),
            "export function verifyToken() { return true; }\n",
        )
        .unwrap();
        fs::write(
            repo.join("src/features/login.ts"),
            "import { verifyToken } from '../services/auth';\nexport const ok = verifyToken();\n",
        )
        .unwrap();
        fs::write(
            repo.join("src/services/auth.test.ts"),
            "import { verifyToken } from './auth';\nconsole.log(verifyToken());\n",
        )
        .unwrap();
        git(&["add", "."]);
        git(&["commit", "-m", "init"]);

        // Modify auth.ts without editing caller or test
        fs::write(
            repo.join("src/services/auth.ts"),
            "export function verifyToken(strict = true) { return strict; }\n",
        )
        .unwrap();

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
        let ctx_state = ContextIndexState::default();

        let report =
            get_workspace_impact_report_with_pool(&pool, &ctx_state, &root, None, "op-impact-1")
                .await
                .unwrap();

        assert_eq!(report.changed_files_count, 1);
        assert_eq!(report.files[0].role, "api_service");
        assert!(report.files[0]
            .direct_callers
            .iter()
            .any(|c| c.file_path == "src/features/login.ts" && !c.also_changed));
        assert!(report.files[0]
            .related_tests
            .iter()
            .any(|t| t.file_path == "src/services/auth.test.ts"));
        assert!(report
            .warnings
            .iter()
            .any(|w| w.kind == "untouched_callers"));
        assert!(report
            .warnings
            .iter()
            .any(|w| w.kind == "untested_logic_edits"));
        assert!(report
            .recommended_checks
            .iter()
            .any(|c| c.args.contains(&"typecheck".to_owned())));

        let _ = fs::remove_dir_all(&base);
    }
}
