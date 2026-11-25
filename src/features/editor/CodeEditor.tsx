import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Uri, type editor as MonacoEditor } from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker?worker";

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

export function CodeEditor({
  path,
  value,
  theme,
  fontSize,
  revealTarget,
  onChange,
  onSelectionChange,
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
  onFocus?: () => void;
  onMount?: OnMount;
}) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const selectionCbRef = useRef(onSelectionChange);
  const focusCbRef = useRef(onFocus);
  selectionCbRef.current = onSelectionChange;
  focusCbRef.current = onFocus;

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
        editor.onDidFocusEditorText(() => {
          focusCbRef.current?.();
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
