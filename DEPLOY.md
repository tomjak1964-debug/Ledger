# Deploying Ledger to its own site

The app is a static Vite/React SPA in [`app/`](app/) talking to Supabase. There's
no server to run — the host just builds `app/` and serves the static `dist/`.
Config for both hosts lives at the repo root: [`netlify.toml`](netlify.toml) and
[`vercel.json`](vercel.json). Both are self-contained (they build the `app/`
subdirectory), so you don't need to change any "root directory" setting.

Same approach as the golf-league app: repo on GitHub → host imports the repo →
every push auto-deploys.

## 0. Before you deploy — Supabase must be ready

- `schema.sql` run in the SQL editor ✓ (done 2026-07-10)
- `migrations/002_invoice_notes.sql` run ✓ (needed for invoice editing)
- Email provider enabled; "Confirm email" set how you want it
  (Authentication → Sign In / Up → Email).

No Supabase redirect-URL or CORS changes are needed — sign-in is plain
email + password and the data API allows any origin.

## 1. Environment variables (set these in the host)

Vite inlines `VITE_*` vars **at build time**, so set them in the host's site
settings *before the first build* — same values as `app/.env.local`:

| Variable | Value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://iusqcwfgciavixuhywoh.supabase.co` | browser-safe |
| `VITE_SUPABASE_ANON_KEY` | your publishable (`sb_publishable_…`) key | browser-safe (RLS protects data) |

⚠️ **Never** put the secret / service-role key in the host — it bypasses RLS.

## 2. Get the repo onto GitHub

`gh` isn't installed on this machine, so create the repo on the website:

1. github.com → **＋** → **New repository** → name it (e.g. `ledger`),
   **Private**, and do NOT add a README/license (the repo must be empty).
2. Then in this folder:
   ```
   git remote add origin https://github.com/YOUR-USERNAME/ledger.git
   git push -u origin main
   ```
   (Or just tell Claude the repo URL and it will wire up the push.)

## 3a. Deploy to Netlify

1. app.netlify.com → **Add new site → Import an existing project** → pick the
   repo. Netlify reads `netlify.toml` (build command + `app/dist` + SPA redirect).
2. Site settings → **Environment variables** → add the two `VITE_*` vars.
3. Deploy. Every push to `main` redeploys. Free tier is plenty.

## 3b. Deploy to Vercel (alternative)

1. vercel.com → **Add New → Project** → import the repo. Vercel reads
   `vercel.json`; leave Root Directory as the repo root.
2. Project → Settings → **Environment Variables** → add the two `VITE_*` vars.
3. Deploy.

## After deploying — smoke test

Open the deployed URL, sign in (or create your account), and check the
Dashboard loads. If the app shows the "connect Supabase" setup notice, the env
vars weren't set at build time — add them and trigger a redeploy.

**Phone install:** open the deployed URL on your phone → iPhone: Share →
*Add to Home Screen* · Android Chrome: menu → *Install app*.

## Notes

- Prod and local use the same Supabase project, so they share your books —
  that's the point (multi-device), not a bug.
- Build locally to sanity-check: `npm --prefix app run build` → `app/dist/`.
- Custom domain later: both hosts let you attach one in the site settings
  (e.g. `ledger.tmjengineering.com` via a CNAME record).
