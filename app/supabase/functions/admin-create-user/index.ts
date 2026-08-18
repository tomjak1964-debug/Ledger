// Supabase Edge Function: admin-provisioned user accounts (Phase 2, feature 6).
//
// An org owner/admin calls this to create a login for a teammate with an
// initial password they hand over — there is no public sign-up. Runs with the
// service-role key (never exposed to the browser). SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically;
// no secrets to set. Deploy: supabase functions deploy admin-create-user
//
// Body: { orgId, email, password, role?, permissions? }
// The caller must be an owner/admin of orgId (verified below).
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

    const { orgId, email, password, role, permissions, action } = await req.json();
    if (!orgId || !email || !password) throw new Error("orgId, email and password are required");
    if (String(password).length < 8) throw new Error("Password must be at least 8 characters");
    const addr = String(email).trim().toLowerCase();

    // 1) Identify the caller from their JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) throw new Error("Not signed in");

    // 2) Authorize: the caller must be an owner/admin of the target org.
    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: caller } = await admin.from("org_members")
      .select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
    if (!caller || !["owner", "admin"].includes(caller.role))
      throw new Error("Only an admin can manage users");

    if (action === "reset-password") {
      // Reset an existing member's password. Find their auth id via membership.
      const { data: target } = await admin.from("org_members")
        .select("user_id").eq("org_id", orgId).eq("email", addr).maybeSingle();
      if (!target?.user_id) throw new Error("That user hasn't signed in yet, so there's no login to reset");
      const { error: rErr } = await admin.auth.admin.updateUserById(target.user_id, { password: String(password) });
      if (rErr) throw rErr;
      return new Response(JSON.stringify({ ok: true, email: addr }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // 3) Create the auth user with the given password, pre-confirmed so they
    //    can sign in immediately with the credentials the admin hands them.
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: addr, password: String(password), email_confirm: true,
    });
    if (cErr) throw cErr;

    // 4) Attach them to the org with their role + permissions.
    const { error: mErr } = await admin.from("org_members").upsert({
      org_id: orgId,
      user_id: created.user.id,
      email: addr,
      role: role === "admin" ? "admin" : "member",
      permissions: permissions ?? {},
    }, { onConflict: "org_id,email" });
    if (mErr) throw mErr;

    return new Response(JSON.stringify({ ok: true, email: created.user.email }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
