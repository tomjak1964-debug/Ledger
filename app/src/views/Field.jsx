import { useState, useEffect } from "react";
import { uid, money, todayISO, nameOf, EXPENSE_CATS } from "../lib/helpers.js";
import { Ico, ICONS, Empty, Field, Badge } from "../components/ui.jsx";

// Distance in miles between two {lat,lng} points (haversine); null if unknown.
function miles(a, b) {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return null;
  const R = 3958.8, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Mobile-first field module: nearby jobs, log time, log expense (+ photo), and
// update progress — all against the same data the office sees.
export default function FieldView({ db, actions, toast, session }) {
  const [pos, setPos] = useState(null);
  const [locState, setLocState] = useState("…");
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (!navigator.geolocation) { setLocState("no GPS"); return; }
    navigator.geolocation.getCurrentPosition(
      p => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocState("located"); },
      () => setLocState("location off"));
  }, []);

  const jobs = db.salesOrders.filter(s => s.status === "open").map(so => {
    const cust = db.contacts.find(c => c.id === so.customerId);
    return { so, cust, dist: pos ? miles(pos, cust) : null };
  }).sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));

  const job = jobs.find(j => j.so.id === active);

  if (job) return <JobPanel job={job} db={db} actions={actions} toast={toast} session={session} onBack={() => setActive(null)} />;

  return <div style={{ maxWidth: 640, margin: "0 auto" }}>
    <div className="card">
      <div className="card-head"><h3>Nearby Jobs</h3><span className="subtle" style={{ marginLeft: "auto", fontSize: 12 }}>GPS: {locState}</span></div>
      {jobs.length === 0
        ? <Empty icon={ICONS.job} title="No open jobs" msg="Open sales orders assigned to your shop show up here, closest first." />
        : <div style={{ display: "flex", flexDirection: "column" }}>
          {jobs.map(j => <button key={j.so.id} onClick={() => setActive(j.so.id)}
            style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: "none", border: "none", borderTop: "1px solid var(--line)", padding: "14px 14px", cursor: "pointer" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{j.cust ? j.cust.name : "—"}</div>
              <div className="subtle" style={{ fontSize: 13 }}><span className="doc-id">{j.so.number}</span>{j.so.poNumber ? " · PO " + j.so.poNumber : ""}</div>
            </div>
            <div className="mono subtle" style={{ fontSize: 13 }}>{j.dist == null ? "" : j.dist.toFixed(1) + " mi"}</div>
            <Ico d={ICONS.arrow} size={16} />
          </button>)}
        </div>}
    </div>
    <p className="subtle" style={{ marginTop: 10, textAlign: "center" }}>Set a customer's site location (Contacts → the customer) to enable distance sorting.</p>
  </div>;
}

function JobPanel({ job, db, actions, toast, session, onBack }) {
  const { so, cust } = job;
  const [tab, setTab] = useState("time");
  const lines = so.lineItems || [];
  return <div style={{ maxWidth: 640, margin: "0 auto" }}>
    <div className="toolbar">
      <button className="btn ghost" onClick={onBack}><Ico d={ICONS.back} size={16} />Jobs</button>
      <div style={{ marginLeft: 6 }}><h2 style={{ fontSize: 17 }}>{cust ? cust.name : "—"}</h2><div className="subtle" style={{ fontSize: 13 }}><span className="doc-id">{so.number}</span></div></div>
    </div>
    <div className="pill-tabs" style={{ marginBottom: 14 }}>
      {[["time", "Log Time"], ["expense", "Log Expense"], ["progress", "Progress"]].map(([k, l]) =>
        <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
    </div>
    {tab === "time" && <LogTime so={so} db={db} actions={actions} toast={toast} session={session} />}
    {tab === "expense" && <LogExpense so={so} db={db} actions={actions} toast={toast} />}
    {tab === "progress" && <Progress so={so} lines={lines} actions={actions} toast={toast} />}
  </div>;
}

function LogTime({ so, db, actions, toast, session }) {
  const cats = (db.timeCategories || []).filter(c => c.active);
  const [categoryId, setCategoryId] = useState(cats[0]?.id || "");
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  if (cats.length === 0) return <div className="card"><Empty icon={ICONS.clock} title="No time categories" msg="An admin needs to set up time categories first." /></div>;
  const save = async () => {
    if (!(Number(hours) > 0)) { toast("⚠ Enter hours"); return; }
    setBusy(true);
    const cat = cats.find(c => c.id === categoryId);
    const ok = await actions.saveTimeEntries([{ id: uid(), salesOrderId: so.id, categoryId, date: todayISO(), hours: Number(hours) || 0, rate: cat?.rate || 0, cost: cat?.costRate || 0, description, userEmail: session.user.email }]);
    setBusy(false);
    if (ok) { setHours(""); setDescription(""); toast("Time logged"); }
  };
  return <div className="card"><div className="card-body">
    <Field label="Category"><select className="select" value={categoryId} onChange={e => setCategoryId(e.target.value)}>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
    <Field label="Hours"><input className="input mono" type="number" step="any" inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} /></Field>
    <Field label="What you did"><textarea className="input" value={description} onChange={e => setDescription(e.target.value)} /></Field>
    <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Log Time"}</button>
    <p className="subtle" style={{ margin: "8px 0 0" }}>Logged time is billable after an admin approves it.</p>
  </div></div>;
}

function LogExpense({ so, db, actions, toast }) {
  const [category, setCategory] = useState(EXPENSE_CATS[0] || "Materials");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!(Number(amount) > 0)) { toast("⚠ Enter an amount"); return; }
    setBusy(true);
    const exp = await actions.saveExpense({ id: uid(), _new: true, date: todayISO(), category, vendor, amount: Number(amount) || 0, method: "Field", notes, salesOrderId: so.id });
    if (exp && file) await actions.uploadAttachment("expense", exp.id, file);
    setBusy(false);
    if (exp) { setAmount(""); setVendor(""); setNotes(""); setFile(null); toast("Expense saved" + (file ? " with photo" : "")); }
  };
  return <div className="card"><div className="card-body">
    <div className="row">
      <Field label="Category"><select className="select" value={category} onChange={e => setCategory(e.target.value)}>{EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Amount"><input className="input mono" type="number" step="any" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
    </div>
    <Field label="Vendor / Payee"><input className="input" value={vendor} onChange={e => setVendor(e.target.value)} /></Field>
    <Field label="Notes"><input className="input" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    <Field label="Receipt photo"><input className="input" type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files?.[0] || null)} /></Field>
    <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Expense"}</button>
  </div></div>;
}

function Progress({ so, lines, actions, toast }) {
  const toggle = async (li, ready) => { if (await actions.setLineReady(so.id, li.id, ready)) toast(ready ? "Marked ready" : "Unmarked"); };
  return <div className="card"><div className="card-body">
    {lines.length === 0 ? <p className="subtle" style={{ margin: 0 }}>No line items.</p>
      : lines.map(li => <div key={li.id} className="cat-row" style={{ padding: "10px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: li.invoiced || li.closed ? "default" : "pointer", flex: 1 }}>
          <input type="checkbox" checked={!!li.ready} disabled={li.invoiced || li.closed} onChange={e => toggle(li, e.target.checked)} />
          <span>{li.desc} <span className="subtle">· {li.qty} {li.unit}</span></span>
        </label>
        {li.invoiced ? <Badge status="invoiced" /> : li.closed ? <Badge status="closed" /> : li.ready ? <Badge status="ready" /> : null}
      </div>)}
    <p className="subtle" style={{ margin: "8px 0 0" }}>Marking items ready flags the job for invoicing in the office.</p>
  </div></div>;
}
