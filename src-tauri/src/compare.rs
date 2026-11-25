use super::*;
use std::collections::BTreeSet;

const MAX_DIFF_LINES: usize = 300;
const MAX_LCS_LINES: usize = 600;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionEnvironment {
    pub(crate) os: String,
    pub(crate) arch: String,
    pub(crate) cwd: String,
    pub(crate) program_version: Option<String>,
}

impl ExecutionEnvironment {
    pub(crate) fn capture(root: &Path, program: &str) -> Self {
        Self {
            os: std::env::consts::OS.to_owned(),
            arch: std::env::consts::ARCH.to_owned(),
            cwd: root.to_string_lossy().into_owned(),
            program_version: detect_program_version(program),
        }
    }
}

fn detect_program_version(program: &str) -> Option<String> {
    let name = Path::new(program)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(program);
    let version_arg = match name {
        "node" | "pnpm" | "npm" | "yarn" | "cargo" | "rustc" | "python" | "python3" | "pytest"
        | "git" => "--version",
        "go" => "version",
        _ => return None,
    };
    let output = Command::new(program)
        .arg(version_arg)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next().unwrap_or("").trim();
    if first.is_empty() {
        None
    } else {
        Some(first.chars().take(120).collect())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NormalizationRules {
    #[serde(default = "default_true")]
    pub(crate) strip_ansi: bool,
    #[serde(default)]
    pub(crate) strip_timestamps: bool,
    #[serde(default)]
    pub(crate) strip_durations: bool,
    #[serde(default)]
    pub(crate) trim_trailing_whitespace: bool,
}

fn default_true() -> bool {
    true
}

impl Default for NormalizationRules {
    fn default() -> Self {
        Self {
            strip_ansi: true,
            strip_timestamps: false,
            strip_durations: false,
            trim_trailing_whitespace: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ComparisonOutcome {
    Equal,
    Different,
    Regressed,
    Fixed,
    BaselineFailed,
    MissingArtifact,
    Inconclusive,
}

impl ComparisonOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Equal => "equal",
            Self::Different => "different",
            Self::Regressed => "regressed",
            Self::Fixed => "fixed",
            Self::BaselineFailed => "baseline_failed",
            Self::MissingArtifact => "missing_artifact",
            Self::Inconclusive => "inconclusive",
        }
    }

    fn from_str(value: &str) -> Self {
        match value {
            "equal" => Self::Equal,
            "different" => Self::Different,
            "regressed" => Self::Regressed,
            "fixed" => Self::Fixed,
            "baseline_failed" => Self::BaselineFailed,
            "missing_artifact" => Self::MissingArtifact,
            _ => Self::Inconclusive,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComparisonWarning {
    pub(crate) code: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComparisonDiffLine {
    pub(crate) kind: String,
    pub(crate) baseline_line: Option<usize>,
    pub(crate) candidate_line: Option<usize>,
    pub(crate) text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComparisonRunSummary {
    pub(crate) execution_id: String,
    pub(crate) present: bool,
    pub(crate) command: String,
    pub(crate) source_digest: String,
    pub(crate) status: String,
    pub(crate) exit_code: Option<i64>,
    pub(crate) started_at: i64,
    pub(crate) finished_at: Option<i64>,
    pub(crate) environment: Option<ExecutionEnvironment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BehaviorComparisonRecord {
    pub(crate) id: String,
    pub(crate) project_id: String,
    pub(crate) change_id: Option<String>,
    pub(crate) label: String,
    pub(crate) baseline_execution_id: String,
    pub(crate) candidate_execution_id: String,
    pub(crate) baseline: ComparisonRunSummary,
    pub(crate) candidate: ComparisonRunSummary,
    pub(crate) normalization: NormalizationRules,
    pub(crate) outcome: ComparisonOutcome,
    pub(crate) outputs_equal: bool,
    pub(crate) warnings: Vec<ComparisonWarning>,
    pub(crate) shared_services: Vec<String>,
    pub(crate) diff_lines: Vec<ComparisonDiffLine>,
    pub(crate) diff_truncated: bool,
    pub(crate) observed_scope: String,
    pub(crate) not_checked_scope: String,
    pub(crate) created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompareExecutionsRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    baseline_execution_id: String,
    candidate_execution_id: String,
    #[serde(default)]
    change_id: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    normalization: NormalizationRules,
    #[serde(default = "default_true")]
    persist: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteComparisonRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    comparison_id: String,
}

pub(crate) fn normalize_output(raw: &str, rules: &NormalizationRules) -> String {
    let mut text = raw.replace("\r\n", "\n");
    if rules.strip_ansi {
        text = strip_ansi_sequences(&text);
    }
    let mut lines: Vec<String> = text
        .split('\n')
        .map(|line| {
            let mut value = line.to_owned();
            if rules.strip_timestamps {
                value = normalize_timestamps(&value);
            }
            if rules.strip_durations {
                value = normalize_durations(&value);
            }
            if rules.trim_trailing_whitespace {
                value = value.trim_end().to_owned();
            }
            value
        })
        .collect();
    if rules.trim_trailing_whitespace {
        while lines.last().is_some_and(|line| line.is_empty()) {
            lines.pop();
        }
    }
    lines.join("\n")
}

fn strip_ansi_sequences(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            i += 2;
            while i < bytes.len() {
                let b = bytes[i];
                i += 1;
                if (0x40..=0x7e).contains(&b) {
                    break;
                }
            }
        } else {
            let ch = input[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn normalize_timestamps(line: &str) -> String {
    // Replaces ISO-8601 timestamps like 2026-11-25T18:10:24.123Z or 2026-11-25 18:10:24
    let bytes = line.as_bytes();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    while i < bytes.len() {
        if i + 19 <= bytes.len()
            && bytes[i].is_ascii_digit()
            && bytes[i + 1].is_ascii_digit()
            && bytes[i + 2].is_ascii_digit()
            && bytes[i + 3].is_ascii_digit()
            && bytes[i + 4] == b'-'
            && bytes[i + 5].is_ascii_digit()
            && bytes[i + 6].is_ascii_digit()
            && bytes[i + 7] == b'-'
            && bytes[i + 8].is_ascii_digit()
            && bytes[i + 9].is_ascii_digit()
            && (bytes[i + 10] == b'T' || bytes[i + 10] == b' ')
            && bytes[i + 11].is_ascii_digit()
            && bytes[i + 12].is_ascii_digit()
            && bytes[i + 13] == b':'
            && bytes[i + 14].is_ascii_digit()
            && bytes[i + 15].is_ascii_digit()
            && bytes[i + 16] == b':'
            && bytes[i + 17].is_ascii_digit()
            && bytes[i + 18].is_ascii_digit()
        {
            i += 19;
            if i < bytes.len() && bytes[i] == b'.' {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
            }
            if i < bytes.len() && bytes[i] == b'Z' {
                i += 1;
            } else if i + 6 <= bytes.len()
                && (bytes[i] == b'+' || bytes[i] == b'-')
                && bytes[i + 1].is_ascii_digit()
                && bytes[i + 2].is_ascii_digit()
                && bytes[i + 3] == b':'
                && bytes[i + 4].is_ascii_digit()
                && bytes[i + 5].is_ascii_digit()
            {
                i += 6;
            }
            out.push_str("<timestamp>");
            continue;
        }
        let ch = line[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn normalize_durations(line: &str) -> String {
    // Replaces standalone numeric durations such as 12ms, 1.45s, 0.03s, 320µs
    let bytes = line.as_bytes();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    while i < bytes.len() {
        let at_word_start =
            i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_');
        if at_word_start && bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i < bytes.len()
                && bytes[i] == b'.'
                && i + 1 < bytes.len()
                && bytes[i + 1].is_ascii_digit()
            {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
            }
            let unit_len = if line[i..].starts_with("ms")
                || line[i..].starts_with("ns")
                || line[i..].starts_with("us")
            {
                2
            } else if line[i..].starts_with('µ') && line[i + 'µ'.len_utf8()..].starts_with('s') {
                'µ'.len_utf8() + 1
            } else if line[i..].starts_with('s') {
                1
            } else {
                0
            };
            if unit_len > 0 {
                let after = i + unit_len;
                let at_word_end = after >= bytes.len()
                    || !(bytes[after].is_ascii_alphanumeric() || bytes[after] == b'_');
                if at_word_end {
                    out.push_str("<duration>");
                    i = after;
                    continue;
                }
            }
            out.push_str(&line[start..i]);
            continue;
        }
        let ch = line[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn compute_diff_lines(baseline: &str, candidate: &str) -> (Vec<ComparisonDiffLine>, bool) {
    let base_lines: Vec<&str> = if baseline.is_empty() {
        Vec::new()
    } else {
        baseline.split('\n').collect()
    };
    let cand_lines: Vec<&str> = if candidate.is_empty() {
        Vec::new()
    } else {
        candidate.split('\n').collect()
    };

    if base_lines == cand_lines {
        return (Vec::new(), false);
    }

    let mut raw_ops: Vec<ComparisonDiffLine> = Vec::new();
    let mut truncated = false;

    if base_lines.len() <= MAX_LCS_LINES && cand_lines.len() <= MAX_LCS_LINES {
        let n = base_lines.len();
        let m = cand_lines.len();
        let mut dp = vec![vec![0usize; m + 1]; n + 1];
        for i in (0..n).rev() {
            for j in (0..m).rev() {
                dp[i][j] = if base_lines[i] == cand_lines[j] {
                    dp[i + 1][j + 1] + 1
                } else {
                    dp[i + 1][j].max(dp[i][j + 1])
                };
            }
        }
        let mut i = 0;
        let mut j = 0;
        while i < n && j < m {
            if base_lines[i] == cand_lines[j] {
                raw_ops.push(ComparisonDiffLine {
                    kind: "context".to_owned(),
                    baseline_line: Some(i + 1),
                    candidate_line: Some(j + 1),
                    text: base_lines[i].to_owned(),
                });
                i += 1;
                j += 1;
            } else if dp[i + 1][j] >= dp[i][j + 1] {
                raw_ops.push(ComparisonDiffLine {
                    kind: "removed".to_owned(),
                    baseline_line: Some(i + 1),
                    candidate_line: None,
                    text: base_lines[i].to_owned(),
                });
                i += 1;
            } else {
                raw_ops.push(ComparisonDiffLine {
                    kind: "added".to_owned(),
                    baseline_line: None,
                    candidate_line: Some(j + 1),
                    text: cand_lines[j].to_owned(),
                });
                j += 1;
            }
        }
        while i < n {
            raw_ops.push(ComparisonDiffLine {
                kind: "removed".to_owned(),
                baseline_line: Some(i + 1),
                candidate_line: None,
                text: base_lines[i].to_owned(),
            });
            i += 1;
        }
        while j < m {
            raw_ops.push(ComparisonDiffLine {
                kind: "added".to_owned(),
                baseline_line: None,
                candidate_line: Some(j + 1),
                text: cand_lines[j].to_owned(),
            });
            j += 1;
        }
    } else {
        // Bounded line-by-line fallback for large outputs
        let max_len = base_lines.len().max(cand_lines.len());
        for idx in 0..max_len {
            match (base_lines.get(idx), cand_lines.get(idx)) {
                (Some(a), Some(b)) if a == b => raw_ops.push(ComparisonDiffLine {
                    kind: "context".to_owned(),
                    baseline_line: Some(idx + 1),
                    candidate_line: Some(idx + 1),
                    text: (*a).to_owned(),
                }),
                (Some(a), Some(b)) => {
                    raw_ops.push(ComparisonDiffLine {
                        kind: "removed".to_owned(),
                        baseline_line: Some(idx + 1),
                        candidate_line: None,
                        text: (*a).to_owned(),
                    });
                    raw_ops.push(ComparisonDiffLine {
                        kind: "added".to_owned(),
                        baseline_line: None,
                        candidate_line: Some(idx + 1),
                        text: (*b).to_owned(),
                    });
                }
                (Some(a), None) => raw_ops.push(ComparisonDiffLine {
                    kind: "removed".to_owned(),
                    baseline_line: Some(idx + 1),
                    candidate_line: None,
                    text: (*a).to_owned(),
                }),
                (None, Some(b)) => raw_ops.push(ComparisonDiffLine {
                    kind: "added".to_owned(),
                    baseline_line: None,
                    candidate_line: Some(idx + 1),
                    text: (*b).to_owned(),
                }),
                (None, None) => {}
            }
        }
    }

    // Keep 2 lines of surrounding context around changed lines for readability
    let changed_indices: Vec<usize> = raw_ops
        .iter()
        .enumerate()
        .filter_map(|(idx, line)| (line.kind != "context").then_some(idx))
        .collect();
    let mut filtered = Vec::new();
    for (idx, line) in raw_ops.into_iter().enumerate() {
        let near_change = changed_indices
            .iter()
            .any(|&changed| changed.abs_diff(idx) <= 2);
        if near_change {
            if filtered.len() >= MAX_DIFF_LINES {
                truncated = true;
                break;
            }
            filtered.push(line);
        }
    }
    (filtered, truncated)
}

fn is_non_terminal_or_mutated(status: &ExecutionStatus) -> bool {
    matches!(
        status,
        ExecutionStatus::Running
            | ExecutionStatus::Cancelled
            | ExecutionStatus::TimedOut
            | ExecutionStatus::StartFailed
            | ExecutionStatus::Interrupted
            | ExecutionStatus::Inconclusive
    )
}

fn is_effective_pass(record: &ExecutionRecord) -> bool {
    match record.status {
        ExecutionStatus::Passed => true,
        ExecutionStatus::Stale => record.exit_code == Some(0),
        _ => false,
    }
}

fn is_effective_fail(record: &ExecutionRecord) -> bool {
    match record.status {
        ExecutionStatus::Failed => true,
        ExecutionStatus::Stale => record.exit_code.is_some_and(|code| code != 0),
        _ => false,
    }
}

fn format_command(record: &ExecutionRecord) -> String {
    if record.args.is_empty() {
        record.program.clone()
    } else {
        format!("{} {}", record.program, record.args.join(" "))
    }
}

fn run_summary(id: &str, record: Option<&ExecutionRecord>) -> ComparisonRunSummary {
    match record {
        Some(item) => ComparisonRunSummary {
            execution_id: item.id.clone(),
            present: true,
            command: format_command(item),
            source_digest: item.source_digest.clone(),
            status: serde_json::to_string(&item.status)
                .unwrap_or_else(|_| "\"unknown\"".to_owned())
                .trim_matches('"')
                .to_owned(),
            exit_code: item.exit_code,
            started_at: item.started_at,
            finished_at: item.finished_at,
            environment: item.environment.clone(),
        },
        None => ComparisonRunSummary {
            execution_id: id.to_owned(),
            present: false,
            command: "(missing artifact)".to_owned(),
            source_digest: String::new(),
            status: "missing".to_owned(),
            exit_code: None,
            started_at: 0,
            finished_at: None,
            environment: None,
        },
    }
}

fn detect_workspace_shared_services(root: &Path) -> Vec<String> {
    let mut services = BTreeSet::new();
    let runs_toml = root.join(".laplace").join("runs.toml");
    if let Ok(content) = fs::read_to_string(&runs_toml) {
        if let Ok(parsed) = content.parse::<toml::Value>() {
            if let Some(table) = parsed.as_table() {
                for value in table.values() {
                    if let Some(items) = value.get("shared_services").and_then(|v| v.as_array()) {
                        for item in items {
                            if let Some(name) = item.as_str() {
                                let trimmed = name.trim();
                                if !trimmed.is_empty() {
                                    services.insert(trimmed.to_owned());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    for compose in [
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
    ] {
        if root.join(compose).is_file() {
            services.insert(format!("Shared containers ({compose})"));
        }
    }
    services.into_iter().collect()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn evaluate_comparison(
    id: String,
    project_id: String,
    change_id: Option<String>,
    label: Option<String>,
    baseline_id: &str,
    candidate_id: &str,
    baseline: Option<&ExecutionRecord>,
    candidate: Option<&ExecutionRecord>,
    normalization: NormalizationRules,
    shared_services: Vec<String>,
    created_at: i64,
) -> BehaviorComparisonRecord {
    let mut warnings = Vec::new();
    if !shared_services.is_empty() {
        warnings.push(ComparisonWarning {
            code: "shared_service_contamination".to_owned(),
            message: format!(
                "Workspace uses shared services ({}). State left by one run may affect the other.",
                shared_services.join(", ")
            ),
        });
    }

    let baseline_summary = run_summary(baseline_id, baseline);
    let candidate_summary = run_summary(candidate_id, candidate);

    let (base, cand) = match (baseline, candidate) {
        (Some(b), Some(c)) => (b, c),
        _ => {
            warnings.push(ComparisonWarning {
                code: "missing_artifact".to_owned(),
                message: "One or both recorded check artifacts are missing or were pruned."
                    .to_owned(),
            });
            return BehaviorComparisonRecord {
                id,
                project_id,
                change_id,
                label: label.unwrap_or_else(|| "Comparison (missing artifact)".to_owned()),
                baseline_execution_id: baseline_id.to_owned(),
                candidate_execution_id: candidate_id.to_owned(),
                baseline: baseline_summary,
                candidate: candidate_summary,
                normalization,
                outcome: ComparisonOutcome::MissingArtifact,
                outputs_equal: false,
                warnings,
                shared_services,
                diff_lines: Vec::new(),
                diff_truncated: false,
                observed_scope: "Recorded execution lookup in SQLite.".to_owned(),
                not_checked_scope:
                    "Could not compare outputs because at least one artifact is unavailable."
                        .to_owned(),
                created_at,
            };
        }
    };

    if base.program != cand.program || base.args != cand.args {
        warnings.push(ComparisonWarning {
            code: "different_command".to_owned(),
            message: format!(
                "Baseline ran `{}` while candidate ran `{}`.",
                format_command(base),
                format_command(cand)
            ),
        });
    }

    if base.source_digest == cand.source_digest {
        warnings.push(ComparisonWarning {
            code: "same_source_digest".to_owned(),
            message: "Both runs recorded the exact same source digest (no file edits between runs). Any difference indicates non-determinism or external state.".to_owned(),
        });
    }

    match (&base.environment, &cand.environment) {
        (Some(a), Some(b)) if a != b => {
            warnings.push(ComparisonWarning {
                code: "different_environment".to_owned(),
                message: format!(
                    "Environment changed between runs ({}/{} {} vs {}/{} {}).",
                    a.os,
                    a.arch,
                    a.program_version.as_deref().unwrap_or("unknown version"),
                    b.os,
                    b.arch,
                    b.program_version.as_deref().unwrap_or("unknown version")
                ),
            });
        }
        (None, Some(_)) | (Some(_), None) | (None, None) => {
            warnings.push(ComparisonWarning {
                code: "environment_unrecorded".to_owned(),
                message: "Toolchain/environment metadata was not recorded for at least one older check run.".to_owned(),
            });
        }
        _ => {}
    }

    if base.status == ExecutionStatus::Inconclusive || cand.status == ExecutionStatus::Inconclusive
    {
        warnings.push(ComparisonWarning {
            code: "source_mutated_during_run".to_owned(),
            message: "Source files changed while at least one check was executing.".to_owned(),
        });
    }

    let normalized_base = normalize_output(&base.output, &normalization);
    let normalized_cand = normalize_output(&cand.output, &normalization);
    let outputs_equal = normalized_base == normalized_cand && base.exit_code == cand.exit_code;
    let (diff_lines, diff_truncated) = compute_diff_lines(&normalized_base, &normalized_cand);

    let outcome = if is_non_terminal_or_mutated(&base.status)
        || is_non_terminal_or_mutated(&cand.status)
    {
        ComparisonOutcome::Inconclusive
    } else if is_effective_fail(base) && is_effective_pass(cand) {
        warnings.push(ComparisonWarning {
            code: "baseline_failed".to_owned(),
            message: format!(
                "Baseline check failed (exit {:?}) while candidate passed. Baseline failure is preserved for provenance.",
                base.exit_code
            ),
        });
        ComparisonOutcome::Fixed
    } else if is_effective_fail(base) && is_effective_fail(cand) {
        warnings.push(ComparisonWarning {
            code: "baseline_failed".to_owned(),
            message: format!(
                "Both baseline (exit {:?}) and candidate (exit {:?}) failed. Baseline failure is preserved rather than treated as passing.",
                base.exit_code, cand.exit_code
            ),
        });
        ComparisonOutcome::BaselineFailed
    } else if is_effective_pass(base) && is_effective_fail(cand) {
        ComparisonOutcome::Regressed
    } else if outputs_equal {
        ComparisonOutcome::Equal
    } else {
        ComparisonOutcome::Different
    };

    let computed_label = label
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            format!(
                "{} ({} → {})",
                format_command(cand),
                &base.source_digest[..base.source_digest.len().min(8)],
                &cand.source_digest[..cand.source_digest.len().min(8)]
            )
        });

    let active_rules = active_normalization_labels(&normalization);
    let observed_scope = format!(
        "Observed: exit code and stdout/stderr for `{}` across digests {} → {}{}.",
        format_command(cand),
        &base.source_digest[..base.source_digest.len().min(8)],
        &cand.source_digest[..cand.source_digest.len().min(8)],
        if active_rules.is_empty() {
            " (raw byte-exact comparison, no normalization)".to_owned()
        } else {
            format!(" (normalized: {})", active_rules.join(", "))
        }
    );
    let not_checked_scope = "Not checked: general behavioral equivalence, untested code paths, visual rendering, timing/performance, or external side effects outside recorded command output.".to_owned();

    BehaviorComparisonRecord {
        id,
        project_id,
        change_id,
        label: computed_label,
        baseline_execution_id: baseline_id.to_owned(),
        candidate_execution_id: candidate_id.to_owned(),
        baseline: baseline_summary,
        candidate: candidate_summary,
        normalization,
        outcome,
        outputs_equal,
        warnings,
        shared_services,
        diff_lines,
        diff_truncated,
        observed_scope,
        not_checked_scope,
        created_at,
    }
}

fn active_normalization_labels(rules: &NormalizationRules) -> Vec<&'static str> {
    let mut labels = Vec::new();
    if rules.strip_ansi {
        labels.push("ANSI codes stripped");
    }
    if rules.strip_timestamps {
        labels.push("ISO timestamps normalized");
    }
    if rules.strip_durations {
        labels.push("durations normalized");
    }
    if rules.trim_trailing_whitespace {
        labels.push("trailing whitespace trimmed");
    }
    labels
}

async fn load_execution_by_id(
    pool: &SqlitePool,
    project_id: &str,
    execution_id: &str,
    operation_id: &str,
) -> Result<Option<ExecutionRecord>, IpcError> {
    let row = sqlx::query(
        "SELECT id, project_id, change_id, command_json, source_digest, status, exit_code, output, started_at, finished_at, environment_json FROM executions WHERE project_id = ? AND id = ?",
    )
    .bind(project_id)
    .bind(execution_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "comparison_read_failed",
            "Recorded check artifact could not be loaded.",
            operation_id,
        )
    })?;
    match row {
        Some(row) => Ok(Some(parse_execution_row(&row, operation_id)?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub(crate) async fn compare_executions(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: CompareExecutionsRequest,
) -> Result<BehaviorComparisonRecord, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || request.project_id.trim().is_empty()
        || request.baseline_execution_id.trim().is_empty()
        || request.candidate_execution_id.trim().is_empty()
    {
        return Err(terminal_error(
            "invalid_comparison_request",
            "Select both a baseline check and a candidate check to compare.",
            &request.operation_id,
        ));
    }
    if request.baseline_execution_id == request.candidate_execution_id {
        return Err(terminal_error(
            "invalid_comparison_request",
            "Choose two different verification runs for baseline and candidate.",
            &request.operation_id,
        ));
    }

    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    let project_id = root.to_string_lossy().into_owned();
    let pool = open_domain_database(&app, &db).await?;

    let baseline = load_execution_by_id(
        &pool,
        &project_id,
        &request.baseline_execution_id,
        &request.operation_id,
    )
    .await?;
    let candidate = load_execution_by_id(
        &pool,
        &project_id,
        &request.candidate_execution_id,
        &request.operation_id,
    )
    .await?;
    let shared_services = detect_workspace_shared_services(&root);

    let comparison_id = crypto_operation_id();
    let created_at = now_ms();
    let record = evaluate_comparison(
        comparison_id,
        project_id.clone(),
        request.change_id.clone(),
        request.label.clone(),
        &request.baseline_execution_id,
        &request.candidate_execution_id,
        baseline.as_ref(),
        candidate.as_ref(),
        request.normalization,
        shared_services,
        created_at,
    );

    if request.persist {
        let normalization_json =
            serde_json::to_string(&record.normalization).unwrap_or_else(|_| "{}".to_owned());
        let warnings_json =
            serde_json::to_string(&record.warnings).unwrap_or_else(|_| "[]".to_owned());
        let shared_json =
            serde_json::to_string(&record.shared_services).unwrap_or_else(|_| "[]".to_owned());
        sqlx::query(
            "INSERT INTO behavior_comparisons (id, project_id, change_id, label, baseline_execution_id, candidate_execution_id, normalization_json, outcome, warnings_json, shared_services_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&record.id)
        .bind(&record.project_id)
        .bind(&record.change_id)
        .bind(&record.label)
        .bind(&record.baseline_execution_id)
        .bind(&record.candidate_execution_id)
        .bind(normalization_json)
        .bind(record.outcome.as_str())
        .bind(warnings_json)
        .bind(shared_json)
        .bind(record.created_at)
        .execute(&pool)
        .await
        .map_err(|_| {
            terminal_error(
                "comparison_write_failed",
                "Behavior comparison could not be saved.",
                &request.operation_id,
            )
        })?;
    }

    Ok(record)
}

#[tauri::command]
pub(crate) async fn list_behavior_comparisons(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: GitRequest,
) -> Result<Vec<BehaviorComparisonRecord>, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_comparison_request",
            "The comparison list request is invalid.",
            &request.operation_id,
        ));
    }
    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    let project_id = root.to_string_lossy().into_owned();
    let pool = open_domain_database(&app, &db).await?;
    let rows = sqlx::query(
        "SELECT id, project_id, change_id, label, baseline_execution_id, candidate_execution_id, normalization_json, outcome, shared_services_json, created_at FROM behavior_comparisons WHERE project_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .bind(&project_id)
    .fetch_all(&pool)
    .await
    .map_err(|_| {
        terminal_error(
            "comparison_list_failed",
            "Behavior comparisons could not be loaded.",
            &request.operation_id,
        )
    })?;

    let mut records = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.try_get("id").unwrap_or_default();
        let change_id: Option<String> = row.try_get("change_id").ok();
        let label: String = row.try_get("label").unwrap_or_default();
        let baseline_id: String = row.try_get("baseline_execution_id").unwrap_or_default();
        let candidate_id: String = row.try_get("candidate_execution_id").unwrap_or_default();
        let normalization: NormalizationRules = row
            .try_get::<String, _>("normalization_json")
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let shared_services: Vec<String> = row
            .try_get::<String, _>("shared_services_json")
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let created_at: i64 = row.try_get("created_at").unwrap_or_default();
        let stored_outcome = row
            .try_get::<String, _>("outcome")
            .ok()
            .map(|value| ComparisonOutcome::from_str(&value));

        let baseline =
            load_execution_by_id(&pool, &project_id, &baseline_id, &request.operation_id).await?;
        let candidate =
            load_execution_by_id(&pool, &project_id, &candidate_id, &request.operation_id).await?;
        let mut evaluated = evaluate_comparison(
            id,
            project_id.clone(),
            change_id,
            Some(label),
            &baseline_id,
            &candidate_id,
            baseline.as_ref(),
            candidate.as_ref(),
            normalization,
            shared_services,
            created_at,
        );
        if evaluated.outcome == ComparisonOutcome::MissingArtifact
            && stored_outcome.is_some_and(|prev| prev != ComparisonOutcome::MissingArtifact)
        {
            evaluated.warnings.push(ComparisonWarning {
                code: "artifact_pruned_after_save".to_owned(),
                message: "At least one referenced check artifact was pruned after this comparison was saved.".to_owned(),
            });
        }
        records.push(evaluated);
    }

    Ok(records)
}

#[tauri::command]
pub(crate) async fn delete_behavior_comparison(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: DeleteComparisonRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || request.comparison_id.trim().is_empty()
    {
        return Err(terminal_error(
            "invalid_comparison_request",
            "The comparison delete request is invalid.",
            &request.operation_id,
        ));
    }
    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The workspace is no longer available.",
            &request.operation_id,
        )
    })?;
    let project_id = root.to_string_lossy().into_owned();
    let pool = open_domain_database(&app, &db).await?;
    sqlx::query("DELETE FROM behavior_comparisons WHERE id = ? AND project_id = ?")
        .bind(&request.comparison_id)
        .bind(&project_id)
        .execute(&pool)
        .await
        .map_err(|_| {
            terminal_error(
                "comparison_delete_failed",
                "Behavior comparison could not be deleted.",
                &request.operation_id,
            )
        })?;
    Ok(())
}

#[cfg(test)]
mod compare_tests {
    use super::*;

    fn sample_exec(
        id: &str,
        digest: &str,
        status: ExecutionStatus,
        exit_code: Option<i64>,
        output: &str,
        env_os: Option<&str>,
    ) -> ExecutionRecord {
        ExecutionRecord {
            id: id.to_owned(),
            project_id: "/tmp/demo".to_owned(),
            change_id: None,
            program: "pnpm".to_owned(),
            args: vec!["test".to_owned()],
            source_digest: digest.to_owned(),
            files: vec!["src/index.ts".to_owned()],
            file_digests: Vec::new(),
            status,
            exit_code,
            output: output.to_owned(),
            started_at: 1_000,
            finished_at: Some(2_000),
            environment: env_os.map(|os| ExecutionEnvironment {
                os: os.to_owned(),
                arch: "aarch64".to_owned(),
                cwd: "/tmp/demo".to_owned(),
                program_version: Some("10.0.0".to_owned()),
            }),
        }
    }

    #[test]
    fn reproduces_equal_and_different_outputs_with_explicit_normalization() {
        let base = sample_exec(
            "e1",
            "aaaa1111",
            ExecutionStatus::Passed,
            Some(0),
            "\x1b[32mPASS\x1b[0m 2026-11-25T10:00:00Z 42ms\n3 tests passed\n",
            Some("macos"),
        );
        let cand_same_logic = sample_exec(
            "e2",
            "bbbb2222",
            ExecutionStatus::Passed,
            Some(0),
            "PASS 2026-11-25T10:05:12Z 89ms\n3 tests passed\n",
            Some("macos"),
        );

        // Default rules only strip ANSI — timestamp & duration differences remain visible
        let default_cmp = evaluate_comparison(
            "c1".to_owned(),
            "/tmp/demo".to_owned(),
            None,
            None,
            "e1",
            "e2",
            Some(&base),
            Some(&cand_same_logic),
            NormalizationRules::default(),
            Vec::new(),
            3_000,
        );
        assert_eq!(default_cmp.outcome, ComparisonOutcome::Different);
        assert!(!default_cmp.outputs_equal);
        assert!(!default_cmp.diff_lines.is_empty());

        // Enabling timestamp & duration normalization reproduces equal outcome
        let normalized_cmp = evaluate_comparison(
            "c2".to_owned(),
            "/tmp/demo".to_owned(),
            None,
            None,
            "e1",
            "e2",
            Some(&base),
            Some(&cand_same_logic),
            NormalizationRules {
                strip_ansi: true,
                strip_timestamps: true,
                strip_durations: true,
                trim_trailing_whitespace: true,
            },
            Vec::new(),
            3_000,
        );
        assert_eq!(normalized_cmp.outcome, ComparisonOutcome::Equal);
        assert!(normalized_cmp.outputs_equal);
        assert!(normalized_cmp.diff_lines.is_empty());
    }

    #[test]
    fn preserves_baseline_failure_and_flags_regression() {
        let fail_base = sample_exec(
            "e1",
            "aaaa1111",
            ExecutionStatus::Failed,
            Some(1),
            "FAIL test A\n",
            Some("macos"),
        );
        let pass_cand = sample_exec(
            "e2",
            "bbbb2222",
            ExecutionStatus::Passed,
            Some(0),
            "PASS test A\n",
            Some("macos"),
        );
        let fixed = evaluate_comparison(
            "c1".to_owned(),
            "/tmp/demo".to_owned(),
            None,
            None,
            "e1",
            "e2",
            Some(&fail_base),
            Some(&pass_cand),
            NormalizationRules::default(),
            Vec::new(),
            3_000,
        );
        assert_eq!(fixed.outcome, ComparisonOutcome::Fixed);
        assert!(fixed.warnings.iter().any(|w| w.code == "baseline_failed"));

        let still_failing = evaluate_comparison(
            "c2".to_owned(),
            "/tmp/demo".to_owned(),
            None,
            None,
            "e1",
            "e3",
            Some(&fail_base),
            Some(&sample_exec(
                "e3",
                "cccc3333",
                ExecutionStatus::Failed,
                Some(1),
                "FAIL test A\n",
                Some("macos"),
            )),
            NormalizationRules::default(),
            Vec::new(),
            3_000,
        );
        assert_eq!(still_failing.outcome, ComparisonOutcome::BaselineFailed);
        assert!(still_failing
            .warnings
            .iter()
            .any(|w| w.code == "baseline_failed"));

        let regressed = evaluate_comparison(
            "c3".to_owned(),
            "/tmp/demo".to_owned(),
            None,
            None,
            "e2",
            "e1",
            Some(&pass_cand),
            Some(&fail_base),
            NormalizationRules::default(),
            Vec::new(),
            3_000,
        );
        assert_eq!(regressed.outcome, ComparisonOutcome::Regressed);
    }

    #[test]
    fn surfaces_missing_artifact_source_mutation_and_environment_mismatch() {
        let missing = evaluate_comparison(
            "c1".to_owned(),
            "/tmp/demo".to_owned(),
            None,
            None,
            "missing-1",
            "e2",
            None,
            Some(&sample_exec(
                "e2",
                "bbbb2222",
                ExecutionStatus::Passed,
                Some(0),
                "ok\n",
                Some("macos"),
            )),
            NormalizationRules::default(),
            Vec::new(),
            3_000,
        );
        assert_eq!(missing.outcome, ComparisonOutcome::MissingArtifact);

        let mutated = evaluate_comparison(
            "c2".to_owned(),
            "/tmp/demo".to_owned(),
            None,
            None,
            "e1",
            "e2",
            Some(&sample_exec(
                "e1",
                "aaaa1111",
                ExecutionStatus::Inconclusive,
                Some(0),
                "ok\n",
                Some("macos"),
            )),
            Some(&sample_exec(
                "e2",
                "bbbb2222",
                ExecutionStatus::Passed,
                Some(0),
                "ok\n",
                Some("linux"),
            )),
            NormalizationRules::default(),
            vec!["postgres".to_owned()],
            3_000,
        );
        assert_eq!(mutated.outcome, ComparisonOutcome::Inconclusive);
        assert!(mutated
            .warnings
            .iter()
            .any(|w| w.code == "source_mutated_during_run"));
        assert!(mutated
            .warnings
            .iter()
            .any(|w| w.code == "different_environment"));
        assert!(mutated
            .warnings
            .iter()
            .any(|w| w.code == "shared_service_contamination"));
    }
}
