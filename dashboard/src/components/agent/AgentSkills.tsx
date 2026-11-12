import { useCallback, useEffect, useRef, useState } from "react";
import { Github, Library, Loader2, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { api, ApiError } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { Badge } from "../shared/Badge";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";
import type { AgentSkill, AgentSkillDetail, LibrarySkill, SkillCandidate, SkillInvocation } from "../../lib/types";

interface AgentSkillsProps {
  agentName: string;
  onChanged: () => void;
}

const INVOCATIONS: { value: SkillInvocation; label: string; help: string }[] = [
  { value: "auto", label: "Automática e manual", help: "O agente usa sozinho quando o pedido combina com a descrição, e você também pode escolher a skill na conversa." },
  { value: "manual", label: "Só manual", help: "O agente nunca usa por conta própria; só roda quando você escolhe a skill na conversa." },
  { value: "model", label: "Só automática", help: "Não aparece na lista da conversa; o agente usa sozinho quando o pedido combina com a descrição." },
];

const INVOCATION_BADGE: Record<SkillInvocation, { label: string; variant: "default" | "accent" | "info" }> = {
  auto: { label: "Automática e manual", variant: "accent" },
  manual: { label: "Só manual", variant: "default" },
  model: { label: "Só automática", variant: "info" },
};

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_LISTING = 1536;

type InstallMode = "upload" | "github" | "library" | "create";

const fieldClass = "w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function conflictsOf(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const conflicts = err.body.conflicts;
  return Array.isArray(conflicts) ? conflicts.filter((name): name is string => typeof name === "string") : null;
}

// Repete a instalação substituindo as skills existentes se o usuário confirmar.
async function withReplace<T>(install: (replace: boolean) => Promise<T>): Promise<T | null> {
  try {
    return await install(false);
  } catch (err) {
    const conflicts = conflictsOf(err);
    if (!conflicts) throw err;
    if (!confirm(`Já existe skill com o nome ${conflicts.join(", ")} neste agente. Substituir?`)) return null;
    return install(true);
  }
}

interface TriggerFields {
  description: string;
  whenToUse: string;
  invocation: SkillInvocation;
}

