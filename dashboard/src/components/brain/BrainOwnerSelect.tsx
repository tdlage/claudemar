import { useNavigate } from "react-router-dom";
import { useBrainOwners } from "../../hooks/useBrain";

const selectClass =
  "bg-bg border border-border rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent max-w-[16rem]";

/** Só para o admin: escolhe entre o próprio brain (completo) e a visão técnica do brain de um usuário. */
export function BrainOwnerSelect({ current }: { current: string }) {
  const navigate = useNavigate();
  const { owners } = useBrainOwners(true);

  return (
    <label className="flex items-center gap-2 text-xs text-text-muted">
      Brain
      <select
        value={current}
        onChange={(e) => navigate(e.target.value === "admin" ? "/second-brain" : `/second-brain/usuarios/${e.target.value}`)}
        className={selectClass}
        aria-label="Escolher o brain"
      >
        <option value="admin">Meu brain</option>
        {owners
          .filter((owner) => owner.owner !== "admin")
          .map((owner) => (
            <option key={owner.owner} value={owner.owner}>
              {owner.name}
              {!owner.initialized ? " — não iniciado" : owner.issues > 0 ? ` — ${owner.issues} conexão(ões) com problema` : ""}
            </option>
          ))}
      </select>
    </label>
  );
}
