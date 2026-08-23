import { useState, useRef, useEffect } from "react";
import { uid, money, todayISO, fmtDate } from "../lib/helpers.js";
import { Ico, ICONS, Field, PasswordInput } from "../components/ui.jsx";
import { AREAS, isAdminRole } from "../lib/permissions.js";
import { supabase } from "../lib/supabaseClient.js";
import { checkLayout, openCheckPdf } from "../lib/checkPrint.js";

export default function SettingsView({ db, actions, toast, session, readOnly, isAdmin }) {
  const [s, setS] = useState(db.settings);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("company");
  const fileRef = useRef();
  const TABS = [
    ["company", "Company"],
    ["data", "Data"],
    ["checks", "Check Printing"],
    ...(isAdmin ? [["users", "Users & Access"], ["time", "Time Categories"], ["backups", "Backups"]] : []),
    ["activity", "Activity"],
    ["account", "Account"],
  ];
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

  return <div style={{ maxWidth: 820 }}>
    <div className="pill-tabs" style={{ marginBottom: 16, flexWrap: "wrap" }}>
      {TABS.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
    </div>

    {tab === "company" && <>
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
        <button className="btn primary" disabled={readOnly} onClick={saveAll}><Ico d={ICONS.check} size={15} />Save Settings</button>
      </div>
    </div>
    </>}

    {tab === "data" && <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Data</h3></div>
      <div className="card-body" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn" disabled={busy} onClick={exportData}>Export Backup (JSON)</button>
        <button className="btn" disabled={busy || readOnly} onClick={() => fileRef.current?.click()}>{busy ? "Working…" : "Import Backup (JSON)"}</button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
          onChange={e => { importData(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="btn" disabled={busy || readOnly} onClick={loadSample}>Load Sample Data</button>
        <button className="btn danger" disabled={busy || readOnly} onClick={clearAll}><Ico d={ICONS.trash} size={15} />Clear All Data</button>
        <p className="subtle" style={{ margin: "4px 0 0", width: "100%" }}>
          Import accepts backups exported from the original single-file app (ledger.html) or from this one —
          same format. Your data lives in Supabase and syncs to every device you sign in from.
        </p>
      </div>
    </div>}

    {tab === "checks" && <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Check Printing</h3></div>
      <div className="card-body">
        <p className="subtle" style={{ marginTop: 0 }}>Positions are inches from the top-left of the page, for pre-printed voucher stock (check on top).
          Print the test pattern on plain paper, hold it over a check, and nudge the numbers. Always print at 100% scale.</p>
        <div className="row">
          {Object.entries(checkLayout(s).fields).map(([k, f]) => <Field key={k} label={f.label}>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input mono" type="number" step="0.05" value={f.x} title="X (in)"
                onChange={e => set("check", { ...s.check, fields: { ...(s.check?.fields || {}), [k]: { ...(s.check?.fields?.[k] || {}), x: Number(e.target.value) } } })} />
              <input className="input mono" type="number" step="0.05" value={f.y} title="Y (in)"
                onChange={e => set("check", { ...s.check, fields: { ...(s.check?.fields || {}), [k]: { ...(s.check?.fields?.[k] || {}), y: Number(e.target.value) } } })} />
            </div>
          </Field>)}
          <Field label="Font Size"><input className="input mono" type="number" value={checkLayout(s).fontSize}
            onChange={e => set("check", { ...s.check, fontSize: Number(e.target.value) })} /></Field>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" onClick={() => openCheckPdf({ test: true, settings: s })}>Print Test Pattern</button>
          <button className="btn" onClick={() => openCheckPdf({
            payment: { amount: 12345.67, date: todayISO(), ref: "1001" },
            vendor: { name: "Sample Vendor, Inc.", address: "123 Main St\nAnytown, MI 48000" },
            memo: "Inv 9999", stubLines: [{ ref: "9999", desc: "Sample bill", amount: 12345.67 }], settings: s,
          })}>Print Sample Check</button>
          <button className="btn primary" disabled={readOnly} onClick={saveAll}><Ico d={ICONS.check} size={15} />Save Positions</button>
        </div>
      </div>
    </div>}

    {tab === "users" && isAdmin && <UsersCard db={db} actions={actions} toast={toast} session={session} />}
    {tab === "time" && isAdmin && <TimeCategoriesCard db={db} actions={actions} toast={toast} />}
    {tab === "backups" && isAdmin && <BackupsCard s={s} set={set} saveAll={saveAll} actions={actions} toast={toast} readOnly={readOnly} />}

    {tab === "activity" && <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Activity — Deletions</h3></div>
      <div className="card-body">
        <p className="subtle" style={{ marginTop: 0 }}>An audit trail of deleted records — who removed what, and when. Deleting an invoice also reopens its sales order for re-invoicing.</p>
        {(db.auditLog || []).length === 0
          ? <p className="subtle" style={{ margin: 0 }}>No deletions recorded yet.</p>
          : (db.auditLog || []).slice(0, 50).map(a => <div key={a.id} className="cat-row">
            <span className="badge red" style={{ textTransform: "capitalize" }}><span className="dot"></span>{a.entityType.replace("_", " ")}</span>
            <span className="mono">{a.entityNumber || "—"}</span>
            {a.detail && <span className="subtle">{a.detail}</span>}
            <span className="subtle" style={{ marginLeft: "auto" }}>{a.userEmail}</span>
            <span className="subtle">{fmtDate((a.createdAt || "").slice(0, 10))} {(a.createdAt || "").slice(11, 16)}</span>
          </div>)}
      </div>
    </div>}

    {tab === "account" && <div className="card">
      <div className="card-head"><h3>Account</h3></div>
      <div className="card-body">
        <div className="kv"><dt>Signed in as</dt><dd>{session.user.email}</dd></div>
        <div className="divider"></div>
        <ChangePassword toast={toast} />
      </div>
    </div>}
  </div>;
}

// Self-service password change for the signed-in user.
function ChangePassword({ toast }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const err = pw.length > 0 && pw.length < 8 ? "At least 8 characters" : (confirm && pw !== confirm ? "Passwords don't match" : "");
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast("⚠ " + error.message); return; }
    setPw(""); setConfirm(""); toast("Password updated");
  };
  return <div>
    <div className="subtle" style={{ fontWeight: 600, marginBottom: 8 }}>Change Password</div>
    <div className="row">
      <Field label="New Password" hint="At least 8 characters"><PasswordInput autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
      <Field label="Confirm New Password"><PasswordInput autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></Field>
    </div>
    {err && <p className="subtle" style={{ margin: "0 0 8px", color: "var(--neg)" }}>{err}</p>}
    <button className="btn primary" disabled={busy || !pw || !!err || pw !== confirm} onClick={save}>{busy ? "Saving…" : "Update Password"}</button>
  </div>;
}

// Automated backup settings + on-demand backup. Config lives in settings.backup.
function BackupsCard({ s, set, saveAll, actions, toast, readOnly }) {
  const b = s.backup || { enabled: false, email: false, recipient: "", storage: true };
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState(null);
  const setB = (patch) => set("backup", { ...b, ...patch });
  const bool = (v) => v ? "1" : "0";
  const loadFiles = async () => { const list = await actions.listBackups(); if (list) setFiles(list); };
  useEffect(() => { loadFiles(); }, []);
  const download = async (path) => { const url = await actions.backupUrl(path); if (url) window.open(url, "_blank"); };
  const size = n => n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB";
  const runNow = async () => {
    setBusy(true);
    const res = await actions.runBackupNow();
    setBusy(false);
    if (res && res.results) {
      const r = res.results[0] || {};
      if (r.skipped) toast("Backups aren't enabled yet — turn them on and save first.");
      else toast(`Backup done${r.stored ? " · saved" : ""}${r.emailed ? " · emailed" : ""}`);
      loadFiles();
    }
  };
  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head"><h3>Automated Backups</h3></div>
    <div className="card-body">
      <p className="subtle" style={{ marginTop: 0 }}>A full JSON snapshot of your books, emailed and/or saved to private storage. Choose either or both. Runs on the schedule you set in Supabase; use “Back up now” to test.</p>
      <div className="row">
        <Field label="Automated backups"><select className="select" value={bool(b.enabled)} onChange={e => setB({ enabled: e.target.value === "1" })}><option value="0">Off</option><option value="1">On</option></select></Field>
        <Field label="Save to storage" hint="Private “backups” bucket"><select className="select" value={bool(b.storage)} onChange={e => setB({ storage: e.target.value === "1" })}><option value="0">Off</option><option value="1">On</option></select></Field>
        <Field label="Email backup"><select className="select" value={bool(b.email)} onChange={e => setB({ email: e.target.value === "1" })}><option value="0">Off</option><option value="1">On</option></select></Field>
      </div>
      {b.email && <Field label="Email to"><input className="input" value={b.recipient || ""} onChange={e => setB({ recipient: e.target.value })} placeholder="you@example.com" /></Field>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn primary" disabled={readOnly} onClick={saveAll}><Ico d={ICONS.check} size={15} />Save Settings</button>
        <button className="btn" disabled={busy || readOnly} onClick={runNow}>{busy ? "Backing up…" : "Back up now"}</button>
      </div>
      <div className="divider"></div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <span className="subtle" style={{ fontWeight: 700 }}>Recent backups</span>
        <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={loadFiles}><Ico d={ICONS.refresh} size={13} />Refresh</button>
      </div>
      {files === null ? <p className="subtle" style={{ margin: 0 }}>Loading…</p>
        : files.length === 0 ? <p className="subtle" style={{ margin: 0 }}>No stored backups yet. Turn on “Save to storage” and run one.</p>
          : files.map(f => <div key={f.path} className="cat-row">
            <button className="link-btn" style={{ color: "var(--accent)", fontWeight: 600 }} onClick={() => download(f.path)}>{f.name}</button>
            <span className="subtle">{size(f.size)}</span>
            <span className="subtle" style={{ marginLeft: "auto" }}>{f.updatedAt ? fmtDate(f.updatedAt.slice(0, 10)) : ""}</span>
          </div>)}
      <p className="subtle" style={{ margin: "10px 0 0" }}>Requires the <span className="mono">scheduled-backup</span> edge function. For the recurring schedule, a Supabase Cron job calls it with the <span className="mono">x-cron-secret</span> header.</p>
    </div>
  </div>;
}

// Admin-managed time categories with flat hourly rates.
function TimeCategoriesCard({ db, actions, toast }) {
  const [edit, setEdit] = useState(null);
  const cats = db.timeCategories || [];
  const save = async () => { if (await actions.saveTimeCategory({ ...edit, rate: Number(edit.rate) || 0, costRate: Number(edit.costRate) || 0 })) { setEdit(null); toast("Category saved"); } };
  const del = async (id) => { if (confirm("Delete this category? Existing time entries keep their snapshot rate.") && await actions.deleteTimeCategory(id)) toast("Removed"); };
  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head"><h3>Time Categories</h3>
      <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => setEdit({ id: uid(), _new: true, name: "", rate: 0, costRate: 0, active: true, sort: cats.length })}><Ico d={ICONS.plus} size={14} />New Category</button>
    </div>
    <div className="card-body">
      <p className="subtle" style={{ marginTop: 0 }}>Categories and flat hourly rates users pick when logging time. The rate is snapshotted onto each time entry.</p>
      {cats.length === 0
        ? <p className="subtle" style={{ margin: 0 }}>No categories yet — add Engineering, Field Service, etc.</p>
        : cats.map(c => <div key={c.id} className="cat-row">
          <span style={{ fontWeight: 600 }}>{c.name}</span>
          <span className="mono subtle">bill {money(c.rate)}/hr · cost {money(c.costRate || 0)}/hr</span>
          {!c.active && <span className="subtle">· inactive</span>}
          <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
            <button className="btn ghost icon" onClick={() => setEdit({ ...c })} title="Edit"><Ico d={ICONS.edit} size={14} /></button>
            <button className="btn ghost icon" onClick={() => del(c.id)} title="Delete"><Ico d={ICONS.trash} size={14} /></button>
          </span>
        </div>)}
      {edit && <div style={{ background: "var(--canvas)", borderRadius: 9, padding: 12, marginTop: 10 }}>
        <div className="row">
          <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Engineering" /></Field>
          <Field label="Bill Rate ($/hr)" hint="Charged to the customer"><input className="input mono" type="number" step="any" value={edit.rate} onChange={e => setEdit({ ...edit, rate: e.target.value })} /></Field>
          <Field label="Cost Rate ($/hr)" hint="What it costs you"><input className="input mono" type="number" step="any" value={edit.costRate || 0} onChange={e => setEdit({ ...edit, costRate: e.target.value })} /></Field>
          <Field label="Active"><select className="select" value={edit.active ? "1" : "0"} onChange={e => setEdit({ ...edit, active: e.target.value === "1" })}><option value="1">Active</option><option value="0">Inactive</option></select></Field>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={!edit.name.trim()} onClick={save}>Save Category</button>
          <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
        </div>
      </div>}
    </div>
  </div>;
}

// Generate a readable, mixed temp password (≥ 8 chars) for a new user.
function genPassword() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
  return "Tmj-" + b64.slice(0, 10);
}

const PERM_OPTS = [["", "No access"], ["read", "Read only"], ["write", "Read & write"]];

// Per-area access grid. `value` is a { area: 'read'|'write' } map; empty means no access.
function PermMatrix({ value, onChange }) {
  const set = (area, lvl) => { const n = { ...value }; if (lvl) n[area] = lvl; else delete n[area]; onChange(n); };
  return <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 12px", marginTop: 8, maxWidth: 440 }}>
    {AREAS.map(a => <div key={a.key} style={{ display: "contents" }}>
      <span className="subtle" style={{ alignSelf: "center" }}>{a.label}</span>
      <select className="select" style={{ minWidth: 150 }} value={value[a.key] || ""} onChange={e => set(a.key, e.target.value)}>
        {PERM_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>)}
  </div>;
}

// Admin-only: create logins, set roles, and set per-area access.
function UsersCard({ db, actions, toast, session }) {
  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head"><h3>Users & Access</h3></div>
    <div className="card-body">
      <p className="subtle" style={{ marginTop: 0 }}>Create a login for each teammate and set what they can see. <b>Read</b> = view only; <b>Read &amp; write</b> = view and edit; <b>No access</b> hides that area entirely. Owners and admins have full access.</p>
      {(db.members || []).map(m => <MemberRow key={m.email} m={m} self={m.email === session.user.email} actions={actions} toast={toast} />)}
      <div className="divider"></div>
      <CreateUserForm actions={actions} toast={toast} />
    </div>
  </div>;
}

function MemberRow({ m, self, actions, toast }) {
  const owner = m.role === "owner";
  const [role, setRole] = useState(m.role);
  const [perms, setPerms] = useState(m.permissions || {});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [rBusy, setRBusy] = useState(false);
  const [shown, setShown] = useState("");
  const isAdmin = isAdminRole(role);
  const dirty = role !== m.role || JSON.stringify(perms) !== JSON.stringify(m.permissions || {});
  const save = async () => { setSaving(true); if (await actions.updateMember(m.email, { role, permissions: isAdmin ? {} : perms })) toast("Access updated for " + m.email); setSaving(false); };
  const remove = async () => { if (confirm("Remove " + m.email + "? Their access is revoked (the login itself stays in Supabase).") && await actions.removeMember(m.email)) toast("Removed " + m.email); };
  const openReset = () => { setNewPw(genPassword()); setShown(""); setResetting(true); };
  const doReset = async () => {
    setRBusy(true);
    const ok = await actions.resetUserPassword(m.email, newPw);
    setRBusy(false);
    if (ok) { setShown(newPw); setResetting(false); toast("Password reset for " + m.email); }
  };

  return <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line, #e6e9ef)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontWeight: 600 }}>{m.email}</span>
      {self && <span className="subtle">· you</span>}
      {!m.userId && <span className="subtle">· not signed in yet</span>}
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        {m.userId && <button className="btn ghost sm" title="Set a new password for this user" onClick={openReset}>Reset password</button>}
        {owner ? <span className="badge green"><span className="dot"></span>Owner</span>
          : <select className="select" value={role} onChange={e => setRole(e.target.value)} disabled={self}>
            <option value="member">Member</option><option value="admin">Admin</option>
          </select>}
        {!owner && !self && <button className="btn ghost icon" title="Remove user" onClick={remove}><Ico d={ICONS.trash} size={14} /></button>}
      </div>
    </div>
    {owner || isAdmin
      ? <p className="subtle" style={{ margin: "6px 0 0" }}>Full access to everything.</p>
      : <PermMatrix value={perms} onChange={setPerms} />}
    {resetting && <div style={{ background: "var(--canvas)", borderRadius: 9, padding: 12, marginTop: 8 }}>
      <div className="subtle" style={{ fontWeight: 600, marginBottom: 6 }}>New password for {m.email}</div>
      <div style={{ display: "flex", gap: 6, maxWidth: 360 }}>
        <PasswordInput value={newPw} onChange={e => setNewPw(e.target.value)} />
        <button className="btn" type="button" onClick={() => setNewPw(genPassword())} title="Generate">↻</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn sm primary" disabled={rBusy || newPw.length < 8} onClick={doReset}>{rBusy ? "Setting…" : "Set Password"}</button>
        <button className="btn sm" onClick={() => setResetting(false)}>Cancel</button>
      </div>
    </div>}
    {shown && <p className="subtle" style={{ margin: "8px 0 0" }}>New password set — share it: <span className="mono">{shown}</span></p>}
    {dirty && <button className="btn sm primary" disabled={saving} style={{ marginTop: 8 }} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>}
  </div>;
}

function CreateUserForm({ actions, toast }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(genPassword());
  const [role, setRole] = useState("member");
  const [perms, setPerms] = useState({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  const create = async () => {
    if (!email.includes("@")) { toast("⚠ Enter a valid email"); return; }
    if (password.length < 8) { toast("⚠ Password must be at least 8 characters"); return; }
    setBusy(true);
    const ok = await actions.createUser({ email: email.trim().toLowerCase(), password, role, permissions: isAdminRole(role) ? {} : perms });
    setBusy(false);
    if (ok) {
      setCreated({ email: email.trim().toLowerCase(), password });
      setEmail(""); setPassword(genPassword()); setRole("member"); setPerms({});
      toast("User created");
    }
  };

  if (!open) return <div>
    {created && <div className="auth-note" style={{ marginBottom: 10 }}>
      Created <b>{created.email}</b>. Share these credentials — the password isn't stored and won't be shown again:<br />
      <span className="mono">{created.email}</span> / <span className="mono">{created.password}</span>
    </div>}
    <button className="btn primary" onClick={() => { setCreated(null); setOpen(true); }}><Ico d={ICONS.plus} size={15} />Create User</button>
  </div>;

  return <div>
    <div className="row">
      <Field label="Email"><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="barry@example.com" /></Field>
      <Field label="Initial Password" hint="Give this to the user; they can change it later">
        <div style={{ display: "flex", gap: 6 }}>
          <input className="input mono" value={password} onChange={e => setPassword(e.target.value)} />
          <button className="btn" type="button" onClick={() => setPassword(genPassword())} title="Generate">↻</button>
        </div></Field>
      <Field label="Role"><select className="select" value={role} onChange={e => setRole(e.target.value)}>
        <option value="member">Member</option><option value="admin">Admin (full access)</option>
      </select></Field>
    </div>
    {!isAdminRole(role) && <><div className="subtle" style={{ fontWeight: 600 }}>Access</div><PermMatrix value={perms} onChange={setPerms} /></>}
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <button className="btn primary" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create User"}</button>
      <button className="btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
    </div>
    <p className="subtle" style={{ margin: "8px 0 0" }}>Requires the <span className="mono">admin-create-user</span> edge function to be deployed.</p>
  </div>;
}
