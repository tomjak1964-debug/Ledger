// Supabase Edge Function: send an email (with optional attachments) via Resend.
// Secrets to set (Dashboard → Edge Functions → send-document → Secrets, or CLI):
//   RESEND_API_KEY  — from resend.com (API Keys)
//   EMAIL_FROM      — e.g. "TMJ Engineering <invoices@tmjengineering.com>"
//                     (domain must be verified in Resend; until then use
//                      "onboarding@resend.dev", which can only email yourself)
// Deploy: supabase functions deploy send-document   (or paste in the dashboard)
//
// Only a signed-in member of a company may send: the public (anon) key alone
// passes the gateway's key check, so without this anyone could use the key in
// the web app to send email through the Resend account. SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Identify the caller from their JWT (the anon key alone has no user).
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) throw new Error("Not signed in");

    // 2) They must belong to a company in Ledger.
    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: member } = await admin.from("org_members")
      .select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
    if (!member) throw new Error("Not a member of any company");

    const { to, subject, html, attachments } = await req.json();
    if (!to || !subject) throw new Error("Missing to/subject");
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) throw new Error("RESEND_API_KEY secret is not set");
    const from = Deno.env.get("EMAIL_FROM") ?? "onboarding@resend.dev";

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject, html,
        attachments: (attachments ?? []).map((a: { filename: string; content: string }) =>
          ({ filename: a.filename, content: a.content })),
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message ?? "Resend rejected the email");
    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
