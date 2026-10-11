import { Link } from 'react-router-dom';
import { BRAND, formatMonthDay, isDateStr, t } from '@agora/core';
import { SCHEDULES_VERIFIED_ON } from '../lib/data.js';
import { useCities } from '../lib/DataProvider.jsx';
import { useStore } from '../lib/store.jsx';
import { Icon, PageHeader, Section } from '../components/ui/index.js';
import '../styles/pages/about.css';

function monthDayYear(dateStr) {
  return isDateStr(String(dateStr || '')) ? formatMonthDay(dateStr, { withYear: true }) : '';
}

/** What you can do in the app, as the same link rows the rest of the app uses. */
const PLACES = [
  { to: '/meetings', icon: 'cal', key: 'meetings' },
  { to: '/prepare', icon: 'mic', key: 'prepare' },
  { to: '/community', icon: 'people', key: 'community' },
  { to: '/news', icon: 'news', key: 'news' },
  { to: '/insights', icon: 'chart', key: 'data' },
];

/** About: why the app exists, where its data comes from, and who made it. Quiet and short. */
export default function About() {
  const { cities } = useCities();
  const { setupComplete } = useStore();
  const verified = monthDayYear(SCHEDULES_VERIFIED_ON);

  return (
    <div className="wrap ab">
      <PageHeader title={t('about.heading', { app: BRAND.name })} lead={BRAND.shortDescription}>
        {!setupComplete && (
          <Link className="btn btn--primary" to="/">
            {t('about.getStarted')}
          </Link>
        )}
      </PageHeader>

      <div className="ab-grid">
        <article className="ab-prose">
          <section aria-labelledby="ab-why">
            <h2 className="t-heading" id="ab-why">
              {t('about.nameTitle')}
            </h2>
            <p>{t('about.nameBody')}</p>
          </section>

          <section aria-labelledby="ab-problem">
            <h2 className="t-heading" id="ab-problem">
              {t('about.problemTitle')}
            </h2>
            <p>{t('about.problemBody', { region: BRAND.region, app: BRAND.name })}</p>
          </section>

          <section aria-labelledby="ab-fair">
            <h2 className="t-heading" id="ab-fair">
              {t('about.nonpartisanTitle')}
            </h2>
            <p>
              {BRAND.nonpartisanNote} {t('about.nonpartisanBody')}
            </p>
          </section>

          <section aria-labelledby="ab-data" id="data">
            <h2 className="t-heading" id="ab-data">
              {t('about.dataTitle')}
            </h2>
            <p>{t('about.dataBody')}</p>
            <p>{t('about.dataBody2')}</p>
            {verified && (
              <p className="verified">
                <Icon name="shield" />
                <span>{t('about.verified', { date: verified })}</span>
              </p>
            )}
          </section>

          <section aria-labelledby="ab-wrong">
            <h2 className="t-heading" id="ab-wrong">
              {t('about.reportTitle')}
            </h2>
            <p>{t('about.reportBody')}</p>
            <p>
              <a className="link" href={`${BRAND.repoUrl}/issues/new`} target="_blank" rel="noopener noreferrer">
                {t('about.reportLink')}
                <span className="vh"> {t('ui.opensNewTab')}</span>
              </a>
            </p>
          </section>

          <section aria-labelledby="ab-credits">
            <h2 className="t-heading" id="ab-credits">
              {t('about.creditsTitle')}
            </h2>
            <p>{t('about.creditsBody')}</p>
            <p>{BRAND.builtFor}</p>
          </section>
        </article>

        <aside className="ab-side">
          <Section title={t('about.doTitle')} id="ab-do">
            <ul className="group">
              {PLACES.map((p) => (
                <li key={p.key}>
                  <Link className="lrow lrow--icon" to={p.to}>
                    <span className="lrow__ic">
                      <Icon name={p.icon} />
                    </span>
                    <span>
                      <span className="lrow__t">{t(`about.do.${p.key}`)}</span>
                      <span className="lrow__m">{t(`about.do.${p.key}Sub`, { n: cities.length })}</span>
                    </span>
                    <Icon name="chev-r" />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </aside>
      </div>
    </div>
  );
}
