import { create } from "zustand";
import type { UiPreferences } from "../services/contracts";

export const DEFAULT_PREFERENCES: UiPreferences = {
  theme: "dark",
  density: "comfortable",
  editorFontSize: 12,
  navigationCollapsed: false,
  inspectorCollapsed: false,
  inspectorWidth: 360,
  explorerCollapsed: false,
  explorerWidth: 238,
  bottomDrawerCollapsed: false,
  bottomDrawerHeight: 240,
};

export type PageId =
  | "home"
  | "editor"
  | "changes"
  | "context"
  | "verify"
  | "rook"
  | "tools"
  | "settings";

export type RightPanelTab = "rook" | "context" | "history";
export type BottomDrawerTab = "terminal" | "run" | "git" | "verify";
export type LeftSidebarTab = "files" | "search";

interface AppState {
  page: PageId;
  preferences: UiPreferences;
  leftSidebarTab: LeftSidebarTab;
  searchFocusNonce: number;
  rightPanelTab: RightPanelTab;
  rookExpanded: boolean;
  bottomDrawerTab: BottomDrawerTab;
  navigate: (page: PageId) => void;
  setPreferences: (preferences: UiPreferences) => void;
  setLeftSidebarTab: (tab: LeftSidebarTab) => void;
  focusWorkspaceSearch: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setRookExpanded: (expanded: boolean) => void;
  setBottomDrawerTab: (tab: BottomDrawerTab) => void;
}

export const useAppStore = create<AppState>((set) => ({
  page: "home",
  preferences: DEFAULT_PREFERENCES,
  leftSidebarTab: "files",
  searchFocusNonce: 0,
  rightPanelTab: "rook",
  rookExpanded: false,
  bottomDrawerTab: "terminal",
  navigate: (page) => set({ page }),
  setPreferences: (preferences) => set({ preferences }),
  setLeftSidebarTab: (leftSidebarTab) => set({ leftSidebarTab }),
  focusWorkspaceSearch: () =>
    set((state) => ({
      page: "editor",
      leftSidebarTab: "search",
      searchFocusNonce: state.searchFocusNonce + 1,
    })),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setRookExpanded: (rookExpanded) => set({ rookExpanded }),
  setBottomDrawerTab: (bottomDrawerTab) => set({ bottomDrawerTab }),
}));
