import { useState, useRef } from "react";
import { todayISO } from "../lib/helpers.js";
import { Ico, ICONS, Field } from "../components/ui.jsx";

export default function SettingsView({ db, actions, toast, session }) {
  const [s, setS] = useState(db.settings);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState("");
  const fileRef = useRef();
  const set = (k, v) => setS(p => ({ ...p, [k]: v }));
  const saveAll = async () => { if (await actions.saveSettings(s)) toast("Settings saved"); };
  const clearAll = async () => {
    if (!confirm("Erase ALL data (contacts, catalog, documents, expenses) and start empty? Company settings are kept. This cannot be undone.")) return;
    setBusy(true);
    if (await actions.clearAllData()) toast("All data cleared");
    setBusy(false);
  };
  const loadSample = async () => {
    if (!confirm("Replace current data with the sample dataset?")) return;
    setBusy(true);
    if (await actions.loadSampleData()) toast("Sample data loaded");
    setBusy(false);
  };
  const exportData = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ledger-backup-" + todayISO() + ".json"; a.click();
  };
  const importData = async (file) => {
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { toast("⚠ That file isn't valid JSON"); return; }
    if (!confirm("Importing REPLACES all current data with the backup file. Continue?")) return;
    setBusy(true);
    if (await actions.importBackup(data)) toast("Backup imported");
    setBusy(false);
  };

  return <div style={{ maxWidth: 720 }}>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Company</h3></div>
      <div className="card-body">
        <Field label="Company Name"><input className="input" value={s.company} onChange={e => set("company", e.target.value)} /></Field>
        <Field label="Address"><textarea className="input" value={s.companyAddress} onChange={e => set("companyAddress", e.target.value)} /></Field>
        <div className="row">
          <Field label="Email"><input className="input" value={s.companyEmail} onChange={e => set("companyEmail", e.target.value)} /></Field>
          <Field label="Phone"><input className="input" value={s.companyPhone} onChange={e => set("companyPhone", e.target.value)} /></Field>
        </div>
      </div>
    </div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Defaults</h3></div>
      <div className="card-body">
        <div className="row">
          <Field label="Default Tax Rate (%)"><input className="input mono" type="number" step="any" value={s.taxRate} onChange={e => set("taxRate", Number(e.target.value))} /></Field>
          <Field label="Payment Terms (days)" hint="Sets invoice & bill due dates"><input className="input mono" type="number" value={s.terms} onChange={e => set("terms", Number(e.target.value))} /></Field>
        </div>
        <div className="row">
          <Field label="Quote Prefix"><input className="input" value={s.quotePrefix} onChange={e => set("quotePrefix", e.target.value)} /></Field>
          <Field label="SO Prefix"><input className="input" value={s.soPrefix} onChange={e => set("soPrefix", e.target.value)} /></Field>
          <Field label="Invoice Prefix"><input className="input" value={s.invPrefix} onChange={e => set("invPrefix", e.target.value)} /></Field>
          <Field label="Bill Prefix"><input className="input" value={s.billPrefix} onChange={e => set("billPrefix", e.target.value)} /></Field>
        </div>
        <Field label="Default Quote Notes"><textarea className="input" value={s.quoteNotes} onChange={e => set("quoteNotes", e.target.value)} /></Field>
        <Field label="Default Invoice Notes"><textarea className="input" value={s.invoiceNotes} onChange={e => set("invoiceNotes", e.target.value)} /></Field>
        <button className="btn primary" onClick={saveAll}><Ico d={ICONS.check} size={15} />Save Settings</button>
      </div>
    </div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Data</h3></div>
      <div className="card-body" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn" disabled={busy} onClick={exportData}>Export Backup (JSON)</button>
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Working…" : "Import Backup (JSON)"}</button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
          onChange={e => { importData(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="btn" disabled={busy} onClick={loadSample}>Load Sample Data</button>
        <button className="btn danger" disabled={busy} onClick={clearAll}><Ico d={ICONS.trash} size={15} />Clear All Data</button>
        <p className="subtle" style={{ margin: "4px 0 0", width: "100%" }}>
          Import accepts backups exported from the original single-file app (ledger.html) or from this one —
          same format. Your data lives in Supabase and syncs to every device you sign in from.
        </p>
      </div>
    </div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Team</h3></div>
      <div className="card-body">
        <p className="subtle" style={{ marginTop: 0 }}>Everyone below shares these books — proposals your engineer enters land here instantly. Invite by email; they create their own password at sign-up.</p>
        {(db.members || []).map(m => <div key={m.email} className="cat-row">
          <span style={{ fontWeight: 600 }}>{m.email}</span>
          <span className="subtle">{m.role}{!m.userId ? " · invited, not signed up yet" : ""}</span>
          {m.role !== "owner" && <button className="btn ghost icon" style={{ marginLeft: "auto" }} title="Remove"
            onClick={async () => { if (confirm("Remove " + m.email + "?") && await actions.removeMember(m.email)) toast("Removed"); }}>
            <Ico d={ICONS.trash} size={14} /></button>}
        </div>)}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input className="input" style={{ maxWidth: 300 }} placeholder="engineer@example.com" value={invite} onChange={e => setInvite(e.target.value)} />
          <button className="btn primary" disabled={!invite.includes("@")} onClick={async () => {
            if (await actions.inviteMember(invite)) { setInvite(""); toast("Invited — have them sign up with that email"); }
          }}>Invite</button>
        </div>
      </div>
    </div>
    <div className="card">
      <div className="card-head"><h3>Account</h3></div>
      <div className="card-body">
        <div className="kv"><dt>Signed in as</dt><dd>{session.user.email}</dd></div>
      </div>
    </div>
  </div>;
}
