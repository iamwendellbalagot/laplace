use super::*;

pub(crate) const EXPECTED_SCHEMA_VERSION: i64 = 8;
const MAX_RETAINED_BACKUPS: usize = 3;

fn backup_dir_for(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups")
}

pub(crate) fn list_database_backups(db_path: &Path) -> Vec<PathBuf> {
    let dir = backup_dir_for(db_path);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("laplace-v") && n.ends_with(".sqlite3"))
        })
        .collect();
    files.sort();
    files
}

fn prune_old_backups(db_path: &Path) {
    let files = list_database_backups(db_path);
    if files.len() <= MAX_RETAINED_BACKUPS {
        return;
    }
    let remove_count = files.len() - MAX_RETAINED_BACKUPS;
    for old in files.into_iter().take(remove_count) {
        let _ = fs::remove_file(old);
    }
}

pub(crate) fn create_pre_migration_backup(
    db_path: &Path,
    from_version: i64,
) -> Result<Option<PathBuf>, IpcError> {
    let Ok(meta) = fs::metadata(db_path) else {
        return Ok(None);
    };
    if !meta.is_file() || meta.len() == 0 {
        return Ok(None);
    }
    let dir = backup_dir_for(db_path);
    fs::create_dir_all(&dir).map_err(|_| {
        terminal_error(
            "database_backup_failed",
            "Laplace could not create the database backup folder before upgrading.",
            "database",
        )
    })?;
    let backup_path = dir.join(format!("laplace-v{from_version}-{}.sqlite3", now_ms()));
    fs::copy(db_path, &backup_path).map_err(|_| {
        terminal_error(
            "database_backup_failed",
            "Laplace could not back up your database before upgrading. Existing data was left untouched.",
            "database",
        )
    })?;
    prune_old_backups(db_path);
    Ok(Some(backup_path))
}

pub(crate) async fn check_and_backup_before_migrate(
    db_path: &Path,
    pool: &SqlitePool,
) -> Result<Option<PathBuf>, IpcError> {
    let check_result: Option<String> = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_optional(pool)
        .await
        .map_err(|_| {
            terminal_error(
                "database_corrupt",
                "Laplace database integrity check failed. Inspect or restore a backup from the backups folder.",
                "database",
            )
        })?;
    if check_result.as_deref() != Some("ok") {
        return Err(terminal_error(
            "database_corrupt",
            &format!(
                "Laplace database failed integrity check ({}). Existing data was not overwritten; inspect {}.",
                check_result.as_deref().unwrap_or("unknown"),
                backup_dir_for(db_path).display()
            ),
            "database",
        ));
    }

    let has_migrations_table: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let current_version: i64 = if has_migrations_table > 0 {
        sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations")
            .fetch_one(pool)
            .await
            .unwrap_or(0)
    } else {
        0
    };

    if current_version > EXPECTED_SCHEMA_VERSION {
        return Err(terminal_error(
            "database_newer_version",
            &format!(
                "This Laplace database uses schema v{current_version}, which is newer than this app (v{EXPECTED_SCHEMA_VERSION}). Upgrade Laplace instead of downgrading."
            ),
            "database",
        ));
    }

    if current_version > 0 && current_version < EXPECTED_SCHEMA_VERSION {
        return create_pre_migration_backup(db_path, current_version);
    }

    Ok(None)
}

#[cfg(test)]
mod db_recovery_tests {
    use super::*;

    #[tokio::test]
    async fn backs_up_and_prunes_and_rejects_newer_schema_downgrade() {
        let dir = std::env::temp_dir().join(format!("laplace-dbrec-{}", crypto_operation_id()));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("laplace.sqlite3");

        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();

        sqlx::query("CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT, installed_on TIMESTAMP, success BOOLEAN, checksum BLOB, execution_time BIGINT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success) VALUES (5, 'old', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let created = check_and_backup_before_migrate(&db_path, &pool)
            .await
            .unwrap();
        assert!(created.is_some());
        assert_eq!(list_database_backups(&db_path).len(), 1);

        // Create extra backups and verify retention cap of 3
        for v in 1..=4 {
            std::thread::sleep(std::time::Duration::from_millis(2));
            let _ = create_pre_migration_backup(&db_path, v).unwrap();
        }
        assert_eq!(list_database_backups(&db_path).len(), MAX_RETAINED_BACKUPS);

        // Newer schema must be rejected rather than downgraded
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success) VALUES (99, 'future', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let err = check_and_backup_before_migrate(&db_path, &pool)
            .await
            .unwrap_err();
        assert_eq!(err.code, "database_newer_version");

        pool.close().await;
        let _ = fs::remove_dir_all(&dir);
    }
}
