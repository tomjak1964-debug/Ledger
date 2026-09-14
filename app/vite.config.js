import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Stamped into the bundle so Settings → Account can say which build is running.
// Two rounds have been lost to "is the fix live or is my browser cached?" — this
// answers it at a glance. Vercel exports the commit sha; local builds get a date.
const sha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' + (sha ? ' · ' + sha : '');

export default defineConfig({
  define: { __BUILD__: JSON.stringify(stamp) },
  // Two pages: a public landing page at / that says what this site is (reputation
  // scanners kept flagging a bare credential form on a new domain), and the app
  // itself at /app.
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',            // new deploys refresh the cached shell automatically
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'Ledger — Quote to Cash',
        short_name: 'Ledger',
        description: 'Quotes, sales orders, invoices, payments, and reports for the shop.',
        theme_color: '#13233B',
        background_color: '#EDF0F4',
        display: 'standalone',
        start_url: '/app',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Precache only the built app shell. Supabase requests are NOT cached,
      // so the books are always live. /reset is deliberately left out of both
      // the precache and the SPA fallback: it is the page that throws this
      // cache away, so it must always come from the server.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['reset.html'],
        // The app shell answers for /app...; the landing page and /reset are
        // served as themselves.
        navigateFallback: '/app/index.html',
        navigateFallbackDenylist: [/^\/reset/, /^\/$/],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { host: true, port: 5173 }, // host:true exposes it on the LAN for phone testing
});
