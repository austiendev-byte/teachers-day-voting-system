import { memo, useEffect, useState } from 'react'
import { CalendarBlank, CheckCircle, Clock, Hourglass, LockSimple, WarningCircle } from '@phosphor-icons/react'

const dateTimeFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function formatDate(dateValue) {
  if (!dateValue) return ''

  return dateTimeFormatter.format(new Date(dateValue))
}

function getTimeDifference(targetDate, now) {
  if (!targetDate) {
    return null
  }

  const target = new Date(targetDate)
  const difference = target.getTime() - now.getTime()

  if (difference <= 0) {
    return {
      total: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0
    }
  }

  const totalSeconds = Math.floor(difference / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return {
    total: difference,
    days,
    hours,
    minutes,
    seconds
  }
}

const TONE_ICONS = {
  success: CheckCircle,
  warning: Hourglass,
  info: CalendarBlank,
  closed: LockSimple,
  neutral: WarningCircle
}

function StudentCountdown({
  votingState,
  stateCopy,
  electionStart,
  schoolStart,
  schoolEnd,
  children
}) {
  const [now, setNow] = useState(() => new Date())

  const timerTarget =
    votingState === 'election_not_started'
      ? electionStart
      : votingState === 'school_not_started'
        ? schoolStart
        : votingState === 'school_open'
          ? schoolEnd
          : null

  useEffect(() => {
    if (!timerTarget) {
      return undefined
    }

    const tick = () => setNow(new Date())
    tick()

    const timer = window.setInterval(tick, 1000)

    return () => window.clearInterval(timer)
  }, [timerTarget])

  const timer = getTimeDifference(timerTarget, now)

  const countdownLabel =
    votingState === 'election_not_started'
      ? 'Election starts in'
      : votingState === 'school_not_started'
        ? 'Your school opens in'
        : votingState === 'school_open'
          ? 'Voting closes in'
          : ''

  const parts = timer
    ? [
        ['Days', timer.days],
        ['Hours', timer.hours],
        ['Min', timer.minutes],
        ['Sec', timer.seconds]
      ]
    : []

  const Icon = TONE_ICONS[stateCopy.tone] || Clock

  return (
    <section className={`status-panel is-${stateCopy.tone}`} aria-labelledby="status-title">
      <div className="status-panel-head">
        <span className="status-panel-icon" aria-hidden="true">
          <Icon size={22} weight="duotone" />
        </span>
        <div>
          <h1 id="status-title" className="status-panel-title">{stateCopy.title}</h1>
          <p className="status-panel-message">{stateCopy.message}</p>
        </div>
      </div>

      {timerTarget && timer ? (
        <div className="countdown" role="timer" aria-live="off">
          <span className="countdown-label">{countdownLabel}</span>

          <div className="countdown-units">
            {parts.map(([label, value]) => (
              <div key={label} className="countdown-unit">
                <strong className="num">{String(value).padStart(2, '0')}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>

          <span className="countdown-deadline">
            <Clock size={15} aria-hidden="true" />
            {votingState === 'election_not_started'
              ? `Election starts ${formatDate(electionStart)}`
              : votingState === 'school_not_started'
                ? `Your school starts ${formatDate(schoolStart)}`
                : `Voting closes ${formatDate(schoolEnd)}`}
          </span>
        </div>
      ) : (
        <p className="countdown-static">
          {votingState === 'schedule_not_configured'
            ? 'Waiting for your school schedule'
            : votingState === 'election_awaiting_open'
              ? 'Waiting for the organizers to open voting'
              : votingState === 'school_closed'
                ? 'Voting has closed for your school'
                : 'The election has closed'}
        </p>
      )}

      {children}
    </section>
  )
}

export default memo(StudentCountdown)
