import type { PageId } from "../state/app-store";

export interface NavigationItem {
  id: PageId;
  label: string;
  description: string;
  symbol: string;
  available: boolean;
}

export const navigationItems: NavigationItem[] = [
  {
    id: "editor",
    label: "Workspace",
    description: "Code, docked Rook, and live tools",
    symbol: "⌘",
    available: true,
  },
  {
    id: "changes",
    label: "Review",
    description: "Diff, verify, and commit working changes",
    symbol: "▤",
    available: true,
  },
  {
    id: "context",
    label: "System",
    description: "Source relationships and history",
    symbol: "◇",
    available: true,
  },
  {
    id: "tools",
    label: "Tools",
    description: "Skills and MCP capabilities",
    symbol: "⊕",
    available: true,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Appearance, runtime, and layout preferences",
    symbol: "⚙",
    available: true,
  },
];

export const screenTitles: Record<PageId, string> = {
  home: "Project Pulse",
  editor: "Workspace",
  changes: "Review",
  context: "System Map",
  verify: "Verification",
  rook: "Rook",
  tools: "Skills & MCP",
  settings: "Settings",
};
