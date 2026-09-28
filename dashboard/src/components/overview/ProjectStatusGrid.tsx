import { Link } from "react-router-dom";
import { FolderGit2, ArrowUpRight } from "lucide-react";
import { Badge } from "../shared/Badge";
import type { ProjectInfo } from "../../lib/types";
import { usePendingQuestionTargets } from "../../hooks/usePendingQuestionTargets";
import { NeedsAnswerBadge } from "../shared/NeedsAnswerBadge";

export function ProjectStatusGrid({ projects }: { projects: ProjectInfo[] }) {
  const pending = usePendingQuestionTargets();
  if (!projects.length)
    return (
      <p className="p-4 text-sm text-text-muted">Nenhum projeto criado.</p>
    );
  return (
    <div className="workspace-rows">
      {projects.map((project) => (
        <Link
          key={project.name}
          className={`workspace-row ${pending.has(`project:${project.name}`) ? "needs-answer" : ""}`}
          to={`/projects/${encodeURIComponent(project.name)}`}
        >
          <span className="workspace-row-icon">
            <FolderGit2 size={20} strokeWidth={1.6} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-sm">
              {project.name}
            </span>
            <span className="block mt-1 text-xs text-text-secondary">
              {project.repoCount
                ? `${project.repoCount} ${project.repoCount === 1 ? "repositório" : "repositórios"}`
                : "Conversas e arquivos do projeto"}
            </span>
          </span>
          {pending.has(`project:${project.name}`) && <NeedsAnswerBadge />}
          {project.hasChanges && <Badge variant="warning">Alterações</Badge>}
          <ArrowUpRight size={16} className="text-text-muted shrink-0" />
        </Link>
      ))}
    </div>
  );
}
