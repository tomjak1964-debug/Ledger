// Supabase Edge Function: send an email (with optional attachments) via Resend.
// Secrets to set (Dashboard → Edge Functions → send-document → Secrets, or CLI):
//   RESEND_API_KEY  — from resend.com (API Keys)
//   EMAIL_FROM      — e.g. "TMJ Engineering <invoices@tmjengineering.com>"
//                     (domain must be verified in Resend; until then use
//                      "onboarding@resend.dev", which can only email yourself)
// Deploy: supabase functions deploy send-document   (or paste in the dashboard)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
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
