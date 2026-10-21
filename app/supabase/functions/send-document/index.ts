// Supabase Edge Function: send an email (with optional attachments) via Resend.
// Settings (in ~/apps/ledger/.env on the NUC, passed to the functions
// container by HomeServer's docker-compose.homeserver.yml):
//   RESEND_API_KEY          — from resend.com (API Keys)
//   EMAIL_FROM_INVOICE      — e.g. "TMJ Engineering <invoices@tmjengineering.com>"
//   EMAIL_FROM_REMITTANCE   — e.g. "TMJ Engineering <remittances@tmjengineering.com>"
//   EMAIL_FROM_SALES        — e.g. "TMJ Engineering <sales@tmjengineering.com>"
//   EMAIL_FROM_RECEIVABLES  — e.g. "TMJ Engineering <receivables@tmjengineering.com>"
//                             (proposals and the rate sheet)
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
  proposal: "EMAIL_FROM_SALES",        // proposals and quotes
  ratesheet: "EMAIL_FROM_SALES",       // the customer rate sheet
  banking: "EMAIL_FROM_RECEIVABLES",   // the customer banking information sheet
};
function senderFor(docType: unknown): string {
  const general = Deno.env.get("EMAIL_FROM") || "onboarding@resend.dev";
  if (docType == null || docType === "") return general;
  const setting = FROM_BY_TYPE[String(docType)];
  if (!setting) throw new Error(`Unknown document type "${docType}"`);
  return Deno.env.get(setting) || general;
}

// Recipients: one address or a list, as a string ("a@x.com, b@y.com"; commas,
// semicolons or spaces between) or an array. Each must look like an address;
// duplicates are dropped. A copy of the app from before lists sends one string.
const MAX_RECIPIENTS = 20;
function addressList(v: unknown, field: string): string[] {
  const raw = Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[\s,;]+/);
  const out: string[] = [];
  for (const a of raw.map(s => s.trim()).filter(Boolean)) {
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a)) throw new Error(`"${a}" in ${field} isn't an email address`);
    if (!out.some(x => x.toLowerCase() === a.toLowerCase())) out.push(a);
  }
  return out;
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

    const body = await req.json();
    const { subject, html, attachments, docType } = body;
    const to = addressList(body.to, "To");
    const cc = addressList(body.cc, "CC").filter(a => !to.some(t => t.toLowerCase() === a.toLowerCase()));
    if (!to.length || !subject) throw new Error("Missing to/subject");
    if (to.length + cc.length > MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS} recipients per email`);
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) throw new Error("RESEND_API_KEY secret is not set");
    let from = senderFor(docType);
    // "Send as me": from the caller's own business email (org_members.send_as,
    // set in Users & Access) under their name, replies to it. It must be on the
    // same mail domain as the company sender — the only domain the mail service
    // can send from. With none set: the company address under their name, with
    // replies to their sign-in email.
    let replyTo: string | undefined;
    if (body.fromMe) {
      const { data: me } = await admin.from("org_members").select("name, send_as").eq("user_id", user.id).limit(1).maybeSingle();
      const companyAddr = (from.match(/<([^>]+)>/)?.[1] || from).trim();
      const domain = companyAddr.split("@")[1]?.toLowerCase() || "";
      const own = String(me?.send_as || "").trim();
      const ownOk = /^[^@\s<>"]+@[^@\s<>"]+$/.test(own) && own.split("@")[1].toLowerCase() === domain;
      const name = String(me?.name || user.email || "").replace(/[<>"]/g, "").trim();
      const addr = ownOk ? own : companyAddr;
      from = name ? `${name} <${addr}>` : addr;
      replyTo = ownOk ? own : (user.email || undefined);
    }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to, ...(cc.length ? { cc } : {}), ...(replyTo ? { reply_to: replyTo } : {}), subject, html,
        attachments: (attachments ?? []).map((a: { filename: string; content: string }) =>
          ({ filename: a.filename, content: a.content })),
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message ?? "Resend rejected the email");
    return new Response(JSON.stringify({ ok: true, id: data.id, to, cc }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
