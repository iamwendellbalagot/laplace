import { useEffect, useState } from "react";
import type { AppService } from "../../services/app-service";
import type { RuntimeDiagnostics } from "../../services/contracts";

export function diagnosticsReport(d: RuntimeDiagnostics): string {
  return [
    `Laplace ${d.appVersion} (${d.buildProfile})`,
    `Platform: ${d.os}/${d.arch}`,
    `Database schema: v${d.schemaVersion} (app expects v${d.expectedSchemaVersion}), ${d.backupCount} pre-upgrade backup(s)`,
    `Rook runtime: ${d.rookSource}${d.rookVersion ? ` · rook-agent ${d.rookVersion}` : ""}${d.nodeVersion ? ` · Node ${d.nodeVersion}` : ""}`,
    d.rookError ? `Rook runtime error: ${d.rookError}` : "Rook runtime: ready",
    `Network: ${d.networkPolicy}`,
  ].join("\n");
}

export function RuntimeDiagnosticsPanel({
  service,
  browserPreview,
}: {
  service: AppService;
  browserPreview?: boolean;
}) {
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (browserPreview) return;
    let cancelled = false;
    void service
      .getRuntimeDiagnostics()
      .then((value) => {
        if (!cancelled) setDiagnostics(value);
      })
      .catch((failure: unknown) => {
        if (!cancelled)
          setError(
            failure instanceof Error
              ? failure.message
              : "Diagnostics could not be loaded.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [browserPreview, service]);

  if (browserPreview) {
    return <p>Diagnostics require the native desktop app.</p>;
  }
  return (
    <div className="runtime-diagnostics">
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {diagnostics ? (
        <>
          <pre className="runtime-diagnostics-report">
            {diagnosticsReport(diagnostics)}
          </pre>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              if (navigator.clipboard?.writeText) {
                void navigator.clipboard
                  .writeText(diagnosticsReport(diagnostics))
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }
            }}
          >
            {copied ? "Copied" : "Copy diagnostics"}
          </button>
        </>
      ) : (
        !error && <p role="status">Loading diagnostics…</p>
      )}
    </div>
  );
}
