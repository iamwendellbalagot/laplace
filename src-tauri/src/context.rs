use super::*;
use std::cmp::Reverse;

const MAX_CONTEXT_INDEX_FILES: usize = 2_000;
const MAX_CONTEXT_FILE_BYTES: u64 = 256 * 1024;
const MAX_CACHED_TEXT_FILE_BYTES: usize = 128 * 1024;
const MAX_CACHED_TEXT_TOTAL_BYTES: usize = 16 * 1024 * 1024;
const MAX_SYMBOL_REFERENCES: usize = 60;
const MAX_SYSTEM_RELATIONS: usize = 160;

const IGNORED_CONTEXT_DIRS: &[&str] = &[
    ".git",
    ".rook",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    ".venv",
    "__pycache__",
    "coverage",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileSymbol {
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) line: usize,
    pub(crate) exported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SymbolReference {
    pub(crate) file_path: String,
    pub(crate) line: usize,
    pub(crate) preview: String,
    pub(crate) provenance: String,
    pub(crate) evidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContextRelation {
    pub(crate) id: String,
    pub(crate) source_path: String,
    pub(crate) source_line: Option<usize>,
    pub(crate) target_path: String,
    pub(crate) relation_kind: String,
    pub(crate) provenance: String,
    pub(crate) evidence: String,
    pub(crate) stale: bool,
    pub(crate) pinned_link_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContextAnnotationRecord {
    pub(crate) id: String,
    pub(crate) target_kind: String,
    pub(crate) target_key: String,
    pub(crate) summary: String,
    pub(crate) provenance: String,
    pub(crate) source_digest: String,
    pub(crate) stale: bool,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContextPinnedLinkRecord {
    pub(crate) id: String,
    pub(crate) source_path: String,
    pub(crate) target_path: String,
    pub(crate) relation_kind: String,
    pub(crate) note: String,
    pub(crate) source_digest: String,
    pub(crate) stale: bool,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileContextSnapshot {
    pub(crate) file_path: String,
    pub(crate) language: String,
    pub(crate) file_digest: String,
    pub(crate) symbols: Vec<FileSymbol>,
    pub(crate) active_symbol: Option<FileSymbol>,
    pub(crate) queried_symbol: Option<String>,
    pub(crate) symbol_references: Vec<SymbolReference>,
    pub(crate) imports: Vec<ContextRelation>,
    pub(crate) importers: Vec<ContextRelation>,
    pub(crate) related_tests: Vec<ContextRelation>,
    pub(crate) annotation: Option<ContextAnnotationRecord>,
    pub(crate) pinned_links: Vec<ContextPinnedLinkRecord>,
    pub(crate) indexed_file_count: usize,
    pub(crate) truncated: bool,
    pub(crate) cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectSymbolEntry {
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) file_path: String,
    pub(crate) line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileHistoryCommit {
    pub(crate) sha: String,
    pub(crate) short_sha: String,
    pub(crate) subject: String,
    pub(crate) author: String,
    pub(crate) committed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileHistoryCheckpoint {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) source_digest: String,
    pub(crate) created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileHistoryCheck {
    pub(crate) id: String,
    pub(crate) command: String,
    pub(crate) status: String,
    pub(crate) started_at: i64,
    pub(crate) finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileHistorySnapshot {
    pub(crate) file_path: String,
    pub(crate) commits: Vec<FileHistoryCommit>,
    pub(crate) checkpoints: Vec<FileHistoryCheckpoint>,
    pub(crate) notes: Vec<review::ReviewComment>,
    pub(crate) checks: Vec<FileHistoryCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemModuleNode {
    pub(crate) key: String,
    pub(crate) label: String,
    pub(crate) primary_file: String,
    pub(crate) files: Vec<String>,
    pub(crate) file_count: usize,
    pub(crate) incoming_count: usize,
    pub(crate) outgoing_count: usize,
    pub(crate) digest: String,
    pub(crate) annotation: Option<ContextAnnotationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemModuleEdge {
    pub(crate) id: String,
    pub(crate) source_module: String,
    pub(crate) target_module: String,
    pub(crate) reference_count: usize,
    pub(crate) sample_source_path: String,
    pub(crate) sample_source_line: Option<usize>,
    pub(crate) sample_target_path: String,
    pub(crate) provenance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemContextSnapshot {
    pub(crate) modules: Vec<SystemModuleNode>,
    pub(crate) edges: Vec<SystemModuleEdge>,
    pub(crate) relationships: Vec<ContextRelation>,
    pub(crate) annotations: Vec<ContextAnnotationRecord>,
    pub(crate) pinned_links: Vec<ContextPinnedLinkRecord>,
    pub(crate) recent_commits: Vec<FileHistoryCommit>,
    pub(crate) indexed_file_count: usize,
    pub(crate) truncated: bool,
    pub(crate) cancelled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileContextRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    relative_path: String,
    #[serde(default)]
    symbol: Option<String>,
    #[serde(default)]
    cursor_line: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileHistoryRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    relative_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveContextAnnotationRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    target_kind: String,
    target_key: String,
    summary: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteContextAnnotationRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    target_kind: String,
    target_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveContextPinnedLinkRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    source_path: String,
    target_path: String,
    relation_kind: String,
    #[serde(default)]
    note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteContextPinnedLinkRequest {
    schema_version: u16,
    operation_id: String,
    project_id: String,
    link_id: String,
}

#[derive(Debug, Clone)]
pub(crate) struct RawImport {
    pub(crate) specifier: String,
    pub(crate) line: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct CachedIndexedFile {
    relative_path: String,
    mtime_ms: i64,
    size_bytes: u64,
    pub(crate) digest: String,
    pub(crate) language: String,
    symbols: Vec<FileSymbol>,
    pub(crate) raw_imports: Vec<RawImport>,
    pub(crate) has_inline_rust_tests: bool,
    cached_text: Option<String>,
}

#[derive(Default, Clone)]
pub(crate) struct WorkspaceContextCache {
    pub(crate) files: HashMap<String, CachedIndexedFile>,
    pub(crate) truncated: bool,
}

#[derive(Default, Clone)]
pub(crate) struct ContextIndexState {
    workspaces: Arc<Mutex<HashMap<String, WorkspaceContextCache>>>,
    generations: Arc<Mutex<HashMap<String, Arc<AtomicU64>>>>,
}

impl ContextIndexState {
    fn generation_token(&self, workspace_key: &str) -> Arc<AtomicU64> {
        let mut map = self
            .generations
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        map.entry(workspace_key.to_owned())
            .or_insert_with(|| Arc::new(AtomicU64::new(0)))
            .clone()
    }

    pub(crate) fn begin_generation(&self, workspace_key: &str) -> (Arc<AtomicU64>, u64) {
        let token = self.generation_token(workspace_key);
        let next = token.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
        (token, next)
    }

    pub(crate) fn cancel_workspace(&self, workspace_key: &str) -> bool {
        let token = self.generation_token(workspace_key);
        token.fetch_add(1, Ordering::SeqCst);
        true
    }

    fn take_cache_snapshot(&self, workspace_key: &str) -> WorkspaceContextCache {
        let map = self
            .workspaces
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        map.get(workspace_key).cloned().unwrap_or_default()
    }

    fn store_cache_snapshot(&self, workspace_key: &str, cache: WorkspaceContextCache) {
        let mut map = self
            .workspaces
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        map.insert(workspace_key.to_owned(), cache);
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn validate_safe_context_path(relative_path: &str, operation_id: &str) -> Result<(), IpcError> {
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

fn detect_language(relative_path: &str) -> &'static str {
    let ext = Path::new(relative_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    match ext.as_deref() {
        Some("ts" | "tsx" | "mts" | "cts") => "typescript",
        Some("js" | "jsx" | "mjs" | "cjs") => "javascript",
        Some("rs") => "rust",
        Some("py") => "python",
        Some("go") => "go",
        Some("css" | "scss") => "css",
        Some("json" | "toml" | "yaml" | "yml") => "config",
        Some("md") => "markdown",
        _ => "text",
    }
}

fn is_indexable_source(relative_path: &str) -> bool {
    matches!(
        detect_language(relative_path),
        "typescript" | "javascript" | "rust" | "python" | "go" | "css" | "config" | "markdown"
    )
}

fn is_ident_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '$'
}

fn read_identifier(input: &str) -> Option<String> {
    let trimmed = input.trim_start();
    let mut chars = trimmed.chars();
    let first = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '_' || first == '$') {
        return None;
    }
    let mut ident = String::new();
    ident.push(first);
    for ch in chars {
        if is_ident_char(ch) {
            ident.push(ch);
        } else {
            break;
        }
    }
    if ident.is_empty() {
        None
    } else {
        Some(ident)
    }
}

fn extract_symbols(language: &str, content: &str) -> (Vec<FileSymbol>, bool) {
    let mut symbols = Vec::new();
    let mut has_inline_rust_tests = false;

    for (idx, raw_line) in content.lines().enumerate() {
        let line_no = idx + 1;
        let line = raw_line.trim();
        if line.is_empty()
            || line.starts_with("//")
            || line.starts_with('*')
            || line.starts_with("/*")
            || line.starts_with('#')
        {
            if language == "rust" && line.starts_with("#[cfg(test)]") {
                has_inline_rust_tests = true;
            }
            continue;
        }

        match language {
            "typescript" | "javascript" => {
                let mut rest = line;
                let mut exported = false;
                if let Some(after) = rest.strip_prefix("export ") {
                    exported = true;
                    rest = after.trim_start();
                    if let Some(after_default) = rest.strip_prefix("default ") {
                        rest = after_default.trim_start();
                    }
                }
                if let Some(after) = rest.strip_prefix("declare ") {
                    rest = after.trim_start();
                }
                if let Some(after) = rest.strip_prefix("async ") {
                    rest = after.trim_start();
                }
                if let Some(after) = rest.strip_prefix("abstract ") {
                    rest = after.trim_start();
                }

                let found = if let Some(after) = rest.strip_prefix("function ") {
                    read_identifier(after).map(|name| (name, "function"))
                } else if let Some(after) = rest.strip_prefix("class ") {
                    read_identifier(after).map(|name| (name, "class"))
                } else if let Some(after) = rest.strip_prefix("interface ") {
                    read_identifier(after).map(|name| (name, "interface"))
                } else if let Some(after) = rest.strip_prefix("type ") {
                    read_identifier(after).map(|name| (name, "type"))
                } else if let Some(after) = rest.strip_prefix("enum ") {
                    read_identifier(after).map(|name| (name, "enum"))
                } else if exported {
                    rest.strip_prefix("const ")
                        .or_else(|| rest.strip_prefix("let "))
                        .and_then(read_identifier)
                        .map(|name| (name, "const"))
                } else {
                    None
                };

                if let Some((name, kind)) = found {
                    symbols.push(FileSymbol {
                        name,
                        kind: kind.to_owned(),
                        line: line_no,
                        exported,
                    });
                }
            }
            "rust" => {
                let mut rest = line;
                let mut exported = false;
                if let Some(after) = rest.strip_prefix("pub") {
                    let after_trim = after.trim_start();
                    if after_trim.starts_with('(') {
                        if let Some(close_idx) = after_trim.find(')') {
                            exported = true;
                            rest = after_trim[close_idx + 1..].trim_start();
                        }
                    } else if after.starts_with(' ') {
                        exported = true;
                        rest = after_trim;
                    }
                }
                if let Some(after) = rest.strip_prefix("async ") {
                    rest = after.trim_start();
                }
                if let Some(after) = rest.strip_prefix("unsafe ") {
                    rest = after.trim_start();
                }
                let found = if let Some(after) = rest.strip_prefix("fn ") {
                    read_identifier(after).map(|name| (name, "function"))
                } else if let Some(after) = rest.strip_prefix("struct ") {
                    read_identifier(after).map(|name| (name, "struct"))
                } else if let Some(after) = rest.strip_prefix("enum ") {
                    read_identifier(after).map(|name| (name, "enum"))
                } else if let Some(after) = rest.strip_prefix("trait ") {
                    read_identifier(after).map(|name| (name, "trait"))
                } else if let Some(after) = rest.strip_prefix("type ") {
                    read_identifier(after).map(|name| (name, "type"))
                } else if let Some(after) = rest.strip_prefix("mod ") {
                    read_identifier(after).map(|name| (name, "module"))
                } else {
                    None
                };
                if let Some((name, kind)) = found {
                    symbols.push(FileSymbol {
                        name,
                        kind: kind.to_owned(),
                        line: line_no,
                        exported,
                    });
                }
            }
            "python" => {
                let rest = line.strip_prefix("async ").unwrap_or(line);
                if let Some(after) = rest.strip_prefix("def ") {
                    if let Some(name) = read_identifier(after) {
                        symbols.push(FileSymbol {
                            exported: !name.starts_with('_'),
                            name,
                            kind: "function".to_owned(),
                            line: line_no,
                        });
                    }
                } else if let Some(after) = rest.strip_prefix("class ") {
                    if let Some(name) = read_identifier(after) {
                        symbols.push(FileSymbol {
                            exported: !name.starts_with('_'),
                            name,
                            kind: "class".to_owned(),
                            line: line_no,
                        });
                    }
                }
            }
            "go" => {
                if let Some(after) = line.strip_prefix("func ") {
                    let after_receiver = if after.trim_start().starts_with('(') {
                        after
                            .find(')')
                            .map(|idx| after[idx + 1..].trim_start())
                            .unwrap_or(after)
                    } else {
                        after
                    };
                    if let Some(name) = read_identifier(after_receiver) {
                        let exported = name
                            .chars()
                            .next()
                            .map(|c| c.is_ascii_uppercase())
                            .unwrap_or(false);
                        symbols.push(FileSymbol {
                            name,
                            kind: "function".to_owned(),
                            line: line_no,
                            exported,
                        });
                    }
                } else if let Some(after) = line.strip_prefix("type ") {
                    if let Some(name) = read_identifier(after) {
                        let exported = name
                            .chars()
                            .next()
                            .map(|c| c.is_ascii_uppercase())
                            .unwrap_or(false);
                        symbols.push(FileSymbol {
                            name,
                            kind: "type".to_owned(),
                            line: line_no,
                            exported,
                        });
                    }
                }
            }
            _ => {}
        }
    }

    (symbols, has_inline_rust_tests)
}

fn extract_quoted_after(line: &str, marker: &str) -> Option<String> {
    let idx = line.find(marker)?;
    let tail = line[idx + marker.len()..].trim_start();
    let quote = tail.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &tail[1..];
    let end = rest.find(quote)?;
    let value = rest[..end].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_owned())
    }
}

fn extract_raw_imports(language: &str, content: &str) -> Vec<RawImport> {
    let mut imports = Vec::new();
    for (idx, raw_line) in content.lines().enumerate() {
        let line_no = idx + 1;
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with("//") || line.starts_with('#') {
            continue;
        }
        match language {
            "typescript" | "javascript" => {
                if let Some(spec) = extract_quoted_after(line, " from ") {
                    imports.push(RawImport {
                        specifier: spec,
                        line: line_no,
                    });
                } else if line.starts_with("import ") && !line.contains(" from ") {
                    if let Some(spec) = extract_quoted_after(line, "import ") {
                        imports.push(RawImport {
                            specifier: spec,
                            line: line_no,
                        });
                    }
                } else if let Some(spec) = extract_quoted_after(line, "require(") {
                    imports.push(RawImport {
                        specifier: spec,
                        line: line_no,
                    });
                } else if let Some(spec) = extract_quoted_after(line, "import(") {
                    imports.push(RawImport {
                        specifier: spec,
                        line: line_no,
                    });
                }
            }
            "rust" => {
                let rest = line.strip_prefix("pub ").unwrap_or(line);
                if let Some(after_mod) = rest.strip_prefix("mod ") {
                    if after_mod.trim_end().ends_with(';') {
                        if let Some(name) = read_identifier(after_mod) {
                            imports.push(RawImport {
                                specifier: format!("mod:{name}"),
                                line: line_no,
                            });
                        }
                    }
                } else if let Some(after_use) = rest.strip_prefix("use ") {
                    if let Some(after_crate) = after_use.strip_prefix("crate::") {
                        if let Some(seg) = read_identifier(after_crate) {
                            imports.push(RawImport {
                                specifier: format!("crate:{seg}"),
                                line: line_no,
                            });
                        }
                    } else if let Some(after_super) = after_use.strip_prefix("super::") {
                        if let Some(seg) = read_identifier(after_super) {
                            imports.push(RawImport {
                                specifier: format!("super:{seg}"),
                                line: line_no,
                            });
                        }
                    }
                }
            }
            "python" => {
                if let Some(after_from) = line.strip_prefix("from ") {
                    if let Some(module) = after_from.split_whitespace().next() {
                        if !module.is_empty() {
                            imports.push(RawImport {
                                specifier: module.to_owned(),
                                line: line_no,
                            });
                        }
                    }
                } else if let Some(after_import) = line.strip_prefix("import ") {
                    if let Some(module) = after_import
                        .split(',')
                        .next()
                        .and_then(|s| s.split_whitespace().next())
                    {
                        if !module.is_empty() {
                            imports.push(RawImport {
                                specifier: module.to_owned(),
                                line: line_no,
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }
    imports
}

fn normalize_joined_path(base_dir: &str, relative: &str) -> Option<String> {
    let mut parts: Vec<&str> = if base_dir.is_empty() {
        Vec::new()
    } else {
        base_dir.split('/').filter(|s| !s.is_empty()).collect()
    };
    for segment in relative.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

fn parent_dir(relative_path: &str) -> &str {
    relative_path
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .unwrap_or("")
}

fn resolve_ts_candidate(candidate: &str, file_set: &HashSet<String>) -> Option<String> {
    if file_set.contains(candidate) {
        return Some(candidate.to_owned());
    }
    let stripped_js = candidate
        .strip_suffix(".js")
        .or_else(|| candidate.strip_suffix(".jsx"))
        .or_else(|| candidate.strip_suffix(".mjs"))
        .or_else(|| candidate.strip_suffix(".cjs"));
    let bases: Vec<&str> = match stripped_js {
        Some(base) => vec![candidate, base],
        None => vec![candidate],
    };
    for base in bases {
        for ext in [
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".mts",
            ".mjs",
            ".json",
            ".css",
            "/index.ts",
            "/index.tsx",
            "/index.js",
            "/index.jsx",
        ] {
            let probe = format!("{base}{ext}");
            if file_set.contains(&probe) {
                return Some(probe);
            }
        }
    }
    None
}

pub(crate) fn resolve_import(
    source_path: &str,
    language: &str,
    specifier: &str,
    file_set: &HashSet<String>,
) -> Option<String> {
    match language {
        "typescript" | "javascript" => {
            if specifier.starts_with("./") || specifier.starts_with("../") {
                let joined = normalize_joined_path(parent_dir(source_path), specifier)?;
                resolve_ts_candidate(&joined, file_set)
            } else if let Some(after_at) = specifier.strip_prefix("@/") {
                let candidate = format!("src/{after_at}");
                resolve_ts_candidate(&candidate, file_set)
            } else if specifier.starts_with("src/") {
                resolve_ts_candidate(specifier, file_set)
            } else {
                None
            }
        }
        "rust" => {
            if let Some(name) = specifier.strip_prefix("mod:") {
                let dir = parent_dir(source_path);
                let direct = normalize_joined_path(dir, &format!("{name}.rs"));
                if let Some(path) = direct.filter(|p| file_set.contains(p)) {
                    return Some(path);
                }
                let nested = normalize_joined_path(dir, &format!("{name}/mod.rs"));
                return nested.filter(|p| file_set.contains(p));
            }
            if let Some(name) = specifier.strip_prefix("crate:") {
                // Find nearest `src` directory prefix for the Rust crate
                let src_root = if let Some(idx) = source_path.find("/src/") {
                    &source_path[..idx + 4]
                } else if source_path.starts_with("src/") {
                    "src"
                } else {
                    parent_dir(source_path)
                };
                for probe in [
                    format!("{src_root}/{name}.rs"),
                    format!("{src_root}/{name}/mod.rs"),
                ] {
                    if file_set.contains(&probe) {
                        return Some(probe);
                    }
                }
                return None;
            }
            if let Some(name) = specifier.strip_prefix("super:") {
                let dir = parent_dir(source_path);
                for probe in [
                    normalize_joined_path(dir, &format!("{name}.rs")),
                    normalize_joined_path(dir, &format!("../{name}.rs")),
                    normalize_joined_path(dir, &format!("{name}/mod.rs")),
                ]
                .into_iter()
                .flatten()
                {
                    if file_set.contains(&probe) {
                        return Some(probe);
                    }
                }
                return None;
            }
            None
        }
        "python" => {
            if let Some(after_dot) = specifier.strip_prefix('.') {
                let rel = after_dot.replace('.', "/");
                let dir = parent_dir(source_path);
                for suffix in [".py", "/__init__.py"] {
                    if let Some(path) = normalize_joined_path(dir, &format!("{rel}{suffix}")) {
                        if file_set.contains(&path) {
                            return Some(path);
                        }
                    }
                }
                None
            } else {
                let rel = specifier.replace('.', "/");
                for probe in [format!("{rel}.py"), format!("{rel}/__init__.py")] {
                    if file_set.contains(&probe) {
                        return Some(probe);
                    }
                }
                None
            }
        }
        _ => None,
    }
}

pub(crate) fn is_test_file(relative_path: &str) -> bool {
    let lower = relative_path.to_ascii_lowercase();
    let name = Path::new(&lower)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    lower.starts_with("tests/")
        || lower.contains("/tests/")
        || lower.contains("/__tests__/")
        || name.contains(".test.")
        || name.contains(".spec.")
        || name.contains("_test.")
        || name.starts_with("test_")
}

pub(crate) fn normalized_stem(relative_path: &str) -> String {
    let name = Path::new(relative_path)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let stem = name.split('.').next().unwrap_or(&name);
    let stem = stem.strip_prefix("test_").unwrap_or(stem);
    stem.strip_suffix("_test").unwrap_or(stem).to_owned()
}

fn module_key_for_path(relative_path: &str) -> String {
    let parts: Vec<&str> = relative_path.split('/').collect();
    match parts.len() {
        0 | 1 => "(root)".to_owned(),
        2 => parts[0].to_owned(),
        3 => format!("{}/{}", parts[0], parts[1]),
        _ => format!("{}/{}/{}", parts[0], parts[1], parts[2]),
    }
}

fn compute_module_digest(files: &[String], cache: &WorkspaceContextCache) -> String {
    let mut hasher = Sha256::new();
    let mut sorted = files.to_vec();
    sorted.sort();
    for path in sorted {
        hasher.update(path.as_bytes());
        hasher.update(b"\0");
        if let Some(entry) = cache.files.get(&path) {
            hasher.update(entry.digest.as_bytes());
        }
        hasher.update(b"\n");
    }
    format!("{:x}", hasher.finalize())
}

fn contains_word_boundary(line: &str, symbol: &str) -> bool {
    if symbol.is_empty() || line.len() < symbol.len() {
        return false;
    }
    let bytes = line.as_bytes();
    let mut search_from = 0;
    while let Some(offset) = line[search_from..].find(symbol) {
        let start = search_from + offset;
        let end = start + symbol.len();
        let left_ok = start == 0 || !is_ident_char(bytes[start - 1] as char);
        let right_ok = end == bytes.len() || !is_ident_char(bytes[end] as char);
        if left_ok && right_ok {
            return true;
        }
        search_from = start + 1;
    }
    false
}

fn walk_indexable_files(
    root: &Path,
    token: &AtomicU64,
    expected_gen: u64,
) -> (Vec<String>, bool, bool) {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut truncated = false;

    while let Some(dir) = stack.pop() {
        if token.load(Ordering::Relaxed) != expected_gen {
            return (files, truncated, true);
        }
        let Ok(read_dir) = fs::read_dir(&dir) else {
            continue;
        };
        let mut children: Vec<PathBuf> = read_dir
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .collect();
        children.sort();
        for path in children {
            if token.load(Ordering::Relaxed) != expected_gen {
                return (files, truncated, true);
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
                if IGNORED_CONTEXT_DIRS.contains(&name) {
                    continue;
                }
                stack.push(path);
            } else if meta.is_file() {
                if files.len() >= MAX_CONTEXT_INDEX_FILES {
                    truncated = true;
                    break;
                }
                if let Ok(rel) = path.strip_prefix(root) {
                    let normalized = rel
                        .components()
                        .map(|component| component.as_os_str().to_string_lossy())
                        .collect::<Vec<_>>()
                        .join("/");
                    if !normalized.is_empty() && is_indexable_source(&normalized) {
                        files.push(normalized);
                    }
                }
            }
        }
    }
    files.sort();
    (files, truncated, false)
}

pub(crate) fn update_workspace_index(
    root: &Path,
    state: &ContextIndexState,
    token: &AtomicU64,
    expected_gen: u64,
) -> (WorkspaceContextCache, bool) {
    let workspace_key = root.to_string_lossy().into_owned();
    let prev = state.take_cache_snapshot(&workspace_key);
    let (discovered, truncated, walk_cancelled) = walk_indexable_files(root, token, expected_gen);
    if walk_cancelled {
        return (prev, true);
    }

    let mut next_files = HashMap::with_capacity(discovered.len());
    let mut cached_text_bytes = 0usize;

    for relative_path in discovered {
        if token.load(Ordering::Relaxed) != expected_gen {
            return (prev, true);
        }
        let full_path = root.join(&relative_path);
        let Ok(meta) = fs::symlink_metadata(&full_path) else {
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_file() {
            continue;
        }
        let size_bytes = meta.len();
        if size_bytes > MAX_CONTEXT_FILE_BYTES {
            continue;
        }
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        if let Some(existing) = prev.files.get(&relative_path) {
            if existing.mtime_ms == mtime_ms && existing.size_bytes == size_bytes {
                let mut reused = existing.clone();
                if let Some(ref text) = reused.cached_text {
                    if cached_text_bytes + text.len() <= MAX_CACHED_TEXT_TOTAL_BYTES {
                        cached_text_bytes += text.len();
                    } else {
                        reused.cached_text = None;
                    }
                }
                next_files.insert(relative_path, reused);
                continue;
            }
        }

        let Ok(bytes) = fs::read(&full_path) else {
            continue;
        };
        if bytes.contains(&0) {
            continue;
        }
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        let digest = sha256_hex(content.as_bytes());
        let language = detect_language(&relative_path).to_owned();
        let (symbols, has_inline_rust_tests) = extract_symbols(&language, &content);
        let raw_imports = extract_raw_imports(&language, &content);
        let cached_text = if content.len() <= MAX_CACHED_TEXT_FILE_BYTES
            && cached_text_bytes + content.len() <= MAX_CACHED_TEXT_TOTAL_BYTES
        {
            cached_text_bytes += content.len();
            Some(content)
        } else {
            None
        };
        next_files.insert(
            relative_path.clone(),
            CachedIndexedFile {
                relative_path,
                mtime_ms,
                size_bytes,
                digest,
                language,
                symbols,
                raw_imports,
                has_inline_rust_tests,
                cached_text,
            },
        );
    }

    let cache = WorkspaceContextCache {
        files: next_files,
        truncated,
    };
    state.store_cache_snapshot(&workspace_key, cache.clone());
    (cache, false)
}

fn git_log_commits(
    root: &Path,
    relative_path: Option<&str>,
    limit: usize,
) -> Vec<FileHistoryCommit> {
    if !root.join(".git").exists() {
        return Vec::new();
    }
    let limit_arg = format!("-n{limit}");
    let mut args = vec![
        "-c",
        "core.fsmonitor=false",
        "log",
        &limit_arg,
        "--format=%H%x1f%h%x1f%s%x1f%an%x1f%at",
    ];
    if let Some(path) = relative_path {
        args.push("--follow");
        args.push("--");
        args.push(path);
    }
    let Ok(output) = Command::new("git")
        .args(&args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_PAGER", "cat")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            let sha = parts.next()?.trim().to_owned();
            let short_sha = parts.next()?.trim().to_owned();
            let subject = parts.next()?.trim().to_owned();
            let author = parts.next()?.trim().to_owned();
            let secs: i64 = parts.next()?.trim().parse().ok()?;
            if sha.is_empty() {
                return None;
            }
            Some(FileHistoryCommit {
                sha,
                short_sha,
                subject,
                author,
                committed_at: secs * 1000,
            })
        })
        .collect()
}

pub(crate) async fn load_annotations_for_project(
    pool: &SqlitePool,
    project_id: &str,
    operation_id: &str,
) -> Result<Vec<ContextAnnotationRecord>, IpcError> {
    let rows = sqlx::query(
        "SELECT id, target_kind, target_key, summary, provenance, source_digest, created_at, updated_at FROM context_annotations WHERE project_id = ? ORDER BY updated_at DESC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "context_db_read_failed",
            "Saved context notes could not be loaded.",
            operation_id,
        )
    })?;
    Ok(rows
        .into_iter()
        .map(|row| ContextAnnotationRecord {
            id: row.try_get("id").unwrap_or_default(),
            target_kind: row.try_get("target_kind").unwrap_or_default(),
            target_key: row.try_get("target_key").unwrap_or_default(),
            summary: row.try_get("summary").unwrap_or_default(),
            provenance: row
                .try_get("provenance")
                .unwrap_or_else(|_| "developer_confirmed".to_owned()),
            source_digest: row.try_get("source_digest").unwrap_or_default(),
            stale: false,
            created_at: row.try_get("created_at").unwrap_or(0),
            updated_at: row.try_get("updated_at").unwrap_or(0),
        })
        .collect())
}

async fn load_pinned_links_for_project(
    pool: &SqlitePool,
    project_id: &str,
    operation_id: &str,
) -> Result<Vec<ContextPinnedLinkRecord>, IpcError> {
    let rows = sqlx::query(
        "SELECT id, source_path, target_path, relation_kind, note, source_digest, created_at, updated_at FROM context_pinned_links WHERE project_id = ? ORDER BY updated_at DESC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "context_db_read_failed",
            "Saved context links could not be loaded.",
            operation_id,
        )
    })?;
    Ok(rows
        .into_iter()
        .map(|row| ContextPinnedLinkRecord {
            id: row.try_get("id").unwrap_or_default(),
            source_path: row.try_get("source_path").unwrap_or_default(),
            target_path: row.try_get("target_path").unwrap_or_default(),
            relation_kind: row.try_get("relation_kind").unwrap_or_default(),
            note: row.try_get("note").unwrap_or_default(),
            source_digest: row.try_get("source_digest").unwrap_or_default(),
            stale: false,
            created_at: row.try_get("created_at").unwrap_or(0),
            updated_at: row.try_get("updated_at").unwrap_or(0),
        })
        .collect())
}

fn pair_digest(cache: &WorkspaceContextCache, source_path: &str, target_path: &str) -> String {
    let a = cache
        .files
        .get(source_path)
        .map(|f| f.digest.as_str())
        .unwrap_or("missing");
    let b = cache
        .files
        .get(target_path)
        .map(|f| f.digest.as_str())
        .unwrap_or("missing");
    sha256_hex(format!("{a}:{b}").as_bytes())
}

fn read_file_text_for_search(root: &Path, entry: &CachedIndexedFile) -> Option<String> {
    if let Some(ref text) = entry.cached_text {
        return Some(text.clone());
    }
    let bytes = fs::read(root.join(&entry.relative_path)).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

pub(crate) async fn get_file_context_with_pool(
    pool: &SqlitePool,
    state: &ContextIndexState,
    root: &Path,
    relative_path: &str,
    symbol: Option<&str>,
    cursor_line: Option<usize>,
    operation_id: &str,
) -> Result<FileContextSnapshot, IpcError> {
    validate_safe_context_path(relative_path, operation_id)?;
    let workspace_key = root.to_string_lossy().into_owned();
    let (token, gen_id) = state.begin_generation(&workspace_key);
    let root_owned = root.to_path_buf();
    let state_cloned = state.clone();
    let (cache, cancelled) = tokio::task::spawn_blocking(move || {
        update_workspace_index(&root_owned, &state_cloned, &token, gen_id)
    })
    .await
    .map_err(|_| {
        terminal_error(
            "context_index_failed",
            "Workspace context index failed.",
            operation_id,
        )
    })?;
    let file_set: HashSet<String> = cache.files.keys().cloned().collect();

    let current_file = cache.files.get(relative_path);
    let language = current_file
        .map(|f| f.language.clone())
        .unwrap_or_else(|| detect_language(relative_path).to_owned());
    let file_digest = current_file.map(|f| f.digest.clone()).unwrap_or_else(|| {
        fs::read(root.join(relative_path))
            .map(|bytes| sha256_hex(&bytes))
            .unwrap_or_default()
    });
    let symbols = current_file.map(|f| f.symbols.clone()).unwrap_or_default();

    let requested_symbol = symbol
        .map(str::trim)
        .filter(|s| s.len() >= 2 && s.chars().all(is_ident_char))
        .map(str::to_owned);

    let active_symbol = if let Some(ref name) = requested_symbol {
        symbols
            .iter()
            .find(|sym| sym.name == *name)
            .cloned()
            .or_else(|| {
                cursor_line.and_then(|line| symbols.iter().rfind(|sym| sym.line <= line).cloned())
            })
    } else if let Some(line) = cursor_line {
        symbols.iter().rfind(|sym| sym.line <= line).cloned()
    } else {
        symbols.first().cloned()
    };

    let queried_symbol =
        requested_symbol.or_else(|| active_symbol.as_ref().map(|s| s.name.clone()));

    let mut imports = Vec::new();
    let mut imported_targets = HashSet::new();
    if let Some(entry) = current_file {
        for raw in &entry.raw_imports {
            if let Some(target) =
                resolve_import(relative_path, &entry.language, &raw.specifier, &file_set)
            {
                if target != relative_path && imported_targets.insert(target.clone()) {
                    imports.push(ContextRelation {
                        id: format!("imp:{relative_path}:{target}:{}", raw.line),
                        source_path: relative_path.to_owned(),
                        source_line: Some(raw.line),
                        target_path: target,
                        relation_kind: "imports".to_owned(),
                        provenance: "observed".to_owned(),
                        evidence: format!("Static import `{}` at line {}", raw.specifier, raw.line),
                        stale: false,
                        pinned_link_id: None,
                    });
                }
            }
        }
    }

    let mut importers = Vec::new();
    let mut importer_paths = HashSet::new();
    let mut sorted_paths: Vec<&String> = cache.files.keys().collect();
    sorted_paths.sort();
    for other_path in &sorted_paths {
        if other_path.as_str() == relative_path {
            continue;
        }
        let Some(other) = cache.files.get(*other_path) else {
            continue;
        };
        for raw in &other.raw_imports {
            if let Some(target) =
                resolve_import(other_path, &other.language, &raw.specifier, &file_set)
            {
                if target == relative_path && importer_paths.insert((*other_path).clone()) {
                    importers.push(ContextRelation {
                        id: format!("caller:{other_path}:{relative_path}:{}", raw.line),
                        source_path: (*other_path).clone(),
                        source_line: Some(raw.line),
                        target_path: relative_path.to_owned(),
                        relation_kind: "imports".to_owned(),
                        provenance: "observed".to_owned(),
                        evidence: format!("Imports `{relative_path}` at line {}", raw.line),
                        stale: false,
                        pinned_link_id: None,
                    });
                    break;
                }
            }
        }
    }

    let all_annotations = load_annotations_for_project(pool, &workspace_key, operation_id).await?;
    let annotation = all_annotations
        .into_iter()
        .find(|item| item.target_kind == "file" && item.target_key == relative_path)
        .map(|mut item| {
            item.stale = !file_digest.is_empty() && item.source_digest != file_digest;
            item
        });

    let all_pinned = load_pinned_links_for_project(pool, &workspace_key, operation_id).await?;
    let pinned_links: Vec<ContextPinnedLinkRecord> = all_pinned
        .into_iter()
        .filter(|link| link.source_path == relative_path || link.target_path == relative_path)
        .map(|mut link| {
            let live_digest = pair_digest(&cache, &link.source_path, &link.target_path);
            link.stale = link.source_digest != live_digest;
            link
        })
        .collect();

    let mut related_tests = Vec::new();
    let mut seen_test_paths = HashSet::new();

    if current_file
        .map(|f| f.has_inline_rust_tests)
        .unwrap_or(false)
    {
        seen_test_paths.insert(relative_path.to_owned());
        related_tests.push(ContextRelation {
            id: format!("test-inline:{relative_path}"),
            source_path: relative_path.to_owned(),
            source_line: None,
            target_path: relative_path.to_owned(),
            relation_kind: "tests".to_owned(),
            provenance: "observed".to_owned(),
            evidence: "Inline #[cfg(test)] module".to_owned(),
            stale: false,
            pinned_link_id: None,
        });
    }

    // Developer-confirmed test links first
    for link in &pinned_links {
        if link.relation_kind == "tests" {
            let other = if link.source_path == relative_path {
                link.target_path.clone()
            } else {
                link.source_path.clone()
            };
            seen_test_paths.insert(other.clone());
            related_tests.push(ContextRelation {
                id: format!("test-pinned:{}", link.id),
                source_path: link.source_path.clone(),
                source_line: None,
                target_path: other,
                relation_kind: "tests".to_owned(),
                provenance: "developer_confirmed".to_owned(),
                evidence: if link.note.is_empty() {
                    "Developer-confirmed test link".to_owned()
                } else {
                    link.note.clone()
                },
                stale: link.stale,
                pinned_link_id: Some(link.id.clone()),
            });
        }
    }

    // Observed test importers
    for importer in &importers {
        if is_test_file(&importer.source_path)
            && seen_test_paths.insert(importer.source_path.clone())
        {
            related_tests.push(ContextRelation {
                id: format!("test-obs:{}:{relative_path}", importer.source_path),
                source_path: importer.source_path.clone(),
                source_line: importer.source_line,
                target_path: importer.source_path.clone(),
                relation_kind: "tests".to_owned(),
                provenance: "observed".to_owned(),
                evidence: importer.evidence.clone(),
                stale: false,
                pinned_link_id: None,
            });
        }
    }

    // Inferred test files by stem matching (clearly labeled Inferred)
    if !is_test_file(relative_path) {
        let active_stem = normalized_stem(relative_path);
        if active_stem.len() >= 3 && active_stem != "index" && active_stem != "mod" {
            for candidate_path in &sorted_paths {
                if is_test_file(candidate_path)
                    && !seen_test_paths.contains(*candidate_path)
                    && normalized_stem(candidate_path) == active_stem
                {
                    seen_test_paths.insert((*candidate_path).clone());
                    related_tests.push(ContextRelation {
                        id: format!("test-inf:{relative_path}:{candidate_path}"),
                        source_path: relative_path.to_owned(),
                        source_line: None,
                        target_path: (*candidate_path).clone(),
                        relation_kind: "tests".to_owned(),
                        provenance: "inferred".to_owned(),
                        evidence: "Filename stem match (no direct import observed)".to_owned(),
                        stale: false,
                        pinned_link_id: None,
                    });
                }
            }
        }
    }

    // Symbol references across workspace (observed first, then inferred)
    let mut observed_refs = Vec::new();
    let mut inferred_refs = Vec::new();
    if let Some(ref sym_name) = queried_symbol {
        if sym_name.len() >= 2 {
            let decl_line = active_symbol
                .as_ref()
                .filter(|s| s.name == *sym_name)
                .map(|s| s.line);
            for path in &sorted_paths {
                if observed_refs.len() >= MAX_SYMBOL_REFERENCES {
                    break;
                }
                let Some(entry) = cache.files.get(*path) else {
                    continue;
                };
                let Some(text) = read_file_text_for_search(root, entry) else {
                    continue;
                };
                if !text.contains(sym_name.as_str()) {
                    continue;
                }
                let is_observed_file = path.as_str() == relative_path
                    || importer_paths.contains(*path)
                    || imported_targets.contains(*path);
                for (idx, line_text) in text.lines().enumerate() {
                    let line_no = idx + 1;
                    if path.as_str() == relative_path && decl_line == Some(line_no) {
                        continue;
                    }
                    if contains_word_boundary(line_text, sym_name) {
                        let preview = line_text.trim().chars().take(120).collect::<String>();
                        let hit = SymbolReference {
                            file_path: (*path).clone(),
                            line: line_no,
                            preview,
                            provenance: if is_observed_file {
                                "observed".to_owned()
                            } else {
                                "inferred".to_owned()
                            },
                            evidence: if path.as_str() == relative_path {
                                "Reference in active file".to_owned()
                            } else if is_observed_file {
                                "Reference in statically linked file".to_owned()
                            } else {
                                "Identifier match without observed import".to_owned()
                            },
                        };
                        if is_observed_file {
                            observed_refs.push(hit);
                            if observed_refs.len() >= MAX_SYMBOL_REFERENCES {
                                break;
                            }
                        } else if inferred_refs.len() < MAX_SYMBOL_REFERENCES {
                            inferred_refs.push(hit);
                        }
                    }
                }
            }
        }
    }

    let mut symbol_references = observed_refs;
    let remaining = MAX_SYMBOL_REFERENCES.saturating_sub(symbol_references.len());
    symbol_references.extend(inferred_refs.into_iter().take(remaining));

    Ok(FileContextSnapshot {
        file_path: relative_path.to_owned(),
        language,
        file_digest,
        symbols,
        active_symbol,
        queried_symbol,
        symbol_references,
        imports,
        importers,
        related_tests,
        annotation,
        pinned_links,
        indexed_file_count: cache.files.len(),
        truncated: cache.truncated,
        cancelled,
    })
}

pub(crate) async fn get_file_history_with_pool(
    pool: &SqlitePool,
    root: &Path,
    relative_path: &str,
    operation_id: &str,
) -> Result<FileHistorySnapshot, IpcError> {
    validate_safe_context_path(relative_path, operation_id)?;
    let project_id = root.to_string_lossy().into_owned();
    let root_owned = root.to_path_buf();
    let rel_owned = relative_path.to_owned();
    let commits =
        tokio::task::spawn_blocking(move || git_log_commits(&root_owned, Some(&rel_owned), 20))
            .await
            .unwrap_or_default();

    let checkpoint_rows = sqlx::query(
        "SELECT rs.id, rs.source_digest, rs.created_at FROM review_snapshots rs INNER JOIN review_snapshot_files rsf ON rsf.snapshot_id = rs.id INNER JOIN changes c ON c.id = rs.change_id WHERE c.project_id = ? AND rsf.file_path = ? ORDER BY rs.created_at DESC LIMIT 20",
    )
    .bind(&project_id)
    .bind(relative_path)
    .fetch_all(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "context_history_failed",
            "Review checkpoints for this file could not be loaded.",
            operation_id,
        )
    })?;
    let checkpoints: Vec<FileHistoryCheckpoint> = checkpoint_rows
        .into_iter()
        .map(|row| {
            let id: String = row.try_get("id").unwrap_or_default();
            let digest: String = row.try_get("source_digest").unwrap_or_default();
            FileHistoryCheckpoint {
                label: if digest.starts_with("lbl:") {
                    digest
                        .split_once('|')
                        .map(|(head, _)| head.trim_start_matches("lbl:").to_owned())
                        .unwrap_or_else(|| "Checkpoint".to_owned())
                } else {
                    "Review checkpoint".to_owned()
                },
                id,
                source_digest: digest,
                created_at: row.try_get("created_at").unwrap_or(0),
            }
        })
        .collect();

    let note_rows = sqlx::query(
        "SELECT rc.id, rc.change_id, rc.file_path, rc.line_number, rc.body, rc.resolved, rc.created_at FROM review_comments rc INNER JOIN changes c ON c.id = rc.change_id WHERE c.project_id = ? AND rc.file_path = ? ORDER BY rc.created_at DESC LIMIT 30",
    )
    .bind(&project_id)
    .bind(relative_path)
    .fetch_all(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "context_history_failed",
            "Review notes for this file could not be loaded.",
            operation_id,
        )
    })?;
    let notes: Vec<review::ReviewComment> = note_rows
        .into_iter()
        .map(|row| review::ReviewComment {
            id: row.try_get("id").unwrap_or_default(),
            change_id: row.try_get("change_id").unwrap_or_default(),
            file_path: row.try_get("file_path").unwrap_or_default(),
            line_number: row.try_get("line_number").ok().flatten(),
            body: row.try_get("body").unwrap_or_default(),
            resolved: row.try_get::<i64, _>("resolved").unwrap_or(0) != 0,
            created_at: row.try_get("created_at").unwrap_or(0),
        })
        .collect();

    let check_rows = sqlx::query(
        "SELECT e.id, e.command_json, e.status, e.started_at, e.finished_at FROM executions e INNER JOIN source_files sf ON sf.execution_id = e.id WHERE e.project_id = ? AND sf.path = ? ORDER BY e.started_at DESC LIMIT 12",
    )
    .bind(&project_id)
    .bind(relative_path)
    .fetch_all(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "context_history_failed",
            "Verification checks for this file could not be loaded.",
            operation_id,
        )
    })?;
    let checks: Vec<FileHistoryCheck> = check_rows
        .into_iter()
        .map(|row| {
            let cmd_json: String = row.try_get("command_json").unwrap_or_default();
            let command = serde_json::from_str::<(String, Vec<String>)>(&cmd_json)
                .map(|(program, args)| {
                    if args.is_empty() {
                        program
                    } else {
                        format!("{program} {}", args.join(" "))
                    }
                })
                .unwrap_or(cmd_json);
            FileHistoryCheck {
                id: row.try_get("id").unwrap_or_default(),
                command,
                status: row.try_get("status").unwrap_or_default(),
                started_at: row.try_get("started_at").unwrap_or(0),
                finished_at: row.try_get("finished_at").ok().flatten(),
            }
        })
        .collect();

    Ok(FileHistorySnapshot {
        file_path: relative_path.to_owned(),
        commits,
        checkpoints,
        notes,
        checks,
    })
}

pub(crate) async fn get_system_context_with_pool(
    pool: &SqlitePool,
    state: &ContextIndexState,
    root: &Path,
    operation_id: &str,
) -> Result<SystemContextSnapshot, IpcError> {
    let workspace_key = root.to_string_lossy().into_owned();
    let (token, gen_id) = state.begin_generation(&workspace_key);
    let root_owned = root.to_path_buf();
    let state_cloned = state.clone();
    let (cache, cancelled) = tokio::task::spawn_blocking(move || {
        update_workspace_index(&root_owned, &state_cloned, &token, gen_id)
    })
    .await
    .map_err(|_| {
        terminal_error(
            "context_index_failed",
            "Workspace context index failed.",
            operation_id,
        )
    })?;
    let file_set: HashSet<String> = cache.files.keys().cloned().collect();

    let mut module_files: HashMap<String, Vec<String>> = HashMap::new();
    for path in cache.files.keys() {
        let key = module_key_for_path(path);
        module_files.entry(key).or_default().push(path.clone());
    }
    for files in module_files.values_mut() {
        files.sort();
    }

    let mut module_digests: HashMap<String, String> = HashMap::new();
    for (key, files) in &module_files {
        module_digests.insert(key.clone(), compute_module_digest(files, &cache));
    }

    let raw_annotations = load_annotations_for_project(pool, &workspace_key, operation_id).await?;
    let annotations: Vec<ContextAnnotationRecord> = raw_annotations
        .into_iter()
        .map(|mut item| {
            let live_digest = if item.target_kind == "module" {
                module_digests.get(&item.target_key).cloned()
            } else {
                cache.files.get(&item.target_key).map(|f| f.digest.clone())
            };
            item.stale = match live_digest {
                Some(digest) => digest != item.source_digest,
                None => true,
            };
            item
        })
        .collect();

    let raw_pinned = load_pinned_links_for_project(pool, &workspace_key, operation_id).await?;
    let pinned_links: Vec<ContextPinnedLinkRecord> = raw_pinned
        .into_iter()
        .map(|mut link| {
            let live_digest = pair_digest(&cache, &link.source_path, &link.target_path);
            link.stale = link.source_digest != live_digest;
            link
        })
        .collect();

    let mut edge_map: HashMap<(String, String), SystemModuleEdge> = HashMap::new();
    let mut incoming_counts: HashMap<String, usize> = HashMap::new();
    let mut outgoing_counts: HashMap<String, usize> = HashMap::new();
    let mut relationships: Vec<ContextRelation> = Vec::new();

    for link in &pinned_links {
        relationships.push(ContextRelation {
            id: format!("pin:{}", link.id),
            source_path: link.source_path.clone(),
            source_line: None,
            target_path: link.target_path.clone(),
            relation_kind: link.relation_kind.clone(),
            provenance: "developer_confirmed".to_owned(),
            evidence: if link.note.is_empty() {
                "Developer-confirmed relationship".to_owned()
            } else {
                link.note.clone()
            },
            stale: link.stale,
            pinned_link_id: Some(link.id.clone()),
        });
    }

    let mut sorted_paths: Vec<&String> = cache.files.keys().collect();
    sorted_paths.sort();

    let mut observed_pairs: HashSet<(String, String)> = HashSet::new();
    for source_path in &sorted_paths {
        let Some(entry) = cache.files.get(*source_path) else {
            continue;
        };
        let src_module = module_key_for_path(source_path);
        for raw in &entry.raw_imports {
            let Some(target_path) =
                resolve_import(source_path, &entry.language, &raw.specifier, &file_set)
            else {
                continue;
            };
            if target_path == **source_path {
                continue;
            }
            if !observed_pairs.insert(((*source_path).clone(), target_path.clone())) {
                continue;
            }
            let tgt_module = module_key_for_path(&target_path);
            if src_module != tgt_module {
                *outgoing_counts.entry(src_module.clone()).or_insert(0) += 1;
                *incoming_counts.entry(tgt_module.clone()).or_insert(0) += 1;
                edge_map
                    .entry((src_module.clone(), tgt_module.clone()))
                    .and_modify(|edge| edge.reference_count += 1)
                    .or_insert_with(|| SystemModuleEdge {
                        id: format!("edge:{src_module}->{tgt_module}"),
                        source_module: src_module.clone(),
                        target_module: tgt_module.clone(),
                        reference_count: 1,
                        sample_source_path: (*source_path).clone(),
                        sample_source_line: Some(raw.line),
                        sample_target_path: target_path.clone(),
                        provenance: "observed".to_owned(),
                    });
            }
            if relationships.len() < MAX_SYSTEM_RELATIONS {
                let kind = if is_test_file(source_path) {
                    "tests"
                } else {
                    "imports"
                };
                relationships.push(ContextRelation {
                    id: format!("obs:{source_path}:{target_path}:{}", raw.line),
                    source_path: (*source_path).clone(),
                    source_line: Some(raw.line),
                    target_path,
                    relation_kind: kind.to_owned(),
                    provenance: "observed".to_owned(),
                    evidence: format!("Static import `{}` at line {}", raw.specifier, raw.line),
                    stale: false,
                    pinned_link_id: None,
                });
            }
        }
    }

    // Add inferred stem-matched test relationships (up to cap) where no direct import exists
    let test_files: Vec<&String> = sorted_paths
        .iter()
        .copied()
        .filter(|path| is_test_file(path))
        .collect();
    for source_path in &sorted_paths {
        if relationships.len() >= MAX_SYSTEM_RELATIONS {
            break;
        }
        if is_test_file(source_path) {
            continue;
        }
        let stem = normalized_stem(source_path);
        if stem.len() < 3 || stem == "index" || stem == "mod" {
            continue;
        }
        for test_path in &test_files {
            if relationships.len() >= MAX_SYSTEM_RELATIONS {
                break;
            }
            if normalized_stem(test_path) == stem
                && !observed_pairs.contains(&((*test_path).clone(), (*source_path).clone()))
            {
                relationships.push(ContextRelation {
                    id: format!("inf-test:{source_path}:{test_path}"),
                    source_path: (*source_path).clone(),
                    source_line: None,
                    target_path: (*test_path).clone(),
                    relation_kind: "tests".to_owned(),
                    provenance: "inferred".to_owned(),
                    evidence: "Filename stem match (no direct import observed)".to_owned(),
                    stale: false,
                    pinned_link_id: None,
                });
            }
        }
    }

    let mut modules: Vec<SystemModuleNode> = module_files
        .into_iter()
        .map(|(key, files)| {
            let primary_file = files
                .iter()
                .find(|path| {
                    let name = Path::new(path)
                        .file_name()
                        .and_then(|v| v.to_str())
                        .unwrap_or("");
                    matches!(
                        name,
                        "index.ts"
                            | "index.tsx"
                            | "index.js"
                            | "mod.rs"
                            | "lib.rs"
                            | "main.rs"
                            | "App.tsx"
                    )
                })
                .cloned()
                .unwrap_or_else(|| files[0].clone());
            let label = if key == "(root)" {
                "Workspace root".to_owned()
            } else {
                key.rsplit('/').next().unwrap_or(&key).to_owned()
            };
            let annotation = annotations
                .iter()
                .find(|a| a.target_kind == "module" && a.target_key == key)
                .cloned();
            let digest = module_digests.get(&key).cloned().unwrap_or_default();
            let file_count = files.len();
            let incoming_count = incoming_counts.get(&key).copied().unwrap_or(0);
            let outgoing_count = outgoing_counts.get(&key).copied().unwrap_or(0);
            SystemModuleNode {
                key,
                label,
                primary_file,
                files,
                file_count,
                incoming_count,
                outgoing_count,
                digest,
                annotation,
            }
        })
        .collect();
    modules.sort_by_key(|m| {
        (
            Reverse(m.incoming_count + m.outgoing_count),
            Reverse(m.file_count),
            m.key.clone(),
        )
    });

    let mut edges: Vec<SystemModuleEdge> = edge_map.into_values().collect();
    edges.sort_by_key(|e| (Reverse(e.reference_count), e.id.clone()));

    let root_owned = root.to_path_buf();
    let recent_commits =
        tokio::task::spawn_blocking(move || git_log_commits(&root_owned, None, 12))
            .await
            .unwrap_or_default();

    Ok(SystemContextSnapshot {
        modules,
        edges,
        relationships,
        annotations,
        pinned_links,
        recent_commits,
        indexed_file_count: cache.files.len(),
        truncated: cache.truncated,
        cancelled,
    })
}

pub(crate) async fn save_context_annotation_with_pool(
    pool: &SqlitePool,
    state: &ContextIndexState,
    root: &Path,
    target_kind: &str,
    target_key: &str,
    summary: &str,
    operation_id: &str,
) -> Result<ContextAnnotationRecord, IpcError> {
    if target_kind != "file" && target_kind != "module" {
        return Err(terminal_error(
            "invalid_annotation_target",
            "Annotation target must be a file or module.",
            operation_id,
        ));
    }
    let clean_summary = summary.trim();
    if clean_summary.is_empty() || clean_summary.len() > 1000 {
        return Err(terminal_error(
            "invalid_annotation_summary",
            "Context note must be between 1 and 1,000 characters.",
            operation_id,
        ));
    }
    let workspace_key = root.to_string_lossy().into_owned();
    let source_digest = if target_kind == "file" {
        validate_safe_context_path(target_key, operation_id)?;
        let full = root.join(target_key);
        let bytes = fs::read(&full).map_err(|_| {
            terminal_error(
                "file_not_found",
                "Cannot confirm a note for a file that does not exist on disk.",
                operation_id,
            )
        })?;
        sha256_hex(&bytes)
    } else {
        let (token, gen_id) = state.begin_generation(&workspace_key);
        let (cache, _) = update_workspace_index(root, state, &token, gen_id);
        let files: Vec<String> = cache
            .files
            .keys()
            .filter(|path| module_key_for_path(path) == target_key)
            .cloned()
            .collect();
        if files.is_empty() {
            return Err(terminal_error(
                "module_not_found",
                "Cannot confirm a note for a module with no indexed source files.",
                operation_id,
            ));
        }
        compute_module_digest(&files, &cache)
    };

    let now = now_ms();
    let id = format!(
        "ctx-ann-{}",
        &sha256_hex(format!("{workspace_key}:{target_kind}:{target_key}").as_bytes())[..16]
    );

    sqlx::query(
        "INSERT INTO context_annotations (id, project_id, target_kind, target_key, summary, provenance, source_digest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'developer_confirmed', ?, ?, ?) ON CONFLICT(project_id, target_kind, target_key) DO UPDATE SET summary = excluded.summary, source_digest = excluded.source_digest, updated_at = excluded.updated_at",
    )
    .bind(&id)
    .bind(&workspace_key)
    .bind(target_kind)
    .bind(target_key)
    .bind(clean_summary)
    .bind(&source_digest)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "context_db_write_failed",
            "Context note could not be saved.",
            operation_id,
        )
    })?;

    Ok(ContextAnnotationRecord {
        id,
        target_kind: target_kind.to_owned(),
        target_key: target_key.to_owned(),
        summary: clean_summary.to_owned(),
        provenance: "developer_confirmed".to_owned(),
        source_digest,
        stale: false,
        created_at: now,
        updated_at: now,
    })
}

pub(crate) async fn delete_context_annotation_with_pool(
    pool: &SqlitePool,
    root: &Path,
    target_kind: &str,
    target_key: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    let workspace_key = root.to_string_lossy().into_owned();
    sqlx::query(
        "DELETE FROM context_annotations WHERE project_id = ? AND target_kind = ? AND target_key = ?",
    )
    .bind(&workspace_key)
    .bind(target_kind)
    .bind(target_key)
    .execute(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "context_db_write_failed",
            "Context note could not be removed.",
            operation_id,
        )
    })?;
    Ok(())
}

pub(crate) async fn save_context_pinned_link_with_pool(
    pool: &SqlitePool,
    root: &Path,
    source_path: &str,
    target_path: &str,
    relation_kind: &str,
    note: &str,
    operation_id: &str,
) -> Result<ContextPinnedLinkRecord, IpcError> {
    validate_safe_context_path(source_path, operation_id)?;
    validate_safe_context_path(target_path, operation_id)?;
    if !matches!(
        relation_kind,
        "calls" | "imports" | "tests" | "documents" | "depends_on"
    ) {
        return Err(terminal_error(
            "invalid_relation_kind",
            "Unsupported relationship type.",
            operation_id,
        ));
    }
    let clean_note = note.trim();
    if clean_note.len() > 500 {
        return Err(terminal_error(
            "invalid_link_note",
            "Relationship note must be 500 characters or fewer.",
            operation_id,
        ));
    }
    let src_bytes = fs::read(root.join(source_path)).map_err(|_| {
        terminal_error(
            "file_not_found",
            "Source file does not exist on disk.",
            operation_id,
        )
    })?;
    let tgt_bytes = fs::read(root.join(target_path)).map_err(|_| {
        terminal_error(
            "file_not_found",
            "Target file does not exist on disk.",
            operation_id,
        )
    })?;
    let source_digest =
        sha256_hex(format!("{}:{}", sha256_hex(&src_bytes), sha256_hex(&tgt_bytes)).as_bytes());
    let workspace_key = root.to_string_lossy().into_owned();
    let now = now_ms();
    let id = format!(
        "ctx-lnk-{}",
        &sha256_hex(
            format!("{workspace_key}:{source_path}:{target_path}:{relation_kind}").as_bytes()
        )[..16]
    );

    sqlx::query(
        "INSERT INTO context_pinned_links (id, project_id, source_path, target_path, relation_kind, note, source_digest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, source_path, target_path, relation_kind) DO UPDATE SET note = excluded.note, source_digest = excluded.source_digest, updated_at = excluded.updated_at",
    )
    .bind(&id)
    .bind(&workspace_key)
    .bind(source_path)
    .bind(target_path)
    .bind(relation_kind)
    .bind(clean_note)
    .bind(&source_digest)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|_| {
        terminal_error(
            "context_db_write_failed",
            "Confirmed relationship could not be saved.",
            operation_id,
        )
    })?;

    Ok(ContextPinnedLinkRecord {
        id,
        source_path: source_path.to_owned(),
        target_path: target_path.to_owned(),
        relation_kind: relation_kind.to_owned(),
        note: clean_note.to_owned(),
        source_digest,
        stale: false,
        created_at: now,
        updated_at: now,
    })
}

pub(crate) async fn delete_context_pinned_link_with_pool(
    pool: &SqlitePool,
    root: &Path,
    link_id: &str,
    operation_id: &str,
) -> Result<(), IpcError> {
    let workspace_key = root.to_string_lossy().into_owned();
    sqlx::query("DELETE FROM context_pinned_links WHERE project_id = ? AND id = ?")
        .bind(&workspace_key)
        .bind(link_id)
        .execute(pool)
        .await
        .map_err(|_| {
            terminal_error(
                "context_db_write_failed",
                "Confirmed relationship could not be removed.",
                operation_id,
            )
        })?;
    Ok(())
}

fn canonical_project_root(project_id: &str, operation_id: &str) -> Result<PathBuf, IpcError> {
    fs::canonicalize(project_id).map_err(|_| {
        terminal_error(
            "workspace_unavailable",
            "The project folder is no longer available.",
            operation_id,
        )
    })
}

#[tauri::command]
pub(crate) async fn get_file_context(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    index: tauri::State<'_, ContextIndexState>,
    request: FileContextRequest,
) -> Result<FileContextSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_context_request",
            "The file context request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_project_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    get_file_context_with_pool(
        &pool,
        index.inner(),
        &root,
        &request.relative_path,
        request.symbol.as_deref(),
        request.cursor_line,
        &request.operation_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn get_file_history(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: FileHistoryRequest,
) -> Result<FileHistorySnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_context_request",
            "The file history request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_project_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    get_file_history_with_pool(&pool, &root, &request.relative_path, &request.operation_id).await
}

#[tauri::command]
pub(crate) async fn get_system_context(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    index: tauri::State<'_, ContextIndexState>,
    request: GitRequest,
) -> Result<SystemContextSnapshot, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_context_request",
            "The system context request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_project_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    get_system_context_with_pool(&pool, index.inner(), &root, &request.operation_id).await
}

pub(crate) fn list_project_symbols_at(
    index: &ContextIndexState,
    root: &Path,
    _operation_id: &str,
) -> Result<Vec<ProjectSymbolEntry>, IpcError> {
    let workspace_key = root.to_string_lossy().into_owned();
    let (token, generation) = index.begin_generation(&workspace_key);
    let (cache, _cancelled) = update_workspace_index(root, index, &token, generation);
    let mut entries = Vec::new();
    for (file_path, file) in &cache.files {
        for sym in &file.symbols {
            entries.push(ProjectSymbolEntry {
                name: sym.name.clone(),
                kind: sym.kind.clone(),
                file_path: file_path.clone(),
                line: sym.line,
            });
        }
    }
    entries.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
            .then_with(|| a.file_path.cmp(&b.file_path))
            .then_with(|| a.line.cmp(&b.line))
    });
    entries.truncate(1500);
    Ok(entries)
}

#[tauri::command]
pub(crate) async fn list_project_symbols(
    index: tauri::State<'_, ContextIndexState>,
    request: GitRequest,
) -> Result<Vec<ProjectSymbolEntry>, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_context_request",
            "The workspace symbols request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_project_root(&request.project_id, &request.operation_id)?;
    let state = index.inner().clone();
    let op = request.operation_id.clone();
    tokio::task::spawn_blocking(move || list_project_symbols_at(&state, &root, &op))
        .await
        .map_err(|_| {
            terminal_error(
                "context_index_failed",
                "Workspace symbols indexing was interrupted.",
                &request.operation_id,
            )
        })?
}

