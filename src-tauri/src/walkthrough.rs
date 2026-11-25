use super::*;
use crate::context::{
    is_test_file, resolve_import, update_workspace_index, ContextIndexState, FileSymbol,
};
use crate::impact::{
    classify_file_role, get_workspace_impact_report_with_pool, is_sensitive_config_path,
    ImpactFileAnalysis,
};
use crate::review::{
    canonical_git_root, ensure_workspace_review_id, get_workspace_review_with_pool,
    read_git_file_diff_pair_at, read_git_file_diff_pair_since_review_with_pool,
};
use std::collections::VecDeque;

const MAX_WALKTHROUGH_FILES: usize = 60;
const MAX_WALKTHROUGH_STEPS: usize = 120;
const MAX_LCS_CELLS: usize = 240_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WalkthroughStep {
    pub(crate) id: String,
    pub(crate) order: usize,
    pub(crate) chapter: String,
    pub(crate) file_path: String,
    pub(crate) role: String,
    pub(crate) file_status: String,
    pub(crate) symbol_name: Option<String>,
    pub(crate) symbol_kind: Option<String>,
    pub(crate) hunk_index: Option<usize>,
    pub(crate) old_start: usize,
    pub(crate) old_count: usize,
    pub(crate) new_start: usize,
    pub(crate) new_count: usize,
    pub(crate) added_lines: usize,
    pub(crate) removed_lines: usize,
    pub(crate) header: Option<String>,
    pub(crate) causal_reason: String,
    pub(crate) risk_level: String,
    pub(crate) risk_reasons: Vec<String>,
    pub(crate) direct_callers_count: usize,
    pub(crate) untouched_callers_count: usize,
    pub(crate) related_tests_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WalkthroughChapter {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) summary: String,
    pub(crate) step_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWalkthrough {
    pub(crate) project_id: String,
    pub(crate) baseline: String,
    pub(crate) source_digest: String,
    pub(crate) total_steps: usize,
    pub(crate) high_risk_count: usize,
    pub(crate) chapters: Vec<WalkthroughChapter>,
    pub(crate) steps: Vec<WalkthroughStep>,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWalkthroughRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    #[serde(default)]
    baseline: Option<String>,
}

#[derive(Debug, Clone)]
struct ComputedHunk {
    index: usize,
    old_start: usize,
    old_count: usize,
    new_start: usize,
    new_count: usize,
    added_lines: usize,
    removed_lines: usize,
    header: String,
}

fn split_lines_for_diff(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    let trimmed = text.strip_suffix('\n').unwrap_or(text);
    trimmed
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect()
}

#[derive(Clone, Copy)]
enum EditOpKind {
    Equal,
    Delete,
    Insert,
}

#[derive(Clone, Copy)]
struct EditOp {
    kind: EditOpKind,
    old_idx: usize,
    new_idx: usize,
}

fn compute_walkthrough_hunks(original: &str, modified: &str) -> Vec<ComputedHunk> {
    if original == modified {
        return Vec::new();
    }
    let old_lines = split_lines_for_diff(original);
    let new_lines = split_lines_for_diff(modified);

    let mut prefix = 0usize;
    while prefix < old_lines.len()
        && prefix < new_lines.len()
        && old_lines[prefix] == new_lines[prefix]
    {
        prefix += 1;
    }

    let mut old_end = old_lines.len();
    let mut new_end = new_lines.len();
    while old_end > prefix && new_end > prefix && old_lines[old_end - 1] == new_lines[new_end - 1] {
        old_end -= 1;
        new_end -= 1;
    }

    let mid_old = old_end - prefix;
    let mid_new = new_end - prefix;
    if mid_old == 0 && mid_new == 0 {
        return Vec::new();
    }

    if mid_old.saturating_mul(mid_new) > MAX_LCS_CELLS {
        let old_start = if mid_old == 0 { prefix } else { prefix + 1 };
        let new_start = if mid_new == 0 { prefix } else { prefix + 1 };
        return vec![ComputedHunk {
            index: 0,
            old_start,
            old_count: mid_old,
            new_start,
            new_count: mid_new,
            added_lines: mid_new,
            removed_lines: mid_old,
            header: format!("@@ -{old_start},{mid_old} +{new_start},{mid_new} @@"),
        }];
    }

    let stride = mid_new + 1;
    let mut dp = vec![0u32; (mid_old + 1) * stride];
    for i in (0..mid_old).rev() {
        for j in (0..mid_new).rev() {
            dp[i * stride + j] = if old_lines[prefix + i] == new_lines[prefix + j] {
                dp[(i + 1) * stride + (j + 1)] + 1
            } else {
                dp[(i + 1) * stride + j].max(dp[i * stride + (j + 1)])
            };
        }
    }

    let mut ops = Vec::with_capacity(mid_old + mid_new);
    let mut i = 0usize;
    let mut j = 0usize;
    while i < mid_old && j < mid_new {
        if old_lines[prefix + i] == new_lines[prefix + j] {
            ops.push(EditOp {
                kind: EditOpKind::Equal,
                old_idx: prefix + i,
                new_idx: prefix + j,
            });
            i += 1;
            j += 1;
        } else if dp[(i + 1) * stride + j] >= dp[i * stride + (j + 1)] {
            ops.push(EditOp {
                kind: EditOpKind::Delete,
                old_idx: prefix + i,
                new_idx: prefix + j,
            });
            i += 1;
        } else {
            ops.push(EditOp {
                kind: EditOpKind::Insert,
                old_idx: prefix + i,
                new_idx: prefix + j,
            });
            j += 1;
        }
    }
    while i < mid_old {
        ops.push(EditOp {
            kind: EditOpKind::Delete,
            old_idx: prefix + i,
            new_idx: prefix + j,
        });
        i += 1;
    }
    while j < mid_new {
        ops.push(EditOp {
            kind: EditOpKind::Insert,
            old_idx: prefix + i,
            new_idx: prefix + j,
        });
        j += 1;
    }

    let mut hunks = Vec::new();
    let mut idx = 0usize;
    while idx < ops.len() {
        if matches!(ops[idx].kind, EditOpKind::Equal) {
            idx += 1;
            continue;
        }
        let start_idx = idx;
        let mut removed = 0usize;
        let mut added = 0usize;
        let mut first_old: Option<usize> = None;
        let mut first_new: Option<usize> = None;

        while idx < ops.len() && !matches!(ops[idx].kind, EditOpKind::Equal) {
            let op = ops[idx];
            match op.kind {
                EditOpKind::Delete => {
                    if first_old.is_none() {
                        first_old = Some(op.old_idx);
                    }
                    removed += 1;
                }
                EditOpKind::Insert => {
                    if first_new.is_none() {
                        first_new = Some(op.new_idx);
                    }
                    added += 1;
                }
                EditOpKind::Equal => {}
            }
            idx += 1;
        }

        let anchor_old = ops[start_idx].old_idx;
        let anchor_new = ops[start_idx].new_idx;
        let old_start = if removed == 0 {
            anchor_old
        } else {
            first_old.unwrap_or(anchor_old) + 1
        };
        let new_start = if added == 0 {
            anchor_new
        } else {
            first_new.unwrap_or(anchor_new) + 1
        };

        let index = hunks.len();
        hunks.push(ComputedHunk {
            index,
            old_start,
            old_count: removed,
            new_start,
            new_count: added,
            added_lines: added,
            removed_lines: removed,
            header: format!("@@ -{old_start},{removed} +{new_start},{added} @@"),
        });
    }

    hunks
}

fn anchor_symbol_for_hunk(
    symbols: &[FileSymbol],
    new_start: usize,
    new_count: usize,
) -> Option<&FileSymbol> {
    if symbols.is_empty() {
        return None;
    }
    let anchor_line = new_start.max(1);
    let end_line = anchor_line + new_count.saturating_sub(1);

    // Prefer a symbol declared directly inside the modified slice
    if let Some(inside) = symbols
        .iter()
        .find(|sym| sym.line >= anchor_line && sym.line <= end_line)
    {
        return Some(inside);
    }

    // Otherwise find the nearest enclosing/preceding symbol at or before anchor_line
    symbols
        .iter()
        .filter(|sym| sym.line <= anchor_line)
        .max_by_key(|sym| sym.line)
}

fn is_contract_or_schema_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with("contracts.ts")
        || lower.ends_with("types.ts")
        || lower.ends_with(".sql")
        || lower.contains("/migrations/")
        || lower.starts_with("migrations/")
        || lower.ends_with("/schema.ts")
        || lower.ends_with("/schema.rs")
}

