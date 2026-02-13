import { useState } from "react";
import { Save, Plus, Trash2, FileText } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { MarkdownEditor } from "../shared/MarkdownEditor";
import { useToast } from "../shared/Toast";
import type { AgentFileContent } from "../../lib/types";

interface AgentContextFilesProps {
  agentName: string;
  contextFiles: string[];
  onRefresh: () => void;
}

export function AgentContextFiles({ agentName, contextFiles, onRefresh }: AgentContextFilesProps) {
  const { addToast } = useToast();
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileContent, setNewFileContent] = useState("");

  const dirty = fileContent !== originalContent;

  const openFile = async (file: string) => {
    if (activeFile === file) {
      setActiveFile(null);
      return;
    }
    setLoading(true);
    try {
      const data = await api.get<AgentFileContent>(`/agents/${agentName}/context/${file}`);
      setFileContent(data.content);
      setOriginalContent(data.content);
      setActiveFile(file);
    } catch {
      addToast("error", "Failed to load file");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!activeFile) return;
    setSaving(true);
    try {
      await api.put(`/agents/${agentName}/context/${activeFile}`, { content: fileContent });
      setOriginalContent(fileContent);
      addToast("success", `${activeFile} saved`);
    } catch {
      addToast("error", "Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (file: string) => {
    if (!confirm(`Delete ${file}?`)) return;
    try {
      await api.delete(`/agents/${agentName}/context/${file}`);
      if (activeFile === file) setActiveFile(null);
      addToast("success", "File deleted");
      onRefresh();
    } catch {
      addToast("error", "Failed to delete");
    }
  };

  const handleCreate = async () => {
    if (!newFileName.trim()) return;
    try {
      await api.post(`/agents/${agentName}/context`, {
        filename: newFileName.trim(),
        content: newFileContent,
      });
      addToast("success", "File created");
      setNewFileOpen(false);
      setNewFileName("");
      setNewFileContent("");
      onRefresh();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to create");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-muted">
          Context Files ({contextFiles.length})
        </h3>
        <Button size="sm" variant="secondary" onClick={() => setNewFileOpen(true)}>
          <Plus size={12} className="mr-1" /> New
        </Button>
      </div>

      {contextFiles.length === 0 ? (
        <p className="text-sm text-text-muted">No context files.</p>
      ) : (
        <div className="space-y-2">
          {contextFiles.map((file) => (
            <Card key={file} className="p-0 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2">
                <button
                  onClick={() => openFile(file)}
                  className="flex items-center gap-2 flex-1 text-left hover:text-accent transition-colors"
                >
                  <FileText size={14} className="text-text-muted" />
                  <span className="text-sm text-text-primary">{file}</span>
                </button>
                <Button size="sm" variant="danger" onClick={() => handleDelete(file)}>
                  <Trash2 size={12} />
                </Button>
              </div>
              {activeFile === file && !loading && (
                <div className="border-t border-border">
                  <div className="flex items-center justify-end px-4 py-2 border-b border-border">
                    <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                      <Save size={12} className="mr-1" />
                      {saving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                  <MarkdownEditor
                    value={fileContent}
                    onChange={setFileContent}
                    onSave={handleSave}
                    placeholder="File content..."
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal open={newFileOpen} onClose={() => setNewFileOpen(false)} title="New Context File">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Filename</label>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="e.g. guidelines.md"
              className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Content</label>
            <textarea
              value={newFileContent}
              onChange={(e) => setNewFileContent(e.target.value)}
              rows={8}
              className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary font-mono resize-y focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNewFileOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newFileName.trim()}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
