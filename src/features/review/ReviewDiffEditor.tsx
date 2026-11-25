import { useEffect, useRef } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

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
  onChange,
}: {
  path: string;
  original: string;
  modified: string;
  theme: "dark" | "light";
  fontSize: number;
  sideBySide: boolean;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const listenerRef = useRef<{ dispose(): void } | undefined>(undefined);

  useEffect(() => {
    return () => {
      listenerRef.current?.dispose();
      listenerRef.current = undefined;
    };
  }, []);

  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={languageFor(path)}
      theme={theme === "dark" ? "vs-dark" : "vs"}
      onMount={(diffEditor: editor.IStandaloneDiffEditor) => {
        listenerRef.current?.dispose();
        const modifiedEditor = diffEditor.getModifiedEditor();
        listenerRef.current = modifiedEditor.onDidChangeModelContent(() => {
          onChangeRef.current(modifiedEditor.getValue());
        });
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