fn chapter_rank(chapter: &str) -> usize {
    match chapter {
        "foundation" => 0,
        "core" => 1,
        "consumers" => 2,
        "verification" => 3,
        "config" => 4,
        _ => 5,
    }
}

fn chapter_title(chapter: &str) -> &'static str {
    match chapter {
        "foundation" => "Contracts & Foundation",
        "core" => "Core Logic & Services",
        "consumers" => "Consumers & UI",
        "verification" => "Tests & Verification",
        "config" => "Config & Docs",
        _ => "Other Changes",
    }
}

fn risk_rank(level: &str) -> usize {
    match level {
        "high" => 2,
        "medium" => 1,
        _ => 0,
    }
}

fn assign_chapter(
    path: &str,
    role: &str,
    changed_importers: &[String],
    changed_imports: &[String],
) -> &'static str {
    if role == "tests" {
        return "verification";
    }
    if is_contract_or_schema_path(path) {
        return "foundation";
    }
    if role == "config_docs" {
        return "config";
    }
    if !changed_importers.is_empty() && role != "ui" && changed_imports.is_empty() {
        return "foundation";
    }
    if matches!(role, "backend" | "api_service" | "state") {
        return "core";
    }
    "consumers"
}

fn topologically_order_chapter(
    paths: &[String],
    imports_map: &HashMap<String, Vec<String>>,
    risk_by_path: &HashMap<String, usize>,
    importers_count: &HashMap<String, usize>,
) -> Vec<String> {
    let set: HashSet<&str> = paths.iter().map(String::as_str).collect();
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut dependents: HashMap<String, Vec<String>> = HashMap::new();

    for path in paths {
        in_degree.entry(path.clone()).or_insert(0);
    }

    // Edge: dependency -> dependent (so dependencies are read first)
    for path in paths {
        if let Some(targets) = imports_map.get(path) {
            let mut seen_deps = HashSet::new();
            for dep in targets {
                if dep != path && set.contains(dep.as_str()) && seen_deps.insert(dep.as_str()) {
                    dependents
                        .entry(dep.clone())
                        .or_default()
                        .push(path.clone());
                    *in_degree.entry(path.clone()).or_insert(0) += 1;
                }
            }
        }
    }

    let sort_key = |p: &String| {
        (
            std::cmp::Reverse(*risk_by_path.get(p).unwrap_or(&0)),
            std::cmp::Reverse(*importers_count.get(p).unwrap_or(&0)),
            p.clone(),
        )
    };

    let mut ready: Vec<String> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(p, _)| p.clone())
        .collect();
    ready.sort_by_key(&sort_key);
    let mut queue: VecDeque<String> = ready.into();

    let mut ordered = Vec::with_capacity(paths.len());
    let mut visited = HashSet::new();

    while let Some(node) = queue.pop_front() {
        if !visited.insert(node.clone()) {
            continue;
        }
        ordered.push(node.clone());
        if let Some(next_nodes) = dependents.get(&node) {
            let mut newly_ready = Vec::new();
            for next in next_nodes {
                if let Some(deg) = in_degree.get_mut(next) {
                    *deg = deg.saturating_sub(1);
                    if *deg == 0 {
                        newly_ready.push(next.clone());
                    }
                }
            }
            newly_ready.sort_by_key(&sort_key);
            for item in newly_ready {
                queue.push_back(item);
            }
        }
    }

    // Append any cycle participants deterministically
    if ordered.len() < paths.len() {
        let mut remaining: Vec<String> = paths
            .iter()
            .filter(|p| !visited.contains(*p))
            .cloned()
            .collect();
        remaining.sort_by_key(&sort_key);
        ordered.extend(remaining);
    }

    ordered
}

