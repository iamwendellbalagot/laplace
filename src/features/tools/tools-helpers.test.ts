import { describe, expect, it } from "vitest";
import type { CapabilityMcpServerSummary } from "../../services/contracts";
import {
  capabilityMonogram,
  mcpStatePills,
  parityStatusLabel,
} from "./tools-helpers";

describe("tools helpers", () => {
  it("reports configured, enabled, connected, and authorized as four distinct pills", () => {
    const server: CapabilityMcpServerSummary = {
      name: "docs",
      scope: "global",
      sourcePath: "~/.pi/agent/mcp.json",
      overridePath: null,
      transport: "http",
      target: "https://docs.example.com/mcp",
      configured: "valid",
      configEnabled: true,
      enabled: true,
      connected: false,
      connectionStatus: "blocked_by_stdio_policy",
      connectionNote: "Disabled in stdio",
      authorizationPolicy: "approval_required",
      authorizationNote: "Requires approval",
      exposure: "codemode",
      redactedHeaders: ["Authorization (redacted)"],
      errors: [],
    };
    const pills = mcpStatePills(server);
    expect(pills.map((p) => p.dimension)).toEqual([
      "Configured",
      "Enabled",
      "Connected",
      "Authorized",
    ]);
    expect(pills[0].value).toBe("Valid");
    expect(pills[1].value).toBe("Enabled");
    expect(pills[2].value).toBe("Not connected");
    expect(pills[3].value).toBe("Approval required");
  });

  it("maps parity labels and monograms cleanly", () => {
    expect(parityStatusLabel("native")).toBe("Native");
    expect(parityStatusLabel("terminal_handoff")).toBe("Rook Terminal");
    expect(parityStatusLabel("blocked_protocol")).toBe("Blocked by protocol");
    expect(capabilityMonogram("auditor")).toBe("A");
  });
});
