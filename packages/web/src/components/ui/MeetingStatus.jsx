import { formatDate, t } from '@agora/core';
import Icon from './Icon.jsx';
import Badge from './Badge.jsx';
import { TIMING_ICON, canSpeakText, deadlineText, remoteState, schoolTiming, timingLabel } from './meetingInfo.js';

/**
 * The status signals for one meeting, worded and colored the same everywhere.
 * At most two signals: "Can speak, N min" + school timing (After school / During school),
 * or "Watch only", or "Cancelled" (+ where it moved). An amber sign-up deadline line is
 * added when `deadline` is given (see meetingDeadline in meetingInfo.js).
 *
 * variant="row"    inline text signals for MeetingRow (.st)
 * variant="badges" pills for cards (.badge); `showRemote` adds In person only / Online too.
 */
export default function MeetingStatus({ meeting, city, variant = 'row', deadline, showTiming = true, showRemote = false, className = '' }) {
  if (!meeting) return null;
  const signals = [];
  if (meeting.status === 'cancelled') {
    signals.push({ tone: 'stop', icon: 'xc', text: t('ui.cancelled') });
    if (meeting.movedTo) signals.push({ tone: 'plain', icon: 'moved', text: t('ui.movedTo', { date: formatDate(meeting.movedTo) }) });
  } else if (meeting.openToPublicComment) {
    signals.push({ tone: 'go', icon: 'mic', text: canSpeakText(city) });
    if (meeting.movedFrom) signals.push({ tone: 'plain', icon: 'moved', text: t('ui.movedFrom', { date: formatDate(meeting.movedFrom) }) });
    else if (showTiming) signals.push({ tone: 'plain', icon: TIMING_ICON[schoolTiming(meeting)], text: timingLabel(meeting) });
  } else {
    signals.push({ tone: 'watch', icon: 'eye', text: t('ui.watchOnly') });
    if (variant === 'badges' && showTiming) signals.push({ tone: 'plain', icon: TIMING_ICON[schoolTiming(meeting)], text: timingLabel(meeting) });
  }
  if (variant === 'badges' && showRemote && meeting.status !== 'cancelled' && meeting.openToPublicComment) {
    const remote = remoteState(city);
    signals.push({ tone: 'plain', icon: remote === 'yes' ? 'video' : 'user', text: t(`ui.remote.${remote}`) });
  }
  const dl = deadline && meeting.status !== 'cancelled' ? { tone: deadline.passed ? 'stop' : 'amber', icon: 'clock', text: deadlineText(deadline, variant === 'badges' ? 'closes' : 'by') } : null;

  if (variant === 'badges') {
    const badgeTone = { go: 'go', stop: 'stop', watch: 'neutral', plain: 'neutral' };
    return (
      <div className={`badges ${className}`.trim()}>
        {signals.map((s) => (
          <Badge key={s.text} tone={badgeTone[s.tone]} icon={s.icon}>
            {s.text}
          </Badge>
        ))}
        {dl && (
          <Badge tone={dl.tone === 'stop' ? 'stop' : 'amber'} icon={dl.icon}>
            {dl.text}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <span className={`row__status ${className}`.trim()}>
      {[...signals, ...(dl ? [dl] : [])].map((s) => (
        <span key={s.text} className={`st st--${s.tone}`}>
          <Icon name={s.icon} />
          {s.text}
        </span>
      ))}
    </span>
  );
}
