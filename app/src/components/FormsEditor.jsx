// Settings → Forms: the print forms Ledger uses, which document type each one
// prints, and an editor for the fields on a form (what prints, and where).
import { useState, useRef } from "react";
import { Ico, ICONS, Field } from "./ui.jsx";
import { FORM_TYPES, BUILTIN_FORMS, formsOf, formFor, defaultFormId, blankForm, fieldsOf } from "../lib/forms.js";
import { openCheckPdf, sampleCheck } from "../lib/checkPrint.js";

const isBuiltin = id => BUILTIN_FORMS.some(f => f.id === id);
const round2 = n => Math.round(n * 100) / 100;

export default function FormsTab({ s, set, readOnly, saveAll }) {
  const [editId, setEditId] = useState(null);
  const forms = formsOf(s);
  const editing = forms.find(f => f.id === editId);

  // Forms are saved into settings.forms — a full copy per form, built-ins
  // included, so an edited built-in keeps its tuning.
  const writeForm = (form) => {
    const rest = (s.forms || []).filter(f => f.id !== form.id);
    set("forms", [...rest, form]);
  };
  const removeForm = (id) => {
    set("forms", (s.forms || []).filter(f => f.id !== id));
    const assigns = { ...(s.formFor || {}) };
    Object.entries(assigns).forEach(([t, v]) => { if (v === id) delete assigns[t]; });
    set("formFor", assigns);
  };
  const assign = (type, id) => set("formFor", { ...(s.formFor || {}), [type]: id });
  const usedFor = (id) => FORM_TYPES.filter(t => (s.formFor?.[t.key] || defaultFormId(s, t.key)) === id).map(t => t.label);

  if (editing) return <FormEditor form={editing} settings={s} readOnly={readOnly}
    onChange={writeForm} onReset={() => { removeForm(editing.id); setEditId(null); }}
    onDone={() => setEditId(null)} saveAll={saveAll} />;

  return <>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Which form prints what</h3></div>
      <div className="card-body">
        <p className="subtle" style={{ marginTop: 0 }}>Pick the form used for each kind of document. Checks are laid out field by field
          for your pre-printed stock; invoices and remittances use their standard layout.</p>
        <div className="row">
          {FORM_TYPES.map(t => <Field key={t.key} label={t.label} hint={t.hint}>
            <select className="input" disabled={readOnly} value={s.formFor?.[t.key] || defaultFormId(s, t.key)}
              onChange={e => assign(t.key, e.target.value)}>
              {forms.filter(f => f.type === t.key).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>)}
        </div>
        <button className="btn primary" disabled={readOnly} onClick={saveAll}><Ico d={ICONS.check} size={15} />Save Settings</button>
      </div>
    </div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Forms</h3>
        <button className="btn" disabled={readOnly} onClick={() => {
          const f = blankForm("check", "New Check Form");
          writeForm(f); setEditId(f.id);
        }}><Ico d={ICONS.plus} size={15} />New Check Form</button>
      </div>
      <table>
        <thead><tr><th>Form</th><th>Type</th><th>In use for</th><th></th></tr></thead>
        <tbody>{forms.map(f => <tr key={f.id}>
          <td style={{ fontWeight: 600 }}>{f.name} {isBuiltin(f.id) && <span className="badge gray">Built-in</span>}</td>
          <td className="subtle">{FORM_TYPES.find(t => t.key === f.type)?.label || f.type}</td>
          <td className="subtle">{usedFor(f.id).join(", ") || "—"}</td>
          <td className="right" style={{ whiteSpace: "nowrap" }}>
            {!f.fixed && <button className="btn ghost icon" title="Edit form" onClick={() => setEditId(f.id)}><Ico d={ICONS.edit} size={16} /></button>}
            {!f.fixed && <button className="btn ghost icon" title="Duplicate" disabled={readOnly} onClick={() => {
              const copy = { ...JSON.parse(JSON.stringify(f)), id: blankForm(f.type).id, name: f.name + " (copy)", builtin: false };
              writeForm(copy); setEditId(copy.id);
            }}><Ico d={ICONS.copy || ICONS.plus} size={16} /></button>}
            {!isBuiltin(f.id) && <button className="btn ghost icon" title="Delete form" disabled={readOnly}
              onClick={() => { if (confirm(`Delete the form "${f.name}"?`)) removeForm(f.id); }}><Ico d={ICONS.trash} size={16} /></button>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>

    <div className="card">
      <div className="card-head"><h3>Check Numbering</h3></div>
      <div className="card-body">
        <Field label="First Check #" hint="Where numbering starts before any check is written">
          <input className="input mono" type="number" disabled={readOnly} value={s.check?.start ?? 1001}
            onChange={e => set("check", { ...s.check, start: Number(e.target.value) })} /></Field>
        <p className="subtle">After the first check, the next number is always one past the highest check on file. Void a check and its number comes straight back.</p>
        <button className="btn primary" disabled={readOnly} onClick={saveAll}><Ico d={ICONS.check} size={15} />Save Settings</button>
      </div>
    </div>
  </>;
}

function FormEditor({ form, settings, readOnly, onChange, onReset, onDone, saveAll }) {
  const fields = fieldsOf(form);
  const groups = [...new Set(fields.map(f => f.group))];
  const put = (patch) => onChange({ ...form, ...patch });
  const putField = (key, patch) => {
    const cur = fields.find(f => f.key === key);
    const base = { on: cur.on, x: cur.x, y: cur.y, align: cur.align, ...(cur.size ? { size: cur.size } : {}) };
    onChange({ ...form, fields: { ...form.fields, [key]: { ...base, ...patch } } });
  };
  const sample = { ...sampleCheck(), form, settings };

  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head">
      <h3>{form.name}</h3>
      <button className="btn" onClick={onDone}>Back to Forms</button>
    </div>
    <div className="card-body">
      <div className="row">
        <Field label="Form Name"><input className="input" disabled={readOnly || isBuiltin(form.id)} value={form.name}
          onChange={e => put({ name: e.target.value })} /></Field>
        <Field label="Font Size (pt)"><input className="input mono" type="number" disabled={readOnly} value={form.fontSize || 10}
          onChange={e => put({ fontSize: Number(e.target.value) })} /></Field>
        <Field label="Row Height (in)" hint="Spacing between voucher lines"><input className="input mono" type="number" step="0.01" disabled={readOnly}
          value={form.rowHeight || 0.17} onChange={e => put({ rowHeight: Number(e.target.value) })} /></Field>
      </div>
      <div className="row">
        <Field label="Calibration X (in)" hint="Shifts every field right (+) or left (−)">
          <input className="input mono" type="number" step="0.01" disabled={readOnly} value={form.offsetX || 0}
            onChange={e => put({ offsetX: Number(e.target.value) })} /></Field>
        <Field label="Calibration Y (in)" hint="Shifts every field down (+) or up (−)">
          <input className="input mono" type="number" step="0.01" disabled={readOnly} value={form.offsetY || 0}
            onChange={e => put({ offsetY: Number(e.target.value) })} /></Field>
      </div>

      <p className="subtle">Drag a field on the sheet to move it, or type exact inches below. Coordinates are measured from the
        top-left of the page. Print the test pattern on plain paper, hold it against a blank check, and nudge what's off — always at 100% scale.</p>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <FormSheet form={form} fields={fields} readOnly={readOnly}
          onMove={(key, axes, x, y) => putField(key, axes === "y" ? { y } : axes === "x" ? { x } : { x, y })} />
        <div style={{ flex: "1 1 340px", minWidth: 300 }}>
          {groups.map(g => <div key={g} style={{ marginBottom: 14 }}>
            <div className="subtle" style={{ fontWeight: 600, marginBottom: 4 }}>{g}</div>
            <table><thead><tr><th>Print</th><th>Field</th><th className="num">X</th><th className="num">Y</th><th>Align</th></tr></thead>
              <tbody>{fields.filter(f => f.group === g).map(f => <tr key={f.key}>
                <td><input type="checkbox" checked={f.on} disabled={readOnly} onChange={e => putField(f.key, { on: e.target.checked })} /></td>
                <td>{f.label}</td>
                <td className="num">{f.axes === "y" ? <span className="subtle">—</span> :
                  <input className="input mono" style={{ width: 78 }} type="number" step="0.01" disabled={readOnly || !f.on} value={f.x}
                    onChange={e => putField(f.key, { x: Number(e.target.value) })} />}</td>
                <td className="num">{f.axes === "x" ? <span className="subtle">—</span> :
                  <input className="input mono" style={{ width: 78 }} type="number" step="0.01" disabled={readOnly || !f.on} value={f.y}
                    onChange={e => putField(f.key, { y: Number(e.target.value) })} />}</td>
                <td>{f.canAlign ? <select className="input" style={{ width: 84 }} disabled={readOnly || !f.on} value={f.align}
                  onChange={e => putField(f.key, { align: e.target.value })}><option value="left">Left</option><option value="right">Right</option></select>
                  : <span className="subtle">—</span>}</td>
              </tr>)}</tbody></table>
          </div>)}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        <button className="btn" onClick={() => openCheckPdf({ test: true, form, settings })}><Ico d={ICONS.print} size={15} />Print Test Pattern</button>
        <button className="btn" onClick={() => openCheckPdf(sample)}><Ico d={ICONS.print} size={15} />Print Sample Check</button>
        {isBuiltin(form.id) && <button className="btn" disabled={readOnly} onClick={() => {
          if (confirm("Put this form back to its built-in positions?")) onReset();
        }}>Reset to Built-in</button>}
        <button className="btn primary" disabled={readOnly} onClick={saveAll}><Ico d={ICONS.check} size={15} />Save Form</button>
      </div>
    </div>
  </div>;
}

// The page, to scale, with every field on it. Drag a chip to move the field.
function FormSheet({ form, fields, readOnly, onMove }) {
  const S = 54; // px per inch
  const W = 8.5, H = 11;
  const ref = useRef();
  const drag = useRef(null);
  const [held, setHeld] = useState("");
  const at = k => fields.find(f => f.key === k);
  const rowsY = { "col": at("stubTop")?.y || 0, "foot": at("footTop")?.y || 0 };

  // Drag keeps the grab point, so a chip moves with the cursor rather than
  // jumping its corner under it.
  const down = (f, anchorX, anchorY) => (e) => {
    if (readOnly || !f.on) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = ref.current.getBoundingClientRect();
    drag.current = { f, dx: (e.clientX - r.left) / S - anchorX, dy: (e.clientY - r.top) / S - anchorY };
    setHeld(f.key);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(W, (e.clientX - r.left) / S - d.dx));
    const y = Math.max(0, Math.min(H, (e.clientY - r.top) / S - d.dy));
    onMove(d.f.key, d.f.axes, round2(x), round2(y));
  };
  const up = () => { drag.current = null; setHeld(""); };

  const chip = (f, x, y, extra) => <div key={f.key} onPointerDown={down(f, x, y)} onPointerMove={move} onPointerUp={up}
    title={`${f.label} — ${f.axes === "y" ? `y ${f.y}"` : f.axes === "x" ? `x ${f.x}"` : `${f.x}", ${f.y}"`}`}
    style={{
      position: "absolute", left: x * S, top: y * S, transform: f.align === "right" ? "translate(-100%,-100%)" : "translate(0,-100%)",
      font: "600 9px/1.4 var(--font-ui, Inter), sans-serif", whiteSpace: "nowrap", padding: "1px 4px", borderRadius: 3,
      background: held === f.key ? "var(--accent)" : "var(--accent-wash)", color: held === f.key ? "#fff" : "var(--accent)",
      border: "1px solid var(--accent)", cursor: readOnly ? "default" : "move", opacity: f.on ? 1 : 0.28, touchAction: "none",
      ...extra,
    }}>{f.short || f.label}</div>;

  return <div style={{ flex: "0 0 auto" }}>
    <div ref={ref} style={{ position: "relative", width: W * S, height: H * S, background: "var(--surface)",
      border: "1px solid var(--line, #d6dbe3)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(19,35,59,.10)" }}>
      {(form.guides || []).map(g => <div key={g} style={{ position: "absolute", left: 0, right: 0, top: g * S, borderTop: "1px dashed #c3ccd8" }} />)}
      {fields.filter(f => f.axes === "y").map(f => <div key={f.key + "-band"} style={{ position: "absolute", left: 0, right: 0, top: f.y * S, borderTop: "1px solid var(--warn, #C77700)", opacity: f.on ? 0.5 : 0.15 }} />)}
      {fields.map(f => {
        if (f.axes === "xy") return chip(f, f.x, f.y);
        if (f.axes === "y") return chip(f, 0.08, f.y, { transform: "translate(0,-100%)" });
        const band = f.key.startsWith("foot.") ? rowsY.foot : rowsY.col;
        return chip(f, f.x, band, { transform: (f.align === "right" ? "translate(-100%,0)" : "translate(0,0)") });
      })}
    </div>
    <div className="subtle" style={{ fontSize: 11, marginTop: 4, width: W * S }}>8.5 × 11 in, to scale. Dashed lines are the panel folds on the stock.</div>
  </div>;
}
