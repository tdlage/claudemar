import { useRef, useCallback } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";

interface MonacoEditorProps {
  content: string;
  onChange: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  onSave?: () => void;
}

const EXT_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".py": "python",
  ".sh": "shell",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".css": "css",
  ".html": "html",
  ".xml": "xml",
  ".sql": "sql",
  ".toml": "ini",
  ".env": "ini",
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.includes(".")
    ? `.${filePath.split(".").pop()}`
    : "";
  return EXT_LANGUAGE_MAP[ext] || "plaintext";
}

export function MonacoEditorWrapper({
  content,
  onChange,
  language = "plaintext",
  readOnly = false,
  onSave,
}: MonacoEditorProps) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => onSave?.(),
      );

      editor.focus();
    },
    [onSave],
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      onChange(value ?? "");
    },
    [onChange],
  );

  return (
    <Editor
      height="100%"
      language={language}
      value={content}
      theme="vs-dark"
      onChange={handleChange}
      onMount={handleMount}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        automaticLayout: true,
        tabSize: 2,
        renderWhitespace: "selection",
        padding: { top: 8 },
      }}
      loading={
        <div className="flex items-center justify-center h-full text-text-muted text-sm">
          Loading editor...
        </div>
      }
    />
  );
}
