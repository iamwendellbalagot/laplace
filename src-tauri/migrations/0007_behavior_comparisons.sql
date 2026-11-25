ALTER TABLE executions ADD COLUMN environment_json TEXT;

CREATE TABLE behavior_comparisons (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    change_id TEXT REFERENCES changes(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    baseline_execution_id TEXT NOT NULL,
    candidate_execution_id TEXT NOT NULL,
    normalization_json TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN (
        'equal',
        'different',
        'regressed',
        'fixed',
        'baseline_failed',
        'missing_artifact',
        'inconclusive'
    )),
    warnings_json TEXT NOT NULL DEFAULT '[]',
    shared_services_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
);

CREATE INDEX behavior_comparisons_project_created
    ON behavior_comparisons(project_id, created_at DESC);
