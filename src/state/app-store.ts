import { create } from "zustand";
import type { UiPreferences } from "../services/contracts";

export const DEFAULT_PREFERENCES: UiPreferences = {
  theme: "dark",
  density: "comfortable",
  editorFontSize: 12,
  navigationCollapsed: false,
  inspectorCollapsed: false,
  inspectorWidth: 286,
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

interface AppState {
  page: PageId;
  preferences: UiPreferences;
  navigate: (page: PageId) => void;
  setPreferences: (preferences: UiPreferences) => void;
}

export const useAppStore = create<AppState>((set) => ({
  page: "home",
  preferences: DEFAULT_PREFERENCES,
  navigate: (page) => set({ page }),
  setPreferences: (preferences) => set({ preferences }),
}));
