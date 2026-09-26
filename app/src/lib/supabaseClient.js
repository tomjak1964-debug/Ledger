import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// How long a PostgREST request may go unanswered before it is given up on.
// A normal save answers in well under a second; a request still open at 30 s
// is waiting on something on the server (a row another session holds), and
// the browser's own limit is a minute or more with only "Failed to fetch" to
// show for it.
export const REST_TIMEOUT_MS = 30000;

// The browser could not send the request at all — nothing came back, not even
// an error status. Chrome says "Failed to fetch", Safari "Load failed",
// Firefox "NetworkError when attempting to fetch resource".
const isNetworkError = (e) => e instanceof TypeError || /failed to fetch|load failed|networkerror|network request failed/i.test(e?.message || "");

// Every PostgREST call goes through here (createClient's global.fetch). Two
// things a plain fetch does not do:
//  * a request that gets no answer in REST_TIMEOUT_MS is abandoned with a
//    message that says so, instead of hanging until the browser gives up;
//  * a request the browser could not send is sent once more after a short
//    pause. The usual cause is a PWA window waking from sleep, where the
//    first request goes out on a connection the OS already dropped. Ids are
//    made on the client and writes are upserts, so repeating a request that
//    did land is harmless.
// Auth, storage and edge-function calls are left alone: a token refresh has
// its own retry, an upload can legitimately take longer, and re-sending an
// email function call could send the email twice.
export async function ledgerFetch(input, init = {}) {
  const href = typeof input === "string" ? input : input?.url || String(input);
  if (!href.includes("/rest/v1/")) return fetch(input, init);
  const attempt = async () => {
    if (init.signal) return fetch(input, init);      // the caller is already in charge of cancelling
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REST_TIMEOUT_MS);
    try {
      return await fetch(input, { ...init, signal: ctl.signal });
    } catch (e) {
      if (ctl.signal.aborted) throw new Error(`The server didn't answer in ${REST_TIMEOUT_MS / 1000} seconds`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await new Promise(r => setTimeout(r, 700));
    return attempt();
  }
}

// When env vars are missing the app renders a setup notice instead of crashing.
export const isConfigured = Boolean(url && key);
export const supabase = isConfigured ? createClient(url, key, { global: { fetch: ledgerFetch } }) : null;
