import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEvent, PingResponse, UiPreferences } from "./contracts";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

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
});