function TriggerEditor({ value, onChange }: { value: TriggerFields; onChange: (next: TriggerFields) => void }) {
  const listing = value.description.length + value.whenToUse.length;
  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Descrição: o que a skill faz e quando usar</span>
        <textarea
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          rows={3}
          placeholder="Gera o relatório semanal de vendas a partir das planilhas da pasta de entradas. Use quando pedirem o relatório da semana."
          className={fieldClass}
        />
        <span className="text-[11px] text-text-muted">É por ela que o agente decide sozinho quando usar a skill. Coloque primeiro o caso de uso principal e as palavras-chave.</span>
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Quando usar (opcional)</span>
        <textarea
          value={value.whenToUse}
          onChange={(e) => onChange({ ...value, whenToUse: e.target.value })}
          rows={2}
          placeholder={'Frases que devem acionar a skill, ex.: "relatório da semana", "fechamento de vendas".'}
          className={fieldClass}
        />
        <span className={`text-[11px] ${listing > MAX_LISTING ? "text-red-400" : "text-text-muted"}`}>
          Complementa a descrição no runtime Claude. Descrição + quando usar: {listing}/{MAX_LISTING} caracteres.
        </span>
      </label>
      <fieldset className="space-y-2">
        <legend className="text-xs text-text-secondary mb-1">Acionamento</legend>
        {INVOCATIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="skill-invocation"
              className="mt-1"
              checked={value.invocation === option.value}
              onChange={() => onChange({ ...value, invocation: option.value })}
            />
            <span>
              <span className="text-sm text-text-primary">{option.label}</span>
              <span className="block text-[11px] text-text-muted">{option.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function EditSkillModal({ agentName, name, onClose, onSaved }: { agentName: string; name: string; onClose: () => void; onSaved: () => void }) {
  const { addToast } = useToast();
  const [detail, setDetail] = useState<AgentSkillDetail | null>(null);
  const [trigger, setTrigger] = useState<TriggerFields>({ description: "", whenToUse: "", invocation: "auto" });
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<AgentSkillDetail>(`/agents/${agentName}/skills/${name}`)
      .then((data) => {
        setDetail(data);
        setTrigger({ description: data.description, whenToUse: data.whenToUse, invocation: data.invocation });
        setInstructions(data.instructions);
      })
      .catch((err) => setError(errorMessage(err, "Falha ao carregar a skill")));
  }, [agentName, name]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/agents/${agentName}/skills/${name}`, { ...trigger, instructions });
      addToast("success", `Skill "${name}" atualizada`);
      onSaved();
      onClose();
    } catch (err) {
      addToast("error", errorMessage(err, "Falha ao salvar"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Editar skill ${name}`} size="xl" dismissible={!saving}>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {!detail && !error && <div role="status" className="flex items-center gap-2 text-sm text-text-muted"><Loader2 size={14} className="animate-spin" /> Carregando…</div>}
      {detail && (
        <div className="space-y-4">
          <TriggerEditor value={trigger} onChange={setTrigger} />
          <label className="block space-y-1">
            <span className="text-xs text-text-secondary">Instruções (corpo do SKILL.md, em Markdown)</span>
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={14} className={`${fieldClass} font-mono text-xs`} />
          </label>
          {detail.files.length > 1 && (
            <details className="text-xs text-text-muted">
              <summary className="cursor-pointer">{detail.files.length} arquivos na skill</summary>
              <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto font-mono">
                {detail.files.map((file) => <li key={file.path}>{file.path} · {formatBytes(file.size)}</li>)}
              </ul>
            </details>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={saving} onClick={onClose}>Cancelar</Button>
            <Button size="sm" disabled={saving || !trigger.description.trim()} onClick={() => void save()}>{saving ? "Salvando…" : "Salvar"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function InstallSkillModal({ agentName, onClose, onInstalled }: { agentName: string; onClose: () => void; onInstalled: (names: string[]) => void }) {
  const { addToast } = useToast();
  const [mode, setMode] = useState<InstallMode>("upload");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [candidates, setCandidates] = useState<SkillCandidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [library, setLibrary] = useState<LibrarySkill[] | null>(null);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<TriggerFields>({ description: "", whenToUse: "", invocation: "auto" });
  const [instructions, setInstructions] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode !== "library" || library) return;
    api.get<{ skills: LibrarySkill[] }>(`/agents/${agentName}/skill-library`)
      .then((data) => setLibrary(data.skills))
      .catch((err) => addToast("error", errorMessage(err, "Falha ao carregar a biblioteca")));
  }, [mode, library, agentName, addToast]);

  const run = async (task: () => Promise<string[] | null>) => {
    setBusy(true);
    try {
      const installed = await task();
      if (installed && installed.length > 0) onInstalled(installed);
    } catch (err) {
      addToast("error", errorMessage(err, "Falha ao instalar"));
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = () => run(async () => {
    if (!file) return null;
    const result = await withReplace((replace) => api.upload<{ installed: string[] }>(`/agents/${agentName}/skills-import/upload${replace ? "?replace=1" : ""}`, file));
    return result?.installed ?? null;
  });

  const importGithub = () => run(async () => {
    const names = candidates ? selected : undefined;
    const result = await withReplace((replace) => api.post<{ installed: string[]; candidates: SkillCandidate[] }>(`/agents/${agentName}/skills-import/github`, { url: githubUrl.trim(), names, replace }));
    if (!result) return null;
    if (result.installed.length === 0 && result.candidates.length > 1) {
      setCandidates(result.candidates);
      setSelected([]);
      return null;
    }
    return result.installed;
  });

  const installLibrary = (skill: string) => run(async () => {
    const result = await withReplace((replace) => api.post<{ installed: string[] }>(`/agents/${agentName}/skills-import/library`, { name: skill, replace }));
    return result?.installed ?? null;
  });

  const create = () => run(async () => {
    await api.post(`/agents/${agentName}/skills`, { name: name.trim(), ...trigger, instructions });
    return [name.trim()];
  });

  const modes: { key: InstallMode; label: string; icon: typeof Upload }[] = [
    { key: "upload", label: "Arquivo", icon: Upload },
    { key: "github", label: "GitHub", icon: Github },
    { key: "library", label: "Servidor", icon: Library },
    { key: "create", label: "Criar", icon: Sparkles },
  ];
  const nameValid = NAME_PATTERN.test(name.trim()) && name.trim().length <= 64;

  return (
    <Modal open onClose={onClose} title="Instalar skill" size="lg" dismissible={!busy}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Origem da skill">
          {modes.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border cursor-pointer ${mode === key ? "border-accent text-accent bg-accent/10" : "border-border text-text-muted hover:text-text-primary"}`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {mode === "upload" && (
          <div className="space-y-3">
            <p className="text-xs text-text-muted">
              Envie um <strong>.zip</strong> ou <strong>.skill</strong> com uma ou mais pastas contendo <span className="font-mono">SKILL.md</span>, ou só o arquivo <span className="font-mono">SKILL.md</span>.
              Scripts e arquivos de apoio da pasta vão junto. Limite de 50 MB.
            </p>
            <input ref={fileInput} type="file" accept=".zip,.skill,.md" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={13} /> Escolher arquivo</Button>
              <span className="text-xs text-text-secondary truncate">{file ? `${file.name} · ${formatBytes(file.size)}` : "Nenhum arquivo escolhido"}</span>
            </div>
            <div className="flex justify-end">
              <Button size="sm" disabled={busy || !file} onClick={() => void uploadFile()}>{busy ? "Instalando…" : "Instalar"}</Button>
            </div>
          </div>
        )}

        {mode === "github" && (
          <div className="space-y-3">
            <p className="text-xs text-text-muted">Cole o endereço de um repositório público ou da pasta de uma skill no GitHub.</p>
            <input
              value={githubUrl}
              onChange={(e) => {
                setGithubUrl(e.target.value);
                setCandidates(null);
              }}
              placeholder="https://github.com/anthropics/skills/tree/main/skills/pdf"
              className={fieldClass}
            />
            {candidates && (
              <div className="space-y-2">
                <p className="text-xs text-text-secondary">Esse endereço tem {candidates.length} skills. Escolha quais instalar:</p>
                <ul className="max-h-64 overflow-y-auto divide-y divide-border border border-border rounded-md">
                  {candidates.map((candidate) => (
                    <li key={candidate.name}>
                      <label className="flex items-start gap-2 px-3 py-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selected.includes(candidate.name)}
                          onChange={(e) => setSelected(e.target.checked ? [...selected, candidate.name] : selected.filter((item) => item !== candidate.name))}
                        />
                        <span className="min-w-0">
                          <span className="text-sm text-text-primary font-mono">{candidate.name}</span>
                          <span className="block text-[11px] text-text-muted line-clamp-2">{candidate.description}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <Button size="sm" disabled={busy || !githubUrl.trim() || (candidates !== null && selected.length === 0)} onClick={() => void importGithub()}>
                {busy ? "Importando…" : candidates ? `Instalar ${selected.length || ""}`.trim() : "Importar"}
              </Button>
            </div>
          </div>
        )}

        {mode === "library" && (
          <div className="space-y-2">
            <p className="text-xs text-text-muted">Skills já instaladas no servidor do Claudemar. Instalar copia a skill para este agente.</p>
            {!library && <div role="status" className="flex items-center gap-2 text-xs text-text-muted"><Loader2 size={12} className="animate-spin" /> Carregando…</div>}
            {library && library.length === 0 && <p className="text-sm text-text-muted">Nenhuma skill no servidor.</p>}
            {library && library.length > 0 && (
              <ul className="max-h-80 overflow-y-auto divide-y divide-border border border-border rounded-md">
                {library.map((skill) => (
                  <li key={skill.name} className="flex items-start gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="text-sm text-text-primary font-mono">{skill.name}</span>
                      <span className="block text-[11px] text-text-muted line-clamp-2">{skill.description}</span>
                    </span>
                    {skill.installed ? <Badge variant="success">Instalada</Badge> : (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void installLibrary(skill.name)}>Instalar</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mode === "create" && (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs text-text-secondary">Nome</span>
              <input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="relatorio-semanal" className={`${fieldClass} font-mono`} />
              <span className={`text-[11px] ${name && !nameValid ? "text-red-400" : "text-text-muted"}`}>Letras minúsculas, números e hífens. Vira o comando /{name || "nome"} na conversa.</span>
            </label>
            <TriggerEditor value={trigger} onChange={setTrigger} />
            <label className="block space-y-1">
              <span className="text-xs text-text-secondary">Instruções (Markdown)</span>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={10}
                placeholder={"# Relatório semanal\n\n1. Leia as planilhas em input/vendas.\n2. ..."}
                className={`${fieldClass} font-mono text-xs`}
              />
            </label>
            <div className="flex justify-end">
              <Button size="sm" disabled={busy || !nameValid || !trigger.description.trim() || !instructions.trim()} onClick={() => void create()}>
                {busy ? "Criando…" : "Criar skill"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function AgentSkills({ agentName, onChanged }: AgentSkillsProps) {
  const { addToast } = useToast();
  const [skills, setSkills] = useState<AgentSkill[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AgentSkill | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(() => {
    api.get<{ skills: AgentSkill[] }>(`/agents/${agentName}/skills`)
      .then((data) => {
        setSkills(data.skills);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorMessage(err, "Falha ao carregar as skills")));
  }, [agentName]);

  useEffect(load, [load]);

  const refresh = () => {
    load();
    onChanged();
  };

  const remove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api.delete(`/agents/${agentName}/skills/${removeTarget.name}`);
      addToast("success", `Skill "${removeTarget.name}" removida`);
      setRemoveTarget(null);
      refresh();
    } catch (err) {
      addToast("error", errorMessage(err, "Falha ao remover"));
    } finally {
      setRemoving(false);
    }
  };

  if (loadError && !skills) return <p role="alert" className="text-sm text-red-400">{loadError}</p>;
  if (!skills) return <div role="status" className="flex items-center gap-2 text-sm text-text-muted"><Loader2 size={14} className="animate-spin" /> Carregando skills…</div>;

  return (
    <section className="space-y-4" aria-label="Skills">
      <div className="flex items-start gap-3">
        <p className="text-sm text-text-muted flex-1">
          Skills são pacotes de instruções, scripts e arquivos que o agente usa sozinho quando o pedido combina com a descrição, ou quando você escolhe a skill na conversa.
          Valem para todas as conversas e agendamentos deste agente, nos runtimes Claude e Codex.
        </p>
        <Button size="sm" onClick={() => setInstallOpen(true)}><Plus size={13} /> Instalar skill</Button>
      </div>

      {skills.length === 0 && (
        <Card className="py-10 px-4 text-center">
          <p className="text-sm text-text-muted">Nenhuma skill instalada neste agente.</p>
        </Card>
      )}

      {skills.map((skill) => (
        <Card key={skill.name} className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-text-muted shrink-0" />
            <span className="text-sm font-medium font-mono truncate">{skill.name}</span>
            <Badge variant={INVOCATION_BADGE[skill.invocation].variant}>{INVOCATION_BADGE[skill.invocation].label}</Badge>
            <div className="ml-auto flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => setEditing(skill.name)} className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-accent transition-colors cursor-pointer" title="Editar" aria-label={`Editar ${skill.name}`}>
                <Pencil size={14} />
              </button>
              <button type="button" onClick={() => setRemoveTarget(skill)} className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-red-400 transition-colors cursor-pointer" title="Remover" aria-label={`Remover ${skill.name}`}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <p className="text-xs text-text-secondary">{skill.description}</p>
          {skill.whenToUse && <p className="text-xs text-text-muted"><span className="text-text-secondary">Quando usar:</span> {skill.whenToUse}</p>}
          <div className="flex flex-wrap gap-x-3 text-[11px] text-text-muted">
            <span>{skill.fileCount} arquivo(s) · {formatBytes(skill.totalBytes)}</span>
            <span>Atualizada {formatDistanceToNow(new Date(skill.updatedAt), { addSuffix: true, locale: ptBR })}</span>
            {skill.invocation !== "model" && <span className="font-mono">/{skill.name}</span>}
          </div>
        </Card>
      ))}

      {installOpen && (
        <InstallSkillModal
          agentName={agentName}
          onClose={() => setInstallOpen(false)}
          onInstalled={(names) => {
            addToast("success", names.length === 1 ? `Skill "${names[0]}" instalada` : `${names.length} skills instaladas`);
            setInstallOpen(false);
            refresh();
          }}
        />
      )}

      {editing && <EditSkillModal agentName={agentName} name={editing} onClose={() => setEditing(null)} onSaved={refresh} />}

      <Modal open={removeTarget !== null} onClose={() => setRemoveTarget(null)} title="Remover skill" dismissible={!removing}>
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Remover a skill <strong className="text-text-primary font-mono">{removeTarget?.name}</strong> deste agente? A pasta da skill e todos os arquivos dela são apagados.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={removing} onClick={() => setRemoveTarget(null)}>Cancelar</Button>
            <Button size="sm" variant="danger" disabled={removing} onClick={() => void remove()}>{removing ? "Removendo…" : "Remover"}</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
