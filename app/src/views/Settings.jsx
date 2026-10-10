import { useState, useRef, useEffect } from "react";
import { uid, money, todayISO, fmtDate, isoDate } from "../lib/helpers.js";
import { Ico, ICONS, Field, PasswordInput } from "../components/ui.jsx";
import ChangePassword from "../components/ChangePassword.jsx";
import { AREAS, isAdminRole } from "../lib/permissions.js";
import { supabase } from "../lib/supabaseClient.js";
import FormsTab from "../components/FormsEditor.jsx";
import { proposalConfig } from "../calc/proposals.js";
import { ROLE_LABELS, HOUR_MODEL_LABELS } from "../calc/estimates.js";
import { REV } from "../lib/version.js";
import AccountSelect from "../components/AccountSelect.jsx";
import { accountSettings } from "../calc/accounts.js";

export default function SettingsView({ db, actions, toast, session, readOnly, isAdmin }) {
  const [s, setS] = useState(db.settings);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("company");
  const fileRef = useRef();
  const TABS = [
    ["company", "Company"],
    ["data", "Data"],
    ["forms", "Forms"],
    ["proposals", "Proposals"],
    ["accounts", "Accounts"],
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
          <Field label="Default Payment Terms (days)" hint="Used for any customer or vendor without terms of their own (Customers / Vendors)"><input className="input mono" type="number" value={s.terms} onChange={e => set("terms", Number(e.target.value))} /></Field>
        </div>
        <div className="row">
          <Field label="Quote Prefix"><input className="input" value={s.quotePrefix} onChange={e => set("quotePrefix", e.target.value)} /></Field>
          <Field label="SO Prefix"><input className="input" value={s.soPrefix} onChange={e => set("soPrefix", e.target.value)} /></Field>
          <Field label="Invoice Prefix"><input className="input" value={s.invPrefix} onChange={e => set("invPrefix", e.target.value)} /></Field>
          <Field label="Credit Note Prefix" hint="Credit notes run in their own series"><input className="input" value={s.creditPrefix || "CM"} onChange={e => set("creditPrefix", e.target.value)} /></Field>
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

    {tab === "forms" && <FormsTab s={s} set={set} readOnly={readOnly} saveAll={saveAll} />}
    {tab === "proposals" && <ProposalsTab s={s} set={set} readOnly={readOnly} saveAll={saveAll} />}
    {tab === "accounts" && <AccountsTab db={db} s={s} set={set} readOnly={readOnly} saveAll={saveAll} />}

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
        <div className="kv"><dt>App revision</dt><dd className="mono">Rev {REV} <span className="subtle">— shown at the foot of the menu, with Update when a newer one is out</span></dd></div>
        <div className="divider"></div>
        <div className="subtle" style={{ fontWeight: 600, marginBottom: 8 }}>Change Password</div>
        <ChangePassword toast={toast} />
      </div>
    </div>}
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
      <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => setEdit({ id: uid(), _new: true, name: "", rate: "", costRate: "", active: true, sort: cats.length })}><Ico d={ICONS.plus} size={14} />New Category</button>
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
          <Field label="Bill Rate ($/hr)" hint="Charged to the customer"><input className="input mono" type="number" step="any" value={edit.rate ?? ""} placeholder="0.00" onChange={e => setEdit({ ...edit, rate: e.target.value })} /></Field>
          <Field label="Cost Rate ($/hr)" hint="What it costs you"><input className="input mono" type="number" step="any" value={edit.costRate ?? ""} placeholder="0.00" onChange={e => setEdit({ ...edit, costRate: e.target.value })} /></Field>
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
// When someone last signed in, as a pill: green within a week, grey older,
// amber never.
function SignInPill({ at, hasLogin }) {
  if (!hasLogin || at === null) return <span className="badge amber" title="This login hasn't been used yet"><span className="dot"></span>Never signed in</span>;
  if (at === undefined) return null;
  const d = new Date(at), days = (Date.now() - d.getTime()) / 86400000;
  const when = days < 1 && d.toDateString() === new Date().toDateString()
    ? "today " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : fmtDate(isoDate(d));
  return <span className={"badge " + (days <= 7 ? "green" : "gray")} title={"Last signed in " + d.toLocaleString("en-US")}><span className="dot"></span>Last signed in {when}</span>;
}

