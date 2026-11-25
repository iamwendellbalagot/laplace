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

  it("invokes Plan 12 continuity, run configs, incremental review, and bounded Rook context commands", async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        layout: {
          packageManager: "pnpm",
          layout: "single_package",
          workspacePackages: [],
          warnings: [],
        },
        configs: [],
      })
      .mockResolvedValueOnce({
        id: "run-1",
        workspaceId: "/work/project",
        name: "dev",
        program: "pnpm",
        args: ["run", "dev"],
        cwd: null,
        status: "running",
        port: 5173,
        detectedUrl: null,
        sharedServices: [],
        exitCode: null,
        output: "",
        startedAt: 1,
        finishedAt: null,
      })
      .mockResolvedValueOnce({ layout: null, drafts: [] })
      .mockResolvedValueOnce({
        path: "src/app.ts",
        status: "modified",
        kind: "text",
        original: "old",
        modified: "new",
      })
      .mockResolvedValueOnce(undefined);
    const service = new TauriAppService();

    await service.listRunConfigs("/work/project");
    await service.startRunConfig("/work/project", "dev", 5173);
    await service.loadWorkspaceContinuity("/work/project");
    await service.readGitFileDiffPair("/work/project", "src/app.ts", {
      changeId: "ch-1",
      baseline: "last_review",
    });
    await service.promptRookAsk(
      "session1",
      "Check this failure",
      "--- src/app.ts:1-5 ---\nconst x = 1;",
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "list_run_configs", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "start_run_config", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        name: "dev",
        portOverride: 5173,
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      3,
      "load_workspace_continuity",
      {
        request: {
          schemaVersion: 1,
          operationId: expect.any(String),
          projectId: "/work/project",
        },
      },
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, "read_git_file_diff_pair", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        relativePath: "src/app.ts",
        changeId: "ch-1",
        baseline: "last_review",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(5, "prompt_rook_ask", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        sessionId: "session1",
        text: "Check this failure",
        context: "--- src/app.ts:1-5 ---\nconst x = 1;",
      },
    });
  });

  it("invokes zero-ceremony workspace review, checkpoint, revert, and commit commands", async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        reviewId: "ws-rev-123",
        branch: "main",
        headRevision: "abc",
        sourceDigest: "dig",
        changedFiles: [],
        gitOperationInProgress: false,
        hasFreshPassingCheck: true,
        comments: [],
        lastCheckpointDigest: null,
        lastCheckpointLabel: null,
        lastCheckpointAt: null,
        changedSinceCheckpoint: [],
        lastCommitSha: null,
      })
      .mockResolvedValueOnce({ reviewId: "ws-rev-123" })
      .mockResolvedValueOnce({ reviewId: "ws-rev-123" })
      .mockResolvedValueOnce({ id: "int-1", status: "succeeded" });
    const service = new TauriAppService();

    await service.getWorkspaceReview("/work/project");
    await service.saveWorkspaceCheckpoint("/work/project", "Before Rook Build");
    await service.revertWorkspaceFile(
      "/work/project",
      "src/a.ts",
      "checkpoint",
    );
    await service.commitWorkspaceReview(
      "/work/project",
      ["src/a.ts"],
      "Fix bug",
      "dig",
      false,
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "get_workspace_review", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "save_workspace_checkpoint",
      {
        request: {
          schemaVersion: 1,
          operationId: expect.any(String),
          projectId: "/work/project",
          label: "Before Rook Build",
        },
      },
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "revert_workspace_file", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        relativePath: "src/a.ts",
        target: "checkpoint",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, "commit_workspace_review", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        selectedPaths: ["src/a.ts"],
        commitMessage: "Fix bug",
        expectedSourceDigest: "dig",
        allowUnverified: false,
      },
    });
  });

  it("sends Plan 13 context lens, history, and confirmation IPC commands", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ filePath: "src/a.ts" })
      .mockResolvedValueOnce({ filePath: "src/a.ts", commits: [] })
      .mockResolvedValueOnce({ modules: [] })
      .mockResolvedValueOnce({ id: "ctx-ann-1" })
      .mockResolvedValueOnce({ id: "ctx-lnk-1" })
      .mockResolvedValueOnce(true);
    const service = new TauriAppService();

    await service.getFileContext("/work/project", "src/a.ts", {
      symbol: "rotateSession",
      cursorLine: 12,
    });
    await service.getFileHistory("/work/project", "src/a.ts");
    await service.getSystemContext("/work/project");
    await service.saveContextAnnotation(
      "/work/project",
      "file",
      "src/a.ts",
      "Handles token rotation",
    );
    await service.saveContextPinnedLink(
      "/work/project",
      "src/a.ts",
      "tests/a.test.ts",
      "tests",
      "Verified test",
    );
    await service.cancelContextIndex("/work/project");

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "get_file_context", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        relativePath: "src/a.ts",
        symbol: "rotateSession",
        cursorLine: 12,
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "get_file_history", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        relativePath: "src/a.ts",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "get_system_context", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, "save_context_annotation", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        targetKind: "file",
        targetKey: "src/a.ts",
        summary: "Handles token rotation",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      5,
      "save_context_pinned_link",
      {
        request: {
          schemaVersion: 1,
          operationId: expect.any(String),
          projectId: "/work/project",
          sourcePath: "src/a.ts",
          targetPath: "tests/a.test.ts",
          relationKind: "tests",
          note: "Verified test",
        },
      },
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(6, "cancel_context_index", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
      },
    });
  });

  it("compares, lists, and deletes behavior comparisons", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ id: "cmp-1", outcome: "equal" })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);
    const service = new TauriAppService();

    await service.compareExecutions("/work/project", "e1", "e2", {
      normalization: {
        stripAnsi: true,
        stripTimestamps: true,
        stripDurations: false,
        trimTrailingWhitespace: false,
      },
    });
    await service.listBehaviorComparisons("/work/project");
    await service.deleteBehaviorComparison("/work/project", "cmp-1");

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "compare_executions", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        baselineExecutionId: "e1",
        candidateExecutionId: "e2",
        changeId: null,
        label: null,
        normalization: {
          stripAnsi: true,
          stripTimestamps: true,
          stripDurations: false,
          trimTrailingWhitespace: false,
        },
        persist: true,
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "list_behavior_comparisons",
      {
        request: {
          schemaVersion: 1,
          operationId: expect.any(String),
          projectId: "/work/project",
          untrackedPath: null,
        },
      },
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      3,
      "delete_behavior_comparison",
      {
        request: {
          schemaVersion: 1,
          operationId: expect.any(String),
          projectId: "/work/project",
          comparisonId: "cmp-1",
        },
      },
    );
  });

  it("reads capabilities, inspects skills, and updates MCP config via Rook", async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        runtimeSource: "rook_stdio",
        skills: [],
        mcpServers: [],
      })
      .mockResolvedValueOnce({
        name: "auditor",
        scope: "project",
        content: "# Auditor",
      })
      .mockResolvedValueOnce({
        runtimeSource: "rook_stdio",
        skills: [],
        mcpServers: [],
      })
      .mockResolvedValueOnce({
        runtimeSource: "rook_stdio",
        skills: [],
        mcpServers: [],
      });
    const service = new TauriAppService();

    await service.getCapabilitiesSnapshot("/work/project");
    await service.inspectSkillSource("/work/project", "auditor", "project");
    await service.updateMcpServerConfig("/work/project", {
      action: "toggle",
      scope: "global",
      name: "docs",
      enabled: false,
    });
    await service.acknowledgeWorkspaceCapabilities("/work/project");

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "get_capabilities_snapshot",
      expect.any(Object),
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "inspect_skill_source", {
      request: {
        schemaVersion: 1,
        operationId: expect.any(String),
        projectId: "/work/project",
        name: "auditor",
        scope: "project",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      3,
      "update_mcp_server_config",
      {
        request: {
          schemaVersion: 1,
          operationId: expect.any(String),
          projectId: "/work/project",
          action: "toggle",
          scope: "global",
          name: "docs",
          enabled: false,
          transport: null,
          command: null,
          args: null,
          url: null,
        },
      },
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      4,
      "acknowledge_workspace_capabilities",
      expect.any(Object),
    );
  });
});
