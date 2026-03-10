import { useParams } from "react-router-dom";
import { CyclesList } from "../components/tracker/CyclesList";
import { CycleBoard } from "../components/tracker/CycleBoard";
import { BetDetail } from "../components/tracker/BetDetail";

export function TrackerPage() {
  const { cycleId, betId } = useParams();

  if (cycleId && betId) return <BetDetail cycleId={cycleId} betId={betId} />;
  if (cycleId) return <CycleBoard cycleId={cycleId} />;
  return <CyclesList />;
}
