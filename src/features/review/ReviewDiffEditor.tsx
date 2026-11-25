import { useEffect, useRef } from "react";
import { DiffEditor, loader } from "@monaco-editor/react";
import * as monacoApi from "monaco-editor";
import type { editor } from "monaco-editor";
import {
  monacoThemeFor,
  registerLaplaceMonacoThemes,
} from "../editor/monaco-theme";

loader.config({ monaco: monacoApi });
registerLaplaceMonacoThemes(monacoApi);

function languageFor(path: string): string {
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

export function ReviewDiffEditor({
  path,
  original,
  modified,
  theme,
  fontSize,
  sideBySide,
  readOnly,
  revealLine,
  onChange,
}: {
  path: string;
  original: string;
  modified: string;
  theme: "dark" | "light";
  fontSize: number;
  sideBySide: boolean;
  readOnly: boolean;
  revealLine?: number;
  onChange: (value: string) => void;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const listenerRef = useRef<{ dispose(): void } | undefined>(undefined);
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | undefined>(
    undefined,
  );
  const monacoRef = useRef<typeof monacoApi | undefined>(undefined);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    registerLaplaceMonacoThemes(monaco);
    monaco.editor.setTheme(monacoThemeFor(theme));
  }, [theme]);

  useEffect(() => {
    if (!revealLine || revealLine < 1) return;
    const mod = diffEditorRef.current?.getModifiedEditor();
    mod?.revealLineInCenter(revealLine);
  }, [revealLine, path]);

  useEffect(() => {
    return () => {
      listenerRef.current?.dispose();
      listenerRef.current = undefined;
      diffEditorRef.current = undefined;
      monacoRef.current = undefined;
    };
  }, []);

  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={languageFor(path)}
      theme={monacoThemeFor(theme)}
      beforeMount={registerLaplaceMonacoThemes}
      onMount={(diffEditor: editor.IStandaloneDiffEditor, monaco) => {
        diffEditorRef.current = diffEditor;
        monacoRef.current = monaco as typeof monacoApi;
        registerLaplaceMonacoThemes(monaco);
        monaco.editor.setTheme(monacoThemeFor(theme));
        listenerRef.current?.dispose();
        const modifiedEditor = diffEditor.getModifiedEditor();
        listenerRef.current = modifiedEditor.onDidChangeModelContent(() => {
          onChangeRef.current(modifiedEditor.getValue());
        });
        if (revealLine && revealLine >= 1) {
          modifiedEditor.revealLineInCenter(revealLine);
        }
      }}
      options={{
        automaticLayout: true,
        originalEditable: false,
        readOnly,
        renderSideBySide: sideBySide,
        minimap: { enabled: false },
        fontSize,
        fontFamily: '"JetBrains Mono", monospace',
        scrollBeyondLastLine: false,
        wordWrap: "off",
      }}
    />
  );
}
