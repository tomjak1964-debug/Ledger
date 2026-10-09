// Supabase Edge Function: send an email (with optional attachments) via Resend.
// Settings (in ~/apps/ledger/.env on the NUC, passed to the functions
// container by HomeServer's docker-compose.homeserver.yml):
//   RESEND_API_KEY          — from resend.com (API Keys)
//   EMAIL_FROM_INVOICE      — e.g. "TMJ Engineering <invoices@tmjengineering.com>"
//   EMAIL_FROM_REMITTANCE   — e.g. "TMJ Engineering <remittances@tmjengineering.com>"
//   EMAIL_FROM              — the sender for anything else, and the fallback
//                             while a per-type setting isn't there yet
// The sender is chosen HERE from the document type the app names (FROM_BY_TYPE)
// — never an address from the browser, which could otherwise send as anyone
// on the verified domain. An unknown type is refused.
// Deploy: cp -r app/supabase/functions/send-document ~/apps/ledger/volumes/functions/
//         && cd ~/apps/ledger && docker compose restart functions
//
// Only a signed-in member of a company may send: the public (anon) key alone
// passes the gateway's key check, so without this anyone could use the key in
// the web app to send email through the Resend account. SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Document type → the setting that holds its sender. A copy of the app from
// before types were sent names none and gets the general sender.
const FROM_BY_TYPE: Record<string, string> = {
  invoice: "EMAIL_FROM_INVOICE",       // invoices, credit memos, payment reminders
  remittance: "EMAIL_FROM_REMITTANCE", // remittance advice for vendor payments
  proposal: "EMAIL_FROM",              // proposals and quotes
};
function senderFor(docType: unknown): string {
  const general = Deno.env.get("EMAIL_FROM") || "onboarding@resend.dev";
  if (docType == null || docType === "") return general;
  const setting = FROM_BY_TYPE[String(docType)];
  if (!setting) throw new Error(`Unknown document type "${docType}"`);
  return Deno.env.get(setting) || general;
}

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

    const { to, subject, html, attachments, docType } = await req.json();
    if (!to || !subject) throw new Error("Missing to/subject");
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) throw new Error("RESEND_API_KEY secret is not set");
    const from = senderFor(docType);

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
