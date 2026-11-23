import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";

vi.mock("../../src/features/terminal/TerminalPanel", () => ({
  TerminalPanel: () => <div aria-label="Workspace terminal" />,
}));

vi.mock("../../src/features/editor/CodeEditor", () => ({
  CodeEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Code editor"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));
import {
  AppServiceError,
  type AppService,
} from "../../src/services/app-service";
import type {
  AppEvent,
  PingResponse,
  ProjectEntry,
  ProjectFileRead,
  ProjectSummary,
  UiPreferences,
} from "../../src/services/contracts";
import { DEFAULT_PREFERENCES, useAppStore } from "../../src/state/app-store";

const response: PingResponse = {
  schemaVersion: 1,
  operationId: "op-ui-1",
  status: "ok",
  message: "Native command/event round trip succeeded.",
};

const project: ProjectSummary = {
  id: "/tmp/laplace fixture",
  name: "laplace fixture",
  path: "/tmp/laplace fixture",
  isGitRepository: false,
  lastOpenedUnixMs: 1,
};

const entries: ProjectEntry[] = [
  { name: "src", relativePath: "src", kind: "directory" },
  { name: "README.md", relativePath: "README.md", kind: "file" },
];

const textPreview: ProjectFileRead = {
  kind: "text",
  sizeBytes: 13,
  content: "hello, Laplace!",
};

function serviceFixture(overrides: Partial<AppService> = {}) {
  let receiveEvent: ((event: AppEvent) => void) | undefined;
  const service: AppService = {
    ping: vi.fn(async () => response),
    listen: vi.fn(async (listener) => {
      receiveEvent = listener;
      return () => {
        receiveEvent = undefined;
      };
    }),
    getPreferences: vi.fn(async () => DEFAULT_PREFERENCES),
    updatePreferences: vi.fn(async (preferences: UiPreferences) => preferences),
    chooseProjectDirectory: vi.fn(async () => null),
    openProject: vi.fn(async () => project),
    getRecentProjects: vi.fn(async () => []),
    listProjectEntries: vi.fn(async () => ({ entries, truncated: false })),
    readProjectFile: vi.fn(async () => textPreview),
    saveProjectFile: vi.fn(async () => true),
    gitStatus: vi.fn(async () => ({ branch: "main", files: [] })),
    gitDiff: vi.fn(async () => ""),
    startTerminal: vi.fn(async () => undefined),
    writeTerminal: vi.fn(async () => undefined),
    stopTerminal: vi.fn(async () => undefined),
    trustWorkspace: vi.fn(async () => undefined),
    untrustWorkspace: vi.fn(async () => undefined),
    listChanges: vi.fn(async () => []),
    createChange: vi.fn(async (_projectId: string, objective: string) => ({
      id: "change1",
      projectId: project.id,
      objective,
      status: "draft" as const,
      createdAt: 1,
      updatedAt: 1,
    })),
    updateChange: vi.fn(
      async (
        _projectId: string,
        changeId: string,
        objective: string,
        status:
          | "draft"
          | "active"
          | "in_review"
          | "approved"
          | "integrated"
          | "abandoned",
      ) => ({
        id: changeId,
        projectId: project.id,
        objective,
        status,
        createdAt: 1,
        updatedAt: 2,
      }),
    ),
    reopenChangeReview: vi.fn(
      async (_projectId: string, changeId: string, objective: string) => ({
        id: changeId,
        projectId: project.id,
        objective,
        status: "in_review" as const,
        createdAt: 1,
        updatedAt: 3,
      }),
    ),
    createCandidateWorktree: vi.fn(
      async (_projectId: string, changeId: string) => ({
        changeId,
        path: "/tmp/candidate",
        branch: `laplace/${changeId}`,
        baseRevision: "abc123",
      }),
    ),
    listExecutions: vi.fn(async () => []),
    cancelCheck: vi.fn(async () => undefined),
    startRookAsk: vi.fn(async (sessionId: string) => ({
      sessionId,
      workspaceId: "file:///tmp/project",
      rookVersion: "0.1.6",
      capabilities: { buildSessions: false },
    })),
    promptRookAsk: vi.fn(async () => undefined),
    listenRook: vi.fn(async () => () => undefined),
    stopRookAsk: vi.fn(async () => undefined),
    cancelRookAsk: vi.fn(async () => undefined),
    respondRookPermission: vi.fn(async () => undefined),
    runCheck: vi.fn(
      async (_projectId: string, program: string, args: string[]) => ({
        id: "execution-test",
        projectId: project.id,
        changeId: null,
        program,
        args,
        sourceDigest: "digest",
        files: ["src/main.ts"],
        status: "passed" as const,
        exitCode: 0,
        output: "ok",
        startedAt: 1,
        finishedAt: 2,
      }),
    ),
    listenTerminal: vi.fn(async () => () => undefined),
    ...overrides,
  };
  return { service, emit: (event: AppEvent) => receiveEvent?.(event) };
}

beforeEach(() => {
  useAppStore.setState({ page: "home", preferences: DEFAULT_PREFERENCES });
});

describe("reference application shell", () => {
  it("shows honest first-run state without claiming a project or connected Rook", async () => {
    const { service } = serviceFixture();
    render(<App service={service} />);

    expect(
      await screen.findByRole("heading", { name: /Code when you want/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("No project open")).toHaveLength(2);
    expect(screen.getByText("Rook not connected")).toBeInTheDocument();
    expect(service.ping).not.toHaveBeenCalled();
    expect(service.getPreferences).toHaveBeenCalledOnce();
  });

  it("renders an explicit browser preview without making native calls", async () => {
    const { service } = serviceFixture();
    render(<App service={service} browserPreview />);

    expect(
      await screen.findByRole("heading", { name: /Code when you want/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Browser preview · native actions off/i),
    ).toBeInTheDocument();
    expect(service.getPreferences).not.toHaveBeenCalled();
    expect(service.getRecentProjects).not.toHaveBeenCalled();
    expect(service.listen).not.toHaveBeenCalled();

    expect(
      screen.getByRole("button", { name: /desktop app only/i }),
    ).toBeDisabled();
    expect(service.chooseProjectDirectory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.getByText(/unavailable in this browser preview/i),
    ).toBeInTheDocument();
  });

  it("opens, edits, and saves a project file from the lazy explorer", async () => {
    const { service } = serviceFixture({
      chooseProjectDirectory: vi.fn(async () => project.path),
      listProjectEntries: vi
        .fn()
        .mockResolvedValueOnce({ entries, truncated: false })
        .mockResolvedValueOnce({
          entries: [{ name: "src", relativePath: "src", kind: "directory" }],
          truncated: false,
        })
        .mockResolvedValueOnce({
          entries: [
            { name: "README.md", relativePath: "src/README.md", kind: "file" },
          ],
          truncated: false,
        }),
    });
    render(<App service={service} />);
    await screen.findByRole("heading", { name: /Code when you want/i });
    fireEvent.click(
      screen.getByRole("button", { name: "Open project folder" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Project files are ready." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Project files" }),
    ).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(service.openProject).toHaveBeenCalledWith(project.path);
    expect(service.listProjectEntries).toHaveBeenCalledWith(project.id);
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh project folder" }),
    );
    await waitFor(() =>
      expect(service.listProjectEntries).toHaveBeenLastCalledWith(
        project.id,
        "",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "src" }));
    await waitFor(() =>
      expect(service.listProjectEntries).toHaveBeenLastCalledWith(
        project.id,
        "src",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    const editor = await screen.findByRole("textbox", { name: "Code editor" });
    expect(editor).toHaveValue("hello, Laplace!");
    expect(service.readProjectFile).toHaveBeenCalledWith(
      project.id,
      "src/README.md",
    );
    fireEvent.change(editor, { target: { value: "updated source" } });
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() =>
      expect(service.saveProjectFile).toHaveBeenCalledWith(
        project.id,
        "src/README.md",
        "hello, Laplace!",
        "updated source",
      ),
    );
    await waitFor(() => expect(screen.getAllByText("Saved")).toHaveLength(2));
    expect(service.ping).not.toHaveBeenCalled();
  });

  it("opens nested files using their project-relative path exactly once", async () => {
    const { service } = serviceFixture({
      chooseProjectDirectory: vi.fn(async () => project.path),
      listProjectEntries: vi
        .fn()
        .mockResolvedValueOnce({ entries, truncated: false })
        .mockResolvedValueOnce({
          entries: [
            { name: "nested", relativePath: "src/nested", kind: "directory" },
          ],
          truncated: false,
        })
        .mockResolvedValueOnce({
          entries: [
            {
              name: "main.ts",
              relativePath: "src/nested/main.ts",
              kind: "file",
            },
          ],
          truncated: false,
        }),
    });
    render(<App service={service} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open project folder" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "src" }));
    fireEvent.click(await screen.findByRole("button", { name: "nested" }));
    fireEvent.click(await screen.findByRole("button", { name: "main.ts" }));

    expect(
      await screen.findByRole("textbox", { name: "Code editor" }),
    ).toHaveValue("hello, Laplace!");
    expect(service.readProjectFile).toHaveBeenCalledWith(
      project.id,
      "src/nested/main.ts",
    );
  });

  it("keeps an edited buffer dirty when the backend detects a save conflict", async () => {
    const { service } = serviceFixture({
      chooseProjectDirectory: vi.fn(async () => project.path),
      saveProjectFile: vi.fn(async () => {
        throw new AppServiceError(
          "project_file_conflict",
          "The file changed on disk.",
          "op-conflict",
          false,
        );
      }),
    });
    render(<App service={service} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open project folder" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));
    const editor = await screen.findByRole("textbox", { name: "Code editor" });
    fireEvent.change(editor, { target: { value: "my edits" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The file changed on disk.",
    );
    expect(screen.getByText("Modified")).toBeInTheDocument();
    expect(editor).toHaveValue("my edits");
  });

  it("restores a recent project only after the user selects it", async () => {
    const { service } = serviceFixture({
      getRecentProjects: vi.fn(async () => [project]),
    });
    render(<App service={service} />);
    const recent = await screen.findByRole("button", {
      name: /laplace fixture/i,
    });
    expect(service.openProject).not.toHaveBeenCalled();

    fireEvent.click(recent);
    expect(
      await screen.findByRole("heading", { name: "Project files are ready." }),
    ).toBeInTheDocument();
    expect(service.openProject).toHaveBeenCalledWith(project.path);
  });

  it("keeps dirty documents when switching projects is cancelled", async () => {
    const { service } = serviceFixture({
      getRecentProjects: vi.fn(async () => [project]),
      chooseProjectDirectory: vi.fn(async () => "/tmp/another-project"),
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App service={service} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /laplace fixture/i }),
    );
    await screen.findByRole("heading", { name: "Project files are ready." });
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    const editor = await screen.findByRole("textbox", { name: /Code editor/ });
    fireEvent.change(editor, { target: { value: "dirty buffer" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Open another project folder" }),
    );
    await waitFor(() => expect(window.confirm).toHaveBeenCalledOnce());
    expect(screen.getByRole("textbox", { name: /Code editor/ })).toHaveValue(
      "dirty buffer",
    );
  });

  it("navigates to real shell views and labels unavailable capabilities honestly", async () => {
    const { service } = serviceFixture();
    render(<App service={service} />);
    await screen.findByRole("heading", { name: /Code when you want/i });

    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    expect(
      screen.getByRole("heading", { name: "Changes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Open a project" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Durable Change records belong to a project/),
    ).toBeInTheDocument();
  });

  it("shows structured Change transition errors instead of object coercion", async () => {
    const change = {
      id: "change1",
      projectId: project.id,
      objective: "Test status validation",
      status: "draft" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const { service } = serviceFixture({
      chooseProjectDirectory: vi.fn(async () => project.path),
      listChanges: vi.fn(async () => [change]),
      updateChange: vi.fn(async () => {
        throw {
          code: "change_transition_invalid",
          message: "Move this Change through review before integrating it.",
          retryable: false,
        };
      }),
    });
    render(<App service={service} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open project folder" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Changes" }));
    fireEvent.change(
      await screen.findByRole("combobox", {
        name: "Status for Test status validation",
      }),
      { target: { value: "integrated" } },
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Move this Change through review before integrating it.",
    );
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
  });

  it("shows structured Rook startup errors", async () => {
    const { service } = serviceFixture({
      chooseProjectDirectory: vi.fn(async () => project.path),
      startRookAsk: vi.fn(async () => {
        throw {
          code: "rook_unavailable",
          message: "Install Rook or configure its executable path.",
          retryable: false,
        };
      }),
    });
    render(<App service={service} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open project folder" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Rook" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Start read-only Ask" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Install Rook or configure its executable path.",
    );
  });

  it("opens the command palette, filters, runs a command, and returns focus", async () => {
    const { service } = serviceFixture();
    render(<App service={service} />);
    await screen.findByRole("heading", { name: /Code when you want/i });
    const trigger = screen.getByRole("button", {
      name: /Search screens and commands/i,
    });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    const search = screen.getByRole("combobox", {
      name: "Search screens and commands",
    });
    fireEvent.change(search, { target: { value: "Go to Settings" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("opens the palette with the platform shortcut and leaves text-entry shortcuts alone", async () => {
    render(<App service={serviceFixture().service} />);
    await screen.findByRole("heading", { name: /Code when you want/i });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    const search = screen.getByRole("combobox", {
      name: "Search screens and commands",
    });
    fireEvent.keyDown(search, { key: "k", ctrlKey: true });
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("persists theme changes through the backend and applies semantic theme tokens", async () => {
    const { service } = serviceFixture();
    render(<App service={service} />);
    await screen.findByRole("heading", { name: /Code when you want/i });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));

    await waitFor(() =>
      expect(service.updatePreferences).toHaveBeenCalledOnce(),
    );
    expect(service.updatePreferences).toHaveBeenCalledWith({
      ...DEFAULT_PREFERENCES,
      theme: "light",
    });
    expect(document.querySelector(".app-shell")).toHaveAttribute(
      "data-theme",
      "light",
    );
  });

  it("persists compact density without changing the active view", async () => {
    const { service } = serviceFixture();
    render(<App service={service} />);
    await screen.findByRole("heading", { name: /Code when you want/i });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));

    await waitFor(() =>
      expect(service.updatePreferences).toHaveBeenCalledWith({
        ...DEFAULT_PREFERENCES,
        density: "compact",
      }),
    );
    expect(document.querySelector(".app-shell")).toHaveAttribute(
      "data-density",
      "compact",
    );
    expect(
      screen.getByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("resizes the editor inspector with keyboard and saves the layout", async () => {
    const { service } = serviceFixture();
    render(<App service={service} />);
    await screen.findByRole("heading", { name: /Code when you want/i });
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    const separator = screen.getByRole("separator", {
      name: "Resize editor inspector",
    });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });

    expect(separator).toHaveAttribute("aria-valuenow", "302");
    await waitFor(() =>
      expect(service.updatePreferences).toHaveBeenCalledWith({
        ...DEFAULT_PREFERENCES,
        inspectorWidth: 302,
      }),
    );
  });

  it("runs the native smoke test only after an explicit user action", async () => {
    const { service } = serviceFixture();
    render(<App service={service} />);
    await screen.findByRole("heading", { name: /Code when you want/i });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(service.ping).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Test native connection" }),
    );
    expect(await screen.findByText(response.message)).toBeInTheDocument();
    expect(service.ping).toHaveBeenCalledOnce();
  });

  it("surfaces native command errors and event correlation IDs", async () => {
    const { service, emit } = serviceFixture({
      ping: vi.fn(async () => {
        throw new AppServiceError(
          "unsupported_schema",
          "Frontend and backend schema versions differ.",
          "op-ui-2",
          false,
        );
      }),
    });
    render(<App service={service} />);
    await screen.findByRole("heading", { name: /Code when you want/i });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Test native connection" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "unsupported_schema",
    );

    emit({
      schemaVersion: 1,
      operationId: "op-event-3",
      workspaceId: null,
      sequence: 1,
      timestampUnixMs: 1_700_000_000_000,
      kind: "ping_completed",
    });
    expect(await screen.findByTestId("native-event")).toHaveTextContent(
      "op-event-3",
    );
  });
});
