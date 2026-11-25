CREATE TABLE context_annotations (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    target_kind TEXT NOT NULL CHECK(target_kind IN ('file', 'module')),
    target_key TEXT NOT NULL,
    summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 1000),
    provenance TEXT NOT NULL CHECK(provenance IN ('developer_confirmed')),
    source_digest TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, target_kind, target_key)
);

CREATE INDEX context_annotations_project
    ON context_annotations(project_id, updated_at DESC);

CREATE TABLE context_pinned_links (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    source_path TEXT NOT NULL,
    target_path TEXT NOT NULL,
    relation_kind TEXT NOT NULL CHECK(relation_kind IN ('calls', 'imports', 'tests', 'documents', 'depends_on')),
    note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 500),
    source_digest TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, source_path, target_path, relation_kind)
);

CREATE INDEX context_pinned_links_project
    ON context_pinned_links(project_id, source_path);
