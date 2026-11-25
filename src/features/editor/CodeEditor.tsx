import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Uri, type editor as MonacoEditor } from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker?worker";
import type { EditorDiagnostic } from "../../services/contracts";

self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === "typescript" || label === "javascript"
      ? new TypeScriptWorker()
      : new EditorWorker();
  },
};

export interface RevealTarget {
  line: number;
  column?: number;
  nonce: number;
}

export interface CodeSelectionChange {
  startLine: number;
  endLine: number;
  text: string;
}

export interface CodeCursorChange {
  line: number;
  column: number;
  word: string | null;
}

export function CodeEditor({
  path,
  value,
  theme,
  fontSize,
  revealTarget,
  onChange,
  onSelectionChange,
  onCursorChange,
  onDiagnosticsChange,
  onFocus,
  onMount,
}: {
  path: string;
  value: string;
  theme: "dark" | "light";
  fontSize: number;
  revealTarget?: RevealTarget | null;
  onChange: (value: string) => void;
  onSelectionChange?: (selection: CodeSelectionChange | null) => void;
  onCursorChange?: (cursor: CodeCursorChange) => void;
  onDiagnosticsChange?: (diagnostics: EditorDiagnostic[]) => void;
  onFocus?: () => void;
  onMount?: OnMount;
}) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const selectionCbRef = useRef(onSelectionChange);
  const cursorCbRef = useRef(onCursorChange);
  const diagnosticsCbRef = useRef(onDiagnosticsChange);
  const focusCbRef = useRef(onFocus);
  selectionCbRef.current = onSelectionChange;
  cursorCbRef.current = onCursorChange;
  diagnosticsCbRef.current = onDiagnosticsChange;
  focusCbRef.current = onFocus;

  function emitDiagnosticsForCurrentModel() {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !diagnosticsCbRef.current) return;
    const model = editor.getModel();
    if (!model) {
      diagnosticsCbRef.current([]);
      return;
    }
    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
    const mapped: EditorDiagnostic[] = markers
      .slice(0, 40)
      .map((marker: MonacoEditor.IMarker) => ({
        severity:
          marker.severity >= monaco.MarkerSeverity.Error
            ? "error"
            : marker.severity >= monaco.MarkerSeverity.Warning
              ? "warning"
              : "info",
        message: marker.message,
        line: marker.startLineNumber,
        column: marker.startColumn,
        source: marker.source,
      }));
    diagnosticsCbRef.current(mapped);
  }

  useEffect(() => {
    emitDiagnosticsForCurrentModel();
  }, [path]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !revealTarget) return;
    const position = {
      lineNumber: Math.max(1, revealTarget.line),
      column: Math.max(1, revealTarget.column ?? 1),
    };
    editor.setPosition(position);
    editor.revealLineInCenter(position.lineNumber);
    editor.focus();
  }, [revealTarget?.nonce, revealTarget?.line, revealTarget?.column]);

  return (
    <Editor
      path={Uri.file(path.replaceAll("\\", "/")).toString()}
      language={languageFor(path)}
      value={value}
      theme={theme === "dark" ? "vs-dark" : "vs"}
      onChange={(next) => onChange(next ?? "")}
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
        editor.onDidFocusEditorText(() => {
          focusCbRef.current?.();
        });
        editor.onDidChangeCursorPosition((event) => {
          const model = editor.getModel();
          const word = model?.getWordAtPosition(event.position)?.word ?? null;
          cursorCbRef.current?.({
            line: event.position.lineNumber,
            column: event.position.column,
            word,
          });
        });
        editor.onDidChangeCursorSelection((event) => {
          const sel = event.selection;
          if (sel.isEmpty()) {
            selectionCbRef.current?.(null);
            return;
          }
          const model = editor.getModel();
          const text = model ? model.getValueInRange(sel) : "";
          selectionCbRef.current?.({
            startLine: sel.startLineNumber,
            endLine: sel.endLineNumber,
            text,
          });
        });
        monaco.editor.onDidChangeMarkers((uris: readonly Uri[]) => {
          const model = editor.getModel();
          if (!model) return;
          if (uris.some((u: Uri) => u.toString() === model.uri.toString())) {
            emitDiagnosticsForCurrentModel();
          }
        });
        emitDiagnosticsForCurrentModel();
        if (revealTarget) {
          const position = {
            lineNumber: Math.max(1, revealTarget.line),
            column: Math.max(1, revealTarget.column ?? 1),
          };
          editor.setPosition(position);
          editor.revealLineInCenter(position.lineNumber);
        }
        onMount?.(editor, monaco);
      }}
      options={{
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize,
        fontFamily: '"JetBrains Mono", monospace',
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: "off",
        renderWhitespace: "selection",
      }}
    />
  );
}

function languageFor(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  const languages: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    rs: "rust",
    py: "python",
    sh: "shell",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    xml: "xml",
  };
  return extension ? (languages[extension] ?? "plaintext") : "plaintext";
}
