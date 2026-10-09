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
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    // success → onAuthStateChange in main.jsx swaps in the app
    setBusy(false);
  };
  // A reset link by email. The same answer whether or not the address has a
  // login, so the page can't be used to find out who does.
  const sendReset = async (e) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + "/app" });
    setBusy(false);
    if (error && !/not found|no user/i.test(error.message)) setErr(error.message);
    else setSent(true);
  };

  if (forgot) return <div className="auth-wrap">
    <div className="auth-card">
      <div className="brand">
        <div className="brand-mark">L</div>
        <div><div className="brand-name" style={{ color: "var(--ink)" }}>Ledger</div><div className="brand-sub">Quote → Cash</div></div>
      </div>
      <h2>Reset your password</h2>
      {err && <div className="auth-err">{err}</div>}
      {sent
        ? <p>If <b>{email}</b> has a Ledger login, an email with a reset link is on its way. Open it on this device, then choose a new password.
          It can take a minute — check the junk folder too.</p>
        : <form onSubmit={sendReset}>
          <p className="subtle" style={{ marginTop: 0 }}>Enter the email you sign in with and we'll send a link to set a new password.</p>
          <Field label="Email"><input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
          <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>{busy ? "Sending…" : "Email Me a Reset Link"}</button>
        </form>}
      <div className="auth-switch"><button className="link-btn" onClick={() => { setForgot(false); setSent(false); setErr(null); }}>Back to sign in</button></div>
    </div>
  </div>;

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
        <button className="link-btn" onClick={() => { setForgot(true); setErr(null); }}>Forgot password?</button>
        <div style={{ marginTop: 6 }}>Need access? Ask your administrator to set up an account for you.</div>
      </div>
    </div>
  </div>;
}
