import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { api } from "../../lib/api";
import { Button } from "../shared/Button";
import { MarkdownEditor } from "../shared/MarkdownEditor";
import { useToast } from "../shared/Toast";

export function ContractEditor() {
  const { addToast } = useToast();
  const [content, setContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ content: string }>("/brain/contract")
      .then((res) => setContent(res.content))
      .catch((e) => addToast("error", e instanceof Error ? e.message : String(e)));
  }, [addToast]);

  const save = async () => {
    if (content === null) return;
    setSaving(true);
    try {
      await api.put("/brain/contract", { content });
      setDirty(false);
      addToast("success", "Contrato salvo — o cache de prompt será renovado na próxima compilação");
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (content === null) return <p className="text-xs text-text-muted">Carregando…</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        Contrato do compilador (CLAUDE.md do brain): schemas, postura de extração, regras de fusão e segurança.
        Editar invalida o prompt cache da compilação.
      </p>
      <MarkdownEditor
        value={content}
        onChange={(value: string) => {
          setContent(value);
          setDirty(true);
        }}
        onSave={save}
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={!dirty || saving} className="flex items-center gap-1.5">
          <Save size={14} />
          {saving ? "Salvando…" : "Salvar contrato"}
        </Button>
      </div>
    </div>
  );
}
