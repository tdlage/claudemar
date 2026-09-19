import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  Folder,
  Activity,
  ListTodo,
  Plus,
  ArrowRight,
  MessageSquare,
  Clock3,
} from "lucide-react";
import { api } from "../lib/api";
import { useMobile } from "../hooks/useMobile";
import { useExecutions } from "../hooks/useExecution";
import { ExecutionCard } from "../components/overview/ExecutionCard";
import { AgentStatusGrid } from "../components/overview/AgentStatusGrid";
import { ProjectStatusGrid } from "../components/overview/ProjectStatusGrid";
import { ActivityFeed } from "../components/overview/ActivityFeed";
import { QuickCommand } from "../components/overview/QuickCommand";
import { Terminal } from "../components/terminal/Terminal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
import { Modal } from "../components/shared/Modal";
import { Button } from "../components/shared/Button";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../components/shared/PageState";
import {
  WORKSPACES_CHANGED_EVENT,
  openCreateWorkspace,
} from "../lib/workspaceEvents";
import type { AgentInfo, ProjectInfo } from "../lib/types";

export function OverviewPage() {
  const mobile = useMobile();
  const {
    active,
    recent,
    queue,
    pendingQuestions,
    usageById,
    submitAnswer,
    loading: executionLoading,
    error: executionError,
    refresh: refreshExecutions,
  } = useExecutions();
  const recentWithUsage = recent.map((e) =>
    usageById[e.id] ? { ...e, liveUsage: usageById[e.id] } : e,
  );
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [viewingExecId, setViewingExecId] = useState<string | null>(null);
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({});
  const prevActiveCount = useRef(active.length);
  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        api.get<ProjectInfo[]>("/projects"),
        api.get<AgentInfo[]>("/agents"),
      ]);
      setProjects(p);
      setAgents(a);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
    api
      .get<Record<string, string>>("/executions/session-names")
      .then(setSessionNames)
      .catch(() => {});
  }, []);
  useEffect(() => {
    void load();
    window.addEventListener(WORKSPACES_CHANGED_EVENT, load);
    return () => window.removeEventListener(WORKSPACES_CHANGED_EVENT, load);
  }, [load]);
  useEffect(() => {
    if (prevActiveCount.current > 0 && active.length < prevActiveCount.current)
      void load();
    prevActiveCount.current = active.length;
  }, [active.length, load]);
  const stats = [
    {
      label: "Projetos",
      value: loading || error ? "—" : projects.length,
      icon: Folder,
      detail: "Espaços de trabalho",
      to: "/workspaces/projects",
      tone: "accent",
    },
    {
      label: "Agentes",
      value: loading || error ? "—" : agents.length,
      icon: Bot,
      detail: "Assistentes especializados",
      to: "/workspaces/agents",
      tone: "success",
    },
    {
      label: "Em execução",
      value: executionLoading || executionError ? "—" : active.length,
      icon: Activity,
      detail: executionLoading ? "Carregando…" : executionError ? "Status indisponível" : active.length
        ? "Trabalho em andamento"
        : "Nenhuma execução ativa",
      to: "#active-executions",
      tone: "warning",
    },
    {
      label: "Na fila",
      value: executionLoading || executionError ? "—" : queue.length,
      icon: ListTodo,
      detail: executionLoading ? "Carregando…" : executionError ? "Status indisponível" : queue.length ? "Aguardando execução" : "Nenhuma tarefa na fila",
      to: "#recent-activity",
      tone: "info",
    },
  ];
  const summary = (
    <div className="overview-stats">
      {stats.map(({ label, value, icon: Icon, detail, to, tone }) => (
        <Link
          key={label}
          to={to}
          onClick={
            to.startsWith("#")
              ? (event) => {
                  event.preventDefault();
                  document
                    .getElementById(to.slice(1))
                    ?.scrollIntoView({ block: "start" });
                }
              : undefined
          }
          className={`stat-card stat-${tone}`}
        >
          <div className="stat-label">
            <span>{label}</span>
            <Icon size={17} strokeWidth={1.6} />
          </div>
          <strong>{value}</strong>
          <div className="stat-detail">
            <span>{detail}</span>
            <ArrowUpRight size={14} />
          </div>
        </Link>
      ))}
    </div>
  );
  return (
    <div className="workspace-page overview-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Seu workspace, em um só lugar</p>
          <h1>
            Visão geral<span className="text-accent">.</span>
          </h1>
          <p className="page-description">Do que você quer cuidar hoje?</p>
        </div>
        <Button
          variant="success"
          onClick={() => openCreateWorkspace("projects")}
        >
          <Plus size={16} /> Novo projeto
        </Button>
      </div>
      {error && (
        <ErrorState
          message="Não foi possível atualizar seus projetos e agentes."
          onRetry={() => void load()}
        />
      )}
      {executionError && (
        <ErrorState
          message={executionError}
          onRetry={() => void refreshExecutions()}
        />
      )}
      {!mobile && summary}
      {pendingQuestions.length > 0 && (
        <section
          className="pending-questions"
          aria-label="Perguntas aguardando resposta"
        >
          <div className="section-heading">
            <h2>
              <MessageSquare size={18} /> Precisa da sua resposta
            </h2>
            <span className="count-label">{pendingQuestions.length}</span>
          </div>
          <p className="text-sm text-text-secondary mb-4">
            Responda para que o assistente possa continuar.
          </p>
          <div className="space-y-3">
            {pendingQuestions.map((pq) => (
              <QuestionPanel
                key={`${pq.execId}:${pq.question.toolUseId}`}
                execId={pq.execId}
                question={pq.question}
                runtime={pq.info.runtime}
                targetName={pq.info.targetName}
                onSubmit={submitAnswer}
              />
            ))}
          </div>
        </section>
      )}
      <section className="command-section" aria-labelledby="command-heading">
        <div className="section-heading">
          <h2 id="command-heading">
            <span className="text-accent" aria-hidden="true">
              &gt;_
            </span>{" "}
            Vamos começar
          </h2>
          <span className="eyebrow hidden sm:block">
            Uma ideia. O próximo passo.
          </span>
        </div>
        <QuickCommand />
      </section>
      {mobile && summary}
      <section
        id="active-executions"
        className={
          active.length ? "space-y-4 scroll-mt-6" : "idle-status scroll-mt-6"
        }
      >
        {executionLoading ? (
          <span role="status">Carregando execuções…</span>
        ) : executionError ? (
          <span>O status das execuções está indisponível.</span>
        ) : active.length ? (
          <>
            <div className="section-heading">
              <h2>
                <Activity size={18} className="text-warning" /> Em execução
              </h2>
              <span className="count-label">{active.length}</span>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {active.map((exec) => (
                <ExecutionCard
                  key={exec.id}
                  execution={exec}
                  onViewOutput={setViewingExecId}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <span className="status-dot bg-border-hover" />
            <span>
              Nenhuma execução em andamento. Inicie uma conversa quando quiser.
            </span>
          </>
        )}
      </section>
      <div className="overview-workspaces">
        <section className="workspace-panel">
          <div className="panel-heading">
            <h2>
              <Folder size={17} /> Projetos
            </h2>
            <Link to="/workspaces/projects" className="text-link">
              Ver todos <ArrowUpRight size={14} />
            </Link>
          </div>
          {loading ? (
            <LoadingState label="Carregando projetos…" />
          ) : error ? (
            <p className="p-5 text-sm text-text-secondary">
              Os projetos estão temporariamente indisponíveis.
            </p>
          ) : projects.length ? (
            <ProjectStatusGrid projects={projects.slice(0, 4)} />
          ) : (
            <EmptyState
              icon={Folder}
              title="Seu próximo projeto começa aqui"
              description="Organize conversas, arquivos e repositórios em um espaço próprio."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openCreateWorkspace("projects")}
                >
                  <Plus size={14} /> Criar projeto
                </Button>
              }
            />
          )}
        </section>
        <section className="workspace-panel">
          <div className="panel-heading">
            <h2>
              <Bot size={17} /> Agentes
            </h2>
            <Link to="/workspaces/agents" className="text-link">
              Ver todos <ArrowUpRight size={14} />
            </Link>
          </div>
          {loading ? (
            <LoadingState label="Carregando agentes…" />
          ) : error ? (
            <p className="p-5 text-sm text-text-secondary">
              Os agentes estão temporariamente indisponíveis.
            </p>
          ) : agents.length ? (
            <AgentStatusGrid agents={agents.slice(0, 4)} />
          ) : (
            <EmptyState
              icon={Bot}
              title="Dê uma especialidade ao seu assistente"
              description="Crie agentes com instruções próprias para trabalhos recorrentes."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openCreateWorkspace("agents")}
                >
                  <Plus size={14} /> Criar agente
                </Button>
              }
            />
          )}
        </section>
      </div>
      <section id="recent-activity" className="workspace-panel scroll-mt-6">
        <div className="panel-heading">
          <h2>
            <Clock3 size={17} /> Atividade recente
          </h2>
          <span className="eyebrow">Últimas execuções</span>
        </div>
        {executionLoading ? (
          <LoadingState label="Carregando atividade…" />
        ) : executionError && !recentWithUsage.length && !queue.length ? (
          <p className="p-6 text-sm text-text-secondary">
            O histórico está temporariamente indisponível.
          </p>
        ) : recentWithUsage.length || queue.length ? (
          <div className="activity-panel-body">
            <ActivityFeed
              executions={recentWithUsage}
              queue={queue}
              sessionNames={sessionNames}
            />
          </div>
        ) : (
          <EmptyState
            icon={MessageSquare}
            title="Uma página em branco, muitas possibilidades"
            description="Suas conversas e execuções aparecerão aqui. Comece contando ao assistente o que você precisa."
            action={
              <Link className="text-link" to="/orchestrator">
                Abrir uma conversa <ArrowRight size={15} />
              </Link>
            }
          />
        )}
      </section>
      <p className="workspace-footnote">
        Claudemar <span aria-hidden="true">/</span> Um espaço para ideias
        virarem trabalho.
      </p>
      <Modal
        open={!!viewingExecId}
        onClose={() => setViewingExecId(null)}
        title="Saída da execução"
        size="xl"
      >
        <div className="h-[min(60dvh,500px)]">
          <Terminal executionId={viewingExecId} />
        </div>
      </Modal>
    </div>
  );
}
