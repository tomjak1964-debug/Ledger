import { useState } from "react";
import { Ico, ICONS } from "./ui.jsx";

// The toolbar every printable document shares (standards S2.2), in this order:
// Close · Edit · Copy · Email · Save · Print. Print opens the printer dialog. Save lists the formats the document
// can be saved in (one goes straight to it), each under a name of its own.
// A button is shown only when its handler is given.
export default function DocActions({ onClose, onEmail, onPrint, saves = [], onEdit, onCopy, busy }) {
  const [menu, setMenu] = useState(false);
  const run = async (s) => { setMenu(false); await s.run(); };
  return <div className="doc-bar">
    <button className="btn" onClick={onClose}><Ico d={ICONS.back} size={16} />Close</button>
    {onEdit && <button className="btn" onClick={onEdit}><Ico d={ICONS.edit} size={15} />Edit</button>}
    {onCopy && <button className="btn" onClick={onCopy} title="Make a new draft from this one"><Ico d={ICONS.copy} size={15} />Copy</button>}
    {onEmail && <button className="btn" onClick={onEmail}><Ico d={ICONS.mail} size={15} />Email</button>}
    {saves.length > 0 && <span style={{ position: "relative" }}>
      <button className="btn" disabled={!!busy} onClick={() => (saves.length === 1 ? run(saves[0]) : setMenu(m => !m))}>
        <Ico d={ICONS.download} size={15} />{busy ? "Saving…" : saves.length === 1 ? saves[0].label : "Save"}{saves.length > 1 && " ▾"}</button>
      {menu && <div className="doc-save-menu">
        {saves.map(s => <button key={s.label} onClick={() => run(s)}>{s.label}<span className="subtle">{s.hint}</span></button>)}
      </div>}
    </span>}
    {onPrint && <button className="btn primary" onClick={onPrint}><Ico d={ICONS.print} size={16} />Print</button>}
  </div>;
}
