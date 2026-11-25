use super::*;

const MAX_SEARCH_RESULTS_CAP: usize = 500;
const DEFAULT_SEARCH_RESULTS: usize = 200;
const MAX_SEARCH_LINE_CHARS: usize = 280;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchProjectRequest {
    pub schema_version: u16,
    pub operation_id: String,
    pub project_id: String,
    pub query: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub max_results: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub line: usize,
    pub column: usize,
    pub match_length: usize,
    pub line_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileMatches {
    pub relative_path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchProjectResponse {
    pub schema_version: u16,
    pub operation_id: String,
    pub files: Vec<SearchFileMatches>,
    pub total_matches: usize,
    pub searched_files: usize,
    pub truncated: bool,
}

fn is_word_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

fn truncate_line_preview(line: &str) -> String {
    let trimmed = line.trim_end_matches(['\r', '\n']);
    if trimmed.chars().count() <= MAX_SEARCH_LINE_CHARS {
        return trimmed.to_owned();
    }
    let mut preview: String = trimmed.chars().take(MAX_SEARCH_LINE_CHARS).collect();
    preview.push('…');
    preview
}

fn find_line_matches(
    line: &str,
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
) -> Vec<(usize, usize)> {
    if query.is_empty() {
        return Vec::new();
    }
    let (haystack, needle) = if case_sensitive {
        (line.to_owned(), query.to_owned())
    } else {
        (line.to_lowercase(), query.to_lowercase())
    };
    let mut matches = Vec::new();
    let mut offset = 0usize;
    let needle_chars = needle.chars().count();
    while offset <= haystack.len() {
        let Some(found) = haystack[offset..].find(&needle) else {
            break;
        };
        let byte_start = offset + found;
        let byte_end = byte_start + needle.len();
        let word_ok = if !whole_word {
            true
        } else {
            let prev_ok = haystack[..byte_start]
                .chars()
                .next_back()
                .map(|c| !is_word_char(c))
                .unwrap_or(true);
            let next_ok = haystack[byte_end..]
                .chars()
                .next()
                .map(|c| !is_word_char(c))
                .unwrap_or(true);
            prev_ok && next_ok
        };
        if word_ok {
            let col = haystack[..byte_start].chars().count() + 1;
            matches.push((col, needle_chars));
        }
        offset = byte_end.max(byte_start + 1);
    }
    matches
}

pub(crate) fn search_project_text_at(
    root: &Path,
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    max_results: usize,
    operation_id: &str,
) -> Result<(Vec<SearchFileMatches>, usize, usize, bool), IpcError> {
    if query.is_empty() {
        return Ok((Vec::new(), 0, 0, false));
    }
    let files = workspace_state::list_project_files_at(root, operation_id)?;
    let limit = max_results.clamp(1, MAX_SEARCH_RESULTS_CAP);
    let mut results = Vec::new();
    let mut total_matches = 0usize;
    let mut searched_files = 0usize;
    let mut truncated = false;

    for relative_path in files {
        if total_matches >= limit {
            truncated = true;
            break;
        }
        let full_path = root.join(&relative_path);
        let Ok(meta) = fs::symlink_metadata(&full_path) else {
            continue;
        };
        if meta.file_type().is_symlink()
            || !meta.is_file()
            || meta.len() > fs_service::MAX_PROJECT_FILE_BYTES
        {
            continue;
        }
        let Ok(bytes) = fs::read(&full_path) else {
            continue;
        };
        if bytes.contains(&0) {
            continue;
        }
        let Ok(text) = String::from_utf8(bytes) else {
            continue;
        };
        searched_files += 1;

        let mut file_matches = Vec::new();
        for (line_idx, line) in text.lines().enumerate() {
            let line_hits = find_line_matches(line, query, case_sensitive, whole_word);
            if line_hits.is_empty() {
                continue;
            }
            let preview = truncate_line_preview(line);
            for (column, match_length) in line_hits {
                if total_matches >= limit {
                    truncated = true;
                    break;
                }
                file_matches.push(SearchMatch {
                    line: line_idx + 1,
                    column,
                    match_length,
                    line_text: preview.clone(),
                });
                total_matches += 1;
            }
            if truncated {
                break;
            }
        }
        if !file_matches.is_empty() {
            results.push(SearchFileMatches {
                relative_path,
                matches: file_matches,
            });
        }
    }

    Ok((results, total_matches, searched_files, truncated))
}

#[tauri::command]
pub(crate) async fn search_project_text(
    request: SearchProjectRequest,
) -> Result<SearchProjectResponse, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(IpcError::new(
            "invalid_search_request",
            "The search request is invalid or uses an unsupported schema.",
            request.operation_id,
            false,
        ));
    }
    let root = fs::canonicalize(&request.project_id).map_err(|_| {
        IpcError::new(
            "project_unavailable",
            "The project folder is no longer available.",
            request.operation_id.clone(),
            true,
        )
    })?;
    let operation_id = request.operation_id.clone();
    let query = request.query.clone();
    let max_results = request.max_results.unwrap_or(DEFAULT_SEARCH_RESULTS);
    let (files, total_matches, searched_files, truncated) =
        tokio::task::spawn_blocking(move || {
            search_project_text_at(
                &root,
                &query,
                request.case_sensitive,
                request.whole_word,
                max_results,
                &operation_id,
            )
        })
        .await
        .map_err(|_| {
            IpcError::new(
                "search_failed",
                "Workspace search did not finish cleanly.",
                request.operation_id.clone(),
                true,
            )
        })??;

    Ok(SearchProjectResponse {
        schema_version: IPC_SCHEMA_VERSION,
        operation_id: request.operation_id,
        files,
        total_matches,
        searched_files,
        truncated,
    })
}

#[cfg(test)]
mod search_tests {
    use super::*;

    #[test]
    fn searches_with_case_and_whole_word_and_skips_binary() {
        let temp = tempfile_dir("search-basic");
        fs::create_dir_all(temp.join("src")).unwrap();
        fs::create_dir_all(temp.join("node_modules/pkg")).unwrap();
        fs::write(
            temp.join("src/main.ts"),
            "const alpha = 1;\nconst alphabet = 2;\nconst AlphaBeta = 3;\n",
        )
        .unwrap();
        fs::write(temp.join("src/bin.dat"), b"alpha\0binary").unwrap();
        fs::write(temp.join("node_modules/pkg/index.ts"), "alpha\n").unwrap();

        let (files, total, searched, truncated) =
            search_project_text_at(&temp, "alpha", false, false, 50, "op-search-1").unwrap();
        assert_eq!(searched, 1);
        assert_eq!(total, 3);
        assert!(!truncated);
        assert_eq!(files[0].relative_path, "src/main.ts");

        let (word_files, word_total, _, _) =
            search_project_text_at(&temp, "alpha", true, true, 50, "op-search-2").unwrap();
        assert_eq!(word_total, 1);
        assert_eq!(word_files[0].matches[0].line, 1);
        assert_eq!(word_files[0].matches[0].column, 7);

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn truncates_at_max_results() {
        let temp = tempfile_dir("search-trunc");
        fs::write(temp.join("a.txt"), "hit one\nhit two\nhit three\n").unwrap();

        let (files, total, _, truncated) =
            search_project_text_at(&temp, "hit", true, false, 2, "op-search-3").unwrap();
        assert_eq!(total, 2);
        assert!(truncated);
        assert_eq!(files[0].matches.len(), 2);

        let _ = fs::remove_dir_all(&temp);
    }

    fn tempfile_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("laplace-{prefix}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
