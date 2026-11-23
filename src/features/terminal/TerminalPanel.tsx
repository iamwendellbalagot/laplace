import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { AppService } from "../../services/app-service";
import type { TerminalEvent } from "../../services/contracts";

interface Props {
  service: AppService;
  workspaceId: string;
  browserPreview: boolean;
  trusted: boolean;
  onTrust: () => Promise<void>;
}

export function TerminalPanel({
  service,
  workspaceId,
  browserPreview,
  trusted,
  onTrust,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [workspaceTrusted, setWorkspaceTrusted] = useState(trusted);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || browserPreview || !workspaceTrusted) return;
    const id = crypto.randomUUID().replaceAll("-", "");
    const terminal = new Terminal({
      convertEol: false,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12,
      theme: {
        background: "#11120f",
        foreground: "#e7e2d4",
        cursor: "#c6a86a",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    let unlisten: (() => void) | undefined;
    let stopped = false;
    const sendResize = () =>
      void service
        .writeTerminal(id, workspaceId, undefined, terminal.rows, terminal.cols)
        .catch(() => undefined);
    const resize = new ResizeObserver(() => {
      fit.fit();
      sendResize();
    });
    resize.observe(host);
    void service
      .listenTerminal((event: TerminalEvent) => {
        if (event.sessionId !== id || event.workspaceId !== workspaceId) return;
        if (event.kind === "output" && event.data) terminal.write(event.data);
        if (event.kind === "exited")
          terminal.write(
            `\r\n[process exited${event.exitCode === null ? "" : ` with code ${event.exitCode}`} ]\r\n`,
          );
      })
      .then(async (stop) => {
        if (stopped) {
          stop();
          return;
        }
        unlisten = stop;
        await service.startTerminal(id, workspaceId);
      })
      .then(() => {
        terminal.write(`Laplace terminal · ${workspaceId}\r\n`);
        sendResize();
        terminal.onData(
          (data) =>
            void service
              .writeTerminal(id, workspaceId, data)
              .catch((failure) => setError(String(failure))),
        );
      })
      .catch((failure) =>
        setError(
          failure instanceof Error
            ? failure.message
            : "Terminal could not be started.",
        ),
      );
    return () => {
      stopped = true;
      resize.disconnect();
      unlisten?.();
      void service.stopTerminal(id, workspaceId).catch(() => undefined);
      terminal.dispose();
    };
  }, [browserPreview, service, workspaceId, workspaceTrusted]);

  return (
    <section className="terminal-panel" aria-label="Workspace terminal">
      {browserPreview ? (
        <p role="status">Terminal requires the native desktop app.</p>
      ) : !workspaceTrusted ? (
        <div>
          <p>Starting a shell can execute project-controlled commands.</p>
          <button
            type="button"
            onClick={() =>
              void onTrust()
                .then(() => {
                  setError(undefined);
                  setWorkspaceTrusted(true);
                })
                .catch((failure) => setError(String(failure)))
            }
          >
            Trust project and start terminal
          </button>
        </div>
      ) : (
        <div ref={hostRef} className="terminal-host" />
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
