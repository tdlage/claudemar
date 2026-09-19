import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowUpRight, Bot, Folder, Plus, Search, X } from "lucide-react";
import { api } from "../lib/api";
import type { AgentInfo, ProjectInfo } from "../lib/types";
import { isAdmin } from "../hooks/useAuth";
import { Button } from "../components/shared/Button";
import { Badge } from "../components/shared/Badge";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../components/shared/PageState";
import {
  WORKSPACES_CHANGED_EVENT,
  openCreateWorkspace,
} from "../lib/workspaceEvents";

export function WorkspacesPage() {
  const { kind } = useParams();
  const admin = isAdmin();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, a] = await Promise.all([
        api.get<ProjectInfo[]>("/projects"),
        api.get<AgentInfo[]>("/agents"),
      ]);
      setProjects(p);
      setAgents(a);
    } catch {
      setError("Não foi possível carregar seus espaços de trabalho.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    window.addEventListener(WORKSPACES_CHANGED_EVENT, load);
    return () => window.removeEventListener(WORKSPACES_CHANGED_EVENT, load);
  }, [load]);
  if (kind && kind !== "projects" && kind !== "agents")
    return <Navigate to="/workspaces" replace />;
  const all = [
    ...projects.map((p) => ({
      name: p.name,
      kind: "projects",
      detail: p.repoCount
        ? `${p.repoCount} ${p.repoCount === 1 ? "repositório" : "repositórios"}`
        : "Conversas e arquivos",
      changes: p.hasChanges,
      icon: Folder,
    })),
    ...agents.map((a) => ({
      name: a.name,
      kind: "agents",
      detail: "Assistente especializado",
      changes: false,
      icon: Bot,
    })),
  ]
    .filter((entry) => !kind || entry.kind === kind)
    .sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR", {
        numeric: true,
        sensitivity: "base",
      }),
    );
  const entries = all.filter((entry) =>
    entry.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const title =
    kind === "projects"
      ? "Projetos"
      : kind === "agents"
        ? "Agentes"
        : "Seus espaços";
  const noun = kind === "agents" ? "agente" : "projeto";
  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Workspace / {title}</p>
          <h1>
            {title}
            <span className="text-accent">.</span>
          </h1>
          <p className="page-description">
            {kind === "agents"
              ? "Um assistente para cada especialidade. Escolha com quem trabalhar."
              : "Suas ideias, conversas e arquivos. Tudo no lugar certo."}
          </p>
        </div>
        {admin && (
          <Button
            variant="success"
            onClick={() =>
              openCreateWorkspace(kind === "agents" ? "agents" : "projects")
            }
          >
            <Plus size={16} /> Novo {noun}
          </Button>
        )}
      </div>
      <div className="workspace-filter-bar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Buscar projetos e agentes"
            placeholder={`Buscar ${title.toLocaleLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="icon-button small"
              onClick={() => setSearch("")}
              aria-label="Limpar busca"
            >
              <X size={16} />
            </button>
          )}
        </label>
        <span role="status" className="text-xs text-text-muted">
          {loading
            ? "Carregando…"
            : error
              ? ""
              : `${entries.length} ${entries.length === 1 ? "espaço disponível" : "espaços disponíveis"}`}
        </span>
      </div>
      {loading ? (
        <LoadingState label="Carregando seus espaços…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : entries.length ? (
        <div className="workspace-card-grid">
          {entries.map(({ name, kind: type, detail, changes, icon: Icon }) => (
            <Link
              key={`${type}:${name}`}
              to={`/${type}/${encodeURIComponent(name)}`}
              className="workspace-card"
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`workspace-row-icon ${type === "agents" ? "agent" : ""}`}
                >
                  <Icon size={22} strokeWidth={1.6} />
                </span>
                <ArrowUpRight size={17} className="text-text-muted" />
              </div>
              <h2>{name}</h2>
              <p>{detail}</p>
              <div className="workspace-card-footer">
                <span>
                  {type === "agents" ? "Abrir conversa" : "Abrir projeto"}
                </span>
                {changes ? (
                  <Badge variant="warning">Alterações</Badge>
                ) : (
                  <span className="text-xs text-text-muted">
                    {type === "agents" ? "Agente" : "Projeto"}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="workspace-panel">
          <EmptyState
            icon={search ? Search : kind === "agents" ? Bot : Folder}
            title={
              search
                ? "Nenhum resultado encontrado"
                : `Seu primeiro ${noun} começa aqui`
            }
            description={
              search
                ? `Não encontramos espaços para “${search.trim()}”. Tente outro nome.`
                : admin
                  ? `Crie um ${noun} para organizar seu trabalho e começar uma conversa.`
                  : "Você ainda não tem acesso a espaços nesta categoria. Peça ao administrador para liberar seu acesso."
            }
            action={
              search ? (
                <Button variant="secondary" onClick={() => setSearch("")}>
                  Limpar busca
                </Button>
              ) : admin ? (
                <Button
                  variant="success"
                  onClick={() =>
                    openCreateWorkspace(
                      kind === "agents" ? "agents" : "projects",
                    )
                  }
                >
                  <Plus size={15} /> Criar {noun}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
