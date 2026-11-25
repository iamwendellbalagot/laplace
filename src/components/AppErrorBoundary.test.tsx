import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

function CrashableChild({ shouldCrash }: { shouldCrash: boolean }) {
  if (shouldCrash) {
    throw new Error("Simulated render crash");
  }
  return <div>Healthy workspace</div>;
}

describe("AppErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when no error occurs", () => {
    render(
      <AppErrorBoundary>
        <CrashableChild shouldCrash={false} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Healthy workspace")).toBeInTheDocument();
  });

  it("catches render errors and recovers when requested", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(
      <AppErrorBoundary>
        <CrashableChild shouldCrash={true} />
      </AppErrorBoundary>,
    );

    expect(
      screen.getByText("Laplace hit an unexpected UI error"),
    ).toBeInTheDocument();
    expect(screen.getByText("Simulated render crash")).toBeInTheDocument();

    rerender(
      <AppErrorBoundary>
        <CrashableChild shouldCrash={false} />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try to recover" }));

    expect(screen.getByText("Healthy workspace")).toBeInTheDocument();
  });
});
