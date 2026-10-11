import { firstGrapheme } from '@agora/core';
import Icon from './Icon.jsx';

/**
 * A round initial, or a person glyph for a profile with no name yet. The initial is the
 * name's first grapheme, so a conjunct or a vowel sign stays with its letter ('रा', 'శ్రీ')
 * and an accent or an emoji is never cut in half.
 */
export default function Avatar({ name, size, soft = false, className = '' }) {
  const initial = firstGrapheme(name);
  const cls = ['avatar', size === 'lg' ? 'avatar--lg' : '', !initial ? 'avatar--guest' : soft ? 'avatar--soft' : '', className].filter(Boolean).join(' ');
  return (
    <span className={cls} aria-hidden="true">
      {initial ? initial.toLocaleUpperCase() : <Icon name="user" size={20} />}
    </span>
  );
}
