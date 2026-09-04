import { existsSync } from "node:fs";
import { config } from "./config.js";
import { executionManager, type ExecutionInfo } from "./execution-manager.js";
import { getScheduleById } from "./agents/scheduler.js";
import { getAgentPaths } from "./agents/manager.js";
import { closePool } from "./database.js";

async function main(): Promise<number> {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: schedule-run <schedule-id>");
    return 1;
  }

  const schedule = await getScheduleById(id);
  if (!schedule) {
    console.error(`[schedule-run] agendamento ${id} não encontrado`);
    return 1;
  }

  const paths = getAgentPaths(schedule.agent);
  if (!paths || !existsSync(paths.root)) {
    console.error(`[schedule-run] agente "${schedule.agent}" não encontrado`);
    return 1;
  }

  const startedAt = new Date().toISOString();
  console.log(`[schedule-run] ${startedAt} — executando agendamento ${id} (agente "${schedule.agent}")`);

  const execId = executionManager.startExecution({
    source: "schedule",
    targetType: "agent",
    targetName: schedule.agent,
    prompt: schedule.prompt,
    cwd: paths.root,
    autoApprove: true,
    noResume: true,
    timeoutMs: config.agentTimeoutMs,
  });

  const info = await new Promise<ExecutionInfo>((resolve) => {
    const onComplete = (eid: string, i: ExecutionInfo) => {
      if (eid !== execId) return;
      cleanup();
      resolve(i);
    };
    const onError = (eid: string, i: ExecutionInfo) => {
      if (eid !== execId) return;
      cleanup();
      resolve(i);
    };
    const cleanup = () => {
      executionManager.off("complete", onComplete);
      executionManager.off("error", onError);
    };
    executionManager.on("complete", onComplete);
    executionManager.on("error", onError);
  });

  if (info.status === "error") {
    console.error(`[schedule-run] erro: ${info.error ?? "desconhecido"}`);
    return 1;
  }

  console.log(`[schedule-run] concluído. Saída:\n${info.output || "(sem saída)"}`);
  return 0;
}

const code = await main().catch((err) => {
  console.error(`[schedule-run] falha: ${err instanceof Error ? err.message : String(err)}`);
  return 1;
});

await closePool().catch(() => {});
process.exit(code);
