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
    id: "home",
    label: "Home",
    description: "Workspace overview",
    symbol: "⌂",
    available: true,
  },
  {
    id: "editor",
    label: "Editor",
    description: "Source workspace",
    symbol: "⌘",
    available: true,
  },
  {
    id: "changes",
    label: "Changes",
    description: "Durable engineering changes",
    symbol: "▤",
    available: false,
  },
  {
    id: "context",
    label: "Context",
    description: "Source relationships and history",
    symbol: "⌘",
    available: false,
  },
  {
    id: "verify",
    label: "Verify",
    description: "Recorded checks and evidence",
    symbol: "◇",
    available: false,
  },
  {
    id: "rook",
    label: "Rook",
    description: "Agent sessions and activity",
    symbol: "◉",
    available: false,
  },
  {
    id: "tools",
    label: "Tools",
    description: "Skills and MCP capabilities",
    symbol: "⊕",
    available: false,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Appearance and layout preferences",
    symbol: "⚙",
    available: true,
  },
];

export const screenTitles: Record<PageId, string> = {
  home: "Home",
  editor: "Editor",
  changes: "Changes",
  context: "Context Lens",
  verify: "Verification",
  rook: "Rook",
  tools: "Skills & MCP",
  settings: "Settings",
};
