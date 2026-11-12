import { TriangleAlert } from "lucide-react";
import { brainIssuesTitle } from "../../lib/brainIssues";
import type { BrainConnectionIssue } from "../../lib/types";

export function BrainAlertBadge({ issues }: { issues: BrainConnectionIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <span className="brain-alert-badge" role="status" title={brainIssuesTitle(issues)}>
      <TriangleAlert size={11} aria-hidden="true" />
      {issues.length}
    </span>
  );
}
