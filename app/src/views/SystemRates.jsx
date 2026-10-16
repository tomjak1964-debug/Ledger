import { useState, useMemo } from "react";
import { money } from "../lib/helpers.js";
import { proposalConfig } from "../calc/proposals.js";
import { COMPONENTS, DEFAULT_HOUR_MODEL, HOUR_MODEL_LABELS, DEVICE_FIELDS } from "../calc/estimates.js";
import { canWrite } from "../lib/permissions.js";
import { Ico, ICONS, Field } from "../components/ui.jsx";

// System Rates: the hour model behind a system proposal, laid out like Fixture
// Rates — one row per thing a job can contain (a discrete I/O point, a
// cylinder, a robot…), one column per engineering task, and in each cell the
// hours that one unit adds to that task. A system proposal multiplies these by
// the job's counts to suggest its hours (calc/estimates.js suggestHours), and
// the estimator can still override any task's hours on the proposal itself.
//
// It is settings.proposal.hourModel — only the cells that differ from the
// built-in defaults are stored, so a cell nobody changed follows the default.
// Start-up and project management aren't per-unit: start-up is trips × days ×
// people × hours a day, and PM is a share of the engineering hours, both below.
const TASKS = COMPONENTS.filter(c => c.key !== "startup" && c.key !== "pm");

const DEVICE_HM = new Set(DEVICE_FIELDS.map(d => d.hm));
const GROUPS = [
  { label: "Every job", rows: ["base"], hint: { base: "added once to every system proposal" } },
  { label: "I/O", rows: ["perDiscrete", "perAnalog"], hint: { perDiscrete: "each discrete input or output point", perAnalog: "each analog point" } },
  { label: "Devices", note: "hours beyond the device's own I/O points, which price through the I/O rows",
    rows: Object.keys(HOUR_MODEL_LABELS).filter(k => DEVICE_HM.has(k)),
    hint: Object.fromEntries(DEVICE_FIELDS.map(d => [d.hm, d.extra ? "each one after the first" : d.hint])) },
  { label: "Program & documents", rows: ["perStation", "perStep", "perPanel", "perNetwork", "perScreen", "perAlarm", "perRecipe"], hint: {} },
  { label: "Safety & options", rows: ["safetyRelay", "safetyPlc", "dataCollection", "remoteAccess"],
    hint: { safetyRelay: "when the safety system is relays", safetyPlc: "when it's a safety PLC", dataCollection: "when ticked on the proposal", remoteAccess: "when ticked on the proposal" } },
];

const num = v => Number(v) || 0;
const same = (a, b) => Math.abs(num(a) - num(b)) < 1e-9;

