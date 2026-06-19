import { useEffect, useState, useCallback } from "react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";
import { InputBrowser, type InputFile } from "../agent/InputBrowser";
import { OutputBrowser, type OutputFile } from "../agent/OutputBrowser";

interface Props {
  members: string[];
  open: boolean;
  onClose: () => void;
}

export function FileArchiveModal({ members, open, onClose }: Props) {
  const [selected, setSelected] = useState(members[0] ?? "");
  const [inputFiles, setInputFiles] = useState<InputFile[]>([]);
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);

  useEffect(() => {
    if (!members.includes(selected) && members[0]) setSelected(members[0]);
  }, [members, selected]);

  const loadInputs = useCallback(() => {
    if (!selected) return;
    api.get<InputFile[]>(`/agents/${selected}/input`).then(setInputFiles).catch(() => setInputFiles([]));
  }, [selected]);
  const loadOutputs = useCallback(() => {
    if (!selected) return;
    api.get<OutputFile[]>(`/agents/${selected}/output`).then(setOutputFiles).catch(() => setOutputFiles([]));
  }, [selected]);

  useEffect(() => { if (open) { loadInputs(); loadOutputs(); } }, [open, loadInputs, loadOutputs]);

  return (
    <Modal open={open} onClose={onClose} title="Arquivo do squad" size="xl">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Agente</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="text-sm bg-bg border border-border rounded-md px-2 py-1 focus:outline-none focus:border-accent"
          >
            {members.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {selected ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-medium text-text-secondary mb-2">Enviar (input do agente)</h3>
              <InputBrowser apiBasePath={`/agents/${selected}`} base={`agent:${selected}`} files={inputFiles} onRefresh={loadInputs} />
            </div>
            <div>
              <h3 className="text-xs font-medium text-text-secondary mb-2">Baixar (output do agente)</h3>
              <OutputBrowser agentName={selected} files={outputFiles} onRefresh={loadOutputs} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted">Esse squad não tem agentes.</p>
        )}
      </div>
    </Modal>
  );
}
