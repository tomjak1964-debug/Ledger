import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { Field, PasswordInput } from "../components/ui.jsx";

// Sign-in only. Accounts are provisioned by an admin (Settings → Users), who
// hands new users their initial credentials — there is no public sign-up.
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    // success → onAuthStateChange in main.jsx swaps in the app
    setBusy(false);
  };

  return <div className="auth-wrap">
    <div className="auth-card">
      <div className="brand">
        <div className="brand-mark">L</div>
        <div><div className="brand-name" style={{ color: "var(--ink)" }}>Ledger</div><div className="brand-sub">Quote → Cash</div></div>
      </div>
      <h2>Sign in</h2>
      {err && <div className="auth-err">{err}</div>}
      <form onSubmit={submit}>
        <Field label="Email"><input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
        <Field label="Password">
          <PasswordInput autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </Field>
        <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>
          {busy ? "One moment…" : "Sign In"}
        </button>
      </form>
      <div className="auth-switch">
        Need access? Ask your administrator to set up an account for you.
      </div>
    </div>
  </div>;
}
