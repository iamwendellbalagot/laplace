import fixture from "../../contracts/ipc-fixtures.json";
import { describe, expect, it } from "vitest";
import type {
  AppEvent,
  IpcError,
  PingRequest,
  PingResponse,
  ProjectEntry,
  ProjectSummary,
  UiPreferences,
} from "./contracts";

describe("shared Rust/TypeScript wire fixtures", () => {
  it("satisfies the frontend contract types and stable schema version", () => {
    const request: PingRequest = fixture.pingRequest;
    const response: PingResponse = fixture.pingResponse;
    const error: IpcError = fixture.ipcError;
    const event: AppEvent = fixture.appEvent;
    const preferences = fixture.uiPreferences as UiPreferences;
    const project: ProjectSummary = fixture.projectSummary;
    const entry = fixture.projectEntry as ProjectEntry;

    expect(request.schemaVersion).toBe(1);
    expect(response.operationId).toBe(request.operationId);
    expect(error.code).toBe("invalid_operation_id");
    expect(event.operationId).toBe(request.operationId);
    expect(preferences).toMatchObject({
      theme: "dark",
      density: "comfortable",
      inspectorWidth: 286,
    });
    expect(project.id).toBe(project.path);
    expect(entry.kind).toBe("directory");
  });
});
