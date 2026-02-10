import {
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
  type Ref,
} from "react";
import { api } from "../../lib/api";
import {
  ChevronRight,
  Folder,
  File,
  FileJson,
  FileCode2,
  FileText,
  AlertCircle,
} from "lucide-react";
import type { FileEntry, FileReadResult } from "../../lib/types";

export interface FileTreeHandle {
  refresh: () => void;
}

interface FileTreeProps {
  base: string;
  onFileSelect: (path: string) => void;
  selectedFile: string;
}

const FILE_ICONS: Record<string, typeof File> = {
  ".json": FileJson,
  ".ts": FileCode2,
  ".tsx": FileCode2,
  ".js": FileCode2,
  ".jsx": FileCode2,
  ".py": FileCode2,
  ".sh": FileCode2,
  ".md": FileText,
  ".txt": FileText,
  ".yml": FileText,
  ".yaml": FileText,
};

function getFileIcon(name: string) {
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
  return FILE_ICONS[ext] || File;
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export const FileTree = forwardRef(function FileTree(
  { base, onFileSelect, selectedFile }: FileTreeProps,
  ref: Ref<FileTreeHandle>,
) {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Record<string, FileEntry[]>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDir = useCallback(
    async (path: string) => {
      try {
        const result = await api.get<FileReadResult>(
          `/files?base=${base}&path=${encodeURIComponent(path)}`,
        );
        if (result.type === "directory" && result.entries) {
          if (path === "") {
            setRootEntries(result.entries);
            setError(null);
          } else {
            setDirContents((prev) => ({ ...prev, [path]: result.entries! }));
          }
        }
      } catch (err) {
        if (path === "") {
          setError(err instanceof Error ? err.message : "Failed to load files");
          setRootEntries([]);
        }
      }
    },
    [base],
  );

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setExpandedDirs(new Set());
    setDirContents({});
    await loadDir("");
    setLoading(false);
  }, [loadDir]);

  useState(() => {
    loadRoot();
  });

  useImperativeHandle(
    ref,
    () => ({
      refresh: () => {
        const expanded = new Set(expandedDirs);
        loadDir("").then(() => {
          for (const dir of expanded) {
            loadDir(dir);
          }
        });
      },
    }),
    [expandedDirs, loadDir],
  );

  const toggleDir = useCallback(
    (path: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          if (!dirContents[path]) loadDir(path);
        }
        return next;
      });
    },
    [dirContents, loadDir],
  );

  function renderEntries(entries: FileEntry[], depth = 0) {
    return sortEntries(entries).map((entry) => {
      const Icon =
        entry.type === "directory" ? Folder : getFileIcon(entry.name);
      return (
        <div key={entry.path}>
          <button
            onClick={() =>
              entry.type === "directory"
                ? toggleDir(entry.path)
                : onFileSelect(entry.path)
            }
            className={`flex items-center gap-1.5 w-full px-2 py-1 text-sm hover:bg-surface-hover rounded text-left ${
              selectedFile === entry.path
                ? "bg-accent/10 text-accent"
                : "text-text-secondary"
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            {entry.type === "directory" ? (
              <ChevronRight
                size={12}
                className={`shrink-0 transition-transform ${expandedDirs.has(entry.path) ? "rotate-90" : ""}`}
              />
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <Icon size={14} className="shrink-0" />
            <span className="truncate">{entry.name}</span>
          </button>
          {entry.type === "directory" &&
            expandedDirs.has(entry.path) &&
            dirContents[entry.path] &&
            renderEntries(dirContents[entry.path], depth + 1)}
        </div>
      );
    });
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-red-400">
        <AlertCircle size={14} />
        <span>{error}</span>
      </div>
    );
  }

  if (loading && rootEntries.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-text-muted">Loading...</div>
    );
  }

  return <div className="py-1">{renderEntries(rootEntries)}</div>;
});
