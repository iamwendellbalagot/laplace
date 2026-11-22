import fixture from "../../contracts/ipc-fixtures.json";
import { describe, expect, it } from "vitest";
import type {
  AppEvent,
  IpcError,
  PingRequest,
  PingResponse,
} from "./contracts";

describe("shared Rust/TypeScript wire fixtures", () => {
  it("satisfies the frontend contract types and stable schema version", () => {
    const request: PingRequest = fixture.pingRequest;
    const response: PingResponse = fixture.pingResponse;
    const error: IpcError = fixture.ipcError;
    const event: AppEvent = fixture.appEvent;

    expect(request.schemaVersion).toBe(1);
    expect(response.operationId).toBe(request.operationId);
    expect(error.code).toBe("invalid_operation_id");
    expect(event.operationId).toBe(request.operationId);
  });
});
