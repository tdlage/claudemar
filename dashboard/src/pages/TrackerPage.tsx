import { useParams, useLocation } from "react-router-dom";
import { ProjectsList } from "../components/tracker/ProjectsList";
import { CyclesList } from "../components/tracker/CyclesList";
import { CycleBoard } from "../components/tracker/CycleBoard";
import { ItemDetail } from "../components/tracker/ItemDetail";
import { ProjectBoard } from "../components/tracker/ProjectBoard";

export function TrackerPage() {
  const { projectId, cycleId, itemId } = useParams();
  const location = useLocation();

  if (projectId && cycleId && itemId) return <ItemDetail projectId={projectId} cycleId={cycleId} itemId={itemId} />;
  if (projectId && cycleId) return <CycleBoard projectId={projectId} cycleId={cycleId} />;
  if (projectId && location.pathname.endsWith("/board")) return <ProjectBoard projectId={projectId} />;
  if (projectId) return <CyclesList projectId={projectId} />;
  return <ProjectsList />;
}
