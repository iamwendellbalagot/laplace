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
    label: "Review",
    description: "Diff, verify, and commit working changes",
    symbol: "▤",
    available: true,
  },
  {
    id: "context",
    label: "Context",
    description: "Source relationships and history",
    symbol: "◇",
    available: true,
  },
  {
    id: "verify",
    label: "Verify",
    description: "Recorded checks and evidence",
    symbol: "◇",
    available: true,
  },
  {
    id: "rook",
    label: "Rook",
    description: "Agent sessions and activity",
    symbol: "◉",
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
    description: "Appearance and layout preferences",
    symbol: "⚙",
    available: true,
  },
];

export const screenTitles: Record<PageId, string> = {
  home: "Home",
  editor: "Editor",
  changes: "Review",
  context: "Context Lens",
  verify: "Verification",
  rook: "Rook",
  tools: "Skills & MCP",
  settings: "Settings",
};