fn short_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn build_causal_reason(
    chapter: &str,
    role: &str,
    changed_importers: &[String],
    changed_imports: &[String],
    untouched_callers: usize,
    total_callers: usize,
) -> String {
    if !changed_importers.is_empty() {
        let names: Vec<&str> = changed_importers
            .iter()
            .take(2)
            .map(|p| short_name(p))
            .collect();
        let suffix = if changed_importers.len() > 2 {
            format!(" +{} more", changed_importers.len() - 2)
        } else {
            String::new()
        };
        return format!(
            "Foundation: imported by {} changed file(s) ({}{suffix})",
            changed_importers.len(),
            names.join(", ")
        );
    }
    if chapter == "verification" {
        if !changed_imports.is_empty() {
            let names: Vec<&str> = changed_imports
                .iter()
                .take(2)
                .map(|p| short_name(p))
                .collect();
            return format!("Verifies modified logic in {}", names.join(", "));
        }
        return "Test coverage for this changeset".to_owned();
    }
    if !changed_imports.is_empty() {
        let names: Vec<&str> = changed_imports
            .iter()
            .take(2)
            .map(|p| short_name(p))
            .collect();
        if untouched_callers > 0 {
            return format!(
                "Consumes {} · {} untouched caller(s)",
                names.join(", "),
                untouched_callers
            );
        }
        return format!("Consumes modified code in {}", names.join(", "));
    }
    if untouched_callers > 0 {
        return format!(
            "{} untouched downstream caller(s) import this file",
            untouched_callers
        );
    }
    if total_callers > 0 {
        return format!("Imported by {} workspace file(s)", total_callers);
    }
    match role {
        "backend" => "Backend & persistence logic".to_owned(),
        "api_service" => "Service & IPC boundary".to_owned(),
        "state" => "Application state management".to_owned(),
        "config_docs" => "Configuration or documentation".to_owned(),
        _ => "UI & presentation update".to_owned(),
    }
}

