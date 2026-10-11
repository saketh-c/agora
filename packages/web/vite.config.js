import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

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
        // woff2: the self-hosted fonts, so the display type works offline too.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        // The vision models are about 10 MB and only needed by Practice, and the es/vi city
        // translation memories (about 600 KB each) only by people reading in that language,
        // so they are fetched on first use and then kept, rather than precached for everyone.
        globIgnores: ['models/**', '**/assets/es-*.js', '**/assets/vi-*.js', '**/assets/vision_bundle-*.js'],
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
            urlPattern: ({ url }) => /\/assets\/(es|vi|vision_bundle)-[\w-]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'on-demand-chunks', cacheableResponse: { statuses: [0, 200] }, expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 } },
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
    // core's loadLocale() when someone reads in it, so adding a language does not grow it.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
          leaflet: ['leaflet', 'react-leaflet'],
          ...Object.fromEntries(['es', 'vi'].map((code) => [`ui-${code}`, [path.join(repoRoot, 'packages', 'core', 'src', 'i18n', 'locales', code, 'index.js')]])),
        },
      },
    },
  },
});
