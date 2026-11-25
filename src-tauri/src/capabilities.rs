use super::*;
use std::collections::{BTreeMap, HashSet};

const MAX_SKILL_INSPECT_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapabilitySkillSummary {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) scope: String,
    pub(crate) precedence: String,
    pub(crate) base_dir: String,
    pub(crate) skill_file_path: String,
    pub(crate) digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapabilityMcpServerSummary {
    pub(crate) name: String,
    pub(crate) scope: String,
    pub(crate) source_path: String,
    pub(crate) override_path: Option<String>,
    pub(crate) transport: String,
    pub(crate) target: String,
    pub(crate) configured: String,
    pub(crate) config_enabled: bool,
    pub(crate) enabled: bool,
    pub(crate) connected: bool,
    pub(crate) connection_status: String,
    pub(crate) connection_note: String,
    pub(crate) authorization_policy: String,
    pub(crate) authorization_note: String,
    pub(crate) exposure: String,
    pub(crate) redacted_headers: Vec<String>,
    pub(crate) errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapabilityWorkspaceProviderSummary {
    pub(crate) id: String,
    pub(crate) endpoint: Option<String>,
    pub(crate) endpoint_fingerprint: String,
    pub(crate) missing_environment_variables: Vec<String>,
    pub(crate) source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookParityItem {
    pub(crate) id: String,
    pub(crate) feature: String,
    pub(crate) status: String,
    pub(crate) detail: String,
    #[serde(default)]
    pub(crate) terminal_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapabilityActivityRecord {
    pub(crate) id: String,
    pub(crate) project_id: String,
    pub(crate) session_id: Option<String>,
    pub(crate) capability_kind: String,
    pub(crate) capability_name: String,
    pub(crate) source_scope: String,
    pub(crate) decision: String,
    pub(crate) detail: String,
    pub(crate) created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillDirectories {
    pub(crate) project: String,
    pub(crate) global: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapabilitiesSnapshot {
    pub(crate) runtime_source: String,
    pub(crate) arbitrary_mcp_enabled: bool,
    pub(crate) project_trusted: bool,
    pub(crate) unreviewed_project_changes: bool,
    pub(crate) changed_project_areas: Vec<String>,
    pub(crate) acknowledged_at: Option<i64>,
    pub(crate) skill_directories: SkillDirectories,
    pub(crate) mcp_config_paths: SkillDirectories,
    pub(crate) skills: Vec<CapabilitySkillSummary>,
    pub(crate) mcp_servers: Vec<CapabilityMcpServerSummary>,
    pub(crate) mcp_errors: Vec<String>,
    pub(crate) workspace_providers: Vec<CapabilityWorkspaceProviderSummary>,
    pub(crate) parity_inventory: Vec<RookParityItem>,
    pub(crate) recent_activity: Vec<CapabilityActivityRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillInspectResult {
    pub(crate) name: String,
    pub(crate) scope: String,
    pub(crate) skill_file_path: String,
    pub(crate) digest: String,
    pub(crate) content: String,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InspectSkillRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    name: String,
    scope: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateMcpServerRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    action: String,
    scope: String,
    name: String,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    transport: Option<String>,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Option<Vec<String>>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecordCapabilityActivityRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    #[serde(default)]
    session_id: Option<String>,
    capability_kind: String,
    capability_name: String,
    source_scope: String,
    decision: String,
    #[serde(default)]
    detail: String,
}

fn default_parity_inventory() -> Vec<RookParityItem> {
    vec![
        RookParityItem {
            id: "provider-auth".to_owned(),
            feature: "Provider sign-in / sign-out".to_owned(),
            status: "native".to_owned(),
            detail: "Managed natively in Rook picker via stdio provider/login and provider/logout.".to_owned(),
            terminal_command: None,
        },
        RookParityItem {
            id: "model-selection".to_owned(),
            feature: "Model catalog & selection".to_owned(),
            status: "native".to_owned(),
            detail: "Rook-owned catalog and active model selection via model/list and model/select.".to_owned(),
            terminal_command: None,
        },
        RookParityItem {
            id: "ask-build-sessions".to_owned(),
            feature: "Ask & Build sessions with OS sandbox".to_owned(),
            status: "native".to_owned(),
            detail: "Process-pinned Ask (read-only) and Build (Seatbelt/bwrap sandbox) sessions.".to_owned(),
            terminal_command: None,
        },
        RookParityItem {
            id: "skills-inspect".to_owned(),
            feature: "Skills discovery & read-only SKILL.md inspection".to_owned(),
            status: "native".to_owned(),
            detail: "Inspects .rook/skills and ~/.rook/skills with precedence and digest provenance without executing skills.".to_owned(),
            terminal_command: None,
        },
        RookParityItem {
            id: "skills-manage".to_owned(),
            feature: "Install / remove skills from Git or local path".to_owned(),
            status: "terminal_handoff".to_owned(),
            detail: "Use Rook CLI in Terminal to install or remove skill directories.".to_owned(),
            terminal_command: Some("rook skills list".to_owned()),
        },
        RookParityItem {
            id: "mcp-config".to_owned(),
            feature: "MCP server configuration (mcp.json)".to_owned(),
            status: "native".to_owned(),
            detail: "Reads and edits Pi/Rook global and trusted project mcp.json files with secret redaction.".to_owned(),
            terminal_command: None,
        },
        RookParityItem {
            id: "mcp-runtime".to_owned(),
            feature: "Live MCP tool execution".to_owned(),
            status: "terminal_handoff".to_owned(),
            detail: "Blocked in Laplace stdio sessions (arbitraryMcp: false). Open Rook Terminal to connect and authorize MCP calls.".to_owned(),
            terminal_command: Some("rook".to_owned()),
        },
        RookParityItem {
            id: "project-memory".to_owned(),
            feature: "Repository memory & context compaction".to_owned(),
            status: "terminal_handoff".to_owned(),
            detail: "Interactive /memory and /compact workflows run in Rook Terminal.".to_owned(),
            terminal_command: Some("rook".to_owned()),
        },
        RookParityItem {
            id: "worktrees".to_owned(),
            feature: "Rook CLI worktree commands".to_owned(),
            status: "terminal_handoff".to_owned(),
            detail: "Laplace edits directly in the open repository; use Rook Terminal for manual worktrees.".to_owned(),
            terminal_command: Some("rook worktree list".to_owned()),
        },
    ]
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn rook_skill_dirs(root: &Path) -> (PathBuf, PathBuf) {
    let project = root.join(".rook").join("skills");
    let global_root = std::env::var_os("ROOK_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".rook"));
    (project, global_root.join("skills"))
}

fn mcp_config_paths(root: &Path) -> (PathBuf, PathBuf) {
    let project = root.join(".pi").join("mcp.json");
    let agent_dir = std::env::var_os("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".pi").join("agent"));
    (project, agent_dir.join("mcp.json"))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn parse_skill_frontmatter(content: &str, fallback_name: &str) -> (String, String) {
    let mut name = fallback_name.to_owned();
    let mut description = String::new();
    let trimmed = content.trim_start_matches('\u{feff}');
    if let Some(rest) = trimmed.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            let block = &rest[..end];
            for line in block.lines() {
                if let Some((key, value)) = line.split_once(':') {
                    let clean = value.trim().trim_matches('"').trim_matches('\'');
                    match key.trim() {
                        "name" if !clean.is_empty() => name = clean.to_owned(),
                        "description" if !clean.is_empty() => description = clean.to_owned(),
                        _ => {}
                    }
                }
            }
        }
    }
    (name, description)
}

fn scan_skills_in_dir(
    dir: &Path,
    scope: &str,
    seen: &mut HashSet<String>,
    out: &mut Vec<CapabilitySkillSummary>,
) {
    let Ok(meta) = fs::symlink_metadata(dir) else {
        return;
    };
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return;
    }
    let Ok(canonical_dir) = fs::canonicalize(dir) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&canonical_dir) else {
        return;
    };
    let mut child_paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|entry| entry.path()))
        .collect();
    child_paths.sort();

    for path in child_paths {
        let Ok(child_meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if child_meta.file_type().is_symlink() || !child_meta.is_dir() {
            continue;
        }
        let skill_file = path.join("SKILL.md");
        let Ok(file_meta) = fs::symlink_metadata(&skill_file) else {
            continue;
        };
        if file_meta.file_type().is_symlink() || !file_meta.is_file() {
            continue;
        }
        let Ok(canonical_file) = fs::canonicalize(&skill_file) else {
            continue;
        };
        if !canonical_file.starts_with(&canonical_dir) {
            continue;
        }
        let Ok(bytes) = fs::read(&canonical_file) else {
            continue;
        };
        let fallback_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("skill");
        let text = String::from_utf8_lossy(&bytes);
        let (name, description) = parse_skill_frontmatter(&text, fallback_name);
        let precedence = if seen.insert(name.clone()) {
            "active".to_owned()
        } else {
            "shadowed".to_owned()
        };
        out.push(CapabilitySkillSummary {
            name,
            description,
            scope: scope.to_owned(),
            precedence,
            base_dir: path.to_string_lossy().into_owned(),
            skill_file_path: canonical_file.to_string_lossy().into_owned(),
            digest: sha256_bytes(&bytes),
        });
    }
}

fn sanitize_http_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("MCP HTTP transport requires an http:// or https:// URL.".to_owned());
    }
    let scheme_end = trimmed.find("://").unwrap() + 3;
    let rest = &trimmed[scheme_end..];
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.contains('@') {
        return Err("Embedded URL credentials are not allowed in mcp.json.".to_owned());
    }
    if authority.is_empty() {
        return Err("Invalid HTTP(S) URL.".to_owned());
    }
    Ok(trimmed.to_owned())
}

fn redact_cli_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    for (idx, arg) in args.iter().enumerate() {
        let prev_sensitive = idx > 0 && {
            let p = args[idx - 1].to_ascii_lowercase();
            p.contains("token")
                || p.contains("key")
                || p.contains("secret")
                || p.contains("password")
                || p.contains("auth")
        };
        let lower = arg.to_ascii_lowercase();
        let arg_sensitive = lower.starts_with("--token=")
            || lower.starts_with("--api-key=")
            || lower.starts_with("--secret=")
            || lower.starts_with("--password=")
            || lower.contains("bearer ")
            || arg.starts_with("sk-")
            || arg.starts_with("ghp_");
        if prev_sensitive || arg_sensitive {
            if let Some(eq) = arg.find('=') {
                out.push(format!("{}[redacted]", &arg[..=eq]));
            } else {
                out.push("[redacted]".to_owned());
            }
        } else {
            out.push(arg.clone());
        }
    }
    out
}

fn parse_mcp_json_file(
    path: &Path,
    scope: &str,
    entries: &mut BTreeMap<String, (String, String, Option<String>, serde_json::Value)>,
    errors: &mut Vec<String>,
) {
    if !path.is_file() {
        return;
    }
    let Ok(raw) = fs::read_to_string(path) else {
        errors.push(format!("{}: could not be read.", path.display()));
        return;
    };
    let parsed: serde_json::Value = match serde_json::from_str(raw.trim_start_matches('\u{feff}')) {
        Ok(value) => value,
        Err(err) => {
            errors.push(format!("{}: invalid JSON ({err})", path.display()));
            return;
        }
    };
    let Some(obj) = parsed.as_object() else {
        errors.push(format!(
            "{}: expected a JSON object with \"mcpServers\".",
            path.display()
        ));
        return;
    };
    let Some(servers) = obj.get("mcpServers").and_then(|v| v.as_object()) else {
        return;
    };
    let path_str = path.to_string_lossy().into_owned();
    for (name, value) in servers {
        let Some(server_obj) = value.as_object() else {
            errors.push(format!(
                "{}: server \"{name}\" must be an object.",
                path_str
            ));
            continue;
        };
        let is_override = scope == "project"
            && !server_obj.contains_key("command")
            && !server_obj.contains_key("url")
            && !server_obj.contains_key("type");
        if is_override {
            if let Some((orig_scope, orig_source, _, orig_val)) = entries.get(name).cloned() {
                let mut merged = orig_val.as_object().cloned().unwrap_or_default();
                for (k, v) in server_obj {
                    merged.insert(k.clone(), v.clone());
                }
                entries.insert(
                    name.clone(),
                    (
                        orig_scope,
                        orig_source,
                        Some(path_str.clone()),
                        serde_json::Value::Object(merged),
                    ),
                );
            } else {
                errors.push(format!(
                    "{}: project override \"{name}\" requires a global server or a command/url.",
                    path_str
                ));
            }
            continue;
        }
        entries.insert(
            name.clone(),
            (scope.to_owned(), path_str.clone(), None, value.clone()),
        );
    }
}

fn summarize_mcp_server(
    name: String,
    scope: String,
    source_path: String,
    override_path: Option<String>,
    raw: &serde_json::Value,
    project_trusted: bool,
) -> CapabilityMcpServerSummary {
    let mut errors = Vec::new();
    let config_enabled = raw.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
    let exposure = raw
        .get("exposure")
        .and_then(|v| v.as_str())
        .unwrap_or("codemode")
        .to_owned();
    let mut redacted_headers = Vec::new();
    if let Some(headers) = raw.get("headers").and_then(|v| v.as_object()) {
        for key in headers.keys() {
            redacted_headers.push(format!("{key} (redacted)"));
        }
    }
    if let Some(env_map) = raw.get("env").and_then(|v| v.as_object()) {
        for key in env_map.keys() {
            redacted_headers.push(format!("env:{key} (redacted)"));
        }
    }

    let (transport, target) = if let Some(cmd) = raw
        .get("command")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let args: Vec<String> = raw
            .get("args")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let redacted = redact_cli_args(&args);
        let full = if redacted.is_empty() {
            cmd.to_owned()
        } else {
            format!("{cmd} {}", redacted.join(" "))
        };
        ("stdio".to_owned(), full)
    } else if let Some(url) = raw
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if scope == "project" && raw.get("auth").is_some() {
            errors.push(
                "Project mcp.json cannot set \"auth\"; define auth only in global mcp.json."
                    .to_owned(),
            );
        }
        match sanitize_http_url(url) {
            Ok(clean) => ("http".to_owned(), clean),
            Err(err) => {
                errors.push(err);
                ("invalid".to_owned(), "[invalid or redacted URL]".to_owned())
            }
        }
    } else {
        errors.push(
            "Server entry must define either a non-empty \"command\" (stdio) or \"url\" (http)."
                .to_owned(),
        );
        ("invalid".to_owned(), "(unconfigured)".to_owned())
    };

    let configured = if errors.is_empty() {
        "valid".to_owned()
    } else {
        "invalid".to_owned()
    };
    let effective_enabled =
        configured == "valid" && config_enabled && (scope == "global" || project_trusted);

    let (connection_status, connection_note) = if configured == "invalid" {
        (
            "invalid_config".to_owned(),
            errors
                .first()
                .cloned()
                .unwrap_or_else(|| "Configuration is invalid.".to_owned()),
        )
    } else if scope == "project" && !project_trusted {
        (
            "untrusted_project".to_owned(),
            "Project MCP configuration is inactive until this workspace is trusted.".to_owned(),
        )
    } else if !config_enabled {
        ("disabled".to_owned(), "Disabled in mcp.json.".to_owned())
    } else {
        (
            "blocked_by_stdio_policy".to_owned(),
            "Not connected: Laplace stdio sessions pin arbitraryMcp=false. Use Rook Terminal to connect and invoke MCP tools.".to_owned(),
        )
    };

    CapabilityMcpServerSummary {
        name,
        scope,
        source_path,
        override_path,
        transport,
        target,
        configured,
        config_enabled,
        enabled: effective_enabled,
        connected: false,
        connection_status,
        connection_note,
        authorization_policy: "approval_required".to_owned(),
        authorization_note:
            "Enabled is not authorized: Rook enforces per-call or session approval before invoking any MCP tool."
                .to_owned(),
        exposure,
        redacted_headers,
        errors,
    }
}

