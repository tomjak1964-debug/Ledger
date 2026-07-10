import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { supabase, isConfigured } from "./lib/supabaseClient.js";
import SignIn from "./views/SignIn.jsx";
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

function Root() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (!isConfigured) return <SetupNotice />;
  if (session === undefined) return <div className="boot">Starting up…</div>;
  if (!session) return <SignIn />;
  return <App key={session.user.id} session={session} />;
}

createRoot(document.getElementById("root")).render(<StrictMode><Root /></StrictMode>);
