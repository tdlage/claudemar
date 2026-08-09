import { useTenants } from "../../hooks/useBrain";

export function TenantSelect({
  value,
  onChange,
  allowAll = false,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  allowAll?: boolean;
  className?: string;
}) {
  const { tenants } = useTenants();
  const known = tenants.some((t) => t.id === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {allowAll && <option value="">todos os contextos</option>}
      {!known && value && <option value={value}>{value}</option>}
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
