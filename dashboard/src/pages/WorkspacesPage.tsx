import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Bot, ChevronRight, Folder, Search } from "lucide-react";
import { api } from "../lib/api";
import type { AgentInfo, ProjectInfo } from "../lib/types";
import { Button } from "../components/shared/Button";

export function WorkspacesPage() {
  const { kind } = useParams();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, a] = await Promise.all([api.get<ProjectInfo[]>("/projects"), api.get<AgentInfo[]>("/agents")]);
      setProjects(p);
      setAgents(a);
    } catch { setError("Não foi possível carregar seus espaços."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const entries = [
    ...projects.map((p) => ({ name: p.name, kind: "projects", detail: `${p.repoCount ?? 0} repositórios`, icon: Folder })),
    ...agents.map((a) => ({ name: a.name, kind: "agents", detail: "Conversar com o agente", icon: Bot })),
  ].filter((e) => (!kind || e.kind === kind) && e.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">{kind === "projects" ? "Projetos" : kind === "agents" ? "Agentes" : "Seus espaços"}</h1>
        <p className="text-sm text-text-secondary mt-1">Escolha onde continuar seu trabalho.</p></div>
      <label className="flex items-center gap-3 rounded-xl bg-surface border border-border px-3">
        <Search size={19} className="text-text-muted shrink-0" />
        <input aria-label="Buscar projetos e agentes" placeholder="Buscar pelo nome" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full min-w-0 bg-transparent py-3 outline-none text-base" />
      </label>
      {loading ? <p role="status" className="text-text-secondary py-8">Carregando seus espaços…</p> : error ? <div role="alert" className="space-y-3"><p>{error}</p><Button onClick={() => void load()}>Tentar novamente</Button></div> : (
        <div className="space-y-2">
          {entries.map(({ name, kind: type, detail, icon: Icon }) => (
            <Link key={`${type}:${name}`} to={`/${type}/${encodeURIComponent(name)}`} className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 active:bg-surface-hover hover:border-border-hover transition-colors">
              <span className="rounded-xl bg-accent/10 text-accent p-3"><Icon size={22} /></span>
              <span className="min-w-0 flex-1"><span className="block font-medium break-words">{name}</span><span className="block mt-1 text-sm text-text-secondary">{detail}</span></span>
              <ChevronRight size={18} className="shrink-0 text-text-muted" />
            </Link>
          ))}
          {!entries.length && <p className="py-8 text-center text-text-secondary">{search ? "Nenhum resultado para essa busca." : "Nenhum espaço disponível nesta categoria."}</p>}
        </div>
      )}
    </div>
  );
}
