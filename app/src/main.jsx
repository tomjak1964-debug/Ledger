import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { supabase, isConfigured } from "./lib/supabaseClient.js";
import SignIn from "./views/SignIn.jsx";
import ChangePassword from "./components/ChangePassword.jsx";
import App from "./App.jsx";
import "./styles.css";

function SetupNotice() {
  return <div className="boot"><div className="card"><div className="card-body">
    <h3 style={{ marginBottom: 10 }}>Almost there — connect Supabase</h3>
    <p>Copy <span className="mono">.env.example</span> to <span className="mono">.env.local</span> in the
      <span className="mono"> app/</span> folder and fill in your project's URL and anon key, then restart
      the dev server. Full setup steps are in <span className="mono">app/supabase/README.md</span>.</p>
  </div></div></div>;
}

// Arrived from a "reset your password" email: the link signs them in for
// this one purpose, so the new password comes before the app.
function SetNewPassword({ email, onDone }) {
  return <div className="auth-wrap"><div className="auth-card">
    <div className="brand">
      <div className="brand-mark">L</div>
      <div><div className="brand-name" style={{ color: "var(--ink)" }}>Ledger</div><div className="brand-sub">Quote → Cash</div></div>
    </div>
    <h2>Set a new password</h2>
    <p className="subtle" style={{ marginTop: 0 }}>For {email}. Use it to sign in from now on.</p>
    <ChangePassword onDone={onDone} submitLabel="Save Password" />
  </div></div>;
}

function Root() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [recovering, setRecovering] = useState(() => /type=recovery/.test(window.location.hash));
  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!isConfigured) return <SetupNotice />;
  if (session === undefined) return <div className="boot">Starting up…</div>;
  if (!session) return <SignIn />;
  if (recovering) return <SetNewPassword email={session.user.email} onDone={() => { setRecovering(false); history.replaceState(null, "", window.location.pathname); }} />;
  return <App key={session.user.id} session={session} />;
}

createRoot(document.getElementById("root")).render(<StrictMode><Root /></StrictMode>);
