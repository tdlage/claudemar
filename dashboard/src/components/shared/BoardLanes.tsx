import { Children, useState, type ReactNode } from "react";
import { useMobile } from "../../hooks/useMobile";

interface Props {
  lanes: { id: string; label: string; count: number }[];
  children: ReactNode;
}

export function BoardLanes({ lanes, children }: Props) {
  const mobile = useMobile();
  const [selected, setSelected] = useState<string | null>(null);
  const active = lanes.find((lane) => lane.id === selected) ?? lanes.find((lane) => lane.count > 0) ?? lanes[0];
  const index = lanes.findIndex((lane) => lane.id === active?.id);

  return <div className="space-y-3 min-w-0">
    {mobile && lanes.length > 0 && <label className="flex flex-col gap-2 text-sm text-text-secondary">
      Etapa · {lanes.reduce((total, lane) => total + lane.count, 0)} itens no quadro
      <select value={active?.id ?? ""} onChange={(event) => setSelected(event.target.value)} className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-text-primary">
        {lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.label} ({lane.count})</option>)}
      </select>
    </label>}
    <div className="board-lanes flex gap-3 overflow-x-auto pb-4">
      {mobile ? Children.toArray(children)[index] : children}
    </div>
    {mobile && active?.count === 0 && <p className="text-sm text-text-muted py-4 text-center">Nenhum item nesta etapa.</p>}
  </div>;
}
