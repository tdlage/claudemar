import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, X, Save, Send, Settings, KeyRound, Cpu, Server, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { OPEN_API_KEYS_EVENT } from "../components/layout/ApiKeysSetup";
import { ClaudeAccountSection } from "../components/layout/ClaudeAccountSection";
import type { RuntimeSettings, EmailProfileMasked, LlmProfile, GatewayStatus } from "../lib/types";

interface ProfileFormState {
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  region: string;
  from: string;
  senderName: string;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<RuntimeSettings>({ sesFrom: "", adminEmail: "", llmProfiles: [], activeProfileId: "" });
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [llmDirty, setLlmDirty] = useState(false);
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmMsg, setLlmMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);

  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [gatewayBusy, setGatewayBusy] = useState(false);

  const [profiles, setProfiles] = useState<EmailProfileMasked[]>([]);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ProfileFormState>({ awsAccessKeyId: "", awsSecretAccessKey: "", region: "", from: "", senderName: "" });

  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createForm, setCreateForm] = useState<ProfileFormState>({ awsAccessKeyId: "", awsSecretAccessKey: "", region: "", from: "", senderName: "" });

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ profile: string; type: "ok" | "err"; text: string } | null>(null);

  const loadProfiles = useCallback(() => {
    api.get<EmailProfileMasked[]>("/settings/email/profiles").then(setProfiles).catch(() => {});
  }, []);

  useEffect(() => {
    api.get<RuntimeSettings>("/settings").then(setSettings).catch(() => {});
    loadProfiles();
  }, [loadProfiles]);

  const loadGateway = useCallback(() => {
    api.get<GatewayStatus>("/system/gateway").then(setGateway).catch(() => {});
  }, []);

  useEffect(() => {
    loadGateway();
    const id = setInterval(loadGateway, 15000);
    return () => clearInterval(id);
  }, [loadGateway]);

  const restartGateway = async () => {
    setGatewayBusy(true);
    try {
      setGateway(await api.post<GatewayStatus>("/system/gateway/restart"));
    } catch {
      loadGateway();
    } finally {
      setGatewayBusy(false);
    }
  };

  const handleSaveLlm = async () => {
    setLlmSaving(true);
    setLlmMsg(null);
    try {
      const updated = await api.put<RuntimeSettings>("/settings", settings);
      setSettings(updated);
      setEditingProfileId(null);
      setLlmDirty(false);
      setLlmMsg({ type: "ok", text: "Salvo" });
      setTimeout(() => setLlmMsg(null), 3000);
    } catch (err) {
      setLlmMsg({ type: "err", text: err instanceof Error ? err.message : "Falha ao salvar" });
    } finally {
      setLlmSaving(false);
    }
  };

  const newProfileId = () => `p-${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;

  const patchProfile = (id: string, patch: Partial<LlmProfile>) => {
    setSettings((s) => ({ ...s, llmProfiles: s.llmProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    setLlmDirty(true);
  };

  const addProfile = () => {
    const profile: LlmProfile = {
      id: newProfileId(),
      label: "Novo provedor",
      baseUrl: "http://localhost:8080/anthropic",
      tokenEnv: "BIFROST_VIRTUAL_KEY",
      opusModel: "",
      sonnetModel: "",
      haikuModel: "",
      timeoutMs: "3000000",
      autoCompactWindow: "",
    };
    setSettings((s) => ({ ...s, llmProfiles: [...s.llmProfiles, profile] }));
    setEditingProfileId(profile.id);
    setLlmDirty(true);
  };

  const removeProfile = (id: string) => {
    setSettings((s) => {
      const llmProfiles = s.llmProfiles.filter((p) => p.id !== id);
      const activeProfileId = s.activeProfileId === id ? (llmProfiles[0]?.id ?? "") : s.activeProfileId;
      return { ...s, llmProfiles, activeProfileId };
    });
    if (editingProfileId === id) setEditingProfileId(null);
    setLlmDirty(true);
  };

  const setActiveProfile = (id: string) => {
    setSettings((s) => ({ ...s, activeProfileId: id }));
    setLlmDirty(true);
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    setSettingsMsg(null);
    try {
      const updated = await api.put<RuntimeSettings>("/settings", settings);
      setSettings(updated);
      setSettingsDirty(false);
      setSettingsMsg({ type: "ok", text: "Saved" });
      setTimeout(() => setSettingsMsg(null), 3000);
    } catch {
      setSettingsMsg({ type: "err", text: "Failed to save" });
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleCreateProfile = async () => {
    if (!createName.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/settings/email/profiles", { name: createName.trim(), ...createForm });
      setCreating(false);
      setCreateName("");
      setCreateForm({ awsAccessKeyId: "", awsSecretAccessKey: "", region: "", from: "", senderName: "" });
      loadProfiles();
    } catch {
    } finally {
      setSaving(false);
    }
  };

  const handleEditStart = (profile: EmailProfileMasked) => {
    setEditingProfile(profile.name);
    setEditForm({ awsAccessKeyId: profile.awsAccessKeyId, awsSecretAccessKey: "", region: profile.region, from: profile.from, senderName: profile.senderName });
  };

  const handleEditSave = async (name: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await api.put(`/settings/email/profiles/${encodeURIComponent(name)}`, editForm);
      setEditingProfile(null);
      loadProfiles();
    } catch {
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await api.delete(`/settings/email/profiles/${encodeURIComponent(name)}`);
      if (editingProfile === name) setEditingProfile(null);
      loadProfiles();
    } catch {
    }
  };

  const handleTest = async (name: string) => {
    const to = settings.adminEmail;
    if (!to) {
      setTestMsg({ profile: name, type: "err", text: "Set Admin Email first" });
      setTimeout(() => setTestMsg(null), 4000);
      return;
    }
    setTesting(name);
    setTestMsg(null);
    try {
      await api.post(`/settings/email/profiles/${encodeURIComponent(name)}/test`, { to });
      setTestMsg({ profile: name, type: "ok", text: `Sent to ${to}` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Test failed";
      setTestMsg({ profile: name, type: "err", text: msg });
    } finally {
      setTesting(null);
      setTimeout(() => setTestMsg(null), 5000);
    }
  };

  const inputClass = "w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent";
  const inputMonoClass = `${inputClass} font-mono`;
  const btnAccent = "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors";
  const btnCancel = "px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors";
  const iconBtn = "p-1.5 rounded text-text-muted hover:bg-accent/10 transition-colors";

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <Settings size={20} className="text-text-muted" />
        <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
      </div>

      <ClaudeAccountSection />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
          <Cpu size={14} className="text-text-muted" /> Provedores de LLM
        </h2>
        <p className="text-sm text-text-muted">
          Cada perfil parametriza o proxy usado nas execuções: endpoint do gateway, token e os modelos por alias (<code>opus</code>/<code>sonnet</code>/<code>haiku</code>, no formato <code>provider/modelo</code>). O perfil <strong>ativo</strong> vale para todas as novas execuções. As chaves dos provedores (OpenAI, z.ai, Sakana, Anthropic) ficam em <strong>Chaves de API</strong> e são consumidas pelo gateway. Deixe a Base URL vazia para usar o Anthropic nativo (subscription).
        </p>

        <div className="bg-surface border border-border rounded-lg px-4 py-3 flex items-center gap-3">
          <Server size={16} className="shrink-0 text-text-muted" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">Gateway Bifrost</span>
              <span className="flex items-center gap-1.5 text-xs">
                <span className={`h-2 w-2 rounded-full ${gateway?.reachable ? "bg-success" : gateway?.containerRunning ? "bg-yellow-500" : "bg-danger"}`} />
                <span className={gateway?.reachable ? "text-success" : "text-text-muted"}>
                  {!gateway ? "—" : gateway.reachable ? "Online" : gateway.containerRunning ? "Iniciando…" : "Offline"}
                </span>
              </span>
            </div>
            <div className="text-xs text-text-muted font-mono truncate">{gateway?.url || "—"}</div>
            {gateway?.lastError && !gateway.reachable && (
              <div className="text-xs text-danger truncate" title={gateway.lastError}>{gateway.lastError}</div>
            )}
          </div>
          <button
            onClick={restartGateway}
            disabled={gatewayBusy}
            className={`${iconBtn} hover:text-accent disabled:opacity-40 disabled:pointer-events-none`}
            title="Reiniciar gateway"
          >
            <RefreshCw size={14} className={gatewayBusy ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="space-y-2">
          {settings.llmProfiles.map((p) => {
            const isActive = p.id === settings.activeProfileId;
            const isEditing = editingProfileId === p.id;
            return (
              <div key={p.id} className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setActiveProfile(p.id)}
                    title={isActive ? "Perfil ativo" : "Tornar ativo"}
                    className="shrink-0"
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${isActive ? "border-accent" : "border-border"}`}>
                      {isActive && <span className="h-2 w-2 rounded-full bg-accent" />}
                    </span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">{p.label || p.id}</span>
                      {isActive && <span className="text-xs text-success">ativo</span>}
                    </div>
                    <div className="text-xs text-text-muted font-mono truncate">
                      {p.opusModel || "—"}{p.baseUrl ? "" : " · nativo"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditingProfileId(isEditing ? null : p.id)}
                      className={`${iconBtn} hover:text-accent`}
                      title="Editar"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => removeProfile(p.id)}
                      disabled={settings.llmProfiles.length <= 1}
                      className={`${iconBtn} hover:text-danger disabled:opacity-40 disabled:pointer-events-none`}
                      title="Remover"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="border-t border-border px-4 py-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Nome</label>
                        <input type="text" value={p.label} onChange={(e) => patchProfile(p.id, { label: e.target.value })} className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Token (env var)</label>
                        <input type="text" value={p.tokenEnv} onChange={(e) => patchProfile(p.id, { tokenEnv: e.target.value })} placeholder="BIFROST_VIRTUAL_KEY" className={inputMonoClass} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-muted mb-1">Base URL (gateway)</label>
                      <input type="text" value={p.baseUrl} onChange={(e) => patchProfile(p.id, { baseUrl: e.target.value })} placeholder="http://localhost:8080/anthropic — vazio = Anthropic nativo" className={inputMonoClass} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Modelo opus</label>
                        <input type="text" value={p.opusModel} onChange={(e) => patchProfile(p.id, { opusModel: e.target.value })} placeholder="openai/gpt-5.5" className={inputMonoClass} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Modelo sonnet</label>
                        <input type="text" value={p.sonnetModel} onChange={(e) => patchProfile(p.id, { sonnetModel: e.target.value })} placeholder="openai/gpt-5.4-mini" className={inputMonoClass} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Modelo haiku</label>
                        <input type="text" value={p.haikuModel} onChange={(e) => patchProfile(p.id, { haikuModel: e.target.value })} placeholder="openai/gpt-5.4-nano" className={inputMonoClass} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Timeout (ms)</label>
                        <input type="text" value={p.timeoutMs} onChange={(e) => patchProfile(p.id, { timeoutMs: e.target.value })} placeholder="3000000" className={inputMonoClass} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Auto-compact window</label>
                        <input type="text" value={p.autoCompactWindow} onChange={(e) => patchProfile(p.id, { autoCompactWindow: e.target.value })} placeholder="vazio = janela do modelo" className={inputMonoClass} />
                      </div>
                    </div>
                    <p className="text-xs text-text-muted font-mono">id: {p.id}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3">
          <button onClick={addProfile} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-text-secondary hover:bg-surface-hover transition-colors">
            <Plus size={14} /> Adicionar provedor
          </button>
          <div className="flex items-center gap-3">
            {llmMsg && (
              <span className={`text-xs ${llmMsg.type === "ok" ? "text-success" : "text-danger"}`}>{llmMsg.text}</span>
            )}
            <button onClick={handleSaveLlm} disabled={llmSaving || !llmDirty} className={btnAccent}>
              <Save size={12} />
              {llmSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Chaves de API</h2>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-text-muted">
            Configure as chaves (Voyage, Qdrant, OpenAI) gravadas no <code>.env</code> do servidor, sem acessar a máquina.
          </p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_API_KEYS_EVENT))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors shrink-0"
          >
            <KeyRound size={14} /> Configurar chaves
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Email</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Default Sender</label>
            <input
              type="email"
              value={settings.sesFrom}
              onChange={(e) => { setSettings({ ...settings, sesFrom: e.target.value }); setSettingsDirty(true); }}
              placeholder="noreply@example.com"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Admin Email</label>
            <input
              type="email"
              value={settings.adminEmail}
              onChange={(e) => { setSettings({ ...settings, adminEmail: e.target.value }); setSettingsDirty(true); }}
              placeholder="admin@example.com"
              className={inputClass}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          {settingsMsg && (
            <span className={`text-xs ${settingsMsg.type === "ok" ? "text-success" : "text-danger"}`}>
              {settingsMsg.text}
            </span>
          )}
          <button
            onClick={handleSaveSettings}
            disabled={settingsSaving || !settingsDirty}
            className={btnAccent}
          >
            <Save size={12} />
            {settingsSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="text-sm font-semibold text-text-primary">AWS SES Profiles</h2>
          <button onClick={() => setCreating(true)} className={btnAccent}>
            <Plus size={14} />
            Add Profile
          </button>
        </div>

        {creating && (
          <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-primary">New Profile</span>
              <button onClick={() => { setCreating(false); setCreateName(""); setCreateForm({ awsAccessKeyId: "", awsSecretAccessKey: "", region: "", from: "", senderName: "" }); }} className="text-text-muted hover:text-text-primary">
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Profile Name</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value.replace(/[\[\]\s]/g, ""))}
                  placeholder="default"
                  autoFocus
                  className={inputMonoClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">From Email</label>
                <input
                  type="email"
                  value={createForm.from}
                  onChange={(e) => setCreateForm({ ...createForm, from: e.target.value })}
                  placeholder="noreply@example.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Sender Name</label>
                <input
                  type="text"
                  value={createForm.senderName}
                  onChange={(e) => setCreateForm({ ...createForm, senderName: e.target.value })}
                  placeholder="My Company"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">AWS Access Key ID</label>
                <input
                  type="text"
                  value={createForm.awsAccessKeyId}
                  onChange={(e) => setCreateForm({ ...createForm, awsAccessKeyId: e.target.value })}
                  className={inputMonoClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">AWS Secret Key</label>
                <input
                  type="password"
                  value={createForm.awsSecretAccessKey}
                  onChange={(e) => setCreateForm({ ...createForm, awsSecretAccessKey: e.target.value })}
                  className={inputMonoClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Region</label>
                <input
                  type="text"
                  value={createForm.region}
                  onChange={(e) => setCreateForm({ ...createForm, region: e.target.value })}
                  placeholder="us-east-1"
                  className={inputMonoClass}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleCreateProfile}
                disabled={saving || !createName.trim() || !createForm.awsAccessKeyId || !createForm.awsSecretAccessKey || !createForm.region || !createForm.from}
                className={btnAccent}
              >
                {saving ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        )}

        {profiles.length === 0 && !creating && (
          <div className="text-center py-12 text-text-muted text-sm">
            No email profiles configured. Add one to enable email sending.
          </div>
        )}

        <div className="space-y-2">
          {profiles.map((profile) => {
            const isEditing = editingProfile === profile.name;
            const profileTestMsg = testMsg?.profile === profile.name ? testMsg : null;
            return (
              <div key={profile.name} className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary font-mono">[{profile.name}]</span>
                      {profile.senderName && <span className="text-xs text-text-secondary">{profile.senderName}</span>}
                      <span className="text-xs text-text-muted">{profile.from}</span>
                      <span className="text-xs text-text-muted">{profile.region}</span>
                    </div>
                    {profileTestMsg && (
                      <span className={`text-xs mt-0.5 block ${profileTestMsg.type === "ok" ? "text-success" : "text-danger"}`}>
                        {profileTestMsg.text}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleTest(profile.name)}
                      disabled={testing === profile.name}
                      className={`${iconBtn} hover:text-accent`}
                      title="Send test email"
                    >
                      <Send size={13} />
                    </button>
                    <button
                      onClick={() => isEditing ? setEditingProfile(null) : handleEditStart(profile)}
                      className={`${iconBtn} hover:text-accent`}
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(profile.name)}
                      className={`${iconBtn} hover:text-danger`}
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="border-t border-border px-4 py-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">AWS Access Key ID</label>
                        <input
                          type="text"
                          value={editForm.awsAccessKeyId}
                          onChange={(e) => setEditForm({ ...editForm, awsAccessKeyId: e.target.value })}
                          className={inputMonoClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">
                          AWS Secret Key <span className="font-normal text-text-muted">({profile.awsSecretAccessKeyMasked})</span>
                        </label>
                        <input
                          type="password"
                          value={editForm.awsSecretAccessKey}
                          onChange={(e) => setEditForm({ ...editForm, awsSecretAccessKey: e.target.value })}
                          placeholder="Leave blank to keep existing"
                          className={inputMonoClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Region</label>
                        <input
                          type="text"
                          value={editForm.region}
                          onChange={(e) => setEditForm({ ...editForm, region: e.target.value })}
                          placeholder="us-east-1"
                          className={inputMonoClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">From Email</label>
                        <input
                          type="email"
                          value={editForm.from}
                          onChange={(e) => setEditForm({ ...editForm, from: e.target.value })}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Sender Name</label>
                        <input
                          type="text"
                          value={editForm.senderName}
                          onChange={(e) => setEditForm({ ...editForm, senderName: e.target.value })}
                          placeholder="My Company"
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-1 border-t border-border">
                      <button onClick={() => setEditingProfile(null)} className={btnCancel}>
                        Cancel
                      </button>
                      <button onClick={() => handleEditSave(profile.name)} disabled={saving} className={btnAccent}>
                        <Save size={12} />
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
