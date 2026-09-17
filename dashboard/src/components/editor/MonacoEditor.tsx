import { useRef, useCallback, useEffect } from "react";
import { useMobile } from "../../hooks/useMobile";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";

interface MonacoEditorProps {
  content: string;
  onChange: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  onSave?: () => void;
  goToLine?: number;
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
  goToLine,
}: MonacoEditorProps) {
  const mobile = useMobile();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const mobileEditorRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    if (mobile && mobileEditorRef.current && goToLine) {
      const editor = mobileEditorRef.current;
      const offset = editor.value.split("\n").slice(0, goToLine - 1).reduce((total, line) => total + line.length + 1, 0);
      editor.setSelectionRange(offset, offset);
      editor.scrollTop = Math.max(0, goToLine - 3) * 24;
      return;
    }
    if (!editorRef.current || !goToLine) return;
    editorRef.current.revealLineInCenter(goToLine);
    editorRef.current.setPosition({ lineNumber: goToLine, column: 1 });
    editorRef.current.focus();
  }, [goToLine, mobile]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      onChange(value ?? "");
    },
    [onChange],
  );

  if (mobile) return <textarea
    ref={mobileEditorRef} aria-label="Conteúdo do arquivo" value={content} onChange={(event) => onChange(event.target.value)}
    readOnly={readOnly} spellCheck={false} autoCapitalize="off" autoCorrect="off"
    onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "s") { event.preventDefault(); onSave?.(); } }}
    className="w-full h-full min-h-0 resize-none bg-bg p-3 font-mono text-base leading-6 text-text-primary focus:outline-none"
  />;

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
