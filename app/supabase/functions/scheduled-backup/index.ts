// Supabase Edge Function: automated backups (feature 8).
//
// Two ways to run:
//  • Manual  — an admin clicks "Back up now" (their JWT); backs up their org.
//  • Cron    — a scheduler sends header `x-cron-secret: <CRON_SECRET>`; backs up
//              every org. Set up a schedule in Dashboard → Cron (or pg_cron).
//
// Per org, honours settings.data.backup = { enabled, email, recipient, storage }.
// Emails the JSON via Resend and/or uploads it to the private "backups" bucket.
//
// Secrets: SUPABASE_* are injected. Add CRON_SECRET (any random string) for the
// scheduled run. RESEND_API_KEY / EMAIL_FROM are the same as send-document.
// Deploy: supabase functions deploy scheduled-backup
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TABLES = [
  "contacts", "catalog_items", "quotes", "quote_line_items", "sales_orders", "sales_order_line_items",
  "invoices", "invoice_line_items", "payments", "bills", "expenses", "proposals", "contact_people",
  "machine_types", "time_categories", "time_entries", "purchase_orders", "purchase_order_line_items", "attachments",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

    // Which orgs, and is the caller authorized?
    let orgIds: string[] = [];
    const cronSecret = Deno.env.get("CRON_SECRET");
    const provided = req.headers.get("x-cron-secret");
    if (cronSecret && provided && provided === cronSecret) {
      const { data } = await admin.from("orgs").select("id");
      orgIds = (data ?? []).map((o: { id: string }) => o.id);
    } else {
      const authHeader = req.headers.get("Authorization") ?? "";
      const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data: mem } = await admin.from("org_members").select("org_id, role").eq("user_id", user.id);
      orgIds = (mem ?? []).filter((m: { role: string }) => ["owner", "admin"].includes(m.role)).map((m: { org_id: string }) => m.org_id);
      if (!orgIds.length) throw new Error("Only an admin can run backups");
    }

    const results = [];
    for (const orgId of orgIds) results.push(await backupOrg(admin, orgId));
    return json({ ok: true, results });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 400);
  }
});

async function backupOrg(admin: ReturnType<typeof createClient>, orgId: string) {
  const { data: sRow } = await admin.from("settings").select("data").eq("org_id", orgId).maybeSingle();
  const cfg = (sRow?.data?.backup) ?? {};
  if (!cfg.enabled) return { orgId, skipped: "backups not enabled" };

  const dump: Record<string, unknown> = { org_id: orgId, generated_at: new Date().toISOString(), settings: sRow?.data ?? {} };
  for (const t of TABLES) {
    const { data } = await admin.from(t).select("*").eq("org_id", orgId);
    dump[t] = data ?? [];
  }
  const body = JSON.stringify(dump);
  const filename = `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const out: Record<string, unknown> = { orgId, filename, stored: false, emailed: false };

  if (cfg.storage) {
    const { error } = await admin.storage.from("backups").upload(`${orgId}/${filename}`, new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
    out.stored = !error; if (error) out.storeError = error.message;
  }

  if (cfg.email && cfg.recipient) {
    const key = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("EMAIL_FROM") ?? "onboarding@resend.dev";
    if (!key) { out.emailError = "RESEND_API_KEY not set"; }
    else {
      const content = btoa(unescape(encodeURIComponent(body)));
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [cfg.recipient], subject: `Ledger backup — ${filename}`, html: `<p>Automated backup attached (${filename}).</p>`, attachments: [{ filename, content }] }),
      });
      out.emailed = r.ok; if (!r.ok) out.emailError = (await r.json())?.message ?? "Resend rejected the email";
    }
  }
  return out;
}
