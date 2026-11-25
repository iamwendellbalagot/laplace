CREATE TABLE review_comments (
    id TEXT PRIMARY KEY NOT NULL,
    change_id TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    line_number INTEGER,
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
    resolved INTEGER NOT NULL DEFAULT 0 CHECK(resolved IN (0, 1)),
    created_at INTEGER NOT NULL
);

CREATE INDEX review_comments_change ON review_comments(change_id, created_at ASC);

CREATE TABLE review_decisions (
    id TEXT PRIMARY KEY NOT NULL,
    change_id TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
    source_digest TEXT NOT NULL,
    head_revision TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('approved', 'revision_requested')),
    override_reason TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX review_decisions_change ON review_decisions(change_id, created_at DESC);

CREATE TABLE integration_attempts (
    id TEXT PRIMARY KEY NOT NULL,
    change_id TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    base_head TEXT NOT NULL,
    approved_source_digest TEXT NOT NULL,
    commit_message TEXT NOT NULL,
    selected_paths_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('prepared', 'committing', 'succeeded', 'failed', 'aborted')),
    commit_sha TEXT,
    error_detail TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX integration_attempts_change ON integration_attempts(change_id, created_at DESC);
