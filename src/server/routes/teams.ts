import { Router } from "express";
import { isValidAgentName, listAgents } from "../../agents/manager.js";
import {
  listTeams, getTeam, createTeam, updateTeam, deleteTeam,
  listTeamMembers, setAgentTeam, removeAgentFromTeam,
  getAllAppearances, getAppearance, setAppearance, getTeamOfAgent,
  listSquadMcps, addSquadMcp, removeSquadMcp, listSquadSkills, setSquadSkills,
} from "../../agents/teams-manager.js";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

const RESERVED_MCP_NAMES = new Set(["memory", "scheduler"]);

function stringRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

function validateMcpConfig(raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const type = typeof c.type === "string" ? c.type : "stdio";
  if (type === "http" || type === "sse") {
    if (typeof c.url !== "string" || !c.url.trim()) return null;
    const cfg: Record<string, unknown> = { type, url: c.url };
    const headers = stringRecord(c.headers);
    if (Object.keys(headers).length) cfg.headers = headers;
    return cfg as McpServerConfig;
  }
  if (typeof c.command !== "string" || !c.command.trim()) return null;
  const cfg: Record<string, unknown> = { type: "stdio", command: c.command };
  if (Array.isArray(c.args)) cfg.args = c.args.filter((a) => typeof a === "string");
  const env = stringRecord(c.env);
  if (Object.keys(env).length) cfg.env = env;
  return cfg as McpServerConfig;
}

// Mounted behind requireAdmin (server/index.ts): the whole router is admin-only.
export const teamsRouter = Router();

teamsRouter.get("/", async (_req, res) => {
  res.json(await listTeams());
});

teamsRouter.get("/overview", async (_req, res) => {
  const teams = await listTeams();
  const withMembers = await Promise.all(
    teams.map(async (team) => ({ ...team, members: await listTeamMembers(team.id) })),
  );
  const inTeam = new Set(withMembers.flatMap((t) => t.members.map((m) => m.agentName)));
  const loose = listAgents().filter((name) => !inTeam.has(name));
  const appearances = await getAllAppearances();
  res.json({ teams: withMembers, loose, appearances });
});

teamsRouter.get("/appearances", async (_req, res) => {
  res.json(await getAllAppearances());
});

teamsRouter.get("/appearance/:agent", async (req, res) => {
  if (!isValidAgentName(req.params.agent)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }
  res.json(await getAppearance(req.params.agent));
});

teamsRouter.put("/appearance/:agent", async (req, res) => {
  const { agent } = req.params;
  if (!isValidAgentName(agent)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }
  const { color, emoji } = req.body ?? {};
  await setAppearance(agent, { color: color ?? null, emoji: emoji ?? null });
  res.json({ ok: true });
});

teamsRouter.post("/", async (req, res) => {
  const { name, description, color, emoji } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name required" });
    return;
  }
  try {
    const team = await createTeam({ name: name.trim(), description, color, emoji });
    res.status(201).json(team);
  } catch (err) {
    const message = err instanceof Error && err.message.includes("Duplicate") ? "Team name already exists" : "Failed to create team";
    res.status(409).json({ error: message });
  }
});

teamsRouter.get("/:id", async (req, res) => {
  const team = await getTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const members = await listTeamMembers(team.id);
  res.json({ ...team, members });
});

teamsRouter.put("/:id", async (req, res) => {
  const team = await getTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const { name, description, color, emoji } = req.body ?? {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    res.status(400).json({ error: "name required" });
    return;
  }
  const updated = await updateTeam(req.params.id, { name: name !== undefined ? name.trim() : undefined, description, color, emoji });
  res.json(updated);
});

teamsRouter.delete("/:id", async (req, res) => {
  const team = await getTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  await deleteTeam(req.params.id);
  res.json({ removed: req.params.id });
});

teamsRouter.put("/:id/members/:agent", async (req, res) => {
  const { id, agent } = req.params;
  if (!isValidAgentName(agent) || !listAgents().includes(agent)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  if (!(await getTeam(id))) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const role = req.body?.role === "lead" ? "lead" : "member";
  await setAgentTeam(agent, id, role);
  res.json({ ok: true });
});

teamsRouter.delete("/:id/members/:agent", async (req, res) => {
  const { id, agent } = req.params;
  if (getTeamOfAgent(agent) !== id) {
    res.status(404).json({ error: "Agent is not a member of this team" });
    return;
  }
  await removeAgentFromTeam(agent);
  res.json({ ok: true });
});

teamsRouter.get("/:id/mcps", async (req, res) => {
  if (!(await getTeam(req.params.id))) { res.status(404).json({ error: "Team not found" }); return; }
  res.json(listSquadMcps(req.params.id));
});

teamsRouter.post("/:id/mcps", async (req, res) => {
  if (!(await getTeam(req.params.id))) { res.status(404).json({ error: "Team not found" }); return; }
  const { name, config } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim() || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    res.status(400).json({ error: "name inválido (use letras, números, . _ -)" });
    return;
  }
  if (RESERVED_MCP_NAMES.has(name.trim())) {
    res.status(400).json({ error: `"${name.trim()}" é um nome reservado do sistema` });
    return;
  }
  const valid = validateMcpConfig(config);
  if (!valid) { res.status(400).json({ error: "config MCP inválida (stdio: command; http/sse: url)" }); return; }
  try {
    const item = await addSquadMcp(req.params.id, name.trim(), valid);
    res.status(201).json(item);
  } catch {
    res.status(409).json({ error: "Já existe um MCP com esse nome nesse squad" });
  }
});

teamsRouter.delete("/:id/mcps/:mcpId", async (req, res) => {
  await removeSquadMcp(req.params.mcpId);
  res.json({ ok: true });
});

teamsRouter.get("/:id/skills", async (req, res) => {
  if (!(await getTeam(req.params.id))) { res.status(404).json({ error: "Team not found" }); return; }
  res.json(listSquadSkills(req.params.id));
});

teamsRouter.put("/:id/skills", async (req, res) => {
  if (!(await getTeam(req.params.id))) { res.status(404).json({ error: "Team not found" }); return; }
  const { skills } = req.body ?? {};
  if (!Array.isArray(skills)) { res.status(400).json({ error: "skills deve ser um array" }); return; }
  await setSquadSkills(req.params.id, skills);
  res.json({ ok: true });
});
