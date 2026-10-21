import { useEffect, useState, useCallback } from "react";
import { REV, BUILD, checkForUpdate, updateNow, safeToUpdate } from "../lib/version.js";

// The app's revision, at the foot of the menu where everyone can see it —
// not only admins, who are the only ones with Settings. It checks the server
// on load, every ten minutes and whenever the app comes back into view. A newer
// build installs itself as soon as that is safe (safeToUpdate: no dialog,
// document or editor open, nothing being typed, two minutes idle); until then
// it is an Update button. Clicking the
// revision checks again; Reload throws away a copy that seems stuck.
export default function RevisionFoot() {
  const [state, setState] = useState({ status: "checking" });   // checking · current · update · offline
  const check = useCallback(async () => {
    setState(s => ({ ...s, status: "checking" }));
    const r = await checkForUpdate();
    setState(r.error ? { status: "offline" } : r.updateAvailable ? { status: "update", latest: r.latest } : { status: "current", latest: r.latest });
    if (r.updateAvailable && safeToUpdate()) updateNow();
  }, []);
  useEffect(() => {
    check();
    const t = setInterval(check, 10 * 60 * 1000);
    const onShow = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [check]);

  return <div className="rev-foot" title={"Build " + BUILD}>
    {state.status === "update"
      ? <button className="rev-update" onClick={updateNow}>Update to Rev {state.latest.rev}</button>
      : null}
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button className="link-btn rev-num" onClick={check} title={"Build " + BUILD + " — click to check for an update"}>Rev {REV}</button>
      <span className="rev-state">
        {state.status === "checking" ? "Checking…" : state.status === "current" ? "✓ Up to date" : state.status === "update" ? "Update available" : "Can't check right now"}
      </span>
      <button className="link-btn" style={{ marginLeft: "auto", color: "#66788F" }} onClick={updateNow} title="Throw away this device's cached copy and reload — for a copy that seems stuck. Your data isn't touched.">Reload</button>
    </div>
  </div>;
}
