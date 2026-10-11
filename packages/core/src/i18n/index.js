/**
 * Every language registered up front: what Node (the CLI, the server, scripts and tests)
 * imports. The runtime itself is ./runtime.js; the web app's build loads languages other than
 * English on demand instead (see the package's "browser" entry, ../index.browser.js).
 */
import es from './locales/es/index.js';
import vi from './locales/vi/index.js';
import zh from './locales/zh/index.js';
import hi from './locales/hi/index.js';
import te from './locales/te/index.js';
import ar from './locales/ar/index.js';
import { registerLocale } from './runtime.js';

registerLocale('es', es);
registerLocale('vi', vi);
registerLocale('zh', zh);
registerLocale('hi', hi);
registerLocale('te', te);
registerLocale('ar', ar);

export * from './runtime.js';
