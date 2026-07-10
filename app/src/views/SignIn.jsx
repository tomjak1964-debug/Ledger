import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { Field } from "../components/ui.jsx";

export default function SignIn() {
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null); setNote(null); setBusy(true);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setErr(error.message);
      // success → onAuthStateChange in main.jsx swaps in the app
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setErr(error.message);
      else if (!data.session) setNote("Account created — check your email for a confirmation link, then sign in.");
    }
    setBusy(false);
  };

  return <div className="auth-wrap">
    <div className="auth-card">
      <div className="brand">
        <div className="brand-mark">L</div>
        <div><div className="brand-name" style={{ color: "var(--ink)" }}>Ledger</div><div className="brand-sub">Quote → Cash</div></div>
      </div>
      <h2>{mode === "signin" ? "Sign in" : "Create your account"}</h2>
      {err && <div className="auth-err">{err}</div>}
      {note && <div className="auth-note">{note}</div>}
      <form onSubmit={submit}>
        <Field label="Email"><input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
        <Field label="Password" hint={mode === "signup" ? "At least 6 characters" : undefined}>
          <input className="input" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
        </Field>
        <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>
          {busy ? "One moment…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>
      </form>
      <div className="auth-switch">
        {mode === "signin"
          ? <>First time here? <button className="link-btn" onClick={() => { setMode("signup"); setErr(null); }}>Create an account</button></>
          : <>Already have an account? <button className="link-btn" onClick={() => { setMode("signin"); setErr(null); }}>Sign in</button></>}
      </div>
    </div>
  </div>;
}
