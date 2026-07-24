import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { Modal, Field } from "./ui.jsx";

const blobToBase64 = blob => new Promise(res => {
  const f = new FileReader();
  f.onload = () => res(String(f.result).split(",")[1]);
  f.readAsDataURL(blob);
});

// Generic "email this document" dialog. buildAttachment is async and returns
// { blob, filename } (or null for no attachment).
export default function EmailModal({ title, defaultTo, defaultSubject, defaultBody, buildAttachment, onClose, toast }) {
  const [to, setTo] = useState(defaultTo || "");
  const [subject, setSubject] = useState(defaultSubject || "");
  const [body, setBody] = useState(defaultBody || "");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const att = buildAttachment ? await buildAttachment() : null;
      const attachments = att ? [{ filename: att.filename, content: await blobToBase64(att.blob) }] : [];
      const html = body.split("\n").map(l => l.trim() === "" ? "<br/>" : `<p style="margin:0 0 2px">${l.replace(/</g, "&lt;")}</p>`).join("");
      const { data, error } = await supabase.functions.invoke("send-document", {
        body: { to: to.trim(), subject, html, attachments },
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error);
      toast("Email sent to " + to.trim());
      onClose();
    } catch (e) {
      toast("⚠ Email failed: " + (e.message || e));
    }
    setBusy(false);
  };

  return <Modal title={title} onClose={onClose}
    foot={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !to.includes("@")} onClick={send}>{busy ? "Sending…" : "Send Email"}</button></>}>
    <Field label="To"><input className="input" type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.com" /></Field>
    <Field label="Subject"><input className="input" value={subject} onChange={e => setSubject(e.target.value)} /></Field>
    <Field label="Message"><textarea className="input" style={{ minHeight: 120 }} value={body} onChange={e => setBody(e.target.value)} /></Field>
    <p className="subtle" style={{ margin: 0 }}>The document is attached automatically. Sending requires the email function to be set up (see app/supabase/README.md).</p>
  </Modal>;
}