fn assess_step_risk(
    path: &str,
    role: &str,
    impact: Option<&ImpactFileAnalysis>,
    added_lines: usize,
    removed_lines: usize,
    any_test_changed_in_set: bool,
) -> (String, Vec<String>) {
    let mut reasons = Vec::new();
    let mut high = false;
    let mut medium = false;

    let untouched_callers = impact
        .map(|f| {
            f.direct_callers
                .iter()
                .filter(|c| !c.also_changed && !is_test_file(&c.file_path))
                .count()
        })
        .unwrap_or(0);

    let related_tests_changed = impact
        .map(|f| f.related_tests.iter().any(|t| t.also_changed))
        .unwrap_or(false);

    if is_sensitive_config_path(path) {
        high = true;
        reasons.push("Sensitive config, manifest, or migration".to_owned());
    }

    if matches!(role, "backend" | "api_service" | "state")
        && !related_tests_changed
        && !any_test_changed_in_set
    {
        high = true;
        reasons.push("Logic edit with no test files touched".to_owned());
    }

    let delta = added_lines + removed_lines;
    if untouched_callers > 0 {
        if delta >= 60 {
            high = true;
        } else {
            medium = true;
        }
        reasons.push(format!(
            "{untouched_callers} untouched downstream caller(s)"
        ));
    }

    if impact.and_then(|f| f.stale_note.as_ref()).is_some() {
        medium = true;
        reasons.push("Saved context note is now stale".to_owned());
    }

    if delta >= 40 && !high {
        medium = true;
        reasons.push(format!(
            "Large diff slice (+{added_lines} / -{removed_lines})"
        ));
    }

    let level = if high {
        "high"
    } else if medium {
        "medium"
    } else {
        "low"
    };
    (level.to_owned(), reasons)
}