fn scan_workspace_providers(root: &Path) -> Vec<CapabilityWorkspaceProviderSummary> {
    let models_path = root.join("models.json");
    let Ok(raw) = fs::read_to_string(&models_path) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(providers) = parsed.get("providers").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (id, value) in providers {
        let endpoint = value
            .get("baseUrl")
            .and_then(|v| v.as_str())
            .map(str::to_owned);
        let mut missing = Vec::new();
        if let Some(api_key) = value.get("apiKey").and_then(|v| v.as_str()) {
            if let Some(var_name) = api_key.strip_prefix('$') {
                if std::env::var_os(var_name).is_none() {
                    missing.push(var_name.to_owned());
                }
            }
        }
        let fingerprint = sha256_bytes(value.to_string().as_bytes())[..16].to_owned();
        out.push(CapabilityWorkspaceProviderSummary {
            id: id.clone(),
            endpoint,
            endpoint_fingerprint: fingerprint,
            missing_environment_variables: missing,
            source: "workspace".to_owned(),
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn compute_project_capability_digests(root: &Path) -> (String, String, String) {
    let mut skills_hasher = Sha256::new();
    let project_skills_dir = root.join(".rook").join("skills");
    let mut seen = HashSet::new();
    let mut project_skills = Vec::new();
    scan_skills_in_dir(
        &project_skills_dir,
        "project",
        &mut seen,
        &mut project_skills,
    );
    for skill in &project_skills {
        skills_hasher.update(skill.name.as_bytes());
        skills_hasher.update(b":");
        skills_hasher.update(skill.digest.as_bytes());
        skills_hasher.update(b"\n");
    }
    let skills_digest = if project_skills.is_empty() {
        String::new()
    } else {
        format!("{:x}", skills_hasher.finalize())
    };

    let mcp_digest = fs::read(root.join(".pi").join("mcp.json"))
        .map(|bytes| sha256_bytes(&bytes))
        .unwrap_or_default();

    let providers_digest = fs::read(root.join("models.json"))
        .map(|bytes| sha256_bytes(&bytes))
        .unwrap_or_default();

    (skills_digest, mcp_digest, providers_digest)
}

async fn check_workspace_trust(
    pool: &SqlitePool,
    trusted: &TrustedWorkspaces,
    root: &Path,
) -> bool {
    if trusted.contains(root).unwrap_or(false) {
        return true;
    }
    let row = sqlx::query("SELECT project_id FROM trusted_workspaces WHERE project_id = ?")
        .bind(root.to_string_lossy().as_ref())
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    if row.is_some() {
        if let Ok(mut guard) = trusted.0.lock() {
            guard.insert(root.to_string_lossy().into_owned());
        }
        return true;
    }
    false
}

async fn send_rook_workspace_rpc(
    processes: &RookProcesses,
    root: &Path,
    method: &str,
    params: serde_json::Value,
    operation_id: &str,
) -> Result<Option<serde_json::Value>, IpcError> {
    let target_process = {
        let guard = processes.0.lock().map_err(|_| {
            terminal_error(
                "rook_busy",
                "Rook sessions are temporarily unavailable.",
                operation_id,
            )
        })?;
        guard.values().find_map(|proc_arc| {
            let matches = proc_arc
                .lock()
                .map(|p| p.workspace_path == root)
                .unwrap_or(false);
            matches.then(|| Arc::clone(proc_arc))
        })
    };
    let Some(process) = target_process else {
        return Ok(None);
    };

    let (id, receiver) = {
        let mut guard = process.lock().map_err(|_| {
            terminal_error(
                "rook_busy",
                "Rook session is temporarily unavailable.",
                operation_id,
            )
        })?;
        let id = guard.next_request.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = tokio::sync::oneshot::channel();
        guard
            .pending
            .lock()
            .map_err(|_| {
                terminal_error(
                    "rook_busy",
                    "Rook responses are temporarily unavailable.",
                    operation_id,
                )
            })?
            .insert(id, sender);
        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        if writeln!(guard.stdin, "{message}").is_err() {
            let _ = guard.pending.lock().map(|mut m| m.remove(&id));
            return Err(terminal_error(
                "rook_protocol_failed",
                "Could not send capability request to Rook.",
                operation_id,
            ));
        }
        (id, receiver)
    };

    let response = match tokio::time::timeout(std::time::Duration::from_secs(15), receiver).await {
        Ok(Ok(response)) => response,
        _ => {
            if let Ok(guard) = process.lock() {
                let _ = guard.pending.lock().map(|mut m| m.remove(&id));
            }
            return Err(terminal_error(
                "rook_protocol_timeout",
                "Rook did not respond to the capability request in time.",
                operation_id,
            ));
        }
    };
    if !response["error"].is_null() {
        let code = response["error"]["code"].as_i64().unwrap_or(0);
        if code == -32601 {
            // Older Rook checkout without capabilities RPCs -> allow fallback
            return Ok(None);
        }
        return Err(terminal_error(
            "rook_capability_error",
            response["error"]["message"]
                .as_str()
                .unwrap_or("Rook rejected the capability request."),
            operation_id,
        ));
    }
    Ok(Some(response["result"].clone()))
}

fn build_disk_snapshot(root: &Path, project_trusted: bool) -> CapabilitiesSnapshot {
    let (project_skills_dir, global_skills_dir) = rook_skill_dirs(root);
    let (project_mcp_path, global_mcp_path) = mcp_config_paths(root);

    let mut seen = HashSet::new();
    let mut skills = Vec::new();
    scan_skills_in_dir(&project_skills_dir, "project", &mut seen, &mut skills);
    scan_skills_in_dir(&global_skills_dir, "global", &mut seen, &mut skills);

    let mut entries = BTreeMap::new();
    let mut mcp_errors = Vec::new();
    parse_mcp_json_file(&global_mcp_path, "global", &mut entries, &mut mcp_errors);
    parse_mcp_json_file(&project_mcp_path, "project", &mut entries, &mut mcp_errors);
    let mcp_servers = entries
        .into_iter()
        .map(|(name, (scope, source_path, override_path, raw))| {
            summarize_mcp_server(
                name,
                scope,
                source_path,
                override_path,
                &raw,
                project_trusted,
            )
        })
        .collect();

    let workspace_providers = scan_workspace_providers(root);

    CapabilitiesSnapshot {
        runtime_source: "disk_fallback".to_owned(),
        arbitrary_mcp_enabled: false,
        project_trusted,
        unreviewed_project_changes: false,
        changed_project_areas: Vec::new(),
        acknowledged_at: None,
        skill_directories: SkillDirectories {
            project: project_skills_dir.to_string_lossy().into_owned(),
            global: global_skills_dir.to_string_lossy().into_owned(),
        },
        mcp_config_paths: SkillDirectories {
            project: project_mcp_path.to_string_lossy().into_owned(),
            global: global_mcp_path.to_string_lossy().into_owned(),
        },
        skills,
        mcp_servers,
        mcp_errors,
        workspace_providers,
        parity_inventory: default_parity_inventory(),
        recent_activity: Vec::new(),
    }
}

async fn attach_review_and_activity(
    pool: &SqlitePool,
    root: &Path,
    snapshot: &mut CapabilitiesSnapshot,
) {
    let project_id = root.to_string_lossy().into_owned();
    let (skills_digest, mcp_digest, providers_digest) = compute_project_capability_digests(root);
    let has_any_project_caps =
        !skills_digest.is_empty() || !mcp_digest.is_empty() || !providers_digest.is_empty();

    let saved = sqlx::query(
        "SELECT skills_digest, mcp_digest, providers_digest, acknowledged_at FROM workspace_capability_reviews WHERE project_id = ?",
    )
    .bind(&project_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let mut changed_areas = Vec::new();
    match saved {
        Some(row) => {
            let prev_skills: String = row.try_get("skills_digest").unwrap_or_default();
            let prev_mcp: String = row.try_get("mcp_digest").unwrap_or_default();
            let prev_providers: String = row.try_get("providers_digest").unwrap_or_default();
            snapshot.acknowledged_at = row.try_get("acknowledged_at").ok();
            if prev_skills != skills_digest && !skills_digest.is_empty() {
                changed_areas.push(".rook/skills".to_owned());
            }
            if prev_mcp != mcp_digest && !mcp_digest.is_empty() {
                changed_areas.push(".pi/mcp.json".to_owned());
            }
            if prev_providers != providers_digest && !providers_digest.is_empty() {
                changed_areas.push("models.json".to_owned());
            }
        }
        None if has_any_project_caps => {
            if !skills_digest.is_empty() {
                changed_areas.push(".rook/skills".to_owned());
            }
            if !mcp_digest.is_empty() {
                changed_areas.push(".pi/mcp.json".to_owned());
            }
            if !providers_digest.is_empty() {
                changed_areas.push("models.json".to_owned());
            }
        }
        None => {}
    }

    snapshot.unreviewed_project_changes = !changed_areas.is_empty();
    snapshot.changed_project_areas = changed_areas;

    let activity_rows = sqlx::query(
        "SELECT id, project_id, session_id, capability_kind, capability_name, source_scope, decision, detail, created_at FROM capability_activity WHERE project_id = ? ORDER BY created_at DESC LIMIT 30",
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    snapshot.recent_activity = activity_rows
        .into_iter()
        .map(|row| CapabilityActivityRecord {
            id: row.try_get("id").unwrap_or_default(),
            project_id: row.try_get("project_id").unwrap_or_default(),
            session_id: row.try_get("session_id").ok(),
            capability_kind: row.try_get("capability_kind").unwrap_or_default(),
            capability_name: row.try_get("capability_name").unwrap_or_default(),
            source_scope: row.try_get("source_scope").unwrap_or_default(),
            decision: row.try_get("decision").unwrap_or_default(),
            detail: row.try_get("detail").unwrap_or_default(),
            created_at: row.try_get("created_at").unwrap_or_default(),
        })
        .collect();
}

fn parse_rook_snapshot_json(
    value: serde_json::Value,
    fallback: &CapabilitiesSnapshot,
) -> CapabilitiesSnapshot {
    CapabilitiesSnapshot {
        runtime_source: "rook_stdio".to_owned(),
        arbitrary_mcp_enabled: false,
        project_trusted: fallback.project_trusted,
        unreviewed_project_changes: false,
        changed_project_areas: Vec::new(),
        acknowledged_at: None,
        skill_directories: serde_json::from_value(value["skillDirectories"].clone())
            .unwrap_or_else(|_| fallback.skill_directories.clone()),
        mcp_config_paths: serde_json::from_value(value["mcpConfigPaths"].clone())
            .unwrap_or_else(|_| fallback.mcp_config_paths.clone()),
        skills: serde_json::from_value(value["skills"].clone())
            .unwrap_or_else(|_| fallback.skills.clone()),
        mcp_servers: serde_json::from_value(value["mcpServers"].clone())
            .unwrap_or_else(|_| fallback.mcp_servers.clone()),
        mcp_errors: serde_json::from_value(value["mcpErrors"].clone())
            .unwrap_or_else(|_| fallback.mcp_errors.clone()),
        workspace_providers: serde_json::from_value(value["workspaceProviders"].clone())
            .unwrap_or_else(|_| fallback.workspace_providers.clone()),
        parity_inventory: serde_json::from_value(value["parityInventory"].clone())
            .unwrap_or_else(|_| default_parity_inventory()),
        recent_activity: Vec::new(),
    }
}

#[tauri::command]
pub(crate) async fn get_capabilities_snapshot(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    processes: tauri::State<'_, RookProcesses>,
    request: GitRequest,
) -> Result<CapabilitiesSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_capabilities_request",
            "The capabilities request is invalid.",
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
    let pool = open_domain_database(&app, &db).await?;
    let project_trusted = check_workspace_trust(&pool, &trusted, &root).await;
    let fallback = build_disk_snapshot(&root, project_trusted);

    let mut snapshot = match send_rook_workspace_rpc(
        &processes,
        &root,
        "capabilities/snapshot",
        serde_json::json!({ "projectTrusted": project_trusted }),
        &request.operation_id,
    )
    .await
    {
        Ok(Some(value)) => parse_rook_snapshot_json(value, &fallback),
        _ => fallback,
    };

    attach_review_and_activity(&pool, &root, &mut snapshot).await;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn inspect_skill_source(
    processes: tauri::State<'_, RookProcesses>,
    request: InspectSkillRequest,
) -> Result<SkillInspectResult, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || request.name.trim().is_empty()
        || (request.scope != "project" && request.scope != "global")
    {
        return Err(terminal_error(
            "invalid_skill_inspect",
            "A valid skill name and scope are required.",
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

    if let Ok(Some(value)) = send_rook_workspace_rpc(
        &processes,
        &root,
        "skills/inspect",
        serde_json::json!({ "name": request.name, "scope": request.scope }),
        &request.operation_id,
    )
    .await
    {
        if let Ok(parsed) = serde_json::from_value::<SkillInspectResult>(value) {
            return Ok(parsed);
        }
    }

    inspect_skill_from_disk(&root, &request.name, &request.scope, &request.operation_id)
}

fn inspect_skill_from_disk(
    root: &Path,
    name: &str,
    scope: &str,
    operation_id: &str,
) -> Result<SkillInspectResult, IpcError> {
    let (project_dir, global_dir) = rook_skill_dirs(root);
    let target_dir = if scope == "project" {
        project_dir
    } else {
        global_dir
    };
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    scan_skills_in_dir(&target_dir, scope, &mut seen, &mut found);
    let skill = found
        .into_iter()
        .find(|item| item.name == name)
        .ok_or_else(|| {
            terminal_error(
                "skill_not_found",
                &format!("No {scope} skill named \"{name}\" was found."),
                operation_id,
            )
        })?;
    let canonical_root = fs::canonicalize(&target_dir).map_err(|_| {
        terminal_error(
            "skill_read_denied",
            "Managed skill directory could not be verified.",
            operation_id,
        )
    })?;
    let canonical_file = fs::canonicalize(&skill.skill_file_path).map_err(|_| {
        terminal_error(
            "skill_read_denied",
            "Skill instruction file could not be verified.",
            operation_id,
        )
    })?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err(terminal_error(
            "skill_read_denied",
            "Refusing to read skill instructions outside Rook's managed skill directory.",
            operation_id,
        ));
    }
    let bytes = fs::read(&canonical_file).map_err(|_| {
        terminal_error(
            "skill_read_failed",
            "Skill instructions could not be read.",
            operation_id,
        )
    })?;
    let truncated = bytes.len() > MAX_SKILL_INSPECT_BYTES;
    let slice = if truncated {
        &bytes[..MAX_SKILL_INSPECT_BYTES]
    } else {
        &bytes[..]
    };
    Ok(SkillInspectResult {
        name: skill.name,
        scope: skill.scope,
        skill_file_path: canonical_file.to_string_lossy().into_owned(),
        digest: sha256_bytes(&bytes),
        content: String::from_utf8_lossy(slice).into_owned(),
        truncated,
    })
}

#[tauri::command]
pub(crate) async fn update_mcp_server_config(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    processes: tauri::State<'_, RookProcesses>,
    request: UpdateMcpServerRequest,
) -> Result<CapabilitiesSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || !matches!(request.action.as_str(), "toggle" | "add" | "remove")
        || !matches!(request.scope.as_str(), "global" | "project")
        || request.name.trim().is_empty()
    {
        return Err(terminal_error(
            "invalid_mcp_update",
            "MCP server action, scope, and name are required.",
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
    let pool = open_domain_database(&app, &db).await?;
    let project_trusted = check_workspace_trust(&pool, &trusted, &root).await;
    if request.scope == "project" && !project_trusted {
        return Err(terminal_error(
            "workspace_not_trusted",
            "Trust this workspace before changing project MCP configuration.",
            &request.operation_id,
        ));
    }

    let rpc_params = serde_json::json!({
        "action": request.action,
        "scope": request.scope,
        "name": request.name,
        "enabled": request.enabled,
        "transport": request.transport,
        "command": request.command,
        "args": request.args,
        "url": request.url,
        "projectTrusted": project_trusted,
    });
    let rpc_result = send_rook_workspace_rpc(
        &processes,
        &root,
        "mcp/update",
        rpc_params,
        &request.operation_id,
    )
    .await?
    .ok_or_else(|| {
        terminal_error(
            "rook_session_required",
            "Open the Rook tab to connect Rook first so MCP configuration changes round-trip through Rook.",
            &request.operation_id,
        )
    })?;

    let project_id = root.to_string_lossy().into_owned();
    let _ = sqlx::query(
        "INSERT INTO capability_activity (id, project_id, session_id, capability_kind, capability_name, source_scope, decision, detail, created_at) VALUES (?, ?, NULL, 'mcp_config', ?, ?, ?, ?, ?)",
    )
    .bind(crypto_operation_id())
    .bind(&project_id)
    .bind(&request.name)
    .bind(&request.scope)
    .bind(&request.action)
    .bind(format!(
        "Updated {} MCP server \"{}\" via Rook ({})",
        request.scope, request.name, request.action
    ))
    .bind(now_ms())
    .execute(&pool)
    .await;

    let fallback = build_disk_snapshot(&root, project_trusted);
    let mut snapshot = parse_rook_snapshot_json(rpc_result, &fallback);
    attach_review_and_activity(&pool, &root, &mut snapshot).await;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn acknowledge_workspace_capabilities(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    trusted: tauri::State<'_, TrustedWorkspaces>,
    processes: tauri::State<'_, RookProcesses>,
    request: GitRequest,
) -> Result<CapabilitiesSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_capabilities_request",
            "The capability acknowledgement request is invalid.",
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
    let pool = open_domain_database(&app, &db).await?;
    let project_id = root.to_string_lossy().into_owned();
    let (skills_digest, mcp_digest, providers_digest) = compute_project_capability_digests(&root);
    let now = now_ms();
    sqlx::query(
        "INSERT INTO workspace_capability_reviews (project_id, skills_digest, mcp_digest, providers_digest, acknowledged_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET skills_digest = excluded.skills_digest, mcp_digest = excluded.mcp_digest, providers_digest = excluded.providers_digest, acknowledged_at = excluded.acknowledged_at",
    )
    .bind(&project_id)
    .bind(&skills_digest)
    .bind(&mcp_digest)
    .bind(&providers_digest)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|_| {
        terminal_error(
            "capability_review_save_failed",
            "Capability review acknowledgement could not be saved.",
            &request.operation_id,
        )
    })?;

    get_capabilities_snapshot(app, db, trusted, processes, request).await
}

#[tauri::command]
pub(crate) async fn record_capability_activity(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: RecordCapabilityActivityRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION
        || !validate_operation_id(&request.operation_id)
        || request.capability_name.trim().is_empty()
    {
        return Err(terminal_error(
            "invalid_capability_activity",
            "Invalid capability activity record.",
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
    let pool = open_domain_database(&app, &db).await?;
    sqlx::query(
        "INSERT INTO capability_activity (id, project_id, session_id, capability_kind, capability_name, source_scope, decision, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(crypto_operation_id())
    .bind(root.to_string_lossy().as_ref())
    .bind(&request.session_id)
    .bind(&request.capability_kind)
    .bind(&request.capability_name)
    .bind(&request.source_scope)
    .bind(&request.decision)
    .bind(request.detail.chars().take(400).collect::<String>())
    .bind(now_ms())
    .execute(&pool)
    .await
    .map_err(|_| {
        terminal_error(
            "capability_activity_write_failed",
            "Capability activity could not be saved.",
            &request.operation_id,
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod capabilities_tests {
    use super::*;

    #[test]
    fn redacts_mcp_secrets_and_distinguishes_configured_enabled_connected_authorized() {
        let dir = std::env::temp_dir().join(format!("laplace-cap-{}", crypto_operation_id()));
        fs::create_dir_all(dir.join(".pi")).unwrap();
        fs::write(
            dir.join(".pi").join("mcp.json"),
            r#"{
              "mcpServers": {
                "docs": {
                  "url": "https://docs.example.com/mcp",
                  "headers": { "Authorization": "Bearer secret-token-999" }
                },
                "cli": {
                  "command": "npx",
                  "args": ["-y", "tool", "--token", "sk-secret-abc12345"]
                }
              }
            }"#,
        )
        .unwrap();

        let untrusted = build_disk_snapshot(&dir, false);
        let json = serde_json::to_string(&untrusted).unwrap();
        assert!(!json.contains("secret-token-999"));
        assert!(!json.contains("sk-secret-abc12345"));

        let docs = untrusted
            .mcp_servers
            .iter()
            .find(|s| s.name == "docs")
            .unwrap();
        assert_eq!(docs.configured, "valid");
        assert!(!docs.enabled);
        assert!(!docs.connected);
        assert_eq!(docs.connection_status, "untrusted_project");
        assert_eq!(docs.authorization_policy, "approval_required");

        let trusted = build_disk_snapshot(&dir, true);
        let docs_trusted = trusted
            .mcp_servers
            .iter()
            .find(|s| s.name == "docs")
            .unwrap();
        assert!(docs_trusted.enabled);
        assert!(!docs_trusted.connected);
        assert_eq!(docs_trusted.connection_status, "blocked_by_stdio_policy");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn inspects_project_skill_without_executing_and_rejects_outside_paths() {
        let dir = std::env::temp_dir().join(format!("laplace-skill-{}", crypto_operation_id()));
        let skill_dir = dir.join(".rook").join("skills").join("reviewer");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: reviewer\ndescription: Inspect diffs safely\n---\n# Reviewer\nRead-only instructions.\n",
        )
        .unwrap();

        let inspected = inspect_skill_from_disk(&dir, "reviewer", "project", "op-1").unwrap();
        assert_eq!(inspected.name, "reviewer");
        assert!(inspected.content.contains("Read-only instructions."));
        assert!(!inspected.truncated);

        let missing = inspect_skill_from_disk(&dir, "../etc/passwd", "project", "op-2");
        assert!(missing.is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_project_capability_digests_for_review_warnings() {
        let dir = std::env::temp_dir().join(format!("laplace-dig-{}", crypto_operation_id()));
        fs::create_dir_all(dir.join(".pi")).unwrap();
        fs::write(dir.join(".pi").join("mcp.json"), r#"{"mcpServers":{}}"#).unwrap();

        let (skills1, mcp1, providers1) = compute_project_capability_digests(&dir);
        assert!(skills1.is_empty());
        assert!(!mcp1.is_empty());
        assert!(providers1.is_empty());

        fs::write(
            dir.join(".pi").join("mcp.json"),
            r#"{"mcpServers":{"a":{"command":"echo"}}}"#,
        )
        .unwrap();
        let (_, mcp2, _) = compute_project_capability_digests(&dir);
        assert_ne!(mcp1, mcp2);

        let _ = fs::remove_dir_all(&dir);
    }
}
