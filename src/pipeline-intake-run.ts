import { runIntake } from "./pipeline-intake.js";
import { initTeams } from "./agents/teams-manager.js";
import { closePool } from "./database.js";

async function main(): Promise<number> {
  const pluginId = process.argv[2];
  if (!pluginId) {
    console.error("usage: pipeline-intake-run <plugin-id>");
    return 1;
  }

  await initTeams();

  const startedAt = new Date().toISOString();
  console.log(`[pipeline-intake] ${startedAt} — executando intake do plugin ${pluginId}`);

  try {
    const created = await runIntake(pluginId);
    console.log(`[pipeline-intake] concluído. ${created} card(s) criado(s).`);
    return 0;
  } catch (err) {
    console.error(`[pipeline-intake] erro: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

const code = await main().catch((err) => {
  console.error(`[pipeline-intake] falha: ${err instanceof Error ? err.message : String(err)}`);
  return 1;
});

await closePool().catch(() => {});
process.exit(code);
