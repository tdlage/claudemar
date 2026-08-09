import { QuarantineList } from "./QuarantineList";
import { QuarantineDetail } from "./QuarantineDetail";
import { OpenLoopsTable } from "./OpenLoopsTable";
import { DigestSection } from "./DigestSection";
import { LintSection } from "./LintSection";

export function StateTab({ splat }: { splat: string }) {
  const parts = splat.split("/").filter(Boolean);
  if (parts[0] === "quarantine" && parts[1]) {
    return <QuarantineDetail id={parts.slice(1).join("/")} />;
  }
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Digest diário</h2>
        <DigestSection />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Pendências em aberto</h2>
        <OpenLoopsTable />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Lint do wiki</h2>
        <LintSection />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Quarentena</h2>
        <QuarantineList />
      </section>
    </div>
  );
}
