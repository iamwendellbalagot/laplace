CREATE TABLE workspace_capability_reviews (
    project_id TEXT PRIMARY KEY NOT NULL,
    skills_digest TEXT NOT NULL DEFAULT '',
    mcp_digest TEXT NOT NULL DEFAULT '',
    providers_digest TEXT NOT NULL DEFAULT '',
    acknowledged_at INTEGER NOT NULL
);

CREATE TABLE capability_activity (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    session_id TEXT,
    capability_kind TEXT NOT NULL,
    capability_name TEXT NOT NULL,
    source_scope TEXT NOT NULL,
    decision TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);

CREATE INDEX capability_activity_project_created
    ON capability_activity(project_id, created_at DESC);
