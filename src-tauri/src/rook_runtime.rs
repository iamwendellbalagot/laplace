use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundledRookManifest {
    pub(crate) rook_version: String,
    pub(crate) node_version: String,
    pub(crate) platform: String,
    pub(crate) arch: String,
    pub(crate) node_bin: String,
    pub(crate) rook_entry: String,
    #[serde(default)]
    pub(crate) sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RookRuntimeResolution {
    pub(crate) node_bin: PathBuf,
    pub(crate) rook_entry: PathBuf,
    pub(crate) source: String,
    pub(crate) rook_version: Option<String>,
    pub(crate) node_version: Option<String>,
}

pub(crate) fn resolve_bundled_runtime_at(
    resource_dir: &Path,
    expected_os: &str,
    expected_arch: &str,
    operation_id: &str,
) -> Result<RookRuntimeResolution, IpcError> {
    let runtime_root = resource_dir.join("rook-runtime");
    let manifest_path = runtime_root.join("manifest.json");
    let raw = fs::read_to_string(&manifest_path).map_err(|_| {
        terminal_error(
            "rook_bundle_corrupt",
            "Laplace's bundled Rook runtime is missing. Reinstall or repair Laplace.",
            operation_id,
        )
    })?;
    let manifest: BundledRookManifest = serde_json::from_str(&raw).map_err(|_| {
        terminal_error(
            "rook_bundle_corrupt",
            "Laplace's bundled Rook runtime manifest is unreadable. Reinstall or repair Laplace.",
            operation_id,
        )
    })?;
    if manifest.platform != expected_os || manifest.arch != expected_arch {
        return Err(terminal_error(
            "rook_bundle_incompatible",
            &format!(
                "Laplace's bundled Rook runtime ({}/{}) does not match this system ({expected_os}/{expected_arch}). Reinstall the matching Laplace package.",
                manifest.platform, manifest.arch
            ),
            operation_id,
        ));
    }

    let canonical_root = fs::canonicalize(&runtime_root).map_err(|_| {
        terminal_error(
            "rook_bundle_corrupt",
            "Laplace's bundled Rook runtime folder is inaccessible. Reinstall or repair Laplace.",
            operation_id,
        )
    })?;
    let node_bin = fs::canonicalize(runtime_root.join(&manifest.node_bin)).map_err(|_| {
        terminal_error(
            "rook_bundle_corrupt",
            "Laplace's bundled Node runtime is missing. Reinstall or repair Laplace.",
            operation_id,
        )
    })?;
    let rook_entry = fs::canonicalize(runtime_root.join(&manifest.rook_entry)).map_err(|_| {
        terminal_error(
            "rook_bundle_corrupt",
            "Laplace's bundled Rook entrypoint is missing. Reinstall or repair Laplace.",
            operation_id,
        )
    })?;
    if !node_bin.starts_with(&canonical_root) || !rook_entry.starts_with(&canonical_root) {
        return Err(terminal_error(
            "rook_bundle_corrupt",
            "Laplace's bundled Rook runtime points outside the application bundle. Reinstall Laplace.",
            operation_id,
        ));
    }
    let dist_entry = rook_entry
        .parent()
        .and_then(Path::parent)
        .map(|root| root.join("dist").join("index.js"));
    if !dist_entry.is_some_and(|path| path.is_file()) {
        return Err(terminal_error(
            "rook_bundle_corrupt",
            "Laplace's bundled Rook runtime is incomplete (missing dist/index.js). Reinstall or repair Laplace.",
            operation_id,
        ));
    }

    Ok(RookRuntimeResolution {
        node_bin,
        rook_entry,
        source: "bundled".to_owned(),
        rook_version: Some(manifest.rook_version),
        node_version: Some(manifest.node_version),
    })
}

pub(crate) fn resolve_rook_runtime_for_launch(
    app: &tauri::AppHandle,
    operation_id: &str,
) -> Result<RookRuntimeResolution, IpcError> {
    if tauri::is_dev() {
        let settings = read_rook_dev_settings(&rook_dev_settings_path(app)?)?;
        let path = settings.checkout_path.ok_or_else(|| {
            terminal_error(
                "rook_checkout_required",
                "Select a local Rook checkout in Settings → Developer before starting Rook.",
                operation_id,
            )
        })?;
        let checkout = valid_rook_checkout(Path::new(&path)).ok_or_else(|| {
            terminal_error(
                "rook_checkout_invalid",
                "The selected Rook checkout is no longer valid. Select it again in Settings → Developer.",
                operation_id,
            )
        })?;
        return Ok(RookRuntimeResolution {
            node_bin: PathBuf::from("node"),
            rook_entry: checkout.join("bin").join("rook.mjs"),
            source: "dev_checkout".to_owned(),
            rook_version: None,
            node_version: None,
        });
    }

    // Release builds strictly launch only the bundled Rook/Node payload inside the Laplace app bundle.
    // Developer overrides, LAPLACE_ROOK_BIN, and global PATH binaries are intentionally ignored.
    let resource_dir = app.path().resource_dir().map_err(|_| {
        terminal_error(
            "rook_bundle_corrupt",
            "Laplace could not locate its application bundle resources. Reinstall or repair Laplace.",
            operation_id,
        )
    })?;
    resolve_bundled_runtime_at(
        &resource_dir,
        std::env::consts::OS,
        std::env::consts::ARCH,
        operation_id,
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeDiagnostics {
    pub(crate) app_version: String,
    pub(crate) os: String,
    pub(crate) arch: String,
    pub(crate) build_profile: String,
    pub(crate) schema_version: i64,
    pub(crate) expected_schema_version: i64,
    pub(crate) backup_count: usize,
    pub(crate) rook_source: String,
    pub(crate) rook_version: Option<String>,
    pub(crate) node_version: Option<String>,
    pub(crate) rook_error: Option<String>,
    pub(crate) network_policy: String,
}

#[tauri::command]
pub(crate) async fn get_runtime_diagnostics(
    app: tauri::AppHandle,
    db: tauri::State<'_, DomainDatabase>,
    request: PreferencesRequest,
) -> Result<RuntimeDiagnostics, IpcError> {
    if request.schema_version != IPC_SCHEMA_VERSION || !validate_operation_id(&request.operation_id)
    {
        return Err(terminal_error(
            "invalid_diagnostics_request",
            "The diagnostics request is invalid.",
            &request.operation_id,
        ));
    }
    let pool = open_domain_database(&app, &db).await?;
    let schema_version: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations")
            .fetch_one(&pool)
            .await
            .unwrap_or(0);
    let backup_count = app
        .path()
        .app_data_dir()
        .map(|dir| db_recovery::list_database_backups(&dir.join("laplace.sqlite3")).len())
        .unwrap_or(0);
    let (rook_source, rook_version, node_version, rook_error) =
        match resolve_rook_runtime_for_launch(&app, &request.operation_id) {
            Ok(runtime) => (
                runtime.source,
                runtime.rook_version,
                runtime.node_version,
                None,
            ),
            Err(error) => (
                if tauri::is_dev() {
                    "dev_checkout".to_owned()
                } else {
                    "bundled".to_owned()
                },
                None,
                None,
                Some(error.message),
            ),
        };
    Ok(RuntimeDiagnostics {
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        os: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        build_profile: if tauri::is_dev() { "development" } else { "release" }.to_owned(),
        schema_version,
        expected_schema_version: db_recovery::EXPECTED_SCHEMA_VERSION,
        backup_count,
        rook_source,
        rook_version,
        node_version,
        rook_error,
        network_policy: "Laplace makes no telemetry or update requests. Network access only occurs through Rook provider requests you initiate and commands you run.".to_owned(),
    })
}

#[cfg(test)]
mod rook_runtime_tests {
    use super::*;

    fn create_fake_bundle(root: &Path, os: &str, arch: &str) {
        let rt = root.join("rook-runtime");
        fs::create_dir_all(rt.join("rook").join("bin")).unwrap();
        fs::create_dir_all(rt.join("rook").join("dist")).unwrap();
        fs::write(rt.join("node"), "#!/bin/sh\n").unwrap();
        fs::write(rt.join("rook").join("bin").join("rook.mjs"), "// entry\n").unwrap();
        fs::write(rt.join("rook").join("dist").join("index.js"), "// dist\n").unwrap();
        let manifest = BundledRookManifest {
            rook_version: "0.1.7".to_owned(),
            node_version: "v22.19.0".to_owned(),
            platform: os.to_owned(),
            arch: arch.to_owned(),
            node_bin: "node".to_owned(),
            rook_entry: "rook/bin/rook.mjs".to_owned(),
            sha256: Some("abc123".to_owned()),
        };
        fs::write(
            rt.join("manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn resolves_valid_bundled_runtime_and_rejects_mismatch_or_missing_parts() {
        let dir = std::env::temp_dir().join(format!("laplace-bundle-{}", crypto_operation_id()));
        create_fake_bundle(&dir, "macos", "aarch64");

        let ok = resolve_bundled_runtime_at(&dir, "macos", "aarch64", "op-1").unwrap();
        assert_eq!(ok.source, "bundled");
        assert_eq!(ok.rook_version.as_deref(), Some("0.1.7"));

        let mismatch = resolve_bundled_runtime_at(&dir, "windows", "x86_64", "op-2").unwrap_err();
        assert_eq!(mismatch.code, "rook_bundle_incompatible");
        assert!(mismatch.message.contains("Reinstall"));

        fs::remove_file(
            dir.join("rook-runtime")
                .join("rook")
                .join("dist")
                .join("index.js"),
        )
        .unwrap();
        let corrupt = resolve_bundled_runtime_at(&dir, "macos", "aarch64", "op-3").unwrap_err();
        assert_eq!(corrupt.code, "rook_bundle_corrupt");
        assert!(corrupt.message.contains("Reinstall"));
        assert!(!corrupt.message.contains("LAPLACE_ROOK_BIN"));

        let _ = fs::remove_dir_all(&dir);
    }
}