pub(crate) async fn get_workspace_walkthrough_with_pool(
    pool: &SqlitePool,
    context_state: &ContextIndexState,
    root: &Path,
    baseline: &str,
    operation_id: &str,
) -> Result<WorkspaceWalkthrough, IpcError> {
    let normalized_baseline = if baseline == "last_review" {
        "last_review"
    } else {
        "head"
    };

    let review = get_workspace_review_with_pool(pool, root, operation_id).await?;
    let workspace_key = root.to_string_lossy().into_owned();

    let effective_baseline =
        if normalized_baseline == "last_review" && review.last_checkpoint_digest.is_some() {
            "last_review"
        } else {
            "head"
        };

    let mut target_files: Vec<(String, String)> = if effective_baseline == "last_review" {
        let delta: HashSet<&str> = review
            .changed_since_checkpoint
            .iter()
            .map(String::as_str)
            .collect();
        review
            .changed_files
            .iter()
            .filter(|f| delta.contains(f.path.as_str()))
            .map(|f| {
                (
                    f.path.clone(),
                    file_status_label(f.index_status, f.worktree_status),
                )
            })
            .collect()
    } else {
        review
            .changed_files
            .iter()
            .map(|f| {
                (
                    f.path.clone(),
                    file_status_label(f.index_status, f.worktree_status),
                )
            })
            .collect()
    };

    let mut truncated = false;
    if target_files.len() > MAX_WALKTHROUGH_FILES {
        target_files.truncate(MAX_WALKTHROUGH_FILES);
        truncated = true;
    }

    if target_files.is_empty() {
        return Ok(WorkspaceWalkthrough {
            project_id: workspace_key,
            baseline: effective_baseline.to_owned(),
            source_digest: review.source_digest,
            total_steps: 0,
            high_risk_count: 0,
            chapters: Vec::new(),
            steps: Vec::new(),
            truncated: false,
        });
    }

    let target_paths: Vec<String> = target_files.iter().map(|(p, _)| p.clone()).collect();
    let status_by_path: HashMap<String, String> = target_files.into_iter().collect();
    let changed_set: HashSet<String> = target_paths.iter().cloned().collect();

    let impact = get_workspace_impact_report_with_pool(
        pool,
        context_state,
        root,
        Some(target_paths.clone()),
        operation_id,
    )
    .await?;

    let impact_by_path: HashMap<String, &ImpactFileAnalysis> =
        impact.files.iter().map(|f| (f.path.clone(), f)).collect();

    let (token, gen_id) = context_state.begin_generation(&workspace_key);
    let root_owned = root.to_path_buf();
    let state_cloned = context_state.clone();
    let (cache, _cancelled) = tokio::task::spawn_blocking(move || {
        update_workspace_index(&root_owned, &state_cloned, &token, gen_id)
    })
    .await
    .map_err(|_| {
        terminal_error(
            "walkthrough_index_failed",
            "Workspace walkthrough index failed.",
            operation_id,
        )
    })?;

    let file_set: HashSet<String> = cache.files.keys().cloned().collect();
    let mut changed_imports: HashMap<String, Vec<String>> = HashMap::new();
    let mut changed_importers: HashMap<String, Vec<String>> = HashMap::new();

    for path in &target_paths {
        if let Some(entry) = cache.files.get(path) {
            let mut deps = Vec::new();
            let mut seen = HashSet::new();
            for raw in &entry.raw_imports {
                if let Some(resolved) =
                    resolve_import(path, &entry.language, &raw.specifier, &file_set)
                {
                    if resolved != *path
                        && changed_set.contains(&resolved)
                        && seen.insert(resolved.clone())
                    {
                        changed_importers
                            .entry(resolved.clone())
                            .or_default()
                            .push(path.clone());
                        deps.push(resolved);
                    }
                }
            }
            changed_imports.insert(path.clone(), deps);
        }
    }

    let any_test_changed = target_paths
        .iter()
        .any(|p| classify_file_role(p) == "tests");

    let mut chapter_buckets: HashMap<String, Vec<String>> = HashMap::new();
    let mut risk_rank_by_path: HashMap<String, usize> = HashMap::new();
    let mut importers_count: HashMap<String, usize> = HashMap::new();

    for path in &target_paths {
        let role = impact_by_path
            .get(path)
            .map(|f| f.role.as_str())
            .unwrap_or_else(|| classify_file_role(path));
        let importers = changed_importers
            .get(path)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let imports = changed_imports.get(path).map(Vec::as_slice).unwrap_or(&[]);
        let chapter = assign_chapter(path, role, importers, imports).to_owned();

        let (file_risk, _) = assess_step_risk(
            path,
            role,
            impact_by_path.get(path).copied(),
            0,
            0,
            any_test_changed,
        );
        risk_rank_by_path.insert(path.clone(), risk_rank(&file_risk));
        importers_count.insert(path.clone(), importers.len());
        chapter_buckets
            .entry(chapter)
            .or_default()
            .push(path.clone());
    }

    let workspace_review_id = if effective_baseline == "last_review" {
        Some(ensure_workspace_review_id(pool, root, operation_id).await?)
    } else {
        None
    };

    let mut chapter_ids: Vec<String> = chapter_buckets.keys().cloned().collect();
    chapter_ids.sort_by_key(|c| chapter_rank(c));

    let mut steps = Vec::new();
    let mut chapters = Vec::new();
    let mut high_risk_count = 0usize;

    for chapter_id in chapter_ids {
        let raw_paths = chapter_buckets.remove(&chapter_id).unwrap_or_default();
        let ordered_paths = topologically_order_chapter(
            &raw_paths,
            &changed_imports,
            &risk_rank_by_path,
            &importers_count,
        );

        let mut chapter_step_ids = Vec::new();
        for path in ordered_paths {
            if steps.len() >= MAX_WALKTHROUGH_STEPS {
                truncated = true;
                break;
            }

            let impact_opt = impact_by_path.get(&path).copied();
            let role = impact_opt
                .map(|f| f.role.clone())
                .unwrap_or_else(|| classify_file_role(&path).to_owned());
            let file_status = status_by_path
                .get(&path)
                .cloned()
                .unwrap_or_else(|| "modified".to_owned());
            let importers = changed_importers
                .get(&path)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let imports = changed_imports.get(&path).map(Vec::as_slice).unwrap_or(&[]);

            let direct_callers_count = impact_opt.map(|f| f.direct_callers.len()).unwrap_or(0);
            let untouched_callers_count = impact_opt
                .map(|f| {
                    f.direct_callers
                        .iter()
                        .filter(|c| !c.also_changed && !is_test_file(&c.file_path))
                        .count()
                })
                .unwrap_or(0);
            let related_tests_count = impact_opt.map(|f| f.related_tests.len()).unwrap_or(0);

            let causal_reason = build_causal_reason(
                &chapter_id,
                &role,
                importers,
                imports,
                untouched_callers_count,
                direct_callers_count,
            );

            let diff_pair = if let Some(ref review_id) = workspace_review_id {
                read_git_file_diff_pair_since_review_with_pool(
                    pool,
                    root,
                    review_id,
                    &path,
                    operation_id,
                )
                .await
                .ok()
            } else {
                read_git_file_diff_pair_at(root, &path, operation_id).ok()
            };

            let symbols = cache
                .files
                .get(&path)
                .map(|f| f.symbols.as_slice())
                .unwrap_or(&[]);

            let computed_hunks = match diff_pair.as_ref() {
                Some(pair) if matches!(pair.kind, ProjectFileReadKind::Text) => {
                    let orig = pair.original.as_deref().unwrap_or("");
                    let modif = pair.modified.as_deref().unwrap_or("");
                    compute_walkthrough_hunks(orig, modif)
                }
                _ => Vec::new(),
            };

            if computed_hunks.is_empty() {
                let (risk_level, risk_reasons) =
                    assess_step_risk(&path, &role, impact_opt, 0, 0, any_test_changed);
                if risk_level == "high" {
                    high_risk_count += 1;
                }
                let step_id = format!("{path}::file");
                let order = steps.len() + 1;
                chapter_step_ids.push(step_id.clone());
                steps.push(WalkthroughStep {
                    id: step_id,
                    order,
                    chapter: chapter_id.clone(),
                    file_path: path.clone(),
                    role,
                    file_status,
                    symbol_name: None,
                    symbol_kind: None,
                    hunk_index: None,
                    old_start: 1,
                    old_count: 0,
                    new_start: 1,
                    new_count: 0,
                    added_lines: 0,
                    removed_lines: 0,
                    header: None,
                    causal_reason,
                    risk_level,
                    risk_reasons,
                    direct_callers_count,
                    untouched_callers_count,
                    related_tests_count,
                });
            } else {
                for hunk in computed_hunks {
                    if steps.len() >= MAX_WALKTHROUGH_STEPS {
                        truncated = true;
                        break;
                    }
                    let anchored = anchor_symbol_for_hunk(symbols, hunk.new_start, hunk.new_count);
                    let (risk_level, risk_reasons) = assess_step_risk(
                        &path,
                        &role,
                        impact_opt,
                        hunk.added_lines,
                        hunk.removed_lines,
                        any_test_changed,
                    );
                    if risk_level == "high" {
                        high_risk_count += 1;
                    }
                    let step_id = format!("{path}::{}", hunk.index);
                    let order = steps.len() + 1;
                    chapter_step_ids.push(step_id.clone());
                    steps.push(WalkthroughStep {
                        id: step_id,
                        order,
                        chapter: chapter_id.clone(),
                        file_path: path.clone(),
                        role: role.clone(),
                        file_status: file_status.clone(),
                        symbol_name: anchored.map(|s| s.name.clone()),
                        symbol_kind: anchored.map(|s| s.kind.clone()),
                        hunk_index: Some(hunk.index),
                        old_start: hunk.old_start,
                        old_count: hunk.old_count,
                        new_start: hunk.new_start,
                        new_count: hunk.new_count,
                        added_lines: hunk.added_lines,
                        removed_lines: hunk.removed_lines,
                        header: Some(hunk.header),
                        causal_reason: causal_reason.clone(),
                        risk_level,
                        risk_reasons,
                        direct_callers_count,
                        untouched_callers_count,
                        related_tests_count,
                    });
                }
            }
        }

        if !chapter_step_ids.is_empty() {
            let step_count = chapter_step_ids.len();
            chapters.push(WalkthroughChapter {
                id: chapter_id.clone(),
                title: chapter_title(&chapter_id).to_owned(),
                summary: format!("{step_count} step(s)"),
                step_ids: chapter_step_ids,
            });
        }
    }

    Ok(WorkspaceWalkthrough {
        project_id: workspace_key,
        baseline: effective_baseline.to_owned(),
        source_digest: review.source_digest,
        total_steps: steps.len(),
        high_risk_count,
        chapters,
        steps,
        truncated,
    })
}

