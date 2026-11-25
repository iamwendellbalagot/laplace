CREATE TABLE editor_drafts (
    project_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    saved_digest TEXT NOT NULL,
    draft_content TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, relative_path)
);

CREATE TABLE workspace_layout_state (
    project_id TEXT PRIMARY KEY NOT NULL,
    open_tabs_json TEXT NOT NULL,
    active_tab TEXT,
    split_tab TEXT,
    bottom_tab TEXT NOT NULL DEFAULT 'terminal',
    active_page TEXT NOT NULL DEFAULT 'editor',
    updated_at INTEGER NOT NULL
);

CREATE TABLE review_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    change_id TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
    source_digest TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX review_snapshots_change ON review_snapshots(change_id, created_at DESC);

CREATE TABLE review_snapshot_files (
    snapshot_id TEXT NOT NULL REFERENCES review_snapshots(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    content TEXT,
    PRIMARY KEY (snapshot_id, file_path)
);
