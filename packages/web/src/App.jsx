import { Component, lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { t } from '@agora/core';
import { useStore } from './lib/store.jsx';
import { DataProvider } from './lib/DataProvider.jsx';
import { isChunkLoadError, isReloadPending, reloadOnce } from './lib/recover.js';
import AppHeader from './components/shell/AppHeader.jsx';
import TabBar from './components/shell/TabBar.jsx';
import AppFooter from './components/shell/AppFooter.jsx';
import SetupHost from './components/shell/SetupHost.jsx';
import { PageMetaProvider, RouteEffects, SkipLinks, useShellChrome } from './components/shell/PageMeta.jsx';
import UpdatePrompt from './components/shell/UpdatePrompt.jsx';
import EmptyState from './components/ui/EmptyState.jsx';
import Home from './pages/Home.jsx';

// Pages load on demand; Home ships with the first screen because it is the landing page.
// Routes that still point at a page from before the redesign are marked "interim": the page
// agents replace them with the rebuilt pages.
const Meetings = lazy(() => import('./pages/Meetings.jsx'));
const Prepare = lazy(() => import('./pages/Prepare.jsx'));
const Write = lazy(() => import('./pages/Write.jsx'));
const Practice = lazy(() => import('./pages/Practice.jsx'));
const Cities = lazy(() => import('./pages/Cities.jsx'));
const CityPage = lazy(() => import('./pages/CityPage.jsx'));
const Insights = lazy(() => import('./pages/Insights.jsx'));
const News = lazy(() => import('./pages/News.jsx'));
const About = lazy(() => import('./pages/About.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Community = lazy(() => import('./pages/Community.jsx'));
// Unlinked component gallery for screenshots and review.
const UiGallery = lazy(() => import('./dev/UiGallery.jsx'));

function PageLoading() {
  return (
    <div className="wrap page-loading" role="status" aria-live="polite">
      <span className="vh">{t('common.loading')}</span>
      <span className="page-loading__line page-loading__line--title" aria-hidden="true" />
      <span className="page-loading__line page-loading__line--short" aria-hidden="true" />
      <span className="page-loading__block" aria-hidden="true" />
    </div>
  );
}

/** Keeps one broken page from blanking the whole app. Resets on the next navigation. */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Never swallow it silently: the console is where the reason lives for a bug report.
    console.error('Agora page error:', error, info && info.componentStack);
    // A chunk from a superseded deploy is not a bug in the page. Reload into the current build.
    if (isChunkLoadError(error)) reloadOnce();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (isReloadPending()) {
      return (
        <div className="wrap page-error" role="status" aria-live="polite">
          <p>
            <span className="spinner" aria-hidden="true" /> {t('errors.updating')}
          </p>
        </div>
      );
    }
    const message = String((this.state.error && this.state.error.message) || this.state.error || '');
    return (
      <div className="wrap page-error" role="alert">
        <h1 className="t-title">{t('errors.boundaryTitle')}</h1>
        <EmptyState
          icon="alert"
          title={t('errors.boundaryLead')}
          actions={
            <>
              <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
                {t('errors.reload')}
              </button>
              <Link className="btn btn--secondary" to="/">
                {t('errors.goHome')}
              </Link>
            </>
          }
        >
          {t('errors.boundaryBody')}
        </EmptyState>
        {message && <p className="page-error__detail">{`${t('errors.detail')} ${message.slice(0, 300)}`}</p>}
      </div>
    );
  }
}

/** Old addresses keep working: they forward, with the parts of the query that still mean something. */
function Redirect({ to, keepSearch = false, set }) {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(keepSearch ? search : '');
  if (set) for (const [k, v] of Object.entries(set)) params.set(k, v);
  const qs = params.toString();
  return <Navigate replace to={`${to}${qs ? `?${qs}` : ''}${hash || ''}`} />;
}

/** /learn?tab=comment was the comment builder; the other tabs became sections of Prepare. */
function LearnRedirect() {
  const [params] = useSearchParams();
  const tab = params.get('tab');
  const city = params.get('city');
  const qs = city ? `?city=${encodeURIComponent(city)}` : '';
  if (tab === 'comment') return <Navigate replace to={`/prepare/write${qs}`} />;
  return <Navigate replace to={`/prepare${qs}${tab && tab !== 'checklist' ? `#${tab}` : ''}`} />;
}

function NotFound() {
  return (
    <div className="wrap page-error">
      <h1 className="t-title">{t('errors.notFoundTitle')}</h1>
      <EmptyState
        icon="map"
        title={t('errors.notFoundLead')}
        actions={
          <>
            <Link className="btn btn--primary" to="/">
              {t('errors.goHome')}
            </Link>
            <Link className="btn btn--secondary" to="/meetings">
              {t('nav.meetings')}
            </Link>
          </>
        }
      >
        {t('errors.notFoundBody')}
      </EmptyState>
    </div>
  );
}

function Shell() {
  const { lang } = useStore();
  const location = useLocation();
  const { footerHidden } = useShellChrome();

  return (
    <>
      <SkipLinks />
      <AppHeader />
      <main id="main" tabIndex={-1}>
        <ErrorBoundary resetKey={location.key}>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/meetings" element={<Meetings />} />
              <Route path="/cities" element={<Cities />} />
              <Route path="/city/:id" element={<CityPage />} />
              <Route path="/prepare" element={<Prepare />} />
              <Route path="/prepare/write" element={<Write />} />
              <Route path="/prepare/practice" element={<Practice />} />
              <Route path="/community" element={<Community />} />
              <Route path="/news" element={<News />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/about" element={<About />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/__ui" element={<UiGallery />} />
              {/* Addresses from before the redesign */}
              <Route path="/map" element={<Redirect to="/meetings" keepSearch set={{ view: 'map' }} />} />
              <Route path="/for-you" element={<Redirect to="/" />} />
              <Route path="/start" element={<Redirect to="/" set={{ setup: '1' }} />} />
              <Route path="/learn" element={<LearnRedirect />} />
              <Route path="/rehearse" element={<Redirect to="/prepare/practice" keepSearch />} />
              <Route path="/more" element={<Redirect to="/" />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      {!footerHidden && <AppFooter />}
      <TabBar />
      <SetupHost />
      <UpdatePrompt />
      <RouteEffects languageKey={lang} />
    </>
  );
}

export default function App() {
  return (
    <DataProvider>
      <PageMetaProvider>
        <Shell />
      </PageMetaProvider>
    </DataProvider>
  );
}
