import { useParams } from "react-router-dom";
import { ProjectsList } from "../components/tracker/ProjectsList";
import { CyclesList } from "../components/tracker/CyclesList";
import { CycleBoard } from "../components/tracker/CycleBoard";
import { ItemDetail } from "../components/tracker/ItemDetail";

export function TrackerPage() {
  const { projectId, cycleId, itemId } = useParams();

  if (projectId && cycleId && itemId) return <ItemDetail projectId={projectId} cycleId={cycleId} itemId={itemId} />;
  if (projectId && cycleId) return <CycleBoard projectId={projectId} cycleId={cycleId} />;
  if (projectId) return <CyclesList projectId={projectId} />;
  return <ProjectsList />;
}
