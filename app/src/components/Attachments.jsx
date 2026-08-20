import { useState, useRef } from "react";
import { Ico, ICONS } from "./ui.jsx";

// Reusable file list for any record (invoice, bill, expense, sales order).
// Files live in the private Storage bucket; clicking one opens a short-lived
// signed URL. Only shown on saved records so nothing orphans.
export default function Attachments({ db, actions, toast, parentType, parentId, readOnly }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const list = (db.attachments || []).filter(a => a.parentType === parentType && a.parentId === parentId);

  const upload = async (files) => {
    if (!files.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of files) { if (await actions.uploadAttachment(parentType, parentId, f)) ok++; }
    setBusy(false);
    if (ok) toast(ok + " file" + (ok > 1 ? "s" : "") + " attached");
  };
  const open = async (att) => { const url = await actions.attachmentUrl(att); if (url) window.open(url, "_blank"); };
  const del = async (att) => { if (confirm("Delete " + att.filename + "?") && await actions.deleteAttachment(att)) toast("Deleted"); };
  const size = n => n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB";

  return <div>
    <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
      <span className="subtle" style={{ fontWeight: 700 }}>Attachments</span>
      {!readOnly && <button className="btn sm" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => fileRef.current?.click()}>
        <Ico d={ICONS.clip} size={13} />{busy ? "Uploading…" : "Attach files"}</button>}
      <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={e => { upload([...e.target.files]); e.target.value = ""; }} />
    </div>
    {list.length === 0
      ? <p className="subtle" style={{ margin: "4px 0" }}>No files attached.</p>
      : list.map(a => <div key={a.id} className="cat-row">
        <button className="link-btn" style={{ color: "var(--accent)", fontWeight: 600, textAlign: "left" }} onClick={() => open(a)}>{a.filename}</button>
        <span className="subtle">{size(a.size)}</span>
        {!readOnly && <button className="btn ghost icon" style={{ marginLeft: "auto" }} title="Delete" onClick={() => del(a)}><Ico d={ICONS.trash} size={14} /></button>}
      </div>)}
  </div>;
}
