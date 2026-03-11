interface Props {
  url: string;
  filename: string;
  mimeType: string;
  className?: string;
}

export function AttachmentPreview({ url, filename, mimeType, className = "w-24 h-24" }: Props) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {mimeType.startsWith("image/") ? (
        <img src={url} alt={filename} className={`object-cover rounded border border-border hover:border-accent transition-colors ${className}`} />
      ) : (
        <video src={url} className={`object-cover rounded border border-border ${className}`} controls />
      )}
    </a>
  );
}
