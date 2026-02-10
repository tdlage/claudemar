import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../components/shared/Toast";
import { useSocketRoom, useSocketEvent } from "../hooks/useSocket";
import { FileTree, type FileTreeHandle } from "../components/editor/FileTree";
import {
  MonacoEditorWrapper,
  detectLanguage,
} from "../components/editor/MonacoEditor";
import { EditorTabs, type OpenFile } from "../components/editor/EditorTabs";
import type { AgentInfo, FileReadResult, ProjectInfo } from "../lib/types";

interface FileState {
  content: string;
  originalContent: string;
}

export function EditorPage() {
  const [searchParams] = useSearchParams();
  const { addToast } = useToast();

  const initialBase = searchParams.get("base") || "orchestrator";
  const initialPath = searchParams.get("path") || "";

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [base, setBase] = useState(initialBase);
  const [openFiles, setOpenFiles] = useState<Map<string, FileState>>(
    new Map(),
  );
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fileTreeRef = useRef<FileTreeHandle>(null);

  useEffect(() => {
    api.get<AgentInfo[]>("/agents").then(setAgents).catch(() => {});
    api.get<ProjectInfo[]>("/projects").then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (initialPath && initialBase === base) {
      openFile(initialPath);
    }
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      if (openFiles.has(path)) {
        setActiveFile(path);
        return;
      }
      try {
        const result = await api.get<FileReadResult>(
          `/files?base=${base}&path=${encodeURIComponent(path)}`,
        );
        if (result.type === "file" && result.content !== undefined) {
          setOpenFiles((prev) => {
            const next = new Map(prev);
            next.set(path, {
              content: result.content!,
              originalContent: result.content!,
            });
            return next;
          });
          setActiveFile(path);
        }
      } catch (err) {
        addToast(
          "error",
          err instanceof Error ? err.message : "Failed to open file",
        );
      }
    },
    [base, openFiles, addToast],
  );

  const handleContentChange = useCallback(
    (value: string) => {
      if (!activeFile) return;
      setOpenFiles((prev) => {
        const next = new Map(prev);
        const state = next.get(activeFile);
        if (state) {
          next.set(activeFile, { ...state, content: value });
        }
        return next;
      });
    },
    [activeFile],
  );

  const handleSave = useCallback(async () => {
    if (!activeFile) return;
    const state = openFiles.get(activeFile);
    if (!state) return;
    setSaving(true);
    try {
      await api.put(
        `/files?base=${base}&path=${encodeURIComponent(activeFile)}`,
        { content: state.content },
      );
      setOpenFiles((prev) => {
        const next = new Map(prev);
        next.set(activeFile, {
          content: state.content,
          originalContent: state.content,
        });
        return next;
      });
      addToast("success", "File saved");
    } catch (err) {
      addToast(
        "error",
        err instanceof Error ? err.message : "Failed to save",
      );
    } finally {
      setSaving(false);
    }
  }, [activeFile, openFiles, base, addToast]);

  const handleTabClose = useCallback(
    (path: string) => {
      const state = openFiles.get(path);
      if (state && state.content !== state.originalContent) {
        if (!confirm("Discard unsaved changes?")) return;
      }
      setOpenFiles((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });
      if (activeFile === path) {
        const keys = [...openFiles.keys()].filter((k) => k !== path);
        setActiveFile(keys.length > 0 ? keys[keys.length - 1] : null);
      }
    },
    [openFiles, activeFile],
  );

  const handleBaseChange = useCallback((newBase: string) => {
    setBase(newBase);
    setOpenFiles(new Map());
    setActiveFile(null);
  }, []);

  useSocketRoom("files");

  useSocketEvent<{ event: string; base: string; path: string }>(
    "file:changed",
    useCallback(
      (data) => {
        if (data.base !== base) return;

        fileTreeRef.current?.refresh();

        const state = openFiles.get(data.path);
        if (!state) return;

        const isDirty = state.content !== state.originalContent;
        if (isDirty) {
          addToast("warning", `File changed externally: ${data.path}`);
          return;
        }

        api
          .get<FileReadResult>(
            `/files?base=${base}&path=${encodeURIComponent(data.path)}`,
          )
          .then((result) => {
            if (result.type === "file" && result.content !== undefined) {
              setOpenFiles((prev) => {
                const next = new Map(prev);
                next.set(data.path, {
                  content: result.content!,
                  originalContent: result.content!,
                });
                return next;
              });
            }
          })
          .catch(() => {});
      },
      [base, openFiles, addToast],
    ),
  );

  const tabs: OpenFile[] = [...openFiles.entries()].map(([path, state]) => ({
    path,
    dirty: state.content !== state.originalContent,
  }));

  const activeState = activeFile ? openFiles.get(activeFile) : null;

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-0 -m-4 md:-m-6">
      <div className="w-64 bg-surface border-r border-border overflow-y-auto flex flex-col">
        <div className="p-2 border-b border-border">
          <select
            value={base}
            onChange={(e) => handleBaseChange(e.target.value)}
            className="w-full bg-bg border border-border rounded text-xs px-2 py-1 text-text-primary focus:outline-none"
          >
            <option value="orchestrator">Orchestrator</option>
            {agents.length > 0 && (
              <optgroup label="Agents">
                {agents.map((a) => (
                  <option key={a.name} value={`agent:${a.name}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {projects.length > 0 && (
              <optgroup label="Projects">
                {projects.map((p) => (
                  <option key={p.name} value={`project:${p.name}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="overflow-y-auto flex-1">
          <FileTree
            ref={fileTreeRef}
            base={base}
            onFileSelect={openFile}
            selectedFile={activeFile || ""}
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {tabs.length > 0 ? (
          <>
            <EditorTabs
              tabs={tabs}
              activeTab={activeFile}
              onSelect={setActiveFile}
              onClose={handleTabClose}
            />
            {activeState ? (
              <div className="flex-1 min-h-0">
                <MonacoEditorWrapper
                  key={activeFile}
                  content={activeState.content}
                  onChange={handleContentChange}
                  language={detectLanguage(activeFile || "")}
                  onSave={handleSave}
                />
                {saving && (
                  <div className="absolute bottom-4 right-4 bg-surface border border-border rounded px-3 py-1 text-xs text-text-muted">
                    Saving...
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
                Select a tab
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
            Select a file to edit
          </div>
        )}
      </div>
    </div>
  );
}
