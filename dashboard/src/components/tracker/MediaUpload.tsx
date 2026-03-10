import { useState, useRef, useCallback } from "react";
import { Upload, X, Film, Image as ImageIcon } from "lucide-react";

export interface MediaFile {
  base64: string;
  filename: string;
  mimeType: string;
  preview?: string;
  size: number;
}

interface Props {
  files: MediaFile[];
  onChange: (files: MediaFile[]) => void;
  acceptVideo?: boolean;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function MediaUpload({ files, onChange, acceptVideo = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const allowedTypes = acceptVideo ? [...IMAGE_TYPES, ...VIDEO_TYPES] : IMAGE_TYPES;

  const processFile = useCallback(
    (file: File): Promise<MediaFile | null> => {
      return new Promise((resolve) => {
        if (!allowedTypes.includes(file.type)) {
          resolve(null);
          return;
        }
        const maxSize = VIDEO_TYPES.includes(file.type) ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
        if (file.size > maxSize) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          const preview = IMAGE_TYPES.includes(file.type) ? (reader.result as string) : undefined;
          resolve({ base64, filename: file.name, mimeType: file.type, preview, size: file.size });
        };
        reader.readAsDataURL(file);
      });
    },
    [allowedTypes],
  );

  const addFiles = useCallback(
    async (fileList: FileList) => {
      const results = await Promise.all(Array.from(fileList).map(processFile));
      const valid = results.filter((r): r is MediaFile => r !== null);
      if (valid.length > 0) onChange([...files, ...valid]);
    },
    [files, onChange, processFile],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const fileList: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) fileList.push(f);
        }
      }
      if (fileList.length > 0) {
        const dt = new DataTransfer();
        fileList.forEach((f) => dt.items.add(f));
        addFiles(dt.files);
      }
    },
    [addFiles],
  );

  const remove = (index: number) => {
    onChange(files.filter((_, i) => i !== index));
  };

  const accept = allowedTypes.join(",");

  return (
    <div onPaste={handlePaste}>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          dragOver ? "border-accent bg-accent/5" : "border-border hover:border-accent/40"
        }`}
      >
        <Upload size={20} className="mx-auto text-text-muted mb-1" />
        <p className="text-xs text-text-muted">
          Drop files, paste, or click to upload
        </p>
        <p className="text-[10px] text-text-muted mt-0.5">
          Images {acceptVideo ? "& videos " : ""}— max {acceptVideo ? "10MB img / 100MB video" : "10MB"}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          onChange={(e) => e.target.files && addFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {files.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-2">
          {files.map((f, i) => (
            <div key={i} className="relative group">
              {f.preview ? (
                <img src={f.preview} alt={f.filename} className="w-16 h-16 object-cover rounded border border-border" />
              ) : (
                <div className="w-16 h-16 rounded border border-border bg-bg flex flex-col items-center justify-center">
                  {VIDEO_TYPES.includes(f.mimeType) ? <Film size={16} className="text-text-muted" /> : <ImageIcon size={16} className="text-text-muted" />}
                  <span className="text-[8px] text-text-muted mt-0.5 truncate max-w-[56px]">{f.filename}</span>
                  <span className="text-[8px] text-text-muted">{formatSize(f.size)}</span>
                </div>
              )}
              <button
                onClick={() => remove(i)}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-danger text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
