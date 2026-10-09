import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { Field, PasswordInput } from "./ui.jsx";

// Set the signed-in user's own password. Used from the menu's "Change
// password" (every user) and after following an emailed reset link.
export default function ChangePassword({ toast, onDone, submitLabel = "Update Password" }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const problem = pw.length > 0 && pw.length < 8 ? "At least 8 characters" : (confirm && pw !== confirm ? "Passwords don't match" : "");
  const save = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPw(""); setConfirm("");
    toast?.("Password updated");
    onDone?.();
  };
  return <form onSubmit={save}>
    <div className="row">
      <Field label="New Password" hint="At least 8 characters"><PasswordInput autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
      <Field label="Confirm New Password"><PasswordInput autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></Field>
    </div>
    {(problem || err) && <p className="subtle" style={{ margin: "0 0 8px", color: "var(--neg)" }}>{problem || err}</p>}
    <button className="btn primary" type="submit" disabled={busy || !pw || !!problem || pw !== confirm}>{busy ? "Saving…" : submitLabel}</button>
  </form>;
}
