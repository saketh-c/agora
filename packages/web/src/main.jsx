import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Fonts, self-hosted (no CDN at runtime). Mona Sans with the wdth axis, so the display type's
// font-stretch: 125% is the real wide cut; Public Sans for text. Both carry Vietnamese.
// fonts.css adds Noto Sans Arabic, Devanagari and Telugu, each downloaded only when its script
// is on screen; Chinese uses the system's fonts.
import '@fontsource-variable/mona-sans/wdth.css';
import '@fontsource-variable/public-sans/wght.css';
import './styles/fonts.css';
import './styles/index.css';
import { loadLocale, setI18nWarnings } from '@agora/core';
import { StoreProvider, initialLang, applyDocumentLanguage, takeUrlLanguage } from './lib/store.jsx';
import { reloadOnce } from './lib/recover.js';
import App from './App.jsx';

// Vite raises this when a lazily loaded page's chunk cannot be fetched, which after a
// deploy means the tab is holding a superseded build. Start the reload here, and let the
// real error carry on to the boundary so the console records the true cause rather than
// the "reading 'default'" that swallowing it would produce. See lib/recover.js.
window.addEventListener('vite:preloadError', () => {
  reloadOnce();
});

// Strip the trailing slash so the router treats "/agora/" and "/" the same way.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

// In development, say so when a translation is used in a way it cannot work: a plural
// message given words instead of a number shows its "other" form (core's t()).
if (import.meta.env.DEV) setI18nWarnings((message) => console.warn(`[i18n] ${message}`));

// The first language's dictionary comes before the first render (English is built in; the
// others are small chunks, fetched once), so the app never flashes in English first. The page
// takes the language's tag and direction at once, so an Arabic reader never sees it flip.
// ?lang=<code> picks a language on purpose (see lib/store.jsx), before the router reads the address.
const urlLang = takeUrlLanguage();
const firstLang = initialLang(urlLang);
applyDocumentLanguage(firstLang);
loadLocale(firstLang).finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter basename={basename}>
        <StoreProvider urlLang={urlLang}>
          <App />
        </StoreProvider>
      </BrowserRouter>
    </StrictMode>,
  );
});
