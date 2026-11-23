import Editor, { type OnMount } from "@monaco-editor/react";
import { Uri } from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === "typescript" || label === "javascript"
      ? new TypeScriptWorker()
      : new EditorWorker();
  },
};

export function CodeEditor({
  path,
  value,
  theme,
  fontSize,
  onChange,
  onMount,
}: {
  path: string;
  value: string;
  theme: "dark" | "light";
  fontSize: number;
  onChange: (value: string) => void;
  onMount?: OnMount;
}) {
  return (
    <Editor
      path={Uri.file(path.replaceAll("\\", "/")).toString()}
      language={languageFor(path)}
      value={value}
      theme={theme === "dark" ? "vs-dark" : "vs"}
      onChange={(next) => onChange(next ?? "")}
      onMount={(editor, monaco) => {
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