#[tauri::command]
pub(crate) async fn cancel_context_index(
    index: tauri::State<'_, ContextIndexState>,
    request: GitRequest,
) -> Result<bool, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_context_request",
            "The context cancellation request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_project_root(&request.project_id, &request.operation_id)?;
    Ok(index.cancel_workspace(&root.to_string_lossy()))
}

#[tauri::command]
pub(crate) async fn save_context_annotation(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    index: tauri::State<'_, ContextIndexState>,
    request: SaveContextAnnotationRequest,
) -> Result<ContextAnnotationRecord, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_context_request",
            "The context note request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_project_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    save_context_annotation_with_pool(
        &pool,
        index.inner(),
        &root,
        &request.target_kind,
        &request.target_key,
        &request.summary,
        &request.operation_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn delete_context_annotation(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: DeleteContextAnnotationRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_context_request",
            "The context note delete request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_project_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    delete_context_annotation_with_pool(
        &pool,
        &root,
        &request.target_kind,
        &request.target_key,
        &request.operation_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn save_context_pinned_link(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: SaveContextPinnedLinkRequest,
) -> Result<ContextPinnedLinkRecord, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_context_request",
            "The pinned relationship request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_project_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    save_context_pinned_link_with_pool(
        &pool,
        &root,
        &request.source_path,
        &request.target_path,
        &request.relation_kind,
        &request.note,
        &request.operation_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn delete_context_pinned_link(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: DeleteContextPinnedLinkRequest,
) -> Result<(), IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_context_request",
            "The pinned relationship delete request is invalid.",
            &request.operation_id,
        ));
    }
    let root = canonical_project_root(&request.project_id, &request.operation_id)?;
    let pool = open_domain_database(&app, &db).await?;
    delete_context_pinned_link_with_pool(&pool, &root, &request.link_id, &request.operation_id)
        .await
}