function UsersCard({ db, actions, toast, session }) {
  const [signIns, setSignIns] = useState(null);
  useEffect(() => { let live = true; actions.memberSignIns().then(m => { if (live) setSignIns(m); }); return () => { live = false; }; }, [db.members]);
  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head"><h3>Users & Access</h3></div>
    <div className="card-body">
      <p className="subtle" style={{ marginTop: 0 }}>Create a login for each teammate and set what they can see. <b>Read</b> = view only; <b>Read &amp; write</b> = view and edit; <b>No access</b> hides that area entirely. Owners and admins have full access.</p>
      {(db.members || []).map(m => <MemberRow key={m.email} m={m} self={m.email === session.user.email} actions={actions} toast={toast}
        lastSignIn={signIns ? (m.userId ? (signIns[m.userId] ?? null) : null) : undefined} />)}
      <div className="divider"></div>
      <CreateUserForm actions={actions} toast={toast} />
    </div>
  </div>;
}

function MemberRow({ m, self, actions, toast, lastSignIn }) {
  const owner = m.role === "owner";
  const [role, setRole] = useState(m.role);
  const [name, setName] = useState(m.name || "");
  const [perms, setPerms] = useState(m.permissions || {});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [rBusy, setRBusy] = useState(false);
  const [shown, setShown] = useState("");
  const isAdmin = isAdminRole(role);
  const dirty = role !== m.role || name.trim() !== (m.name || "") || JSON.stringify(perms) !== JSON.stringify(m.permissions || {});
  const save = async () => { setSaving(true); if (await actions.updateMember(m.email, { role, name, permissions: isAdmin ? {} : perms })) toast("Saved " + (name.trim() || m.email)); setSaving(false); };
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
      <input className="input" style={{ maxWidth: 200, fontWeight: 600 }} value={name} placeholder="Name" onChange={e => setName(e.target.value)} />
      <span className="subtle">{m.email}{self ? " · you" : ""}</span>
      <SignInPill at={lastSignIn} hasLogin={!!m.userId} />
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
  const [name, setName] = useState("");
  const [password, setPassword] = useState(genPassword());
  const [role, setRole] = useState("member");
  const [perms, setPerms] = useState({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  const create = async () => {
    if (!email.includes("@")) { toast("⚠ Enter a valid email"); return; }
    if (password.length < 8) { toast("⚠ Password must be at least 8 characters"); return; }
    setBusy(true);
    const ok = await actions.createUser({ email: email.trim().toLowerCase(), name, password, role, permissions: isAdminRole(role) ? {} : perms });
    setBusy(false);
    if (ok) {
      setCreated({ email: email.trim().toLowerCase(), password });
      setEmail(""); setName(""); setPassword(genPassword()); setRole("member"); setPerms({});
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
      <Field label="Name"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Barry Smith" /></Field>
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


// Settings → Accounts: the general ledger accounts the app posts to on its own
// (calc/accounts.js). A customer or vendor with an account of their own wins
// over the income / expense defaults here; the rest are used every time.
function AccountsTab({ db, s, set, readOnly, saveAll }) {
  const a = accountSettings(s);
  const setA = (k, v) => set("accounts", { ...(s.accounts || {}), [k]: v });
  const row = (k, label, hint, types, groups) => <Field key={k} label={label} hint={hint}>
    <AccountSelect db={db} value={a[k]} onChange={v => setA(k, v)} types={types} groups={groups} disabled={readOnly} blank="— pick an account —" /></Field>;
  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head"><h3>Posting Accounts</h3><span className="subtle" style={{ marginLeft: "auto" }}>from the chart under System → Chart of Accounts</span></div>
    <div className="card-body">
      {!(db.accounts || []).length && <p className="subtle" style={{ marginTop: 0 }}>Reading the built-in TMJ chart. Load it under System → Chart of Accounts to rename accounts or add your own.</p>}
      <div className="row">
        <Field label="Accounting basis" hint={a.basis === "accrual"
          ? "Invoices post when issued and bills when entered; A/R and A/P are on the ledger"
          : "Revenue is recognized when a receipt is recorded and expenses when a bill is paid — the basis the books and tax returns are kept on. No A/R or A/P on the ledger"}>
          <select className="select" value={a.basis === "accrual" ? "accrual" : "cash"} disabled={readOnly} onChange={e => setA("basis", e.target.value)}>
            <option value="cash">Cash</option><option value="accrual">Accrual</option>
          </select></Field>
      </div>
      <div className="row">
        {row("cash", "Cash account", "Pays bills and takes receipts unless a payment says otherwise", ["Cash"])}
        {row("ar", "Accounts Receivable", a.basis === "accrual" ? "Debited by every invoice, credited by every receipt" : "Used on the accrual basis only", ["Accounts Receivable"])}
        {row("ap", "Accounts Payable", a.basis === "accrual" ? "Credited by every bill, debited by every bill payment" : "Used on the accrual basis only", ["Accounts Payable"])}
      </div>
      <div className="row">
        {row("income", "Default income account", "For a customer with no sales account of their own", ["Income"])}
        {row("expense", "Default expense account", "For a vendor with no expense account of their own", null, ["expense", "cos"])}
        {row("salesTax", "Sales tax payable", "The tax on every invoice", null, ["liability"])}
      </div>
      <div className="row">
        {row("salesDiscount", "Sales discounts", "An early-payment term a customer took", null, ["income", "expense"])}
        {row("purchaseDiscount", "Purchase discounts", "An early-payment term the shop took on a bill", null, ["expense", "cos", "income"])}
      </div>
      <div className="row">
        {row("retainedEarnings", "Retained Earnings", "Where income, expenses and distributions close to at year-end", null, ["equity"])}
        <Field label="Fiscal year ends" hint="The close posts on the last day of this month; the Balance Sheet and Trial Balance dated after it show the year rolled into Retained Earnings">
          <select className="select" value={Number(a.fiscalYearEndMonth) || 12} disabled={readOnly} onChange={e => setA("fiscalYearEndMonth", Number(e.target.value))}>
            {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((mn, i) => <option key={mn} value={i + 1}>{mn}</option>)}
          </select></Field>
      </div>
      <div className="divider"></div>
      <h4 style={{ margin: "0 0 4px" }}>Lock the books</h4>
      <p className="subtle" style={{ marginTop: 0 }}>Once a month is reconciled or a year is filed, lock it. Nothing dated on or before the lock date can be added,
        deleted or have its money changed — invoices, bills, payments and receipts, expenses and journal entries — on any device. Marking an invoice printed,
        notes and references still work. To correct something locked, move the date back, fix it, and lock again.</p>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <Field label="Books locked through" hint={a.lockDate ? "Locked through " + fmtDate(a.lockDate) + " once saved" : "Blank — nothing is locked"}>
          <input className="input" type="date" value={a.lockDate || ""} disabled={readOnly} onChange={e => setA("lockDate", e.target.value)} /></Field>
        <div style={{ display: "flex", gap: 8, paddingBottom: 18 }}>
          <button className="btn" disabled={readOnly} onClick={() => { const d = new Date(); setA("lockDate", isoDate(new Date(d.getFullYear(), d.getMonth(), 0))); }}>End of Last Month</button>
          {a.lockDate && <button className="btn ghost" disabled={readOnly} onClick={() => setA("lockDate", "")}>Remove Lock</button>}
        </div>
      </div>
      <button className="btn primary" disabled={readOnly} onClick={saveAll}><Ico d={ICONS.check} size={15} />Save Settings</button>
    </div>
  </div>;
}

// Settings → Proposals: what the machine proposal and the controls estimate
// read from settings.proposal (calc/proposals.js proposalConfig). The rate
// card and the hour model price a controls estimate; the letter fields go on
// both documents.
function ProposalsTab({ s, set, readOnly, saveAll }) {
  const cfg = proposalConfig(s);
  const p = s.proposal || {};
  const setP = (k, v) => set("proposal", { ...p, [k]: v });
  const setRate = (k, v) => setP("laborRates", { ...(p.laborRates || {}), [k]: Number(v) || 0 });
  const setHm = (table, key, v) => setP("hourModel", { ...(p.hourModel || {}), [table]: { ...((p.hourModel || {})[table] || {}), [key]: Number(v) || 0 } });
  const setHmScalar = (key, v) => setP("hourModel", { ...(p.hourModel || {}), [key]: Number(v) || 0 });
  const phaseRows = (key, phases, onChange) => <div>
    {phases.map((ph, i) => <div key={i} className="row" style={{ alignItems: "center", marginBottom: 4 }}>
      <input className="input" value={ph.label} disabled={readOnly} onChange={e => onChange(phases.map((q, j) => j === i ? { ...q, label: e.target.value } : q))} />
      <input className="input mono" type="number" min="0" style={{ maxWidth: 90 }} value={ph.pct} disabled={readOnly} onChange={e => onChange(phases.map((q, j) => j === i ? { ...q, pct: Number(e.target.value) || 0 } : q))} />
      <button className="btn ghost icon" disabled={readOnly} onClick={() => onChange(phases.filter((_, j) => j !== i))}><Ico d={ICONS.trash} size={15} /></button>
    </div>)}
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button className="btn sm" disabled={readOnly} onClick={() => onChange([...phases, { key: key + phases.length, label: "", pct: 0 }])}><Ico d={ICONS.plus} size={14} />Add phase</button>
      <span className="mono subtle">{phases.reduce((t, ph) => t + (Number(ph.pct) || 0), 0)}%</span>
    </div>
  </div>;
  const hmKeys = ["hardwareDesign", "drafting", "plc", "hmi", "docs", "fat", "safetyVal"];
  const hmLabels = { hardwareDesign: "Hdw Design", drafting: "Drafting", plc: "PLC", hmi: "HMI", docs: "Docs", fat: "FAT", safetyVal: "Safety Val." };

  return <>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Proposal Letter</h3></div>
      <div className="card-body">
        <div className="row">
          <Field label="Signer" hint="Prints under Regards,"><input className="input" value={cfg.signer} disabled={readOnly} onChange={e => setP("signer", e.target.value)} /></Field>
          <Field label="Proposal number prefix"><input className="input mono" value={cfg.propPrefix} disabled={readOnly} onChange={e => setP("propPrefix", e.target.value)} /></Field>
        </div>
        <Field label="Standards line" hint="Fixture proposals: “System hardware and software design will follow …”"><input className="input" value={cfg.standards} disabled={readOnly} onChange={e => setP("standards", e.target.value)} /></Field>
        <div className="row">
          <Field label="Default build / start-up location"><input className="input" value={cfg.location} disabled={readOnly} onChange={e => setP("location", e.target.value)} /></Field>
          <Field label="PLC platform"><input className="input" value={cfg.plcType} disabled={readOnly} onChange={e => setP("plcType", e.target.value)} /></Field>
          <Field label="HMI platform"><input className="input" value={cfg.hmiType} disabled={readOnly} onChange={e => setP("hmiType", e.target.value)} /></Field>
        </div>
        <div className="row">
          <Field label="Offer valid for (days)"><input className="input mono" type="number" min="0" value={cfg.validityDays} disabled={readOnly} onChange={e => setP("validityDays", Number(e.target.value) || 0)} /></Field>
          <Field label="Support rate ($/hr)" hint="Stand-by / production support beyond the scope"><input className="input mono" type="number" min="0" value={cfg.supportRate} disabled={readOnly} onChange={e => setP("supportRate", Number(e.target.value) || 0)} /></Field>
        </div>
      </div>
    </div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Labor Rate Card</h3><span className="subtle" style={{ marginLeft: "auto" }}>$/hour — prices a system proposal</span></div>
      <div className="card-body"><div className="row">
        {Object.entries(ROLE_LABELS).map(([k, label]) => <Field key={k} label={label}>
          <input className="input mono" type="number" min="0" step="any" value={cfg.laborRates[k] ?? 0} disabled={readOnly} onChange={e => setRate(k, e.target.value)} />
        </Field>)}
      </div>
      <div className="row">
        <Field label="Travel & living ($ per person-day)"><input className="input mono" type="number" min="0" value={cfg.travelPerDay} disabled={readOnly} onChange={e => setP("travelPerDay", Number(e.target.value) || 0)} /></Field>
        <Field label="Hardware markup (%)"><input className="input mono" type="number" min="0" step="any" value={cfg.hardwareMarkupPct} disabled={readOnly} onChange={e => setP("hardwareMarkupPct", Number(e.target.value) || 0)} /></Field>
        <Field label="Default contingency (%)"><input className="input mono" type="number" min="0" step="any" value={cfg.contingencyPct} disabled={readOnly} onChange={e => setP("contingencyPct", Number(e.target.value) || 0)} /></Field>
      </div></div>
    </div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Hour Model</h3><span className="subtle" style={{ marginLeft: "auto" }}>hours a system proposal suggests per unit of content</span></div>
      <table><thead><tr><th>Per</th>{hmKeys.map(k => <th key={k} className="num">{hmLabels[k]}</th>)}</tr></thead>
        <tbody>{Object.entries(HOUR_MODEL_LABELS).map(([table, label]) => <tr key={table}>
          <td>{label}</td>
          {hmKeys.map(k => <td key={k} className="num"><input className="input mono" type="number" min="0" step="any" style={{ width: 70 }}
            value={cfg.hourModel[table]?.[k] ?? ""} placeholder="0" disabled={readOnly} onChange={e => setHm(table, k, e.target.value)} /></td>)}
        </tr>)}</tbody></table>
      <div className="card-body"><div className="row">
        <Field label="Project management (% of engineering hours)"><input className="input mono" type="number" min="0" step="any" value={cfg.hourModel.pmPct} disabled={readOnly} onChange={e => setHmScalar("pmPct", e.target.value)} /></Field>
        <Field label="Hours in a start-up day"><input className="input mono" type="number" min="0" step="any" value={cfg.hourModel.hoursPerDay} disabled={readOnly} onChange={e => setHmScalar("hoursPerDay", e.target.value)} /></Field>
      </div></div>
    </div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Invoicing Schedules</h3><span className="subtle" style={{ marginLeft: "auto" }}>the splits a new proposal starts with</span></div>
      <div className="card-body">
        <div className="row">
          <div style={{ flex: 1, minWidth: 260 }}><div className="subtle" style={{ fontWeight: 700, marginBottom: 6 }}>Fixture proposal</div>
            {phaseRows("m", cfg.phases, v => setP("phases", v))}</div>
          <div style={{ flex: 1, minWidth: 260 }}><div className="subtle" style={{ fontWeight: 700, marginBottom: 6 }}>Controls — engineering only</div>
            {phaseRows("e", cfg.controlsPhases.engineering, v => setP("controlsPhases", { ...cfg.controlsPhases, engineering: v }))}</div>
          <div style={{ flex: 1, minWidth: 260 }}><div className="subtle" style={{ fontWeight: 700, marginBottom: 6 }}>Controls — with hardware</div>
            {phaseRows("h", cfg.controlsPhases.hardware, v => setP("controlsPhases", { ...cfg.controlsPhases, hardware: v }))}</div>
        </div>
      </div>
    </div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Standard Assumptions and Exclusions</h3><span className="subtle" style={{ marginLeft: "auto" }}>one per line — a new system proposal starts with these</span></div>
      <div className="card-body"><div className="row">
        <Field label="Assumptions and clarifications"><textarea className="input" rows={7} value={cfg.assumptions.join("\n")} disabled={readOnly} onChange={e => setP("assumptions", e.target.value.split("\n"))} /></Field>
        <Field label="Exclusions"><textarea className="input" rows={7} value={cfg.exclusions.join("\n")} disabled={readOnly} onChange={e => setP("exclusions", e.target.value.split("\n"))} /></Field>
      </div></div>
    </div>

    {!readOnly && <button className="btn primary" onClick={saveAll}><Ico d={ICONS.check} size={15} />Save Proposal Settings</button>}
  </>;
}
