import { useState } from 'react';
import { t } from '@agora/core';
import { useStore } from '../lib/store.jsx';
import { PageHeader } from '../components/ui/index.js';
import MeetingPicker, { CarryNotice, ForLine, MeetingNotice } from '../components/prepare/MeetingPicker.jsx';
import CommentBuilder from '../components/prepare/CommentBuilder.jsx';
import { usePrepMeeting } from '../components/prepare/prepMeeting.js';
import '../styles/pages/prepare.css';

/**
 * /prepare/write: the comment builder on its own page, for the meeting Prepare is getting
 * ready for (or ?meeting=<id>). It shares the saved draft with the Write step on /prepare.
 */
export default function Write() {
  const ctx = usePrepMeeting();
  const { meeting, city, homeCity, practicing } = ctx;
  const { profile } = useStore();
  const [picking, setPicking] = useState(false);

  return (
    <div className="wrap prep prep--write">
      <PageHeader title={t('shell.titles.write')} crumbs={[{ to: '/prepare', label: t('nav.prepare') }, { label: t('shell.titles.write') }]}>
        <ForLine ctx={ctx} onChange={() => setPicking(true)} />
      </PageHeader>
      <MeetingNotice ctx={ctx} onPick={() => setPicking(true)} />
      <CarryNotice ctx={ctx} />
      <div className="card prep-write">
        <CommentBuilder key={profile.id} ctx={ctx} meeting={meeting} city={city || homeCity} practicing={practicing} headingLevel={2} idPrefix="write" />
      </div>
      <MeetingPicker ctx={ctx} open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}
