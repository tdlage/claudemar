import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, FolderPlus } from "lucide-react";
import { isAdmin } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import {
  CREATE_WORKSPACE_EVENT,
  WORKSPACES_CHANGED_EVENT,
  type WorkspaceKind,
} from "../../lib/workspaceEvents";
import { Field, Input } from "../../vendor/dantui";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { useToast } from "./Toast";

export function CreateWorkspaceModal() {
  const [kind, setKind] = useState<WorkspaceKind | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { addToast } = useToast();
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<WorkspaceKind>).detail;
      if (
        !isAdmin() ||
        submitting.current ||
        (next !== "projects" && next !== "agents")
      )
        return;
      setName("");
      setError("");
      setKind(next);
    };
    window.addEventListener(CREATE_WORKSPACE_EVENT, open);
    return () => window.removeEventListener(CREATE_WORKSPACE_EVENT, open);
  }, []);
  useEffect(() => {
    if (kind) inputRef.current?.focus();
  }, [kind]);

  const project = kind === "projects";
  const noun = project ? "projeto" : "agente";
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!kind || submitting.current) return;
    const value = name.trim();
    const valid = project
      ? /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
      : /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value);
    if (!valid || value.includes("..")) {
      setError(
        `Comece com uma letra ou número. Use letras sem acento, números, hífens${project ? ", sublinhados" : ""} ou pontos isolados.`,
      );
      inputRef.current?.focus();
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      await api.post(`/${kind}`, { name: value });
      window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT));
      addToast(
        "success",
        `${project ? "Projeto" : "Agente"} criado. Tudo pronto para começar.`,
      );
      setKind(null);
      navigate(`/${kind}/${encodeURIComponent(value)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(
        /already exists|existe/i.test(message)
          ? `Já existe um ${noun} com esse nome. Escolha outro.`
          : `Não foi possível criar o ${noun}. Confira sua conexão e tente novamente.`,
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      open={!!kind}
      dismissible={!saving}
      onClose={() => {
        if (!submitting.current) setKind(null);
      }}
      title={`Novo ${noun}`}
    >
      <form onSubmit={submit} className="space-y-6">
        <div className="flex gap-3 text-sm text-text-secondary">
          {project ? (
            <FolderPlus size={24} className="shrink-0 text-accent" />
          ) : (
            <Bot size={24} className="shrink-0 text-accent" />
          )}
          <p>
            {project
              ? "Reúna conversas, arquivos e repositórios em um só lugar."
              : "Crie um assistente com instruções próprias para um tipo de trabalho."}
          </p>
        </div>
        <Field
          label={`Nome do ${noun}`}
          hint="Use um nome curto e fácil de reconhecer. Exemplo: meu-site"
          error={error}
        >
          {(props) => (
            <Input
              {...props}
              ref={inputRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              required
              disabled={saving}
              autoComplete="off"
              spellCheck={false}
              placeholder={project ? "meu-site" : "assistente"}
            />
          )}
        </Field>
        {error && (
          <p className="sr-only" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => setKind(null)}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="success"
            loading={saving}
            disabled={!name.trim()}
          >
            Criar {noun}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
