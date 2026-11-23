CREATE TABLE changes (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    objective TEXT NOT NULL CHECK(length(objective) BETWEEN 1 AND 500),
    status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'in_review', 'approved', 'integrated', 'abandoned')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE change_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    change_id TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX changes_project_updated ON changes(project_id, updated_at DESC);

CREATE TABLE executions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    change_id TEXT REFERENCES changes(id),
    command_json TEXT NOT NULL,
    source_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running', 'passed', 'failed', 'cancelled', 'timed_out', 'start_failed', 'interrupted', 'inconclusive', 'stale')),
    exit_code INTEGER,
    output TEXT NOT NULL DEFAULT '',
    started_at INTEGER NOT NULL,
    finished_at INTEGER
);

CREATE TABLE source_files (
    execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    digest TEXT NOT NULL,
    PRIMARY KEY(execution_id, path)
);

CREATE TABLE project_recipes (
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    recipe_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(project_id, name)
);
