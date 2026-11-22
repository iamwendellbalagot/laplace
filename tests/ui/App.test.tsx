import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import {
  AppServiceError,
  type AppService,
} from "../../src/services/app-service";
import type { AppEvent, PingResponse } from "../../src/services/contracts";

const response: PingResponse = {
  schemaVersion: 1,
  operationId: "op-ui-1",
  status: "ok",
  message: "Native command/event round trip succeeded.",
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
    ...overrides,
  };
  return { service, emit: (event: AppEvent) => receiveEvent?.(event) };
}

describe("bootstrap command/event round trip", () => {
  it("invokes only after the user requests a native check and displays the result", async () => {
    const { service } = serviceFixture();
    render(<App service={service} />);

    expect(service.ping).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Test native connection" }),
    );

    expect(await screen.findByText(response.message)).toBeInTheDocument();
    expect(service.ping).toHaveBeenCalledOnce();
  });

  it("surfaces typed command errors", async () => {
    const { service } = serviceFixture({
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
    fireEvent.click(
      screen.getByRole("button", { name: "Test native connection" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "unsupported_schema",
    );
  });

  it("renders backend events with their operation identity", async () => {
    const { service, emit } = serviceFixture();
    render(<App service={service} />);
    await waitFor(() => expect(service.listen).toHaveBeenCalledOnce());
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
