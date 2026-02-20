import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, X, Save, Send, Settings } from "lucide-react";
import { api } from "../lib/api";
import type { RuntimeSettings, EmailProfileMasked } from "../lib/types";

interface ProfileFormState {
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  region: string;
  from: string;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<RuntimeSettings>({ sesFrom: "", adminEmail: "" });
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [profiles, setProfiles] = useState<EmailProfileMasked[]>([]);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ProfileFormState>({ awsAccessKeyId: "", awsSecretAccessKey: "", region: "", from: "" });

  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createForm, setCreateForm] = useState<ProfileFormState>({ awsAccessKeyId: "", awsSecretAccessKey: "", region: "", from: "" });

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
      setCreateForm({ awsAccessKeyId: "", awsSecretAccessKey: "", region: "", from: "" });
      loadProfiles();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleEditStart = (profile: EmailProfileMasked) => {
    setEditingProfile(profile.name);
    setEditForm({ awsAccessKeyId: profile.awsAccessKeyId, awsSecretAccessKey: "", region: profile.region, from: profile.from });
  };

  const handleEditSave = async (name: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await api.put(`/settings/email/profiles/${encodeURIComponent(name)}`, editForm);
      setEditingProfile(null);
      loadProfiles();
    } catch {
      // ignore
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
      // ignore
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
              <button onClick={() => { setCreating(false); setCreateName(""); setCreateForm({ awsAccessKeyId: "", awsSecretAccessKey: "", region: "", from: "" }); }} className="text-text-muted hover:text-text-primary">
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
