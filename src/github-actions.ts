import { executeSpawn } from "./executor.js";

export interface WorkflowRun {
  id: number;
  name: string;
  displayTitle: string;
  headBranch: string;
  event: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  runNumber: number;
  workflowId: number;
  actor: string;
}

export interface Workflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

export interface WorkflowRunJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string;
  completedAt: string | null;
  steps: WorkflowRunStep[];
}

export interface WorkflowRunStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

function parseGhOwnerRepo(remoteUrl: string): string | null {
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  const sshMatch = remoteUrl.match(/github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  return null;
}

async function ghApi<T>(repoPath: string, endpoint: string, method = "GET", body?: Record<string, unknown>): Promise<T> {
  const args = ["api", endpoint, "--method", method];

  if (body) {
    for (const [key, value] of Object.entries(body)) {
      args.push("-f", `${key}=${String(value)}`);
    }
  }

  const { output, exitCode } = await executeSpawn("gh", args, repoPath, 30000);

  if (exitCode !== 0) {
    throw new Error(`gh api failed: ${output}`);
  }

  return JSON.parse(output) as T;
}

export async function listWorkflows(repoPath: string, remoteUrl: string): Promise<Workflow[]> {
  const ownerRepo = parseGhOwnerRepo(remoteUrl);
  if (!ownerRepo) throw new Error("Not a GitHub repository");

  const data = await ghApi<{ workflows: Workflow[] }>(
    repoPath,
    `/repos/${ownerRepo}/actions/workflows`,
  );

  return data.workflows
    .filter((w) => w.state === "active")
    .map((w) => ({
      id: w.id,
      name: w.name,
      path: w.path,
      state: w.state,
    }));
}

export async function listWorkflowRuns(
  repoPath: string,
  remoteUrl: string,
  branch?: string,
  workflowId?: number,
  perPage = 20,
): Promise<WorkflowRun[]> {
  const ownerRepo = parseGhOwnerRepo(remoteUrl);
  if (!ownerRepo) throw new Error("Not a GitHub repository");

  let endpoint: string;
  if (workflowId) {
    endpoint = `/repos/${ownerRepo}/actions/workflows/${workflowId}/runs?per_page=${perPage}`;
  } else {
    endpoint = `/repos/${ownerRepo}/actions/runs?per_page=${perPage}`;
  }

  if (branch) {
    endpoint += `&branch=${encodeURIComponent(branch)}`;
  }

  const data = await ghApi<{ workflow_runs: Array<Record<string, unknown>> }>(repoPath, endpoint);

  return data.workflow_runs.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    displayTitle: (r.display_title as string) || (r.name as string),
    headBranch: r.head_branch as string,
    event: r.event as string,
    status: r.status as string,
    conclusion: (r.conclusion as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    url: r.html_url as string,
    runNumber: r.run_number as number,
    workflowId: r.workflow_id as number,
    actor: (r.actor as Record<string, string>)?.login ?? "",
  }));
}

export async function getWorkflowRunJobs(
  repoPath: string,
  remoteUrl: string,
  runId: number,
): Promise<WorkflowRunJob[]> {
  const ownerRepo = parseGhOwnerRepo(remoteUrl);
  if (!ownerRepo) throw new Error("Not a GitHub repository");

  const data = await ghApi<{ jobs: Array<Record<string, unknown>> }>(
    repoPath,
    `/repos/${ownerRepo}/actions/runs/${runId}/jobs`,
  );

  return data.jobs.map((j) => ({
    id: j.id as number,
    name: j.name as string,
    status: j.status as string,
    conclusion: (j.conclusion as string | null) ?? null,
    startedAt: j.started_at as string,
    completedAt: (j.completed_at as string | null) ?? null,
    steps: ((j.steps as Array<Record<string, unknown>>) || []).map((s) => ({
      name: s.name as string,
      status: s.status as string,
      conclusion: (s.conclusion as string | null) ?? null,
      number: s.number as number,
    })),
  }));
}

export async function getWorkflowRunLogs(
  repoPath: string,
  remoteUrl: string,
  runId: number,
  jobName?: string,
): Promise<string> {
  const ownerRepo = parseGhOwnerRepo(remoteUrl);
  if (!ownerRepo) throw new Error("Not a GitHub repository");

  const args = ["run", "view", String(runId), "--repo", ownerRepo, "--log"];
  if (jobName) {
    args.push("--job", jobName);
  }

  const { output, exitCode } = await executeSpawn("gh", args, repoPath, 30000);

  if (exitCode !== 0) {
    throw new Error(`Failed to get logs: ${output}`);
  }

  return output;
}

export async function dispatchWorkflow(
  repoPath: string,
  remoteUrl: string,
  workflowId: string,
  ref: string,
  inputs?: Record<string, string>,
): Promise<void> {
  const ownerRepo = parseGhOwnerRepo(remoteUrl);
  if (!ownerRepo) throw new Error("Not a GitHub repository");

  const body: Record<string, unknown> = { ref };
  if (inputs && Object.keys(inputs).length > 0) {
    body.inputs = JSON.stringify(inputs);
  }

  const args = ["workflow", "run", workflowId, "--repo", ownerRepo, "--ref", ref];

  if (inputs) {
    for (const [key, value] of Object.entries(inputs)) {
      args.push("-f", `${key}=${value}`);
    }
  }

  const { output, exitCode } = await executeSpawn("gh", args, repoPath, 30000);

  if (exitCode !== 0) {
    throw new Error(`Failed to dispatch workflow: ${output}`);
  }
}

export async function rerunWorkflow(
  repoPath: string,
  remoteUrl: string,
  runId: number,
  failedOnly = false,
): Promise<void> {
  const ownerRepo = parseGhOwnerRepo(remoteUrl);
  if (!ownerRepo) throw new Error("Not a GitHub repository");

  const args = ["run", "rerun", String(runId), "--repo", ownerRepo];
  if (failedOnly) {
    args.push("--failed");
  }

  const { output, exitCode } = await executeSpawn("gh", args, repoPath, 30000);

  if (exitCode !== 0) {
    throw new Error(`Failed to rerun workflow: ${output}`);
  }
}

export async function cancelWorkflowRun(
  repoPath: string,
  remoteUrl: string,
  runId: number,
): Promise<void> {
  const ownerRepo = parseGhOwnerRepo(remoteUrl);
  if (!ownerRepo) throw new Error("Not a GitHub repository");

  const args = ["run", "cancel", String(runId), "--repo", ownerRepo];

  const { output, exitCode } = await executeSpawn("gh", args, repoPath, 30000);

  if (exitCode !== 0) {
    throw new Error(`Failed to cancel workflow: ${output}`);
  }
}
