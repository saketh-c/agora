import { t } from '@agora/core';
import Icon from './Icon.jsx';
import Menu from './Menu.jsx';
import { downloadIcs, googleCalendarUrl, outlookUrl } from '../../lib/ics.js';
import { meetingDeadline } from './meetingInfo.js';

/**
 * "Add to calendar" as a menu: Google Calendar and Outlook open a prefilled event in a new
 * tab (what works on a Chromebook or an Android phone), and "Apple Calendar or other"
 * downloads an .ics file. Every option carries the sign-up deadline when the city closes
 * sign-up ahead of time; the .ics adds it as its own event with a reminder.
 *
 *   <AddToCalendar meeting={m} city={city} now={now} />
 */
export default function AddToCalendar({ meeting, city, now, className = 'btn btn--secondary', align = 'start' }) {
  if (!meeting) return null;
  const deadline = meeting.openToPublicComment ? meetingDeadline(meeting, now) : null;
  const opts = { deadline };
  const open = (url) => {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (win) win.opener = null;
  };
  return (
    <Menu
      label={t('ui.addToCalendar')}
      buttonClassName={`${className} calbtn`}
      align={align}
      button={
        <>
          <Icon name="cal-plus" />
          {t('ui.addToCalendar')}
          <Icon name="chev-d" size={20} className="calbtn__chev" />
        </>
      }
      items={[
        { label: t('ui.calendar.google'), sub: t('ui.calendar.webSub'), icon: 'ext', onSelect: () => open(googleCalendarUrl(meeting, city, opts)) },
        { label: t('ui.calendar.outlook'), sub: t('ui.calendar.webSub'), icon: 'ext', onSelect: () => open(outlookUrl(meeting, city, opts)) },
        { label: t('ui.calendar.office'), sub: t('ui.calendar.webSub'), icon: 'ext', onSelect: () => open(outlookUrl(meeting, city, { ...opts, work: true })) },
        { type: 'separator' },
        { label: t('ui.calendar.ics'), sub: t('ui.calendar.icsSub'), icon: 'download', onSelect: () => downloadIcs(meeting, city, opts) },
      ]}
    />
  );
}
