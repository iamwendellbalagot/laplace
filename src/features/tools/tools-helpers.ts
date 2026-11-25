import type {
  CapabilityMcpServerSummary,
  RookParityItem,
} from "../../services/contracts";

export interface CapabilityStatePill {
  dimension: "Configured" | "Enabled" | "Connected" | "Authorized";
  value: string;
  tone: "passed" | "failed" | "stale" | "inconclusive";
}

export function mcpStatePills(
  server: CapabilityMcpServerSummary,
): CapabilityStatePill[] {
  return [
    {
      dimension: "Configured",
      value: server.configured === "valid" ? "Valid" : "Invalid",
      tone: server.configured === "valid" ? "passed" : "failed",
    },
    {
      dimension: "Enabled",
      value: server.enabled
        ? "Enabled"
        : server.connectionStatus === "untrusted_project"
          ? "Blocked (untrusted)"
          : "Disabled",
      tone: server.enabled ? "passed" : "stale",
    },
    {
      dimension: "Connected",
      value: server.connected ? "Connected" : "Not connected",
      tone: server.connected ? "passed" : "inconclusive",
    },
    {
      dimension: "Authorized",
      value: "Approval required",
      tone: "stale",
    },
  ];
}

export function parityStatusLabel(status: RookParityItem["status"]): string {
  switch (status) {
    case "native":
      return "Native";
    case "terminal_handoff":
      return "Rook Terminal";
    case "blocked_protocol":
      return "Blocked by protocol";
    default:
      return status;
  }
}

export function capabilityMonogram(name: string): string {
  const clean = name.trim();
  return clean ? clean[0].toUpperCase() : "?";
}
