import { useId, useState } from 'react';
import { topicList, t } from '@agora/core';
import { Chip } from '../ui/index.js';
import { STARTER_TOPICS } from './homeData.js';

/**
 * Topic toggles (aria-pressed chips). Collapsed, it shows the starter topics plus any already
 * picked, and an "All 17 topics" chip that opens the rest in place; `all` shows every topic.
 * `label` names the group for screen readers.
 */
export default function TopicPicker({ value = [], onChange, all = false, label }) {
  const [open, setOpen] = useState(false);
  const listId = `topics-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // Starter topics first, in their order, so opening "All 17 topics" only adds chips after them.
  const rank = (id) => (STARTER_TOPICS.includes(id) ? STARTER_TOPICS.indexOf(id) : STARTER_TOPICS.length);
  const topics = topicList()
    .filter((x) => x.id !== 'other')
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i);
  const expanded = all || open;
  const shown = expanded ? topics : topics.filter((x) => STARTER_TOPICS.includes(x.id) || value.includes(x.id));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="chipwrap topics" role="group" aria-label={label} id={listId}>
      {shown.map((topic) => (
        <Chip key={topic.id} pressed={value.includes(topic.id)} onClick={() => toggle(topic.id)}>
          {topic.label}
        </Chip>
      ))}
      {!all && (
        <Chip menu className={open ? 'topics__less' : ''} aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
          {open ? t('home.topics.fewer') : t('home.topics.all', { n: topics.length })}
        </Chip>
      )}
    </div>
  );
}
