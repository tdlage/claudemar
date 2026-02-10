import { Card } from "../shared/Card";
import type { GitCommit } from "../../lib/types";

interface GitLogProps {
  commits: GitCommit[];
}

export function GitLog({ commits }: GitLogProps) {
  if (commits.length === 0) {
    return <p className="text-sm text-text-muted">No git history available.</p>;
  }

  return (
    <div className="space-y-1">
      {commits.map((commit) => (
        <Card key={commit.hash} className="py-2">
          <div className="flex items-center gap-3">
            <code className="text-xs text-accent font-mono">{commit.hash?.slice(0, 7)}</code>
            <span className="text-sm text-text-primary flex-1 truncate">{commit.message}</span>
            <span className="text-xs text-text-muted">{commit.author}</span>
            <span className="text-xs text-text-muted">{commit.date?.slice(0, 10)}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}
