/**
 * Every language registered up front: what Node (the CLI, the server, scripts and tests)
 * imports. The runtime itself is ./runtime.js; the web app's build loads languages other than
 * English on demand instead (see the package's "browser" entry, ../index.browser.js).
 */
import es from './locales/es/index.js';
import vi from './locales/vi/index.js';
import { registerLocale } from './runtime.js';

registerLocale('es', es);
registerLocale('vi', vi);

export * from './runtime.js';
