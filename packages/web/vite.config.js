import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../core/src/i18n/runtime.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/**
 * Languages other than English, from core's LOCALES. Each gets its own dictionary chunk
 * (ui-<code>) and city translation chunk (city-i18n-<code>). The dictionaries of the languages
 * the app offers (LOCALES[].ready) are precached, so an installed app switches language
 * offline; they are small (under 90 KB each). A language still being translated is not
 * offered, so its dictionary is fetched only when someone picks it on purpose and then kept
 * (CacheFirst), as are the city translations and the script fonts.
 */
const LANGS = LOCALES.map((l) => l.code).filter((code) => code !== 'en');
const PRECACHED_UI = LOCALES.filter((l) => l.ready && l.code !== 'en').map((l) => l.code);
const ON_DEMAND_UI = LANGS.filter((code) => !PRECACHED_UI.includes(code));

// Served from the domain root in development and from /<repo>/ on GitHub Pages, so the
// base has to reach the manifest, the service worker scope, and the router as well as
// the asset URLs.
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
      manifest: {
        name: 'Agora: your turn to speak at city hall',
        short_name: 'Agora',
        description: 'Find a city council meeting in Dallas-Fort Worth, learn exactly how to sign up to speak, and get ready to say your piece.',
        theme_color: '#15182B',
        background_color: '#F2F3F6',
        display: 'standalone',
        start_url: base,
        scope: base,
        lang: 'en-US',
        categories: ['government', 'education', 'news'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Meetings', url: `${base}meetings`, description: 'Council meetings near you, on a list or a map' },
          { name: 'Prepare', url: `${base}prepare`, description: 'Sign up, write your comment and practice it' },
        ],
      },
      workbox: {
        // woff2: the self-hosted Latin fonts (Mona Sans, Public Sans), so the display type
        // works offline too.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        // The vision models are about 10 MB and only needed by Practice; the city translation
        // memories (about 600 KB each), the dictionaries of languages not offered yet, and the
        // Arabic, Devanagari and Telugu fonts are only needed by people reading in that
        // language. All of them are fetched on first use and then kept (runtimeCaching below),
        // rather than precached for everyone.
        globIgnores: ['models/**', '**/assets/city-i18n-*.js', ...ON_DEMAND_UI.map((code) => `**/assets/ui-${code}-*.js`), '**/assets/noto-sans-*.woff2', '**/assets/vision_bundle-*.js'],
        navigateFallback: `${base}index.html`,
        // API URLs opened directly (for example /api/health) must reach the server, not the app.
        navigateFallbackDenylist: [/\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/models/'),
            handler: 'CacheFirst',
            options: { cacheName: 'vision-models', cacheableResponse: { statuses: [0, 200] }, expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          // No OpenStreetMap tile caching: the OSM tile usage policy forbids offline tile caches.
          {
            // Workbox copies this function's source into the service worker, so it names no
            // list from this file: any language's chunk matches, and the precached ones are
            // answered by the precache before this rule is reached.
            urlPattern: ({ url }) => /\/assets\/(city-i18n-[a-z]{2}|ui-[a-z]{2}|vision_bundle)-[\w-]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'on-demand-chunks', cacheableResponse: { statuses: [0, 200] }, expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            // Script fonts for Arabic, Hindi and Telugu: downloaded only when that script is on
            // screen, then kept so the language reads the same offline.
            urlPattern: ({ url }) => /\/assets\/noto-sans-[\w-]+\.woff2$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'script-fonts', cacheableResponse: { statuses: [0, 200] }, expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            // Only reference data is cached offline. Geocode, news, and AI responses can carry a
            // typed address or a name, so they are never written to Cache Storage.
            urlPattern: ({ url }) => /^\/api\/(cities|meetings|stats|learn|topics|health)(\/|$)/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'api', networkTimeoutSeconds: 5, expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@data': path.join(repoRoot, 'data') },
  },
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    // xfwd passes the browser's address on, so dev users are not one rate-limit bucket.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true, xfwd: true } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true, xfwd: true } },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Kept on purpose: the first chunk carries the app, the city data and only the English
    // dictionary. Every other language's dictionary is its own chunk (ui-<code>), loaded by
    // core's loadLocale() when someone reads in it, and so is its city translation memory
    // (city-i18n-<code>), so adding a language does not grow the first download.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
          leaflet: ['leaflet', 'react-leaflet'],
          ...Object.fromEntries(LANGS.map((code) => [`ui-${code}`, [path.join(repoRoot, 'packages', 'core', 'src', 'i18n', 'locales', code, 'index.js')]])),
          ...Object.fromEntries(LANGS.map((code) => [`city-i18n-${code}`, [path.join(repoRoot, 'data', 'i18n', `${code}.json`)]])),
        },
      },
    },
  },
});
