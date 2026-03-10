import { useParams } from "react-router-dom";
import { ProjectsList } from "../components/tracker/ProjectsList";
import { CyclesList } from "../components/tracker/CyclesList";
import { CycleBoard } from "../components/tracker/CycleBoard";
import { BetDetail } from "../components/tracker/BetDetail";

export function TrackerPage() {
  const { projectId, cycleId, betId } = useParams();

  if (projectId && cycleId && betId) return <BetDetail projectId={projectId} cycleId={cycleId} betId={betId} />;
  if (projectId && cycleId) return <CycleBoard projectId={projectId} cycleId={cycleId} />;
  if (projectId) return <CyclesList projectId={projectId} />;
  return <ProjectsList />;
}
