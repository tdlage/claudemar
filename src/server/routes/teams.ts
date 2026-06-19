import { Router } from "express";
import { isValidAgentName, listAgents } from "../../agents/manager.js";
import {
  listTeams, getTeam, createTeam, updateTeam, deleteTeam,
  listTeamMembers, setAgentTeam, removeAgentFromTeam,
  getAllAppearances, setAppearance, getTeamOfAgent,
} from "../../agents/teams-manager.js";

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
