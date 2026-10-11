import { useEffect } from 'react';
import { localeInfo, t } from '@agora/core';
import { useStore } from '../../lib/store.jsx';
import Icon from '../ui/Icon.jsx';

/** How long the notice stays when nobody closes it. */
const SHOW_MS = 10000;

/**
 * Says when a language picked from a menu could not be downloaded (offline, before that
 * language was ever loaded). Nothing changed: the app stays in the language it is in, and
 * the language can be picked again once the connection is back. Lives in the shell's status
 * region with UpdatePrompt, so the two never cover each other.
 */
export default function LanguageNotice() {
  const { langIssue, dismissLangIssue } = useStore();
  useEffect(() => {
    if (!langIssue) return undefined;
    const timer = setTimeout(dismissLangIssue, SHOW_MS);
    return () => clearTimeout(timer);
  }, [langIssue, dismissLangIssue]);
  if (!langIssue) return null;
  const info = localeInfo(langIssue.lang);
  return (
    <div className="toast update__toast" key={langIssue.at}>
      <Icon name="globe" size={20} />
      <span className="update__text">{t('shell.langOffline', { language: info.nativeName })}</span>
      <button type="button" className="iconbtn update__x" aria-label={t('common.close')} onClick={dismissLangIssue}>
        <Icon name="x" size={20} />
      </button>
    </div>
  );
}
