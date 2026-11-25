import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppService } from "../../services/app-service";
import type {
  RookContextChip,
  RunConfigSummary,
  RunEvent,
  RunInstance,
  WorkspaceLayoutInfo,
} from "../../services/contracts";
import { extractStackFrames, formatFailureContextExcerpt } from "./stack-trace";

interface RunPanelProps {
  service: AppService;
  projectId: string;
  projectPath: string;
  workspaceTrusted: boolean;
  browserPreview: boolean;
  onTrustWorkspace: () => Promise<void>;
  onJumpToLocation: (
    relativePath: string,
    line: number,
    column?: number,
  ) => void;
  onInvestigateInRook: (chip: RookContextChip) => void;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

export function LinkedStackOutput({
  output,
  projectPath,
  onJump,
}: {
  output: string;
  projectPath?: string;
  onJump: (relativePath: string, line: number, column?: number) => void;
}) {
  const frames = useMemo(
    () => extractStackFrames(output, projectPath),
    [output, projectPath],
  );
  if (!output) {
    return <pre className="stack-output">(no output)</pre>;
  }
  if (frames.length === 0) {
    return <pre className="stack-output">{output}</pre>;
  }
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  frames.forEach((frame, index) => {
    if (frame.startIndex > cursor) {
      nodes.push(output.slice(cursor, frame.startIndex));
    }
    nodes.push(
      <button
        key={`${frame.relativePath}:${frame.line}:${index}`}
        type="button"
        className="stack-frame-link"
        title={`Open ${frame.relativePath} at line ${frame.line}`}
        onClick={() => onJump(frame.relativePath, frame.line, frame.column)}
      >
        {frame.raw}
      </button>,
    );
    cursor = frame.endIndex;
  });
  if (cursor < output.length) {
    nodes.push(output.slice(cursor));
  }
  return <pre className="stack-output">{nodes}</pre>;
}

export function RunPanel({
  service,
  projectId,
  projectPath,
  workspaceTrusted,
  browserPreview,
  onTrustWorkspace,
  onJumpToLocation,
  onInvestigateInRook,
}: RunPanelProps) {
  const [layout, setLayout] = useState<WorkspaceLayoutInfo>();
  const [configs, setConfigs] = useState<RunConfigSummary[]>([]);
  const [instances, setInstances] = useState<RunInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>();
  const [portOverrides, setPortOverrides] = useState<Record<string, string>>(
    {},
  );
  const [pendingName, setPendingName] = useState<string>();
  const [error, setError] = useState<string>();

  const loadConfigsAndInstances = useCallback(async () => {
    if (browserPreview) return;
    try {
      const [cfgRes, instList] = await Promise.all([
        service.listRunConfigs(projectId),
        service.listRunInstances(projectId),
      ]);
      setLayout(cfgRes.layout);
      setConfigs(cfgRes.configs);
      setInstances(instList);
      setSelectedInstanceId((current) =>
        current && instList.some((item) => item.id === current)
          ? current
          : instList[0]?.id,
      );
    } catch (failure) {
      setError(errorText(failure, "Run configurations could not be loaded."));
    }
  }, [browserPreview, projectId, service]);

  useEffect(() => {
    void loadConfigsAndInstances();
  }, [loadConfigsAndInstances]);

  useEffect(() => {
    if (browserPreview) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void service
      .listenRunEvents((event: RunEvent) => {
        if (!active || event.workspaceId !== projectId) return;
        setInstances((current) =>
          current.map((item) => {
            if (item.id !== event.instanceId) return item;
            if (event.kind === "output") {
              const nextOut = item.output + (event.chunk ?? "");
              const bounded =
                nextOut.length > 262_144
                  ? nextOut.slice(nextOut.length - 262_144)
                  : nextOut;
              return {
                ...item,
                output: bounded,
                detectedUrl: item.detectedUrl ?? event.detectedUrl,
              };
            }
            return {
              ...item,
              status: event.status ?? item.status,
              exitCode: event.exitCode ?? item.exitCode,
              finishedAt: Date.now(),
            };
          }),
        );
      })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [browserPreview, projectId, service]);

  async function handleStart(config: RunConfigSummary) {
    setPendingName(config.name);
    setError(undefined);
    try {
      const rawPort = portOverrides[config.name]?.trim();
      const parsedPort = rawPort ? Number.parseInt(rawPort, 10) : undefined;
      if (
        rawPort &&
        (!Number.isInteger(parsedPort) ||
          (parsedPort ?? 0) < 1 ||
          (parsedPort ?? 0) > 65535)
      ) {
        setError("Port override must be a number between 1 and 65535.");
        return;
      }
      const started = await service.startRunConfig(
        projectId,
        config.name,
        parsedPort,
      );
      setInstances((current) => [
        started,
        ...current.filter((item) => item.id !== started.id),
      ]);
      setSelectedInstanceId(started.id);
    } catch (failure) {
      setError(errorText(failure, `Could not start "${config.name}".`));
    } finally {
      setPendingName(undefined);
    }
  }

  async function handleStop(instance: RunInstance) {
    setPendingName(instance.name);
    setError(undefined);
    try {
      const stopped = await service.stopRunConfig(projectId, instance.id);
      setInstances((current) =>
        current.map((item) => (item.id === stopped.id ? stopped : item)),
      );
    } catch (failure) {
      setError(errorText(failure, `Could not stop "${instance.name}".`));
    } finally {
      setPendingName(undefined);
    }
  }

  const activeInstance =
    instances.find((item) => item.id === selectedInstanceId) ?? instances[0];

  if (browserPreview) {
    return (
      <section className="run-panel" aria-label="Workspace runs">
        <p role="status">Run configurations require the native desktop app.</p>
      </section>
    );
  }

  return (
    <section className="run-panel" aria-label="Workspace runs">
      <div className="run-panel-bar">
        <div className="run-layout-meta">
          <span className="status-pill">
            {layout?.packageManager
              ? `${layout.packageManager} · ${layout.layout.replaceAll("_", " ")}`
              : (layout?.layout.replaceAll("_", " ") ?? "Workspace")}
          </span>
          <span className="run-workspace-id" title={projectPath}>
            Workspace: {projectPath.split(/[\\/]/).at(-1)}
          </span>
        </div>
        <div className="run-panel-bar-actions">
          {!workspaceTrusted && (
            <button
              type="button"
              className="button button-primary"
              onClick={() =>
                void onTrustWorkspace().catch((failure) =>
                  setError(
                    errorText(failure, "Project trust could not be saved."),
                  ),
                )
              }
            >
              Trust project to run
            </button>
          )}
          <button
            type="button"
            className="button button-quiet"
            onClick={() => void loadConfigsAndInstances()}
          >
            Refresh
          </button>
        </div>
      </div>

      {layout?.warnings.map((warning) => (
        <p key={warning} className="run-warning-note" role="status">
          {warning}
        </p>
      ))}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      <div className="run-panel-grid">
        <div className="run-config-list" aria-label="Configured runs">
          {configs.length === 0 ? (
            <p className="run-empty">
              No runnable scripts detected. Add <code>[runs.dev]</code> in{" "}
              <code>.laplace/recipes.toml</code>.
            </p>
          ) : (
            configs.map((config) => {
              const running = instances.find(
                (item) =>
                  item.name === config.name && item.status === "running",
              );
              return (
                <div className="run-config-row" key={config.name}>
                  <div className="run-config-info">
                    <strong>{config.name}</strong>
                    <code>
                      {config.program} {config.args.join(" ")}
                    </code>
                    <span className="run-config-source">
                      {config.source}
                      {config.cwd ? ` · ${config.cwd}` : ""}
                      {config.port ? ` · :${config.port}` : ""}
                    </span>
                    {config.sharedServices.length > 0 && (
                      <span
                        className="run-shared-badge"
                        title="Shared external or local services declared by this Run config"
                      >
                        Shared: {config.sharedServices.join(", ")}
                      </span>
                    )}
                  </div>
                  <div className="run-config-actions">
                    <input
                      className="run-port-input"
                      inputMode="numeric"
                      aria-label={`Port override for ${config.name}`}
                      placeholder={config.port ? `:${config.port}` : "PORT"}
                      value={portOverrides[config.name] ?? ""}
                      onChange={(event) =>
                        setPortOverrides((current) => ({
                          ...current,
                          [config.name]: event.target.value,
                        }))
                      }
                    />
                    {running ? (
                      <>
                        <button
                          type="button"
                          className="button button-quiet"
                          disabled={pendingName === config.name}
                          onClick={() => void handleStart(config)}
                        >
                          Restart
                        </button>
                        <button
                          type="button"
                          className="button button-quiet"
                          disabled={pendingName === config.name}
                          onClick={() => void handleStop(running)}
                        >
                          Stop
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={
                          !workspaceTrusted || pendingName === config.name
                        }
                        onClick={() => void handleStart(config)}
                      >
                        Start
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="run-output-pane" aria-label="Run output">
          {instances.length > 0 && (
            <div className="run-instance-tabs">
              {instances.slice(0, 6).map((inst) => (
                <button
                  key={inst.id}
                  type="button"
                  className={`run-instance-tab${activeInstance?.id === inst.id ? " is-active" : ""}`}
                  onClick={() => setSelectedInstanceId(inst.id)}
                >
                  <span>{inst.name}</span>
                  <span
                    className={`verify-status-pill verify-status-${inst.status === "running" ? "running" : inst.status === "failed" ? "failed" : "passed"}`}
                  >
                    {inst.status}
                  </span>
                </button>
              ))}
            </div>
          )}
          {activeInstance ? (
            <>
              <div className="run-output-meta">
                <span>
                  {activeInstance.name} ·{" "}
                  {activeInstance.exitCode !== null
                    ? `exit ${activeInstance.exitCode}`
                    : activeInstance.status}
                </span>
                <div className="run-output-actions">
                  {activeInstance.detectedUrl && (
                    <button
                      type="button"
                      className="workspace-tools-verify-link"
                      onClick={() =>
                        void service
                          .openRookAuthUrl(activeInstance.detectedUrl!)
                          .catch(() => undefined)
                      }
                    >
                      Open {activeInstance.detectedUrl} ↗
                    </button>
                  )}
                  {activeInstance.status === "failed" && (
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() =>
                        onInvestigateInRook({
                          id: `run-${activeInstance.id}`,
                          kind: "run_failure",
                          label: `Run failure · ${activeInstance.name}`,
                          content: formatFailureContextExcerpt(
                            `${activeInstance.program} ${activeInstance.args.join(" ")}`,
                            activeInstance.output,
                            projectPath,
                          ),
                        })
                      }
                    >
                      Investigate in Rook ↗
                    </button>
                  )}
                </div>
              </div>
              <LinkedStackOutput
                output={activeInstance.output}
                projectPath={projectPath}
                onJump={onJumpToLocation}
              />
            </>
          ) : (
            <p className="run-empty">
              Start a Run configuration to stream output and clickable stack
              traces here.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
