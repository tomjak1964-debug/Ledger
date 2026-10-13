import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { Modal, Field } from "./ui.jsx";

const blobToBase64 = blob => new Promise(res => {
  const f = new FileReader();
  f.onload = () => res(String(f.result).split(",")[1]);
  f.readAsDataURL(blob);
});

// "a@x.com, b@y.com" → the addresses, and any that don't look like one. Commas,
// semicolons or spaces separate them — the same rule send-document applies.
export function parseAddresses(text) {
  const parts = String(text || "").split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
  const ok = [], bad = [];
  for (const a of parts) {
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a)) bad.push(a);
    else if (!ok.some(x => x.toLowerCase() === a.toLowerCase())) ok.push(a);
  }
  return { ok, bad };
}

// Generic "email this document" dialog. buildAttachment is async and returns
// { blob, filename }, a list of them (several documents on one email), or null
// for no attachment. docType ("invoice" |
// "remittance" | "proposal" | "ratesheet") is all the app says about the sender: the
// send-document function picks the From address for that type from its own
// fixed list.
export default function EmailModal({ title, defaultTo, defaultSubject, defaultBody, buildAttachment, onClose, onSent, toast, docType }) {
  const [to, setTo] = useState(defaultTo || "");
  const [cc, setCc] = useState("");
  const toList = parseAddresses(to), ccList = parseAddresses(cc);
  const bad = [...toList.bad, ...ccList.bad];
  const [subject, setSubject] = useState(defaultSubject || "");
  const [body, setBody] = useState(defaultBody || "");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const att = buildAttachment ? await buildAttachment() : null;
      const list = Array.isArray(att) ? att : att ? [att] : [];
      const attachments = await Promise.all(list.map(async a => ({ filename: a.filename, content: await blobToBase64(a.blob) })));
      const html = body.split("\n").map(l => l.trim() === "" ? "<br/>" : `<p style="margin:0 0 2px">${l.replace(/</g, "&lt;")}</p>`).join("");
      const { data, error } = await supabase.functions.invoke("send-document", {
        body: { to: toList.ok, cc: ccList.ok, subject, html, attachments, docType },
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error);
      toast("Email sent to " + toList.ok.join(", ") + (ccList.ok.length ? " · cc " + ccList.ok.join(", ") : ""));
      onSent?.();
      onClose();
    } catch (e) {
      toast("⚠ Email failed: " + (e.message || e));
    }
    setBusy(false);
  };

  return <Modal title={title} onClose={onClose}
    foot={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !toList.ok.length || bad.length > 0} onClick={send}>{busy ? "Sending…" : "Send Email"}</button></>}>
    <Field label="To" hint="Separate several addresses with commas">
      <input className="input" value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.com, other@company.com" /></Field>
    <Field label="CC" hint="Optional — copies go to these addresses">
      <input className="input" value={cc} onChange={e => setCc(e.target.value)} placeholder="name@company.com" /></Field>
    {bad.length > 0 && <p style={{ color: "var(--neg)", margin: "0 0 10px" }}>Not an email address: {bad.join(", ")}</p>}
    <Field label="Subject"><input className="input" value={subject} onChange={e => setSubject(e.target.value)} /></Field>
    <Field label="Message"><textarea className="input" style={{ minHeight: 120 }} value={body} onChange={e => setBody(e.target.value)} /></Field>
    <p className="subtle" style={{ margin: 0 }}>The document is attached automatically. Sending requires the email function to be set up (see app/supabase/README.md).</p>
  </Modal>;
}
