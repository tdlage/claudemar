import { useNavigate } from "react-router-dom";
import { FolderGit2 } from "lucide-react";
import { Card } from "../shared/Card";
import type { ProjectInfo } from "../../lib/types";

interface ProjectStatusGridProps {
  projects: ProjectInfo[];
}

export function ProjectStatusGrid({ projects }: ProjectStatusGridProps) {
  const navigate = useNavigate();

  if (projects.length === 0) {
    return <p className="text-sm text-text-muted">No projects configured.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {projects.map((project) => (
        <Card key={project.name} onClick={() => navigate(`/projects/${project.name}`)}>
          <div className="flex items-center gap-2">
            <FolderGit2 size={16} className="text-accent" />
            <span className="text-sm font-medium">{project.name}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}
