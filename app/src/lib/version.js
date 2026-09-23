// What build is running, and whether the server has a newer one.
//
// REV is Rev X.yy from app/version.json; BUILD is the commit sha and build
// time vite stamps in. The deployed site publishes the same two facts at
// /version.json, which the service worker never caches (vite.config.js keeps
// it out of the precache), so a fetch of it always says what the server has
// right now. A different build stamp means a newer deploy — a hot-fix without
// a rev bump still counts.
import { useEffect } from "react";

export const REV = __REV__;
export const BUILD = __BUILD__;

export async function checkForUpdate() {
  try {
    const r = await fetch("/version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const latest = await r.json();
    return { latest, updateAvailable: !!latest.build && latest.build !== BUILD };
  } catch (e) {
    return { latest: null, updateAvailable: false, error: e.message || String(e) };
  }
}

// The app is a PWA, so a browser can keep serving the build it cached. This
// throws that copy away and reloads, which is the difference between "the fix
// isn't working" and "the fix hasn't arrived". Data lives in Supabase, so
// nothing here is at risk.
export async function updateNow() {
  try {
    if ("serviceWorker" in navigator)
      await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister()));
    if (window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
  } catch { /* private mode / storage blocked — the reload below still helps */ }
  location.reload();
}

// Once per load, a few seconds in: if the server has a newer build, say so
// with an Update now button. A home-screen install has no address bar to
// refresh from, so this is how it finds out.
export function useUpdateNudge(toast, delayMs = 4000) {
  useEffect(() => {
    let gone = false;
    const t = setTimeout(async () => {
      const r = await checkForUpdate();
      if (!gone && r.updateAvailable)
        toast(`Rev ${r.latest.rev} is available — you're on Rev ${REV}`, { actionLabel: "Update now", onAction: updateNow });
    }, delayMs);
    return () => { gone = true; clearTimeout(t); };
  }, [toast, delayMs]);
}
