import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import { config } from "../../config.js";
import { ciEventManager, type CIWorkflowRunEvent } from "../../ci-events.js";
import { pipelineEventManager } from "../../pipeline-events.js";

export const webhooksRouter = Router();

function verifyGithubSignature(payload: Buffer, signature: string | undefined): boolean {
  if (!config.githubWebhookSecret) return true;
  if (!signature) return false;

  const expected = `sha256=${createHmac("sha256", config.githubWebhookSecret).update(payload).digest("hex")}`;

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

webhooksRouter.post("/github", (req: Request, res: Response) => {
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const rawBody = req.body as Buffer;

  if (!verifyGithubSignature(rawBody, signature)) {
    res.status(403).json({ error: "Invalid signature" });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const eventType = req.headers["x-github-event"] as string;

  if (eventType === "workflow_run") {
    const action = payload.action as string;
    const workflowRun = payload.workflow_run as Record<string, unknown>;
    const repository = payload.repository as Record<string, unknown>;

    if (!workflowRun || !repository) {
      res.status(400).json({ error: "Missing workflow_run or repository" });
      return;
    }

    const repoFullName = repository.full_name as string;
    const [owner, repo] = repoFullName.split("/");

    const event: CIWorkflowRunEvent = {
      action,
      owner,
      repo,
      repoFullName,
      runId: workflowRun.id as number,
      runNumber: workflowRun.run_number as number,
      name: workflowRun.name as string,
      displayTitle: (workflowRun.display_title as string) || (workflowRun.name as string),
      headBranch: workflowRun.head_branch as string,
      event: workflowRun.event as string,
      status: workflowRun.status as string,
      conclusion: (workflowRun.conclusion as string | null) ?? null,
      url: workflowRun.html_url as string,
      actor: ((workflowRun.actor as Record<string, string>)?.login) ?? "",
      createdAt: workflowRun.created_at as string,
      updatedAt: workflowRun.updated_at as string,
    };

    ciEventManager.emitWorkflowRun(event);
    console.log(`[webhook] workflow_run ${action}: ${repoFullName} — ${event.name} #${event.runNumber} (${event.conclusion || event.status})`);
  }

  if (eventType === "pull_request_review" && payload.action === "submitted") {
    const review = payload.review as Record<string, unknown> | undefined;
    const pr = payload.pull_request as Record<string, unknown> | undefined;
    const repository = payload.repository as Record<string, unknown> | undefined;
    const reviewer = review?.user as Record<string, unknown> | undefined;
    if (review && pr && repository && typeof pr.number === "number" && reviewer?.type !== "Bot" && String(review.state).toLowerCase() === "changes_requested") {
      pipelineEventManager.emitPrFeedback({
        repoFullName: repository.full_name as string,
        prNumber: pr.number,
        prUrl: pr.html_url as string,
        body: (review.body as string) || "(mudanças solicitadas no review)",
        author: (reviewer?.login as string) ?? "",
      });
    }
  }

  if (eventType === "issue_comment" && payload.action === "created") {
    const issue = payload.issue as Record<string, unknown> | undefined;
    const comment = payload.comment as Record<string, unknown> | undefined;
    const repository = payload.repository as Record<string, unknown> | undefined;
    const commenter = comment?.user as Record<string, unknown> | undefined;
    // Comentário simples só retroalimenta se mencionar @claudemar, para evitar que
    // um "LGTM"/"obrigado" reinicie todo o pipeline. Reviews "changes_requested" sempre retroalimentam.
    const triggered = typeof comment?.body === "string" && comment.body.toLowerCase().includes("@claudemar");
    if (triggered && issue?.pull_request && comment && repository && typeof issue.number === "number" && commenter?.type !== "Bot") {
      const prRef = issue.pull_request as Record<string, string>;
      pipelineEventManager.emitPrFeedback({
        repoFullName: repository.full_name as string,
        prNumber: issue.number,
        prUrl: prRef.html_url || (issue.html_url as string),
        body: (comment.body as string) || "",
        author: (commenter?.login as string) ?? "",
      });
    }
  }

  if (eventType === "pull_request" && (payload.action === "closed" || payload.action === "reopened")) {
    const pr = payload.pull_request as Record<string, unknown> | undefined;
    const repository = payload.repository as Record<string, unknown> | undefined;
    if (pr && repository && typeof pr.number === "number") {
      const base = { repoFullName: repository.full_name as string, prNumber: pr.number, prUrl: pr.html_url as string };
      if (payload.action === "reopened") pipelineEventManager.emitPrReopened(base);
      else pipelineEventManager.emitPrClosed({ ...base, merged: pr.merged === true });
    }
  }

  res.json({ received: true });
});
