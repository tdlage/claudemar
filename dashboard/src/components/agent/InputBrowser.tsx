import { useRef, useState } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";

export interface InputFile {
  name: string;
  size: number;
  mtime: string;
}

interface InputBrowserProps {
  apiBasePath: string;
  files: InputFile[];
  onRefresh: () => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function InputBrowser({ apiBasePath, files, onRefresh }: InputBrowserProps) {
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      addToast("error", "File too large (max 10MB)");
      return;
    }

    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
      );
      await api.post(`${apiBasePath}/input`, { filename: sanitized, content: base64 });
      addToast("success", `Uploaded ${sanitized}`);
      onRefresh();
    } catch {
      addToast("error", "Failed to upload file");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (fileName: string) => {
    try {
      const token = localStorage.getItem("dashboard_token") || "";
      const res = await fetch(`/api${apiBasePath}/input/${fileName}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast("error", "Failed to download file");
    }
  };

  const handleDelete = async (fileName: string) => {
    try {
      await api.delete(`${apiBasePath}/input/${fileName}`);
      onRefresh();
      addToast("success", "File deleted");
    } catch {
      addToast("error", "Failed to delete file");
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleUpload}
          className="hidden"
        />
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Upload size={14} />
          {uploading ? "Uploading..." : "Upload File"}
        </Button>
      </div>

      {files.length === 0 ? (
        <p className="text-sm text-text-muted">No input files.</p>
      ) : (
        <div className="space-y-2">
          {files.map((file) => (
            <Card key={file.name} className="px-4 py-3 flex items-center gap-2">
              <FileText size={14} className="text-text-muted shrink-0" />
              <span className="text-sm text-text-primary truncate flex-1">{file.name}</span>
              <span className="text-xs text-text-muted whitespace-nowrap">
                {(file.size / 1024).toFixed(1)} KB
              </span>
              <span className="text-xs text-text-muted whitespace-nowrap">
                {new Date(file.mtime).toLocaleString()}
              </span>
              <button
                onClick={() => handleDownload(file.name)}
                className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-accent transition-colors cursor-pointer"
                title="Download"
              >
                <Download size={14} />
              </button>
              <button
                onClick={() => handleDelete(file.name)}
                className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-red-400 transition-colors cursor-pointer"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
