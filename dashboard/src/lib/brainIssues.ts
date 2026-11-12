import type { BrainConnectionIssue } from "./types";

export function brainIssuesTitle(issues: BrainConnectionIssue[]): string {
  return issues.map((issue) => `${issue.account}: ${issue.message}`).join("\n");
}
