// Disposable native webview/worker probe; no filesystem or subprocess commands.
#[tauri::command]
async fn ping(schema_version: u32) -> Result<serde_json::Value, String> {
    if schema_version != 1 {
        return Err("unsupported probe schema".into());
    }
    Ok(serde_json::json!({ "schemaVersion": 1, "message": "native round trip" }))
}

#[tauri::command]
fn report(app: tauri::AppHandle, result: serde_json::Value) {
    println!("LAPLACE_PROBE_RESULT={result}");
    // Only an explicit smoke invocation closes automatically; normal runs remain
    // open for manual input, clipboard, resize, display scaling and IME checks.
    if std::env::var("LAPLACE_PROBE_SMOKE").as_deref() == Ok("1") {
        app.exit(if result["passed"] == true { 0 } else { 1 });
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping, report])
        .run(tauri::generate_context!())
        .expect("feasibility webview failed");
}
