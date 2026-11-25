import { create } from "zustand";
import type {
  ChangeRecord,
  ChangeStatus,
  ExecutionRecord,
  GitStatus,
  ProjectEntry,
  ProjectFileRead,
  ProjectRecipeSummary,
  ProjectSummary,
  ReviewDiffBaseline,
  WorkspacePulse,
} from "../services/contracts";
import type { SyncableDocument } from "../features/editor/workspace-sync";

export type EditorDocument = SyncableDocument;

interface WorkspaceStoreState {
  activeProject?: ProjectSummary;
  recentProjects: ProjectSummary[];
  workspaceTrusted: boolean;
  workspacePulse: WorkspacePulse | null;
  projectEntries: ProjectEntry[];
  projectEntriesTruncated: boolean;
  projectDirectory: string;
  selectedFilePath?: string;
  selectedFile?: ProjectFileRead;
  documents: EditorDocument[];
  activeDocumentKey?: string;
  splitDocumentKey?: string;
  activeEditorPane: "primary" | "secondary";
  savingFiles: boolean;
  projectPending: boolean;
  projectError?: string;
  workspaceSyncVersion: number;
  lastSyncedAt?: number;
  changes: ChangeRecord[];
  changeFilter: ChangeStatus | "all";
  executions: ExecutionRecord[];
  projectRecipes: ProjectRecipeSummary[];
  verifyChangeId: string;
  reviewInitialSelectedPaths?: string[];
  reviewBaseline: ReviewDiffBaseline;
  editorGitStatus?: GitStatus;

  setActiveProject: (project?: ProjectSummary) => void;
  setRecentProjects: (
    update: ProjectSummary[] | ((prev: ProjectSummary[]) => ProjectSummary[]),
  ) => void;
  setWorkspaceTrusted: (trusted: boolean) => void;
  setWorkspacePulse: (pulse: WorkspacePulse | null) => void;
  setProjectEntries: (entries: ProjectEntry[], truncated: boolean) => void;
  setProjectDirectory: (dir: string) => void;
  setSelectedFile: (path?: string, file?: ProjectFileRead) => void;
  setDocuments: (
    update: EditorDocument[] | ((prev: EditorDocument[]) => EditorDocument[]),
  ) => void;
  setActiveDocumentKey: (key?: string) => void;
  setSplitDocumentKey: (
    update: string | undefined | ((prev?: string) => string | undefined),
  ) => void;
  setActiveEditorPane: (pane: "primary" | "secondary") => void;
  setSavingFiles: (saving: boolean) => void;
  setProjectPending: (pending: boolean) => void;
  setProjectError: (error?: string) => void;
  bumpSyncVersion: () => void;
  setLastSyncedAt: (ts?: number) => void;
  setChanges: (changes: ChangeRecord[]) => void;
  setChangeFilter: (filter: ChangeStatus | "all") => void;
  setExecutions: (
    update:
      | ExecutionRecord[]
      | ((prev: ExecutionRecord[]) => ExecutionRecord[]),
  ) => void;
  setProjectRecipes: (recipes: ProjectRecipeSummary[]) => void;
  setVerifyChangeId: (id: string) => void;
  setReviewTarget: (
    selectedPaths?: string[],
    baseline?: ReviewDiffBaseline,
  ) => void;
  setEditorGitStatus: (status?: GitStatus) => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  recentProjects: [],
  workspaceTrusted: false,
  workspacePulse: null,
  projectEntries: [],
  projectEntriesTruncated: false,
  projectDirectory: "",
  documents: [],
  activeEditorPane: "primary",
  savingFiles: false,
  projectPending: false,
  workspaceSyncVersion: 0,
  changes: [],
  changeFilter: "all",
  executions: [],
  projectRecipes: [],
  verifyChangeId: "",
  reviewBaseline: "head",

  setActiveProject: (activeProject) => set({ activeProject }),
  setRecentProjects: (update) =>
    set((state) => ({
      recentProjects:
        typeof update === "function" ? update(state.recentProjects) : update,
    })),
  setWorkspaceTrusted: (workspaceTrusted) => set({ workspaceTrusted }),
  setWorkspacePulse: (workspacePulse) => set({ workspacePulse }),
  setProjectEntries: (projectEntries, projectEntriesTruncated) =>
    set({ projectEntries, projectEntriesTruncated }),
  setProjectDirectory: (projectDirectory) => set({ projectDirectory }),
  setSelectedFile: (selectedFilePath, selectedFile) =>
    set({ selectedFilePath, selectedFile }),
  setDocuments: (update) =>
    set((state) => ({
      documents:
        typeof update === "function" ? update(state.documents) : update,
    })),
  setActiveDocumentKey: (activeDocumentKey) => set({ activeDocumentKey }),
  setSplitDocumentKey: (update) =>
    set((state) => ({
      splitDocumentKey:
        typeof update === "function" ? update(state.splitDocumentKey) : update,
    })),
  setActiveEditorPane: (activeEditorPane) => set({ activeEditorPane }),
  setSavingFiles: (savingFiles) => set({ savingFiles }),
  setProjectPending: (projectPending) => set({ projectPending }),
  setProjectError: (projectError) => set({ projectError }),
  bumpSyncVersion: () =>
    set((state) => ({ workspaceSyncVersion: state.workspaceSyncVersion + 1 })),
  setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
  setChanges: (changes) => set({ changes }),
  setChangeFilter: (changeFilter) => set({ changeFilter }),
  setExecutions: (update) =>
    set((state) => ({
      executions:
        typeof update === "function" ? update(state.executions) : update,
    })),
  setProjectRecipes: (projectRecipes) => set({ projectRecipes }),
  setVerifyChangeId: (verifyChangeId) => set({ verifyChangeId }),
  setReviewTarget: (reviewInitialSelectedPaths, reviewBaseline = "head") =>
    set({ reviewInitialSelectedPaths, reviewBaseline }),
  setEditorGitStatus: (editorGitStatus) => set({ editorGitStatus }),
}));
