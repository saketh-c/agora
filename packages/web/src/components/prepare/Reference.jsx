import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { glossary, lowerFirst, speakingTips, t, tn } from '@agora/core';
import { Icon, Sheet } from '../ui/index.js';

/** Terms named in the "Words you'll hear" row: consent agenda, public hearing, quorum. */
const SAMPLE_TERMS = [2, 4, 9];

/**
 * Reference (podium mock): speaking tips and words you'll hear open in a sheet; community
 * guides link to Community. Old /learn?tab=tips and ?tab=glossary links arrive as #tips and
 * #glossary and open the matching sheet.
 */
export default function Reference() {
  const { hash } = useLocation();
  const [open, setOpen] = useState(() => (hash === '#tips' || hash === '#glossary' ? hash.slice(1) : null));
  useEffect(() => {
    if (hash === '#tips' || hash === '#glossary') setOpen(hash.slice(1));
  }, [hash]);

  const tips = speakingTips();
  const terms = glossary();
  const sample = SAMPLE_TERMS.map((i) => terms[i] && terms[i].term).filter(Boolean);
  const sampleText = sample.map((term, i) => (i === 0 ? term : lowerFirst(term))).join(', ');

  return (
    <section className="ref" aria-labelledby="ref-h">
      <div className="sec-head">
        <h2 className="t-heading" id="ref-h">
          {t('prepare.ref.heading')}
        </h2>
      </div>
      <ul className="group">
        <li>
          <button type="button" id="tips" className="lrow lrow--icon" aria-haspopup="dialog" onClick={() => setOpen('tips')}>
            <span className="lrow__ic">
              <Icon name="bulb" />
            </span>
            <span>
              <span className="lrow__t">{t('prepare.ref.tips')}</span>
              <span className="lrow__m">{tn('prepare.ref.tipsSub', tips.length)}</span>
            </span>
            <Icon name="chev-r" />
          </button>
        </li>
        <li>
          <button type="button" id="glossary" className="lrow lrow--icon" aria-haspopup="dialog" onClick={() => setOpen('glossary')}>
            <span className="lrow__ic">
              <Icon name="book" />
            </span>
            <span>
              <span className="lrow__t">{t('prepare.ref.words')}</span>
              <span className="lrow__m">{t('prepare.ref.wordsSub', { terms: sampleText, n: Math.max(0, terms.length - sample.length) })}</span>
            </span>
            <Icon name="chev-r" />
          </button>
        </li>
        <li>
          <Link className="lrow lrow--icon" to="/community">
            <span className="lrow__ic">
              <Icon name="chat" />
            </span>
            <span>
              <span className="lrow__t">{t('prepare.ref.community')}</span>
              <span className="lrow__m">{t('prepare.ref.communitySub')}</span>
            </span>
            <Icon name="chev-r" />
          </Link>
        </li>
      </ul>

      <Sheet open={open === 'tips'} onClose={() => setOpen(null)} title={t('prepare.ref.tips')}>
        <ol className="prep-tips">
          {tips.map((tip, i) => (
            <li key={tip}>
              <span className="prep-tips__n num" aria-hidden="true">
                {i + 1}
              </span>
              <span>{tip}</span>
            </li>
          ))}
        </ol>
      </Sheet>
      <Sheet open={open === 'glossary'} onClose={() => setOpen(null)} title={t('prepare.ref.words')}>
        <dl className="prep-gloss">
          {terms.map((g) => (
            <div key={g.term}>
              <dt>{g.term}</dt>
              <dd>{g.definition}</dd>
            </div>
          ))}
        </dl>
      </Sheet>
    </section>
  );
}
