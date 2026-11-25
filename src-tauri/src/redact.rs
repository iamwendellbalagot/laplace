/// Redacts common credential patterns from command output, exports, and diagnostic text.
pub(crate) fn redact_secrets(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for (idx, line) in input.split('\n').enumerate() {
        if idx > 0 {
            out.push('\n');
        }
        out.push_str(&redact_line(line));
    }
    out
}

fn redact_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    if let Some(pos) = lower.find("authorization:") {
        let prefix = &line[..pos + "authorization:".len()];
        return format!("{prefix} [redacted]");
    }
    let tokens: Vec<String> = line.split(' ').map(redact_token).collect();
    tokens.join(" ")
}

fn redact_token(token: &str) -> String {
    let trimmed = token.trim_matches(|c: char| matches!(c, '"' | '\'' | ',' | ';' | ')' | '('));
    if trimmed.is_empty() {
        return token.to_owned();
    }
    if let Some(redacted_url) = redact_url_credentials(token) {
        return redacted_url;
    }
    if is_known_secret_prefix(trimmed) {
        return token.replace(trimmed, "[redacted]");
    }
    if let Some((key, value)) = token.split_once('=') {
        let key_lower = key.to_ascii_lowercase();
        let val_clean = value.trim_matches(|c: char| matches!(c, '"' | '\'' | ',' | ';'));
        if !val_clean.is_empty()
            && val_clean != "[redacted]"
            && (key_lower.contains("token")
                || key_lower.contains("secret")
                || key_lower.contains("api_key")
                || key_lower.contains("apikey")
                || key_lower.contains("password")
                || key_lower.contains("passwd"))
        {
            return format!("{key}=[redacted]");
        }
    }
    token.to_owned()
}

fn is_known_secret_prefix(value: &str) -> bool {
    (value.starts_with("sk-") && value.len() >= 16)
        || (value.starts_with("ghp_") && value.len() >= 16)
        || (value.starts_with("github_pat_") && value.len() >= 20)
        || (value.starts_with("AIza") && value.len() >= 20)
        || ((value.starts_with("xoxb-")
            || value.starts_with("xoxp-")
            || value.starts_with("xoxa-")
            || value.starts_with("xoxs-"))
            && value.len() >= 16)
}

fn redact_url_credentials(token: &str) -> Option<String> {
    let scheme_pos = token.find("://")?;
    let after_scheme = &token[scheme_pos + 3..];
    let slash_pos = after_scheme.find('/').unwrap_or(after_scheme.len());
    let authority = &after_scheme[..slash_pos];
    let at_pos = authority.rfind('@')?;
    let mut out = String::with_capacity(token.len());
    out.push_str(&token[..scheme_pos + 3]);
    out.push_str("[redacted]@");
    out.push_str(&after_scheme[at_pos + 1..]);
    Some(out)
}

#[cfg(test)]
mod redact_tests {
    use super::*;

    #[test]
    fn redacts_tokens_headers_env_pairs_and_url_credentials() {
        let raw = concat!(
            "Authorization: Bearer abcdef1234567890\n",
            "OPENAI_API_KEY=sk-proj-1234567890abcdef\n",
            "clone https://user:supersecret@git.example.com/repo.git\n",
            "token ghp_0123456789abcdef012345\n",
            "normal output line stays intact"
        );
        let cleaned = redact_secrets(raw);
        assert!(!cleaned.contains("abcdef1234567890"));
        assert!(!cleaned.contains("sk-proj-1234567890abcdef"));
        assert!(!cleaned.contains("supersecret"));
        assert!(!cleaned.contains("ghp_0123456789abcdef012345"));
        assert!(cleaned.contains("https://[redacted]@git.example.com/repo.git"));
        assert!(cleaned.contains("normal output line stays intact"));
    }
}
