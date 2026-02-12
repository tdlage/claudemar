import { useState, useEffect } from "react";
import { GitCommitHorizontal } from "lucide-react";
import { api } from "../lib/api";
import { Badge } from "../components/shared/Badge";

interface ChangelogEntry {
  hash: string;
  date: string;
  subject: string;
  body: string;
}

export function ChangelogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<ChangelogEntry[]>("/system/changelog?limit=100")
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-sm text-text-muted">Loading changelog...</p>;
  }

  if (entries.length === 0) {
    return <p className="text-sm text-text-muted">No changelog entries found.</p>;
  }

  const grouped: Record<string, ChangelogEntry[]> = {};
  for (const entry of entries) {
    const day = entry.date.slice(0, 10);
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(entry);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Changelog</h1>

      {Object.entries(grouped).map(([day, dayEntries]) => (
        <div key={day}>
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
            {new Date(day + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </h2>
          <div className="space-y-1">
            {dayEntries.map((entry) => (
              <div
                key={entry.hash}
                className="flex items-start gap-3 px-4 py-2.5 rounded-md hover:bg-surface-hover transition-colors"
              >
                <GitCommitHorizontal size={16} className="text-accent mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-primary">{entry.subject}</p>
                  {entry.body && (
                    <p className="text-xs text-text-muted mt-0.5 whitespace-pre-wrap">{entry.body}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="default">
                    {entry.hash.slice(0, 7)}
                  </Badge>
                  <span className="text-xs text-text-muted whitespace-nowrap">
                    {new Date(entry.date).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
