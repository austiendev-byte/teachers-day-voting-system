import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle, HourglassMedium, SignOut, WarningCircle } from '@phosphor-icons/react'
import useStudentBallot from '../../hooks/useStudentBallot'
import StudentCountdown from '../../components/StudentCountdown'
import './StudentPages.css'

function StatusSkeleton() {
  return (
    <div className="td-page">
      <div className="td-shell" role="status" aria-label="Checking your election and school schedule">
        <div className="skeleton sk-greeting" />
        <div className="status-panel">
          <div className="status-panel-head">
            <div className="skeleton sk-icon" />
            <div className="sk-grow">
              <div className="skeleton sk-title" />
              <div className="skeleton skeleton-text" />
              <div className="skeleton skeleton-text" />
            </div>
          </div>
          <div className="skeleton sk-block" />
        </div>
      </div>
    </div>
  )
}

function ElectionStatus() {
  const navigate = useNavigate()
  const {
    student,
    accountStatus,
    schoolName,
    election,
    effectiveSchoolWindow,
    votingState,
    currentStateCopy,
    awardCategories,
    votedCategoryCount,
    allCategoriesVoted,
    loading,
    loadError,
    handleLogout,
    reload
  } = useStudentBallot()

  if (loading) {
    return <StatusSkeleton />
  }

  if (loadError) {
    return (
      <div className="td-page">
        <div className="td-shell">
          <div className="td-card td-message-card">
            <span className="td-message-icon is-danger" aria-hidden="true">
              <WarningCircle size={26} weight="duotone" />
            </span>
            <h1 className="td-heading">We couldn&rsquo;t load your ballot</h1>
            <p className="td-subtext td-preline">{loadError}</p>
            <button type="button" className="td-btn td-btn-primary td-message-action" onClick={reload}>
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (accountStatus !== 'approved') {
    return (
      <div className="td-page">
        <div className="td-shell">
          <div className="td-card td-message-card">
            <span className="td-message-icon" aria-hidden="true">
              <HourglassMedium size={26} weight="duotone" />
            </span>
            <h1 className="td-heading">Account awaiting approval</h1>
            <p className="td-subtext">
              Your student account is registered. An administrator needs to approve it before you can vote.
            </p>
            <button type="button" className="td-btn td-btn-ghost td-message-action" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </div>
    )
  }

  const total = awardCategories.length || 9
  const readyToVote = votingState === 'school_open' && !allCategoriesVoted
  const finishedVoting = votingState === 'school_open' && allCategoriesVoted
  const firstName = student?.name?.split(' ')[0] || 'there'

  return (
    <div className="td-page">
      <div className="td-shell">
        <div className="td-greeting-row">
          <p className="td-greeting">
            Hi {firstName}, <span>{schoolName}</span>
          </p>
          <button type="button" className="td-btn-text" onClick={handleLogout}>
            <SignOut size={18} aria-hidden="true" />
            Log out
          </button>
        </div>

        <StudentCountdown
          votingState={votingState}
          stateCopy={currentStateCopy}
          electionStart={election?.start_date}
          schoolStart={effectiveSchoolWindow?.start}
          schoolEnd={effectiveSchoolWindow?.end}
        >
          {readyToVote && (
            <div className="status-cta">
              <div className="status-cta-meta">
                <span>
                  {votedCategoryCount > 0
                    ? `${votedCategoryCount} of ${total} categories recorded`
                    : `${total} award categories on your ballot`}
                </span>
                <span className="num">{Math.round((votedCategoryCount / total) * 100)}%</span>
              </div>
              <div className="td-progress-track" aria-hidden="true">
                <div
                  className="td-progress-fill"
                  style={{ transform: `scaleX(${votedCategoryCount / total})` }}
                />
              </div>
              <button
                type="button"
                className="td-btn td-btn-primary td-vote-button"
                onClick={() => navigate('/student/vote')}
              >
                {votedCategoryCount > 0 ? 'Continue voting' : 'Vote now'}
                <ArrowRight size={20} weight="bold" aria-hidden="true" />
              </button>
            </div>
          )}
        </StudentCountdown>

        {finishedVoting && (
          <Link to="/student/thank-you" className="voted-card">
            <span className="voted-card-seal" aria-hidden="true">
              <CheckCircle size={28} weight="fill" />
            </span>
            <span className="voted-card-body">
              <strong>Your ballot is recorded</strong>
              <span>All {total} of {total} categories. Thank you for taking part.</span>
            </span>
            <ArrowRight className="voted-card-arrow" size={20} aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  )
}

export default ElectionStatus
