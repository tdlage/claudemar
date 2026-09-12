import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { MarkdownViewer } from "./MarkdownViewer";

interface FilePreviewModalProps {
  onClose: () => void;
  fileName: string;
  url: string;
  size: number;
}

type Preview = { type: "text" | "markdown"; content: string } | { type: "image"; url: string };
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp" };

export function FilePreviewModal({ onClose, fileName, url, size }: FilePreviewModalProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let objectUrl: string | undefined;
    setPreview(null);
    setError(null);
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    const imageType = IMAGE_TYPES[extension];
    const maxSize = (imageType ? 10 : 2) * 1024 * 1024;
    const tooLarge = `Preview limited to ${imageType ? 10 : 2}MB. Use Download to open the full file.`;

    const load = async () => {
      if (size > maxSize) throw new Error(tooLarge);
      const token = localStorage.getItem("dashboard_token") || "";
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 ? "File not found." : "Failed to load preview.");
      if (Number(response.headers.get("Content-Length")) > maxSize) {
        controller.abort();
        throw new Error(tooLarge);
      }
      const blob = await response.blob();
      if (cancelled) return;
      if (blob.size > maxSize) throw new Error(tooLarge);
      if (imageType) {
        objectUrl = URL.createObjectURL(new Blob([blob], { type: imageType }));
        setPreview({ type: "image", url: objectUrl });
        return;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (cancelled) return;
      let content: string;
      try {
        if (bytes.includes(0)) throw new Error();
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error("Preview unavailable for this file format. Use Download to open it.");
      }
      setPreview({ type: /^(md|markdown|mdown|mdx)$/.test(extension) ? "markdown" : "text", content });
    };
    void load().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load preview.");
    });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileName, url, size]);

  return (
    <Modal open onClose={onClose} title={fileName} size="xl">
      {!preview && !error && <div role="status" className="flex items-center justify-center gap-2 py-12 text-text-muted"><Loader2 size={20} className="animate-spin" /> Loading preview...</div>}
      {error && <p role="alert" className="text-sm text-text-muted">{error}</p>}
      {!error && preview?.type === "image" && <img src={preview.url} alt={fileName} className="max-w-full max-h-[65vh] mx-auto object-contain" onError={() => setError("Unable to display this image. Use Download to open it.")} />}
      {!error && preview && preview.type !== "image" && (
        preview.content === "" ? <p className="text-sm text-text-muted">Empty file.</p>
          : preview.type === "markdown" ? <MarkdownViewer content={preview.content} />
            : <pre className="text-sm font-mono text-text-primary whitespace-pre-wrap break-words">{preview.content}</pre>
      )}
    </Modal>
  );
}
