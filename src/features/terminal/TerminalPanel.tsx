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
  theme?: "dark" | "light";
  onTrust: () => Promise<void>;
  onUntrust?: () => Promise<void>;
}

function terminalColors(theme: "dark" | "light") {
  return theme === "light"
    ? {
        background: "#f6f8fa",
        foreground: "#0f172a",
        cursor: "#15803d",
        cursorAccent: "#f6f8fa",
        selectionBackground: "#15803d29",
        black: "#0f172a",
        red: "#be123c",
        green: "#15803d",
        yellow: "#b45309",
        blue: "#1d4ed8",
        magenta: "#7e22ce",
        cyan: "#0e7490",
        white: "#e2e8f0",
        brightBlack: "#5a6675",
        brightRed: "#e11d48",
        brightGreen: "#16a34a",
        brightYellow: "#d97706",
        brightBlue: "#2563eb",
        brightMagenta: "#9333ea",
        brightCyan: "#0891b2",
        brightWhite: "#ffffff",
      }
    : {
        background: "#0b0e12",
        foreground: "#e6edf3",
        cursor: "#4ade80",
        cursorAccent: "#0b0e12",
        selectionBackground: "#4ade8036",
        black: "#141921",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#f0b44c",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#56d4dd",
        white: "#b6c2cf",
        brightBlack: "#556170",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fcd34d",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#e6edf3",
      };
}

export function TerminalPanel({
  service,
  workspaceId,
  browserPreview,
  trusted,
  theme = "dark",
  onTrust,
  onUntrust,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = terminalColors(theme);
    }
  }, [theme]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || browserPreview || !trusted) return;
    const id = crypto.randomUUID().replaceAll("-", "");
    const terminal = new Terminal({
      convertEol: false,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12,
      theme: terminalColors(themeRef.current),
    });
    terminalRef.current = terminal;
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
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        fit.fit();
        sendResize();
      }
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
      terminalRef.current = null;
      void service.stopTerminal(id, workspaceId).catch(() => undefined);
      terminal.dispose();
    };
  }, [browserPreview, service, trusted, workspaceId]);

  return (
    <section
      className={`terminal-panel${!browserPreview && trusted ? " terminal-panel-active" : ""}`}
      aria-label="Workspace terminal"
    >
      {browserPreview ? (
        <p role="status">Terminal requires the native desktop app.</p>
      ) : !trusted ? (
        <div>
          <p>Starting a shell can execute project-controlled commands.</p>
          <button
            type="button"
            className="button button-primary"
            onClick={() =>
              void onTrust()
                .then(() => {
                  setError(undefined);
                })
                .catch((failure) => setError(String(failure)))
            }
          >
            Trust project and start terminal
          </button>
        </div>
      ) : (
        <>
          {onUntrust && (
            <div className="terminal-toolbar">
              <button
                type="button"
                className="button button-quiet"
                onClick={() =>
                  void onUntrust().catch((failure) => setError(String(failure)))
                }
              >
                Revoke project trust
              </button>
            </div>
          )}
          <div ref={hostRef} className="terminal-host" />
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