export default function SystemRatesView({ db, actions, toast, readOnly, member }) {
  const editable = !readOnly && canWrite(member, "settings");
  const cfg = useMemo(() => proposalConfig(db.settings, db.timeCategories), [db.settings, db.timeCategories]);
  // The working copy: every cell, defaults filled in. Saved as a diff.
  const [hm, setHm] = useState(() => structuredClone(cfg.hourModel));
  const [saving, setSaving] = useState(false);
  // Compared as numbers, cell by cell: a typed "0.25" is the same as a saved 0.25.
  const dirty = Object.entries(DEFAULT_HOUR_MODEL).some(([k, def]) => typeof def === "object"
    ? [...new Set([...Object.keys(def), ...TASKS.map(t => t.key)])].some(t => !same(hm[k]?.[t], cfg.hourModel[k]?.[t]))
    : !same(hm[k], cfg.hourModel[k]));

  const setCell = (row, task, v) => setHm(h => ({ ...h, [row]: { ...(h[row] || {}), [task]: v === "" ? "" : v } }));
  const resetRow = (row) => setHm(h => ({ ...h, [row]: { ...DEFAULT_HOUR_MODEL[row] } }));
  const rowChanged = (row) => TASKS.some(t => !same(hm[row]?.[t.key], DEFAULT_HOUR_MODEL[row]?.[t.key]));
  // What one unit of a row costs: its hours on each task at that task's rate.
  const unitCost = (row) => TASKS.reduce((s, t) => s + num(hm[row]?.[t.key]) * num(cfg.laborRates[t.role]), 0);
  const unitHours = (row) => TASKS.reduce((s, t) => s + num(hm[row]?.[t.key]), 0);

  const save = async () => {
    // Only what differs from the built-in default is stored.
    const out = {};
    for (const [k, def] of Object.entries(DEFAULT_HOUR_MODEL)) {
      if (typeof def === "object") {
        const cells = {};
        for (const t of new Set([...Object.keys(def), ...TASKS.map(x => x.key)]))
          if (!same(hm[k]?.[t], def[t])) cells[t] = num(hm[k]?.[t]);
        if (Object.keys(cells).length) out[k] = cells;
      } else if (!same(hm[k], def)) out[k] = num(hm[k]);
    }
    setSaving(true);
    const ok = await actions.saveSettings({ ...db.settings, proposal: { ...(db.settings.proposal || {}), hourModel: out } });
    setSaving(false);
    if (ok) toast("System rates saved — new and re-priced system proposals use them");
  };

  const changedCount = Object.keys(HOUR_MODEL_LABELS).filter(rowChanged).length
    + ["pmPct", "hoursPerDay"].filter(k => !same(hm[k], DEFAULT_HOUR_MODEL[k])).length;

  return <div>
    <div className="toolbar">
      <p className="subtle" style={{ margin: 0, maxWidth: 760 }}>The hours each item adds to each task when a system proposal is priced. A proposal multiplies these by its counts to
        suggest hours, priced at each task's rate (Settings → Proposals → Labor Rate Card); any task's hours can still be overridden on the proposal.</p>
      {editable && <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="btn" disabled={!dirty || saving} onClick={() => setHm(structuredClone(cfg.hourModel))}>Discard Changes</button>
        <button className="btn primary" disabled={!dirty || saving} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save Changes"}</button>
      </div>}
    </div>
    {!editable && <p className="subtle" style={{ marginTop: 0 }}>Only someone with Settings access can change these.</p>}

    <div className="card">
      <div className="card-head"><h3>Hours per unit</h3>
        <span className="subtle" style={{ marginLeft: "auto" }}>{changedCount ? `${changedCount} changed from the defaults · shaded` : "all at the built-in defaults"}</span></div>
      <table className="rate-grid"><thead><tr>
        <th>Item</th>
        {TASKS.map(t => <th key={t.key} className="num" title={`${t.label} · ${money(num(cfg.laborRates[t.role]))}/hr`}>{t.label}
          <div className="subtle" style={{ fontWeight: 400, fontSize: 11 }}>{money(num(cfg.laborRates[t.role]))}/hr</div></th>)}
        <th className="num">Hours / unit</th><th className="num">Cost / unit</th><th></th>
      </tr></thead>
        <tbody>{GROUPS.map(g => [
          <tr key={g.label} className="group-row"><td colSpan={TASKS.length + 4}>
            <b>{g.label}</b>{g.note && <span className="subtle"> — {g.note}</span>}</td></tr>,
          ...g.rows.map(row => <tr key={row}>
            <td><div style={{ fontWeight: 600 }}>{HOUR_MODEL_LABELS[row]}</div>
              {g.hint[row] && <div className="subtle" style={{ fontSize: 12 }}>{g.hint[row]}</div>}</td>
            {TASKS.map(t => {
              const v = hm[row]?.[t.key];
              const def = DEFAULT_HOUR_MODEL[row]?.[t.key];
              const changed = !same(v, def);
              return <td key={t.key} className="num">
                <input className="input mono" type="number" min="0" step="any" style={{ width: 72, textAlign: "right", ...(changed ? { background: "var(--accent-wash)", borderColor: "var(--accent)" } : {}) }}
                  value={v ?? ""} placeholder="0" disabled={!editable} title={changed ? `Default ${num(def)}` : "Built-in default"}
                  onChange={e => setCell(row, t.key, e.target.value)} /></td>;
            })}
            <td className="num mono">{unitHours(row) ? unitHours(row).toFixed(2).replace(/\.?0+$/, "") : "—"}</td>
            <td className="num mono">{unitCost(row) ? money(unitCost(row)) : "—"}</td>
            <td>{editable && rowChanged(row) && <button className="btn ghost icon" title="Put this row back to the defaults" onClick={() => resetRow(row)}><Ico d={ICONS.refresh} size={14} /></button>}</td>
          </tr>),
        ])}</tbody></table>
    </div>

    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><h3>Start-up & project management</h3></div>
      <div className="card-body"><div className="row">
        <Field label="Hours in a start-up day" hint={`Start-Up / Debug = trips × days × people × this · default ${DEFAULT_HOUR_MODEL.hoursPerDay}`}>
          <input className="input mono" type="number" min="0" step="any" value={hm.hoursPerDay ?? ""} disabled={!editable} onChange={e => setHm(h => ({ ...h, hoursPerDay: e.target.value }))} /></Field>
        <Field label="Project management (% of engineering hours)" hint={`Hardware design + drafting + PLC + HMI · default ${DEFAULT_HOUR_MODEL.pmPct}%`}>
          <input className="input mono" type="number" min="0" step="any" value={hm.pmPct ?? ""} disabled={!editable} onChange={e => setHm(h => ({ ...h, pmPct: e.target.value }))} /></Field>
      </div></div>
    </div>
  </div>;
}
