import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { navigationItems, screenTitles } from "./app/navigation";
import { AppServiceError, type AppService } from "./services/app-service";
import type { AppEvent, UiPreferences } from "./services/contracts";
import { useAppStore, type PageId } from "./state/app-store";

interface AppProps {
  service: AppService;
}

interface PaletteCommand {
  id: string;
  label: string;
  description: string;
  run: () => void;
}

export function App({ service }: AppProps) {
  const page = useAppStore((state) => state.page);
  const preferences = useAppStore((state) => state.preferences);
  const navigate = useAppStore((state) => state.navigate);
  const setPreferences = useAppStore((state) => state.setPreferences);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string>();
  const [nativeResult, setNativeResult] = useState<string>();
  const [nativeError, setNativeError] = useState<AppServiceError>();
  const [nativeEvent, setNativeEvent] = useState<AppEvent>();
  const [nativePending, setNativePending] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void service
      .getPreferences()
      .then((loaded) => {
        if (mounted) setPreferences(loaded);
      })
      .catch(() => {
        if (mounted) {
          setPreferencesError("Saved display preferences could not be loaded.");
        }
      });
    void service
      .listen((event) => {
        if (mounted) setNativeEvent(event);
      })
      .then((stop) => {
        if (mounted) unlisten = stop;
        else stop();
      })
      .catch(() => {
        if (mounted) {
          setNativeError(
            new AppServiceError(
              "event_listener_unavailable",
              "The native event listener could not be started.",
              "",
              true,
            ),
          );
        }
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [service, setPreferences]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target;
      const isTextEntry =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select, [role='textbox']"));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (isTextEntry) return;
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "b" &&
        !isTextEntry
      ) {
        event.preventDefault();
        void savePreferences({
          ...preferences,
          navigationCollapsed: !preferences.navigationCollapsed,
        });
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [preferences, service]);

  async function savePreferences(next: UiPreferences) {
    setSavingPreferences(true);
    setPreferencesError(undefined);
    try {
      const saved = await service.updatePreferences(next);
      setPreferences(saved);
    } catch (error) {
      setPreferencesError(
        error instanceof Error
          ? error.message
          : "Display preferences could not be saved.",
      );
    } finally {
      setSavingPreferences(false);
    }
  }

  async function testNativeConnection() {
    setNativePending(true);
    setNativeError(undefined);
    setNativeResult(undefined);
    try {
      const response = await service.ping();
      setNativeResult(response.message);
    } catch (error) {
      setNativeError(
        error instanceof AppServiceError
          ? error
          : new AppServiceError(
              "native_unavailable",
              "The native command failed. Retry the connection check.",
              "",
              true,
            ),
      );
    } finally {
      setNativePending(false);
    }
  }

  const commands = useMemo<PaletteCommand[]>(
    () => [
      ...navigationItems.map((item) => ({
        id: `navigate-${item.id}`,
        label: `Go to ${item.label}`,
        description: item.description,
        run: () => navigate(item.id),
      })),
      {
        id: "toggle-navigation",
        label: preferences.navigationCollapsed
          ? "Expand navigation rail"
          : "Collapse navigation rail",
        description: "Toggle the left navigation rail",
        run: () =>
          void savePreferences({
            ...preferences,
            navigationCollapsed: !preferences.navigationCollapsed,
          }),
      },
      {
        id: "toggle-inspector",
        label: preferences.inspectorCollapsed
          ? "Show editor inspector"
          : "Hide editor inspector",
        description: "Toggle the Editor context inspector",
        run: () =>
          void savePreferences({
            ...preferences,
            inspectorCollapsed: !preferences.inspectorCollapsed,
          }),
      },
      {
        id: "toggle-theme",
        label: `Use ${preferences.theme === "dark" ? "light" : "dark"} theme`,
        description: "Change the application color treatment",
        run: () =>
          void savePreferences({
            ...preferences,
            theme: preferences.theme === "dark" ? "light" : "dark",
          }),
      },
    ],
    [navigate, preferences, service, setPreferences],
  );

  const platformShortcut = /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘ K"
    : "Ctrl K";

  return (
    <div
      className="app-shell"
      data-theme={preferences.theme}
      data-density={preferences.density}
      style={
        {
          "--editor-font-size": `${preferences.editorFontSize}px`,
          "--inspector-width": `${preferences.inspectorWidth}px`,
        } as CSSProperties
      }
    >
      <header className="topbar" aria-label="Application toolbar">
        <button
          className="brand"
          type="button"
          aria-label="Laplace home"
          onClick={() => navigate("home")}
        >
          <OrbitMark />
          <span>
            laplace<span className="brand-point">.</span>
          </span>
        </button>
        <span className="toolbar-divider" />
        <div className="project-context" aria-label="Project context">
          <span className="project-avatar" aria-hidden="true">
            —
          </span>
          <span>No project open</span>
          <span className="toolbar-subtle">/ no branch</span>
        </div>
        <Dialog.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
          <Dialog.Trigger asChild>
            <button className="command-trigger" type="button">
              <span className="search-glyph" aria-hidden="true">
                ⌕
              </span>
              <span className="command-placeholder">
                Search screens and commands
              </span>
              <kbd>{platformShortcut}</kbd>
            </button>
          </Dialog.Trigger>
          <CommandPalette
            commands={commands}
            onRun={(command) => {
              command.run();
              setPaletteOpen(false);
            }}
          />
        </Dialog.Root>
        <div className="toolbar-right">
          <span className="connection-state">
            <span className="status-dot status-dot-muted" /> Rook not connected
          </span>
          <button
            type="button"
            className="toolbar-icon-button"
            aria-label="Open settings"
            title="Settings"
            onClick={() => navigate("settings")}
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="app-body">
        <nav
          className={`nav-rail${preferences.navigationCollapsed ? " nav-rail-collapsed" : ""}`}
          aria-label="Primary navigation"
        >
          {navigationItems.map((item, index) => (
            <div
              className={
                index === 5 ? "nav-group nav-group-separated" : "nav-group"
              }
              key={item.id}
            >
              <button
                type="button"
                className={`nav-item${page === item.id ? " nav-item-active" : ""}`}
                aria-label={item.label}
                aria-current={page === item.id ? "page" : undefined}
                title={preferences.navigationCollapsed ? item.label : undefined}
                onClick={() => navigate(item.id)}
              >
                <span className="nav-symbol" aria-hidden="true">
                  {item.symbol}
                </span>
                <span className="nav-label">{item.label}</span>
                {!item.available && (
                  <span className="nav-unavailable" aria-hidden="true">
                    ·
                  </span>
                )}
              </button>
            </div>
          ))}
          <div className="nav-rail-footer">
            <button
              type="button"
              className="nav-collapse-button"
              aria-label={
                preferences.navigationCollapsed
                  ? "Expand navigation rail"
                  : "Collapse navigation rail"
              }
              title={
                preferences.navigationCollapsed
                  ? "Expand navigation"
                  : "Collapse navigation"
              }
              onClick={() =>
                void savePreferences({
                  ...preferences,
                  navigationCollapsed: !preferences.navigationCollapsed,
                })
              }
            >
              <span aria-hidden="true">
                {preferences.navigationCollapsed ? "›" : "‹"}
              </span>
              <span className="nav-label">Collapse</span>
            </button>
          </div>
        </nav>

        <main
          className="screen"
          id="main-content"
          aria-labelledby="screen-title"
        >
          <ScreenContent
            page={page}
            preferences={preferences}
            onPreferencesChange={savePreferences}
            savingPreferences={savingPreferences}
            preferencesError={preferencesError}
            nativeResult={nativeResult}
            nativeError={nativeError}
            nativeEvent={nativeEvent}
            nativePending={nativePending}
            onTestNative={testNativeConnection}
            onNavigate={navigate}
          />
        </main>
      </div>

      {preferencesError && (
        <div className="global-alert" role="alert">
          {preferencesError}
        </div>
      )}

      <footer className="statusbar" aria-label="Application status">
        <div className="statusbar-group">
          <span className="status-mark" aria-hidden="true">
            ◈
          </span>
          <span>No workspace</span>
          <span className="status-separator" />
          <span>Local-first</span>
        </div>
        <div className="statusbar-group statusbar-secondary">
          <span>Laplace · desktop</span>
          <span className="status-separator" />
          <span>{screenTitles[page]}</span>
        </div>
      </footer>
    </div>
  );
}

function OrbitMark() {
  return (
    <svg className="orbit-mark" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="15.5" />
      <path d="M12 9v17h15M12 26 25 10" />
      <circle className="orbit-point" cx="25" cy="10" r="2" />
    </svg>
  );
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  onRun: (command: PaletteCommand) => void;
}

function CommandPalette({ commands, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = commands.filter((command) =>
    `${command.label} ${command.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  useEffect(() => setSelectedIndex(0), [query]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[selectedIndex];
      if (command) onRun(command);
    }
  }

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="palette-overlay" />
      <Dialog.Content
        className="command-palette"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          setQuery("");
          setSelectedIndex(0);
          inputRef.current?.focus();
        }}
      >
        <div className="palette-search-row">
          <span className="search-glyph" aria-hidden="true">
            ⌕
          </span>
          <Dialog.Title className="visually-hidden">
            Command palette
          </Dialog.Title>
          <Dialog.Description className="visually-hidden">
            Search screens and commands. Use the arrow keys to move and Enter to
            run.
          </Dialog.Description>
          <input
            ref={inputRef}
            aria-label="Search screens and commands"
            aria-controls="command-results"
            aria-activedescendant={
              filtered[selectedIndex]
                ? `command-${filtered[selectedIndex].id}`
                : undefined
            }
            autoComplete="off"
            placeholder="Where would you like to go?"
            role="combobox"
            aria-expanded="true"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
          <Dialog.Close asChild>
            <button className="palette-escape" type="button">
              Esc
            </button>
          </Dialog.Close>
        </div>
        <div
          className="palette-results"
          id="command-results"
          role="listbox"
          aria-label="Commands"
        >
          {filtered.length === 0 ? (
            <p className="palette-empty">No matching commands.</p>
          ) : (
            filtered.map((command, index) => (
              <button
                id={`command-${command.id}`}
                className={`palette-command${index === selectedIndex ? " palette-command-active" : ""}`}
                key={command.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseMove={() => setSelectedIndex(index)}
                onClick={() => onRun(command)}
              >
                <span className="palette-command-symbol" aria-hidden="true">
                  ↗
                </span>
                <span className="palette-command-label">{command.label}</span>
                <span className="palette-command-description">
                  {command.description}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="palette-help" aria-hidden="true">
          <span>↑ ↓ Navigate</span>
          <span>↵ Open</span>
          <span>Esc Close</span>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

interface ScreenContentProps {
  page: PageId;
  preferences: UiPreferences;
  onPreferencesChange: (preferences: UiPreferences) => Promise<void>;
  savingPreferences: boolean;
  preferencesError?: string;
  nativeResult?: string;
  nativeError?: AppServiceError;
  nativeEvent?: AppEvent;
  nativePending: boolean;
  onTestNative: () => void;
  onNavigate: (page: PageId) => void;
}

function ScreenContent(props: ScreenContentProps) {
  const { page } = props;
  if (page === "settings") return <SettingsScreen {...props} />;
  if (page === "editor") return <EditorScreen {...props} />;
  if (page === "home") return <HomeScreen onNavigate={props.onNavigate} />;

  const item = navigationItems.find((entry) => entry.id === page);
  const details: Record<
    Exclude<PageId, "home" | "editor" | "settings">,
    string
  > = {
    changes:
      "Change records will appear here once durable project state is available.",
    context:
      "Context relationships will be grounded in opened source and recorded provenance.",
    verify:
      "Verification records will appear only after a real check is run against a known source state.",
    rook: "Rook is a separate process and is not connected to this shell yet. No sessions or agent tools are running.",
    tools:
      "Skills and MCP configuration are not available until the Rook integration is implemented.",
  };
  return (
    <section className="content-page" aria-labelledby="screen-title">
      <PageHeading eyebrow="Laplace workspace" title={screenTitles[page]} />
      <EmptyState
        title="Not available yet"
        description={details[page]}
        label={item?.label ?? "Feature"}
      />
    </section>
  );
}

function HomeScreen({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  return (
    <section className="home-page" aria-labelledby="screen-title">
      <div className="home-copy">
        <p className="eyebrow">A focused desktop workspace</p>
        <h1 id="screen-title">
          Code when you want.
          <br />
          Delegate when you need.
        </h1>
        <p className="home-intro">
          Understand, change, and verify software in one local-first workflow.
        </p>
        <div className="home-open-state">
          <span className="status-dot status-dot-muted" />
          <div>
            <strong>No project open</strong>
            <span>Project opening is the next implementation step.</span>
          </div>
        </div>
        <p className="home-note">
          Nothing has been scanned, executed, or sent to an agent. Open the
          Editor to explore the shell, or adjust its appearance in Settings.
        </p>
        <div className="home-actions">
          <button
            className="button button-primary"
            type="button"
            onClick={() => onNavigate("editor")}
          >
            View editor shell <span aria-hidden="true">→</span>
          </button>
          <button
            className="button button-quiet"
            type="button"
            onClick={() => onNavigate("settings")}
          >
            Appearance settings
          </button>
        </div>
      </div>
      <div className="home-orbit" aria-hidden="true">
        <span className="orbit-ring orbit-ring-outer" />
        <span className="orbit-ring orbit-ring-middle" />
        <span className="orbit-ring orbit-ring-inner" />
        <span className="orbit-axis orbit-axis-one" />
        <span className="orbit-axis orbit-axis-two" />
        <span className="orbit-glyph">ℒ</span>
        <span className="orbit-caption">LOCAL · EXPLICIT · REVIEWABLE</span>
      </div>
    </section>
  );
}

function EditorScreen(props: ScreenContentProps) {
  const { preferences, onPreferencesChange } = props;
  const [draftWidth, setDraftWidth] = useState(preferences.inspectorWidth);
  const draftWidthRef = useRef(preferences.inspectorWidth);
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  useEffect(() => {
    setDraftWidth(preferences.inspectorWidth);
    draftWidthRef.current = preferences.inspectorWidth;
  }, [preferences.inspectorWidth]);

  const changeWidth = (width: number) => {
    const bounded = Math.max(220, Math.min(480, width));
    draftWidthRef.current = bounded;
    setDraftWidth(bounded);
  };

  return (
    <section className="editor-shell" aria-label="Editor workspace">
      <div className="editor-placeholder">
        <div className="editor-placeholder-top">
          <span className="eyebrow">Source workspace</span>
          <span className="status-pill">No project</span>
        </div>
        <div className="editor-placeholder-center">
          <span className="editor-placeholder-mark" aria-hidden="true">
            ⌘
          </span>
          <h1 id="screen-title">Your source belongs here.</h1>
          <p>
            Open a local project to browse and edit files. Project access is not
            implemented in this shell yet.
          </p>
          <button
            className="button button-quiet"
            type="button"
            disabled
            title="Project opening arrives in Plan 04"
          >
            Open project · coming next
          </button>
        </div>
        <div className="editor-placeholder-footer">
          <span>No file selected</span>
          <span>Editor · available in Plan 05</span>
        </div>
      </div>
      {!preferences.inspectorCollapsed && (
        <div
          className="inspector-separator"
          role="separator"
          aria-label="Resize editor inspector"
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={480}
          aria-valuenow={draftWidth}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const delta = event.key === "ArrowLeft" ? 16 : -16;
              const width = Math.max(220, Math.min(480, draftWidth + delta));
              changeWidth(width);
              void onPreferencesChange({
                ...preferences,
                inspectorWidth: width,
              });
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const width = event.key === "Home" ? 220 : 480;
              changeWidth(width);
              void onPreferencesChange({
                ...preferences,
                inspectorWidth: width,
              });
            }
          }}
          onPointerDown={(event) => {
            drag.current = { x: event.clientX, width: draftWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current)
              changeWidth(drag.current.width + drag.current.x - event.clientX);
          }}
          onPointerUp={() => {
            if (!drag.current) return;
            drag.current = undefined;
            void onPreferencesChange({
              ...preferences,
              inspectorWidth: draftWidthRef.current,
            });
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
        />
      )}
      {!preferences.inspectorCollapsed ? (
        <aside
          className="editor-inspector"
          aria-label="Editor context inspector"
        >
          <div className="inspector-heading">
            <span className="eyebrow">Context</span>
            <button
              className="icon-button"
              type="button"
              aria-label="Hide editor inspector"
              onClick={() =>
                void onPreferencesChange({
                  ...preferences,
                  inspectorCollapsed: true,
                })
              }
            >
              ×
            </button>
          </div>
          <div className="inspector-empty">
            <span aria-hidden="true">◇</span>
            <h2>No source context</h2>
            <p>
              Open a project and select a file to see source-linked details
              here.
            </p>
          </div>
        </aside>
      ) : (
        <button
          className="show-inspector-button"
          type="button"
          onClick={() =>
            void onPreferencesChange({
              ...preferences,
              inspectorCollapsed: false,
            })
          }
        >
          Show context
        </button>
      )}
    </section>
  );
}

function SettingsScreen(props: ScreenContentProps) {
  const { preferences, onPreferencesChange } = props;
  return (
    <section
      className="content-page settings-page"
      aria-labelledby="screen-title"
    >
      <PageHeading eyebrow="Workspace preferences" title="Settings" />
      <div className="settings-layout">
        <nav className="settings-menu" aria-label="Settings sections">
          <a className="settings-menu-active" href="#appearance">
            Appearance
          </a>
          <a href="#layout">Layout</a>
          <a href="#native-check">Native connection</a>
        </nav>
        <div className="settings-content">
          <section
            className="settings-group"
            id="appearance"
            aria-labelledby="appearance-title"
          >
            <h2 id="appearance-title">Appearance</h2>
            <p>
              Quiet contrast and readable density for long sessions in the
              editor and review surfaces.
            </p>
            <PreferenceRow
              title="Color treatment"
              description="Choose the graphite palette or its daylight counterpart."
            >
              <div
                className="segmented-control"
                role="radiogroup"
                aria-label="Color treatment"
              >
                {(["dark", "light"] as const).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    role="radio"
                    aria-checked={preferences.theme === theme}
                    className={
                      preferences.theme === theme ? "segment-active" : ""
                    }
                    disabled={props.savingPreferences}
                    onClick={() =>
                      void onPreferencesChange({ ...preferences, theme })
                    }
                  >
                    {theme === "dark" ? "Dark" : "Light"}
                  </button>
                ))}
              </div>
            </PreferenceRow>
            <PreferenceRow
              title="Interface density"
              description="Comfortable spacing or a more compact workspace."
            >
              <div
                className="segmented-control"
                role="radiogroup"
                aria-label="Interface density"
              >
                {(["comfortable", "compact"] as const).map((density) => (
                  <button
                    key={density}
                    type="button"
                    role="radio"
                    aria-checked={preferences.density === density}
                    className={
                      preferences.density === density ? "segment-active" : ""
                    }
                    disabled={props.savingPreferences}
                    onClick={() =>
                      void onPreferencesChange({ ...preferences, density })
                    }
                  >
                    {density === "comfortable" ? "Comfortable" : "Compact"}
                  </button>
                ))}
              </div>
            </PreferenceRow>
            <PreferenceRow
              title="Editor font size"
              description="Applied to source and engineering details."
            >
              <label className="select-label">
                <span className="visually-hidden">Editor font size</span>
                <select
                  value={preferences.editorFontSize}
                  disabled={props.savingPreferences}
                  onChange={(event) =>
                    void onPreferencesChange({
                      ...preferences,
                      editorFontSize: Number(event.currentTarget.value),
                    })
                  }
                >
                  {[11, 12, 13, 14, 15, 16].map((size) => (
                    <option key={size} value={size}>
                      {size} px
                    </option>
                  ))}
                </select>
              </label>
            </PreferenceRow>
            <div className="preference-preview" aria-label="Appearance preview">
              <span className="eyebrow">Preview</span>
              <h3>Quietly capable.</h3>
              <code>
                <span>const</span> workspace = <em>"thoughtful"</em>;
              </code>
            </div>
          </section>

          <section
            className="settings-group"
            id="layout"
            aria-labelledby="layout-title"
          >
            <h2 id="layout-title">Layout</h2>
            <p>
              Navigation and inspector choices are saved by Laplace and restored
              on the next launch.
            </p>
            <PreferenceRow
              title="Navigation rail"
              description="Collapse labels to make more room for the current view."
            >
              <button
                type="button"
                className="button button-quiet"
                aria-pressed={preferences.navigationCollapsed}
                disabled={props.savingPreferences}
                onClick={() =>
                  void onPreferencesChange({
                    ...preferences,
                    navigationCollapsed: !preferences.navigationCollapsed,
                  })
                }
              >
                {preferences.navigationCollapsed ? "Collapsed" : "Expanded"}
              </button>
            </PreferenceRow>
            <PreferenceRow
              title="Editor inspector"
              description="Keep source context beside the Editor when it becomes available."
            >
              <button
                type="button"
                className="button button-quiet"
                aria-pressed={preferences.inspectorCollapsed}
                disabled={props.savingPreferences}
                onClick={() =>
                  void onPreferencesChange({
                    ...preferences,
                    inspectorCollapsed: !preferences.inspectorCollapsed,
                  })
                }
              >
                {preferences.inspectorCollapsed ? "Hidden" : "Shown"}
              </button>
            </PreferenceRow>
            <PreferenceRow
              title="Inspector width"
              description="Resize the Editor context pane with its divider or arrow keys."
            >
              <span className="mono-value">
                {preferences.inspectorWidth} px
              </span>
            </PreferenceRow>
          </section>

          <section
            className="settings-group"
            id="native-check"
            aria-labelledby="native-title"
          >
            <h2 id="native-title">Native connection</h2>
            <p>
              The command/event smoke test runs only when requested. It does not
              open a project or start a tool.
            </p>
            <div className="native-check-row">
              <button
                className="button button-primary"
                type="button"
                disabled={props.nativePending}
                onClick={props.onTestNative}
              >
                {props.nativePending ? "Checking…" : "Test native connection"}
              </button>
              <span role="status" aria-live="polite">
                {props.nativeResult ??
                  (props.nativePending
                    ? "Waiting for native response…"
                    : "Not tested this session")}
              </span>
            </div>
            {props.nativeEvent && (
              <p className="event-confirmation" data-testid="native-event">
                Event {props.nativeEvent.kind} · operation{" "}
                {props.nativeEvent.operationId}
              </p>
            )}
            {props.nativeError && (
              <p className="inline-error" role="alert">
                {props.nativeError.message} ({props.nativeError.code})
              </p>
            )}
          </section>
        </div>
      </div>
      {props.savingPreferences && (
        <span className="save-indicator" role="status">
          Saving preferences…
        </span>
      )}
    </section>
  );
}

function PreferenceRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="preference-row">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <div className="preference-control">{children}</div>
    </div>
  );
}

function PageHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="page-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="screen-title">{title}</h1>
    </header>
  );
}

function EmptyState({
  title,
  description,
  label,
}: {
  title: string;
  description: string;
  label: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-index">{label}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