#[cfg(test)]
mod context_tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    async fn setup_fixture() -> (PathBuf, SqlitePool, ContextIndexState) {
        let root = std::env::temp_dir().join(format!(
            "laplace-ctx-{}-{}",
            std::process::id(),
            EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src/auth")).unwrap();
        fs::create_dir_all(root.join("src/routes")).unwrap();
        fs::create_dir_all(root.join("tests")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();

        fs::write(
            root.join("src/auth/session.ts"),
            "export function rotateSession(token: string) {\n  return token.trim();\n}\n",
        )
        .unwrap();
        fs::write(
            root.join("src/routes/refresh.ts"),
            "import { rotateSession } from '../auth/session';\nexport function handleRefresh(t: string) {\n  return rotateSession(t);\n}\n",
        )
        .unwrap();
        fs::write(
            root.join("src/auth/session.test.ts"),
            "import { rotateSession } from './session';\nconsole.log(rotateSession('a'));\n",
        )
        .unwrap();
        fs::write(
            root.join("tests/refresh.spec.ts"),
            "// mentions handleRefresh without importing it directly\nconst label = 'handleRefresh';\n",
        )
        .unwrap();
        fs::write(
            root.join("node_modules/pkg/ignored.ts"),
            "export const ignored = rotateSession;\n",
        )
        .unwrap();

        let db_dir = root.join(".laplace-test-db");
        fs::create_dir_all(&db_dir).unwrap();
        let options = SqliteConnectOptions::new()
            .filename(db_dir.join("context.db"))
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let canonical = fs::canonicalize(&root).unwrap();
        (canonical, pool, ContextIndexState::default())
    }

    #[tokio::test]
    async fn extracts_observed_imports_callers_symbol_refs_and_distinguishes_inferred_tests() {
        let (root, pool, state) = setup_fixture().await;

        let session_ctx = get_file_context_with_pool(
            &pool,
            &state,
            &root,
            "src/auth/session.ts",
            Some("rotateSession"),
            Some(1),
            "op-ctx-1",
        )
        .await
        .unwrap();

        assert_eq!(session_ctx.language, "typescript");
        assert_eq!(session_ctx.symbols.len(), 1);
        assert_eq!(session_ctx.symbols[0].name, "rotateSession");
        assert!(session_ctx
            .importers
            .iter()
            .any(|rel| rel.source_path == "src/routes/refresh.ts" && rel.provenance == "observed"));
        assert!(session_ctx.related_tests.iter().any(|rel| rel.target_path
            == "src/auth/session.test.ts"
            && rel.provenance == "observed"));
        assert!(session_ctx
            .symbol_references
            .iter()
            .any(|hit| hit.file_path == "src/routes/refresh.ts" && hit.provenance == "observed"));
        assert!(session_ctx
            .symbol_references
            .iter()
            .all(|hit| !hit.file_path.contains("node_modules")));

        // `tests/refresh.spec.ts` does not import `src/routes/refresh.ts`, so test link is Inferred
        let refresh_ctx = get_file_context_with_pool(
            &pool,
            &state,
            &root,
            "src/routes/refresh.ts",
            Some("handleRefresh"),
            Some(2),
            "op-ctx-2",
        )
        .await
        .unwrap();
        assert!(refresh_ctx
            .imports
            .iter()
            .any(|rel| rel.target_path == "src/auth/session.ts" && rel.provenance == "observed"));
        assert!(refresh_ctx
            .related_tests
            .iter()
            .any(|rel| rel.target_path == "tests/refresh.spec.ts" && rel.provenance == "inferred"));
        assert!(refresh_ctx
            .symbol_references
            .iter()
            .any(|hit| hit.file_path == "tests/refresh.spec.ts" && hit.provenance == "inferred"));

        let _ = fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn developer_confirmed_notes_and_pinned_links_persist_and_detect_staleness_on_edit() {
        let (root, pool, state) = setup_fixture().await;

        let saved_note = save_context_annotation_with_pool(
            &pool,
            &state,
            &root,
            "file",
            "src/auth/session.ts",
            "Rotates refresh tokens synchronously.",
            "op-ann-1",
        )
        .await
        .unwrap();
        assert_eq!(saved_note.provenance, "developer_confirmed");
        assert!(!saved_note.stale);

        let saved_link = save_context_pinned_link_with_pool(
            &pool,
            &root,
            "src/routes/refresh.ts",
            "tests/refresh.spec.ts",
            "tests",
            "Confirmed regression test",
            "op-lnk-1",
        )
        .await
        .unwrap();
        assert!(!saved_link.stale);

        // Fresh load reports non-stale confirmed note and test link
        let fresh = get_file_context_with_pool(
            &pool,
            &state,
            &root,
            "src/auth/session.ts",
            None,
            None,
            "op-ctx-fresh",
        )
        .await
        .unwrap();
        assert_eq!(
            fresh
                .annotation
                .as_ref()
                .map(|a| (a.summary.as_str(), a.stale)),
            Some(("Rotates refresh tokens synchronously.", false))
        );

        // Modify underlying source files -> both note and pinned link become stale
        fs::write(
            root.join("src/auth/session.ts"),
            "export function rotateSession(token: string) {\n  return token.trim().toUpperCase();\n}\n",
        )
        .unwrap();
        fs::write(
            root.join("src/routes/refresh.ts"),
            "import { rotateSession } from '../auth/session';\nexport function handleRefresh(t: string) {\n  return rotateSession(t) + '!';\n}\n",
        )
        .unwrap();

        let after_edit = get_file_context_with_pool(
            &pool,
            &state,
            &root,
            "src/auth/session.ts",
            None,
            None,
            "op-ctx-stale",
        )
        .await
        .unwrap();
        assert_eq!(after_edit.annotation.as_ref().map(|a| a.stale), Some(true));

        let system = get_system_context_with_pool(&pool, &state, &root, "op-sys-1")
            .await
            .unwrap();
        assert!(system.modules.iter().any(|m| m.key == "src/auth"));
        assert!(system
            .edges
            .iter()
            .any(|e| e.source_module == "src/routes" && e.target_module == "src/auth"));
        assert!(system
            .pinned_links
            .iter()
            .any(|l| l.id == saved_link.id && l.stale));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cancellation_stops_index_scan_immediately() {
        let root = std::env::temp_dir().join(format!(
            "laplace-ctx-cancel-{}-{}",
            std::process::id(),
            EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/a.ts"), "export const a = 1;\n").unwrap();
        let state = ContextIndexState::default();
        let workspace_key = root.to_string_lossy().into_owned();
        let (token, gen_id) = state.begin_generation(&workspace_key);
        // Cancel before scanning starts
        state.cancel_workspace(&workspace_key);
        let (_cache, cancelled) = update_workspace_index(&root, &state, &token, gen_id);
        assert!(cancelled);
        let _ = fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn file_history_aggregates_git_commits_checkpoints_notes_and_checks() {
        let (root, pool, _state) = setup_fixture().await;
        let git = |args: &[&str]| {
            Command::new("git")
                .args(args)
                .current_dir(&root)
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .output()
                .unwrap()
        };
        assert!(git(&["init", "-b", "main"]).status.success());
        assert!(git(&["config", "user.email", "laplace@example.invalid"])
            .status
            .success());
        assert!(git(&["config", "user.name", "Laplace Test"])
            .status
            .success());
        assert!(git(&["add", "src/auth/session.ts"]).status.success());
        assert!(git(&["commit", "-m", "Add session rotation"])
            .status
            .success());

        let project_id = root.to_string_lossy().into_owned();
        sqlx::query("INSERT INTO changes (id, project_id, objective, status, created_at, updated_at) VALUES ('chg-1', ?, 'Session work', 'active', 100, 100)")
            .bind(&project_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO review_snapshots (id, change_id, source_digest, created_at) VALUES ('snap-1', 'chg-1', 'lbl:Before Rook Build|abc', 200)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO review_snapshot_files (snapshot_id, file_path, content) VALUES ('snap-1', 'src/auth/session.ts', 'old')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO review_comments (id, change_id, file_path, line_number, body, resolved, created_at) VALUES ('cmt-1', 'chg-1', 'src/auth/session.ts', 2, 'Check trim edge case', 0, 300)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO executions (id, project_id, change_id, command_json, source_digest, status, exit_code, output, started_at, finished_at) VALUES ('exec-1', ?, 'chg-1', '[\"pnpm\",[\"test\"]]', 'dig-1', 'passed', 0, 'ok', 400, 450)")
            .bind(&project_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO source_files (execution_id, path, digest) VALUES ('exec-1', 'src/auth/session.ts', 'file-dig-1')")
            .execute(&pool)
            .await
            .unwrap();

        let history = get_file_history_with_pool(&pool, &root, "src/auth/session.ts", "op-hist-1")
            .await
            .unwrap();
        assert_eq!(history.commits.len(), 1);
        assert_eq!(history.commits[0].subject, "Add session rotation");
        assert_eq!(history.checkpoints.len(), 1);
        assert_eq!(history.checkpoints[0].label, "Before Rook Build");
        assert_eq!(history.notes.len(), 1);
        assert_eq!(history.notes[0].body, "Check trim edge case");
        assert_eq!(history.checks.len(), 1);
        assert_eq!(history.checks[0].command, "pnpm test");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lists_project_symbols_across_workspace() {
        let root = std::env::temp_dir().join(format!(
            "laplace-symbols-test-{}-{}",
            std::process::id(),
            now_ms()
        ));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/auth.ts"),
            "export function rotateSessionToken() { return true; }\nexport interface SessionClaim { id: string }\n",
        )
        .unwrap();
        fs::write(
            root.join("src/lib.rs"),
            "pub fn verify_claim() -> bool { true }\n",
        )
        .unwrap();

        let state = ContextIndexState::default();
        let symbols = list_project_symbols_at(&state, &root, "op-sym-1").unwrap();
        assert!(symbols
            .iter()
            .any(|s| s.name == "rotateSessionToken" && s.file_path == "src/auth.ts"));
        assert!(symbols
            .iter()
            .any(|s| s.name == "SessionClaim" && s.file_path == "src/auth.ts"));
        assert!(symbols
            .iter()
            .any(|s| s.name == "verify_claim" && s.file_path == "src/lib.rs"));

        let _ = fs::remove_dir_all(&root);
    }
}
