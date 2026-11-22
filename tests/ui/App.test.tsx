import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
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

  it("opens a user-selected folder and shows a read-only lazy explorer", async () => {
    const { service } = serviceFixture({
      chooseProjectDirectory: vi.fn(async () => project.path),
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
    fireEvent.click(screen.getByRole("button", { name: "src" }));
    await waitFor(() =>
      expect(service.listProjectEntries).toHaveBeenLastCalledWith(
        project.id,
        "src",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    expect(
      await screen.findByText("hello, Laplace!", { selector: "pre" }),
    ).toBeInTheDocument();
    expect(service.readProjectFile).toHaveBeenCalledWith(
      project.id,
      "src/README.md",
    );
    expect(service.ping).not.toHaveBeenCalled();
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

  it("navigates to real shell views and labels unavailable capabilities honestly", async () => {
    const { service } = serviceFixture();
    render(<App service={service} />);
    await screen.findByRole("heading", { name: /Code when you want/i });

    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    expect(
      screen.getByRole("heading", { name: "Changes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Not available yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Change records will appear here/),
    ).toBeInTheDocument();
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
