import { KeyRound, Cpu, Plug, FileText, Filter, Users, DatabaseBackup, MailX } from "lucide-react";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";
import { useBrainSettings } from "../../hooks/useBrain";
import { GoogleAccountSection } from "./GoogleAccountSection";
import { LlmProvidersSection } from "./LlmProvidersSection";
import { ConnectorSettings } from "./ConnectorSettings";
import { ContractEditor } from "./ContractEditor";
import { BackfillSection } from "./BackfillSection";
import { WhatsappSlackSection } from "./WhatsappSlackSection";

const inputClass =
  "w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent";

function SectionHeader({ icon: Icon, title }: { icon: typeof Cpu; title: string }) {
  return (
    <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
      <Icon size={14} className="text-text-muted" /> {title}
    </h2>
  );
}

export function BrainSettingsTab() {
  const { settings, patch, save, saving, loading, error, dirty } = useBrainSettings();
  const { addToast } = useToast();

  if (loading && !settings) return <p className="text-sm text-text-muted py-8 text-center">Carregando…</p>;
  if (error && !settings) return <p className="text-sm text-danger py-8 text-center">{error}</p>;
  if (!settings) return null;

  const handleSave = async () => {
    const ok = await save();
    addToast(ok ? "success" : "error", ok ? "Configurações salvas" : "Falha ao salvar");
  };

  return (
    <div className="max-w-3xl space-y-8 pb-24">
      <section className="space-y-4">
        <SectionHeader icon={KeyRound} title="Contas Google" />
        <GoogleAccountSection />
      </section>

      <section className="space-y-4">
        <SectionHeader icon={Plug} title="WhatsApp e Slack" />
        <WhatsappSlackSection settings={settings} patch={patch} />
      </section>

      <section className="space-y-4">
        <SectionHeader icon={Cpu} title="Provedores de LLM do pipeline" />
        <p className="text-xs text-text-muted">
          Endpoints compatíveis com a API da Anthropic. Selecione o provedor e o modelo de cada etapa. Batch,
          caching e structured outputs só funcionam em provedores que os suportam — sem eles o pipeline cai para
          chamadas realtime com JSON validado.
        </p>
        <LlmProvidersSection settings={settings} patch={patch} />
      </section>

      <section className="space-y-4">
        <SectionHeader icon={Plug} title="Schedulers" />
        <ConnectorSettings settings={settings} patch={patch} />
      </section>

      <section className="space-y-4">
        <SectionHeader icon={MailX} title="Filtro de email (spam, anúncios, massa)" />
        <p className="text-xs text-text-muted">
          Três camadas de corte antes de gastar LLM: categorias do Gmail nem são baixadas; remetentes bloqueados são
          descartados; newsletters/notificações em massa (List-Unsubscribe, precedence bulk, no-reply) entram em raw/
          mas viram ruído (relevance 0) por heurística, sem triagem paga.
        </p>
        <div className="space-y-1">
          <p className="text-xs font-medium text-text-muted">Categorias do Gmail ignoradas na origem</p>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["promotions", "Promoções"],
                ["social", "Social"],
                ["updates", "Atualizações"],
                ["forums", "Fóruns"],
              ] as const
            ).map(([category, label]) => (
              <label key={category} className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.emailFilter.skipCategories.includes(category)}
                  onChange={(e) =>
                    patch((prev) => ({
                      ...prev,
                      emailFilter: {
                        ...prev.emailFilter,
                        skipCategories: e.target.checked
                          ? [...prev.emailFilter.skipCategories, category]
                          : prev.emailFilter.skipCategories.filter((c) => c !== category),
                      },
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-[10px] text-text-muted">Spam e lixeira são sempre ignorados.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={settings.emailFilter.bulkAsNoise}
            onChange={(e) =>
              patch((prev) => ({
                ...prev,
                emailFilter: { ...prev.emailFilter, bulkAsNoise: e.target.checked },
              }))
            }
          />
          Classificar newsletters/emails em massa como ruído por heurística (sem custo de LLM)
        </label>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Remetentes/domínios bloqueados (um por linha; domínio bloqueia subdomínios)
          </label>
          <textarea
            value={settings.emailFilter.blockedSenders.join("\n")}
            onChange={(e) =>
              patch((prev) => ({
                ...prev,
                emailFilter: {
                  ...prev.emailFilter,
                  blockedSenders: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean),
                },
              }))
            }
            rows={3}
            className={`${inputClass} font-mono`}
            placeholder="promo@loja.com&#10;mailchimp.com"
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader icon={Filter} title="Filtro de chatter e triagem" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Mínimo de caracteres</label>
            <input
              type="number"
              min={1}
              value={settings.chatter.minChars}
              onChange={(e) =>
                patch((prev) => ({
                  ...prev,
                  chatter: { ...prev.chatter, minChars: Math.max(1, Number(e.target.value) || 1) },
                }))
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Relevância mínima p/ compilar</label>
            <input
              type="number"
              min={0}
              max={3}
              value={settings.compile.minRelevance}
              onChange={(e) =>
                patch((prev) => ({
                  ...prev,
                  compile: { ...prev.compile, minRelevance: Math.min(3, Math.max(0, Number(e.target.value) || 0)) },
                }))
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Máx. chars por seção</label>
            <input
              type="number"
              min={200}
              value={settings.compile.maxSectionChars}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (!Number.isFinite(value) || value < 0) return;
                patch((prev) => ({ ...prev, compile: { ...prev.compile, maxSectionChars: value } }));
              }}
              onBlur={() =>
                patch((prev) => ({
                  ...prev,
                  compile: { ...prev.compile, maxSectionChars: Math.max(200, prev.compile.maxSectionChars || 200) },
                }))
              }
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Confirmações extras do filtro (uma por linha)
          </label>
          <textarea
            value={settings.chatter.extraConfirmations.join("\n")}
            onChange={(e) =>
              patch((prev) => ({
                ...prev,
                chatter: {
                  ...prev.chatter,
                  extraConfirmations: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean),
                },
              }))
            }
            rows={3}
            className={`${inputClass} font-mono`}
            placeholder="fechou&#10;show de bola"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Filtro extra do Gmail (sintaxe de busca do Gmail, opcional)
          </label>
          <input
            type="text"
            value={settings.gmailQuery}
            onChange={(e) => patch((prev) => ({ ...prev, gmailQuery: e.target.value }))}
            className={`${inputClass} font-mono`}
            placeholder="-category:promotions"
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader icon={Users} title="Regras de tenant" />
        <p className="text-xs text-text-muted">
          O tenant vem primeiro da conta de origem; estes domínios/palavras marcam threads biosoft mesmo em conta
          pessoal.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Domínios biosoft (um por linha)</label>
            <textarea
              value={settings.tenantRules.biosoftDomains.join("\n")}
              onChange={(e) =>
                patch((prev) => ({
                  ...prev,
                  tenantRules: {
                    ...prev.tenantRules,
                    biosoftDomains: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean),
                  },
                }))
              }
              rows={3}
              className={`${inputClass} font-mono`}
              placeholder="biosoft.com.br"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Palavras-chave (uma por linha)</label>
            <textarea
              value={settings.tenantRules.biosoftKeywords.join("\n")}
              onChange={(e) =>
                patch((prev) => ({
                  ...prev,
                  tenantRules: {
                    ...prev.tenantRules,
                    biosoftKeywords: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean),
                  },
                }))
              }
              rows={3}
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader icon={DatabaseBackup} title="Backfill" />
        <BackfillSection />
      </section>

      <section className="space-y-4">
        <SectionHeader icon={FileText} title="Contrato do compilador" />
        <ContractEditor />
      </section>

      {dirty && (
        <div className="fixed bottom-4 right-4 z-40 bg-surface border border-border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3">
          <span className="text-sm text-text-secondary">Alterações não salvas</span>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      )}
    </div>
  );
}
