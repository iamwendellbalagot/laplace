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

  it("routes Change review, approval, and guarded integration commands over native IPC", async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        change: {
          id: "ch-1",
          projectId: "/work/project",
          objective: "Ship review",
          status: "in_review",
          createdAt: 1,
          updatedAt: 2,
        },
        branch: "main",
        headRevision: "abc123",
        sourceDigest: "def456",
        changedFiles: [],
        gitOperationInProgress: false,
        hasFreshPassingCheck: true,
        approvalValid: false,
        approvalStaleReason: null,
        comments: [],
        latestDecision: null,
        latestAttempt: null,
      })
      .mockResolvedValueOnce({
        id: "int-1",
        changeId: "ch-1",
        projectId: "/work/project",
        baseHead: "abc123",
        approvedSourceDigest: "def456",
        commitMessage: "Ship review",
        selectedPaths: ["src/App.tsx"],
        status: "prepared",
        commitSha: null,
        errorDetail: null,
        createdAt: 1,
        updatedAt: 1,
      });
    const service = new TauriAppService();

    await expect(
      service.getChangeReview("/work/project", "ch-1"),
    ).resolves.toMatchObject({ sourceDigest: "def456" });
    await expect(
      service.prepareChangeIntegration(
        "/work/project",
        "ch-1",
        ["src/App.tsx"],
        "Ship review",
      ),
    ).resolves.toMatchObject({ status: "prepared" });

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "get_change_review", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        changeId: "ch-1",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "prepare_change_integration",
      {
        request: {
          schemaVersion: 1,
          operationId: expect.any(String),
          projectId: "/work/project",
          changeId: "ch-1",
          selectedPaths: ["src/App.tsx"],
          commitMessage: "Ship review",
        },
      },
    );
  });

  it("lists and runs project recipes with optional change linkage", async () => {
    mocks.invoke
      .mockResolvedValueOnce([
        { name: "test", program: "pnpm", args: ["test"], cwd: null },
      ])
      .mockResolvedValueOnce({
        id: "exec-1",
        projectId: "/work/project",
        changeId: "change-1",
        program: "pnpm",
        args: ["test"],
        sourceDigest: "abc123",
        files: ["package.json"],
        status: "passed",
        exitCode: 0,
        output: "ok",
        startedAt: 1,
        finishedAt: 2,
      });
    const service = new TauriAppService();

    await expect(service.listProjectRecipes("/work/project")).resolves.toEqual([
      { name: "test", program: "pnpm", args: ["test"], cwd: null },
    ]);
    await expect(
      service.runProjectRecipe("/work/project", "test", "change-1"),
    ).resolves.toMatchObject({ status: "passed", changeId: "change-1" });

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "list_project_recipes", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        untrackedPath: null,
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "run_project_recipe", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        recipeName: "test",
        changeId: "change-1",
      },
    });
  });

  it("checks workspace trust and starts Rook Build sessions over native IPC", async () => {
    mocks.invoke
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        sessionId: "build1",
        workspaceId: "file:///work/project",
        rookVersion: "0.1.6",
        mode: "build",
        sandbox: { enabled: true, runtime: "seatbelt", available: true },
        capabilities: { mode: "build", buildSessions: true },
        providers: [],
        currentModel: null,
      })
      .mockResolvedValueOnce({ sessionId: "session-build-2" });
    const service = new TauriAppService();

    await expect(service.getWorkspaceTrust("/work/project")).resolves.toBe(
      true,
    );
    await expect(
      service.startRookBuild("build1", "/work/project"),
    ).resolves.toMatchObject({ mode: "build" });
    await expect(service.newRookSession("build1", "build")).resolves.toBe(
      "session-build-2",
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "get_workspace_trust", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "start_rook_build", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        sessionId: "build1",
        workspaceId: "/work/project",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "rook_provider_request", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        sessionId: "build1",
        method: "session/new",
        params: { mode: "build" },
      },
    });
  });

  it("sends Rook prompts without a separate context field", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await new TauriAppService().promptRookAsk(
      "session1",
      "Explain this project",
    );

    expect(mocks.invoke).toHaveBeenCalledWith("prompt_rook_ask", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        sessionId: "session1",
        text: "Explain this project",
      },
    });
  });

  it("requests Rook models and submits selected model through native IPC", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ models: [], currentModel: null })
      .mockResolvedValueOnce({
        currentModel: { provider: "p", id: "m", name: "M" },
      });
    const service = new TauriAppService();
    await service.listRookModels("session1");
    await service.selectRookModel("session1", {
      provider: "p",
      id: "m",
      name: "M",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "rook_provider_request", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        sessionId: "session1",
        method: "model/list",
        params: {},
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "rook_provider_request", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        sessionId: "session1",
        method: "model/select",
        params: { provider: "p", id: "m" },
      },
    });
  });

  it("reads and updates the local Rook developer checkout setting", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ enabled: true, checkoutPath: null })
      .mockResolvedValueOnce({ enabled: true, checkoutPath: "/work/rook" });
    const service = new TauriAppService();

    await expect(service.getRookDevSettings()).resolves.toEqual({
      enabled: true,
      checkoutPath: null,
    });
    await expect(service.setRookDevCheckout("/work/rook")).resolves.toEqual({
      enabled: true,
      checkoutPath: "/work/rook",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "get_rook_dev_settings", {
      request: { schemaVersion: 1, operationId: expect.any(String) },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "set_rook_dev_checkout", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        checkoutPath: "/work/rook",
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

  it("reads one project file through the bounded native reader", async () => {
    const file = {
      kind: "text",
      sizeBytes: 11,
      content: "export {};\n",
    } as const;
    mocks.invoke.mockResolvedValue({
      schemaVersion: 1,
      operationId: "op-project-file-1",
      file,
    });

    await expect(
      new TauriAppService().readProjectFile("/tmp/example", "src/index.ts"),
    ).resolves.toEqual(file);
    expect(mocks.invoke).toHaveBeenCalledWith("read_project_file", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/tmp/example",
        relativePath: "src/index.ts",
      },
    });
  });

  it("saves a project file using its previously read content as the version", async () => {
    mocks.invoke.mockResolvedValue({
      schemaVersion: 1,
      operationId: "op-save-1",
      saved: true,
    });
    await expect(
      new TauriAppService().saveProjectFile(
        "/tmp/example",
        "src/main.ts",
        "before",
        "after",
      ),
    ).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("save_project_file", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/tmp/example",
        relativePath: "src/main.ts",
        expectedContent: "before",
        content: "after",
      },
    });
  });

  it("sends Git and terminal requests with workspace identity", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ branch: "main", files: [] })
      .mockResolvedValueOnce("")
      .mockResolvedValue(undefined);
    const service = new TauriAppService();
    await expect(service.gitStatus("/work/project")).resolves.toEqual({
      branch: "main",
      files: [],
    });
    await expect(service.gitDiff("/work/project")).resolves.toBe("");
    await service.startTerminal("terminal1", "/work/project");
    await service.writeTerminal("terminal1", "/work/project", "hello");
    await service.stopTerminal("terminal1", "/work/project");
    await service.trustWorkspace("/work/project");
    mocks.invoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ id: "change1" })
      .mockResolvedValueOnce({ id: "change1" });
    await service.listChanges("/work/project");
    await service.createChange("/work/project", "Add a feature");
    await service.updateChange(
      "/work/project",
      "change1",
      "Add a feature",
      "active",
    );
    expect(mocks.invoke).toHaveBeenCalledWith("git_status", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
      },
    });
    expect(mocks.invoke).toHaveBeenCalledWith("write_terminal", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        sessionId: "terminal1",
        workspaceId: "/work/project",
        data: "hello",
        rows: undefined,
        cols: undefined,
      },
    });
  });

  it("normalizes structured Change and Rook startup failures", async () => {
    const service = new TauriAppService();
    mocks.invoke.mockRejectedValueOnce({
      schemaVersion: 1,
      code: "change_transition_invalid",
      message: "This Change status transition is not allowed.",
      operationId: "change-op",
      retryable: false,
    });
    await expect(
      service.updateChange("/work/project", "c1", "Change", "integrated"),
    ).rejects.toMatchObject({
      code: "change_transition_invalid",
      message: "This Change status transition is not allowed.",
    });

    mocks.invoke.mockRejectedValueOnce({
      schemaVersion: 1,
      code: "rook_unavailable",
      message: "Install Rook or set LAPLACE_ROOK_BIN to its executable path.",
      operationId: "rook-op",
      retryable: false,
    });
    await expect(
      service.startRookAsk("session1", "/work/project"),
    ).rejects.toMatchObject({
      code: "rook_unavailable",
      message: "Install Rook or set LAPLACE_ROOK_BIN to its executable path.",
    });
  });

  it("sends structured verification commands and loads execution history", async () => {
    mocks.invoke.mockResolvedValueOnce({ id: "e1" }).mockResolvedValueOnce([]);
    const service = new TauriAppService();
    await service.runCheck("/work/project", "pnpm", ["test"], "c1");
    await service.listExecutions("/work/project");
    expect(mocks.invoke).toHaveBeenCalledWith("run_check", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        program: "pnpm",
        args: ["test"],
        changeId: "c1",
        timeoutMs: 600000,
      },
    });
  });
});
