import type { ReactNode } from "react";
import type { AppService, AppServiceError } from "../../services/app-service";
import type {
  AppEvent,
  RookDevSettings,
  UiPreferences,
} from "../../services/contracts";
import { RuntimeDiagnosticsPanel } from "./RuntimeDiagnosticsPanel";

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

export function SettingsScreen({
  service,
  preferences,
  onPreferencesChange,
  savingPreferences,
  rookDevSettings,
  rookDevError,
  onChooseRookCheckout,
  onClearRookCheckout,
  nativeResult,
  nativeError,
  nativeEvent,
  nativePending,
  onTestNative,
  browserPreview,
}: {
  service: AppService;
  preferences: UiPreferences;
  onPreferencesChange: (preferences: UiPreferences) => Promise<void>;
  savingPreferences: boolean;
  rookDevSettings?: RookDevSettings;
  rookDevError?: string;
  onChooseRookCheckout: () => void;
  onClearRookCheckout: () => void;
  nativeResult?: string;
  nativeError?: AppServiceError;
  nativeEvent?: AppEvent;
  nativePending: boolean;
  onTestNative: () => void;
  browserPreview: boolean;
}) {
  return (
    <section
      className="content-page settings-page"
      aria-labelledby="screen-title"
    >
      <header className="page-heading">
        <p className="eyebrow">Workspace preferences</p>
        <h1 id="screen-title">Settings</h1>
      </header>
      <div className="settings-layout">
        <nav className="settings-menu" aria-label="Settings sections">
          <a className="settings-menu-active" href="#appearance">
            Appearance
          </a>
          <a href="#layout">Layout</a>
          <a href="#runtime">Runtime</a>
          <a href="#native-check">Native connection</a>
          {rookDevSettings?.enabled && <a href="#developer">Developer</a>}
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
              description="Choose the obsidian terminal palette or its daylight counterpart."
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
                    disabled={savingPreferences}
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
                    disabled={savingPreferences}
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
                  disabled={savingPreferences}
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

          {rookDevSettings?.enabled && (
            <section
              className="settings-group"
              id="developer"
              aria-labelledby="developer-title"
            >
              <h2 id="developer-title">Developer</h2>
              <p>
                Use a local Rook source checkout for Tauri development. This
                setting is unavailable in release builds. Rebuild Rook with{" "}
                <code>pnpm build</code> after changing its source.
              </p>
              <PreferenceRow
                title="Rook checkout"
                description={
                  rookDevSettings.checkoutPath ??
                  "No local Rook checkout selected."
                }
              >
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={onChooseRookCheckout}
                >
                  Choose checkout
                </button>
              </PreferenceRow>
              {rookDevSettings.checkoutPath && (
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={onClearRookCheckout}
                >
                  Clear checkout
                </button>
              )}
              {rookDevError && (
                <p className="inline-error" role="alert">
                  {rookDevError}
                </p>
              )}
            </section>
          )}

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
                disabled={savingPreferences}
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
              title="Co-pilot & context panel"
              description="Keep Rook and source context docked beside the Editor."
            >
              <button
                type="button"
                className="button button-quiet"
                aria-pressed={preferences.inspectorCollapsed}
                disabled={savingPreferences}
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
              title="File explorer"
              description="Show or hide the workspace file tree and search sidebar (⌘B)."
            >
              <button
                type="button"
                className="button button-quiet"
                aria-pressed={Boolean(preferences.explorerCollapsed)}
                disabled={savingPreferences}
                onClick={() =>
                  void onPreferencesChange({
                    ...preferences,
                    explorerCollapsed: !preferences.explorerCollapsed,
                  })
                }
              >
                {preferences.explorerCollapsed ? "Hidden" : "Shown"}
              </button>
            </PreferenceRow>
            <PreferenceRow
              title="Bottom tools drawer"
              description="Show or hide Terminal, Run, Git, and Verify below the editor (⌘J)."
            >
              <button
                type="button"
                className="button button-quiet"
                aria-pressed={Boolean(preferences.bottomDrawerCollapsed)}
                disabled={savingPreferences}
                onClick={() =>
                  void onPreferencesChange({
                    ...preferences,
                    bottomDrawerCollapsed: !preferences.bottomDrawerCollapsed,
                  })
                }
              >
                {preferences.bottomDrawerCollapsed ? "Hidden" : "Shown"}
              </button>
            </PreferenceRow>
            <PreferenceRow
              title="Panel width"
              description="Resize Workspace sidebars and drawer with their dividers or arrow keys."
            >
              <span className="mono-value">
                {preferences.explorerWidth ?? 238} ·{" "}
                {preferences.inspectorWidth} px
              </span>
            </PreferenceRow>
          </section>

          <section
            className="settings-group"
            id="runtime"
            aria-labelledby="runtime-title"
          >
            <h2 id="runtime-title">Runtime &amp; diagnostics</h2>
            <p>
              Which Rook runtime Laplace launches, database schema and backup
              status, and outbound network behavior. Copied diagnostics contain
              no credentials.
            </p>
            <RuntimeDiagnosticsPanel
              service={service}
              browserPreview={browserPreview}
            />
          </section>

          <section
            className="settings-group"
            id="native-check"
            aria-labelledby="native-title"
          >
            <h2 id="native-title">Native connection</h2>
            <p>
              {browserPreview
                ? "Native IPC and project/filesystem access are unavailable in this browser preview. Open Laplace as a desktop app to use them."
                : "The command/event smoke test runs only when requested. It does not open a project or start a tool."}
            </p>
            <div className="native-check-row">
              <button
                className="button button-primary"
                type="button"
                disabled={nativePending || browserPreview}
                onClick={onTestNative}
              >
                {browserPreview
                  ? "Unavailable in browser preview"
                  : nativePending
                    ? "Checking…"
                    : "Test native connection"}
              </button>
              <span role="status" aria-live="polite">
                {browserPreview
                  ? "No native commands are sent from this page."
                  : (nativeResult ??
                    (nativePending
                      ? "Waiting for native response…"
                      : "Not tested this session"))}
              </span>
            </div>
            {nativeEvent && (
              <p className="event-confirmation" data-testid="native-event">
                Event {nativeEvent.kind} · operation {nativeEvent.operationId}
              </p>
            )}
            {nativeError && (
              <p className="inline-error" role="alert">
                {nativeError.message} ({nativeError.code})
              </p>
            )}
          </section>
        </div>
      </div>
      {savingPreferences && (
        <span className="save-indicator" role="status">
          Saving preferences…
        </span>
      )}
    </section>
  );
}
