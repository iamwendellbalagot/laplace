import type { editor } from "monaco-editor";

export const LAPLACE_MONACO_DARK = "laplace-terminal-dark";
export const LAPLACE_MONACO_LIGHT = "laplace-terminal-light";

interface MonacoLike {
  editor: {
    defineTheme: (name: string, data: editor.IStandaloneThemeData) => void;
  };
}

let registered = false;

/** Register custom terminal-matched Monaco themes once per runtime. */
export function registerLaplaceMonacoThemes(
  monaco: MonacoLike,
  force = false,
): void {
  if (registered && !force) return;
  registered = true;

  monaco.editor.defineTheme(LAPLACE_MONACO_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "556170", fontStyle: "italic" },
      { token: "keyword", foreground: "56d4dd" },
      { token: "string", foreground: "4ade80" },
      { token: "number", foreground: "f0b44c" },
      { token: "type", foreground: "86efac" },
      { token: "identifier", foreground: "e6edf3" },
      { token: "delimiter", foreground: "7d8998" },
    ],
    colors: {
      "editor.background": "#0b0e12",
      "editor.foreground": "#e6edf3",
      "editorLineNumber.foreground": "#556170",
      "editorLineNumber.activeForeground": "#4ade80",
      "editorCursor.foreground": "#4ade80",
      "editor.selectionBackground": "#4ade8036",
      "editor.inactiveSelectionBackground": "#4ade801f",
      "editor.lineHighlightBackground": "#141921",
      "editorGutter.background": "#0b0e12",
      "editorIndentGuide.background1": "#1f2733",
      "editorIndentGuide.activeBackground1": "#2a3442",
      "editorWidget.background": "#141921",
      "editorWidget.border": "#2a3442",
      "diffEditor.insertedTextBackground": "#4ade8024",
      "diffEditor.removedTextBackground": "#f8717126",
      "diffEditor.insertedLineBackground": "#4ade8014",
      "diffEditor.removedLineBackground": "#f8717116",
    },
  });

  monaco.editor.defineTheme(LAPLACE_MONACO_LIGHT, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "7b8794", fontStyle: "italic" },
      { token: "keyword", foreground: "0e7490" },
      { token: "string", foreground: "15803d" },
      { token: "number", foreground: "b45309" },
      { token: "type", foreground: "166534" },
      { token: "identifier", foreground: "0f172a" },
      { token: "delimiter", foreground: "5a6675" },
    ],
    colors: {
      "editor.background": "#f6f8fa",
      "editor.foreground": "#0f172a",
      "editorLineNumber.foreground": "#7b8794",
      "editorLineNumber.activeForeground": "#15803d",
      "editorCursor.foreground": "#15803d",
      "editor.selectionBackground": "#15803d29",
      "editor.inactiveSelectionBackground": "#15803d14",
      "editor.lineHighlightBackground": "#eef1f5",
      "editorGutter.background": "#f6f8fa",
      "editorIndentGuide.background1": "#dde3eb",
      "editorIndentGuide.activeBackground1": "#ccd4df",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#ccd4df",
      "diffEditor.insertedTextBackground": "#15803d22",
      "diffEditor.removedTextBackground": "#be123c22",
      "diffEditor.insertedLineBackground": "#15803d12",
      "diffEditor.removedLineBackground": "#be123c12",
    },
  });
}