fn file_status_label(index_status: char, worktree_status: char) -> String {
    if index_status == '?' && worktree_status == '?' {
        "untracked".to_owned()
    } else if index_status == 'D' || worktree_status == 'D' {
        "deleted".to_owned()
    } else if index_status == 'A' {
        "added".to_owned()
    } else {
        "modified".to_owned()
    }
}

#[tauri::command]
pub(crate) async fn get_workspace_walkthrough(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    context_state: tauri::State<'_, ContextIndexState>,
    request: WorkspaceWalkthroughRequest,
) -> Result<WorkspaceWalkthrough, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_walkthrough_request",
            "The workspace walkthrough request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_git_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    let baseline = request.baseline.as_deref().unwrap_or("head");
    get_workspace_walkthrough_with_pool(
        &pool,
        &context_state,
        &root,
        baseline,
        &request.operation_id,
    )
    .await
}

#[cfg(test)]
mod walkthrough_tests {
    use super::*;
    use crate::review::save_workspace_checkpoint_with_pool;

    #[tokio::test]
    async fn orders_chapters_causally_anchors_symbols_and_supports_checkpoint_baseline() {
        let base = std::env::temp_dir().join(format!(
            "laplace-walkthrough-test-{}-{}",
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
            assert!(out.status.success(), "git {:?} failed", args);
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.name", "Laplace Test"]);
        git(&["config", "user.email", "test@laplace.local"]);
        git(&["config", "commit.gpgsign", "false"]);

        fs::write(
            repo.join("src/services/contracts.ts"),
            "export interface AuthResult {\n  ok: boolean;\n}\n",
        )
        .unwrap();
        fs::write(
            repo.join("src/services/auth.ts"),
            "import type { AuthResult } from './contracts';\n\nexport function verifyToken(): AuthResult {\n  return { ok: true };\n}\n",
        )
        .unwrap();
        fs::write(
            repo.join("src/features/login.ts"),
            "import { verifyToken } from '../services/auth';\n\nexport function runLogin() {\n  return verifyToken().ok;\n}\n",
        )
        .unwrap();
        fs::write(
            repo.join("src/features/admin.ts"),
            "import { verifyToken } from '../services/auth';\n\nexport function runAdmin() {\n  return verifyToken().ok;\n}\n",
        )
        .unwrap();
        fs::write(
            repo.join("src/services/auth.test.ts"),
            "import { verifyToken } from './auth';\n\nexport function testVerify() {\n  return verifyToken().ok;\n}\n",
        )
        .unwrap();
        git(&["add", "."]);
        git(&["commit", "-m", "init"]);

        // Edit contracts.ts, auth.ts, login.ts, and auth.test.ts (leave admin.ts untouched)
        fs::write(
            repo.join("src/services/contracts.ts"),
            "export interface AuthResult {\n  ok: boolean;\n  reason?: string;\n}\n",
        )
        .unwrap();
        fs::write(
            repo.join("src/services/auth.ts"),
            "import type { AuthResult } from './contracts';\n\nexport function verifyToken(strict = true): AuthResult {\n  return { ok: strict, reason: strict ? undefined : 'relaxed' };\n}\n",
        )
        .unwrap();
        fs::write(
            repo.join("src/features/login.ts"),
            "import { verifyToken } from '../services/auth';\n\nexport function runLogin() {\n  return verifyToken(true).ok;\n}\n",
        )
        .unwrap();
        fs::write(
            repo.join("src/services/auth.test.ts"),
            "import { verifyToken } from './auth';\n\nexport function testVerify() {\n  return verifyToken(true).ok;\n}\n",
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

        let wt = get_workspace_walkthrough_with_pool(&pool, &ctx_state, &root, "head", "op-wt-1")
            .await
            .unwrap();

        assert_eq!(wt.baseline, "head");
        assert!(wt.total_steps >= 4);

        let chapter_order: Vec<&str> = wt.chapters.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(
            chapter_order,
            vec!["foundation", "core", "consumers", "verification"]
        );

        let auth_step = wt
            .steps
            .iter()
            .find(|s| s.file_path == "src/services/auth.ts")
            .expect("auth step");
        assert_eq!(auth_step.symbol_name.as_deref(), Some("verifyToken"));
        assert_eq!(auth_step.untouched_callers_count, 1); // admin.ts untouched
        assert_eq!(auth_step.risk_level, "medium");

        // Save checkpoint, then edit only login.ts and verify last_review baseline scopes to login.ts
        save_workspace_checkpoint_with_pool(&pool, &root, Some("Before Rook Build"), "op-cp-1")
            .await
            .unwrap();
        fs::write(
            repo.join("src/features/login.ts"),
            "import { verifyToken } from '../services/auth';\n\nexport function runLogin() {\n  const res = verifyToken(true);\n  return res.ok;\n}\n",
        )
        .unwrap();

        let since_cp =
            get_workspace_walkthrough_with_pool(&pool, &ctx_state, &root, "last_review", "op-wt-2")
                .await
                .unwrap();
        assert_eq!(since_cp.baseline, "last_review");
        assert_eq!(since_cp.steps.len(), 1);
        assert_eq!(since_cp.steps[0].file_path, "src/features/login.ts");
        assert_eq!(since_cp.steps[0].symbol_name.as_deref(), Some("runLogin"));

        let _ = fs::remove_dir_all(&base);
    }
}
