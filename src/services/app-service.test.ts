import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEvent, PingResponse, UiPreferences } from "./contracts";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  openDialog: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.openDialog }));

import { AppServiceError, TauriAppService } from "./app-service";

const response: PingResponse = {
  schemaVersion: 1,
  operationId: "op-service-1",
  status: "ok",
  message: "Native command/event round trip succeeded.",
};

const preferences: UiPreferences = {
  theme: "dark",
  density: "comfortable",
  editorFontSize: 12,
  navigationCollapsed: false,
  inspectorCollapsed: false,
  inspectorWidth: 286,
};

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  mocks.openDialog.mockReset();
});

describe("TauriAppService", () => {
  it("sends a versioned command with a correlation ID", async () => {
    mocks.invoke.mockResolvedValue(response);

    await expect(new TauriAppService().ping()).resolves.toEqual(response);

    expect(mocks.invoke).toHaveBeenCalledWith("ping", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
      },
    });
  });

  it("preserves structured backend errors", async () => {
    mocks.invoke.mockRejectedValue({
      schemaVersion: 1,
      code: "unsupported_schema",
      message: "Frontend/backend schema mismatch.",
      operationId: "op-service-2",
      retryable: false,
    });

    await expect(new TauriAppService().ping()).rejects.toMatchObject({
      name: "AppServiceError",
      code: "unsupported_schema",
      message: "Frontend/backend schema mismatch.",
      operationId: "op-service-2",
      retryable: false,
    } satisfies Partial<AppServiceError>);
  });

  it("forwards typed event payloads and returns the unlisten function", async () => {
    const event: AppEvent = {
      schemaVersion: 1,
      operationId: "op-service-3",
      workspaceId: null,
      sequence: 1,
      timestampUnixMs: 1_700_000_000_000,
      kind: "ping_completed",
    };
    const unlisten = vi.fn();
    mocks.listen.mockImplementation(async (_name, handler) => {
      handler({ payload: event });
      return unlisten;
    });
    const receive = vi.fn();

    await expect(new TauriAppService().listen(receive)).resolves.toBe(unlisten);
    expect(mocks.listen).toHaveBeenCalledWith(
      "app-event",
      expect.any(Function),
    );
    expect(receive).toHaveBeenCalledWith(event);
  });

  it("loads persisted preferences through the native service boundary", async () => {
    mocks.invoke.mockResolvedValue({
      schemaVersion: 1,
      operationId: "op-service-4",
      preferences,
    });

    await expect(new TauriAppService().getPreferences()).resolves.toEqual(
      preferences,
    );
    expect(mocks.invoke).toHaveBeenCalledWith("get_preferences", {
      request: { schemaVersion: 1, operationId: expect.any(String) },
    });
  });

  it("persists preferences through the native service boundary", async () => {
    mocks.invoke.mockResolvedValue({
      schemaVersion: 1,
      operationId: "op-service-5",
      preferences,
    });

    await expect(
      new TauriAppService().updatePreferences(preferences),
    ).resolves.toEqual(preferences);
    expect(mocks.invoke).toHaveBeenCalledWith("update_preferences", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        preferences,
      },
    });
  });

  it("opens only a native directory picker and supports cancellation", async () => {
    mocks.openDialog
      .mockResolvedValueOnce("/tmp/example")
      .mockResolvedValueOnce(null);
    const service = new TauriAppService();

    await expect(service.chooseProjectDirectory()).resolves.toBe(
      "/tmp/example",
    );
    await expect(service.chooseProjectDirectory()).resolves.toBeNull();
    expect(mocks.openDialog).toHaveBeenNthCalledWith(1, {
      directory: true,
      multiple: false,
      title: "Open project folder",
    });
  });

  it("sends project operations through typed native commands", async () => {
    const project = {
      id: "/tmp/example",
      name: "example",
      path: "/tmp/example",
      isGitRepository: false,
      lastOpenedUnixMs: 1,
    };
    mocks.invoke
      .mockResolvedValueOnce({
        schemaVersion: 1,
        operationId: "op-project-1",
        project,
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        operationId: "op-project-2",
        projects: [project],
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        operationId: "op-project-3",
        entries: [{ name: "src", relativePath: "src", kind: "directory" }],
        truncated: false,
      });
    const service = new TauriAppService();

    await expect(service.openProject("/tmp/example")).resolves.toEqual(project);
    await expect(service.getRecentProjects()).resolves.toEqual([project]);
    await expect(service.listProjectEntries(project.id)).resolves.toEqual({
      entries: [{ name: "src", relativePath: "src", kind: "directory" }],
      truncated: false,
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "open_project", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        path: project.path,
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "list_project_entries", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: project.id,
        relativePath: "",
      },
    });
  });
});
