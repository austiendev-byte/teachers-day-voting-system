import { memo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle, Circle, SealCheck } from '@phosphor-icons/react'
import useStudentBallot from '../../hooks/useStudentBallot'
import './StudentPages.css'

const BallotCategory = memo(function BallotCategory({ category, faculty, value, alreadyVoted, disabled, onSelect }) {
  const categoryId = String(category.category_id)
  const selectedMember = faculty.find((member) => String(member.id) === String(value))
  const optionFaculty =
    selectedMember && !faculty.some((member) => String(member.id) === String(value))
      ? [selectedMember, ...faculty]
      : faculty

  const state = alreadyVoted ? 'is-complete' : selectedMember ? 'is-selected' : ''

  return (
    <fieldset className={`ballot-item ${state}`} disabled={disabled || alreadyVoted}>
      <legend className="ballot-item-head">
        <span className="ballot-item-number num" aria-hidden="true">
          {String(category.display_order).padStart(2, '0')}
        </span>
        <span className="ballot-item-title">{category.category_name}</span>
        <span className="ballot-item-state">
          {alreadyVoted ? (
            <><SealCheck size={18} weight="fill" aria-hidden="true" /> Recorded</>
          ) : selectedMember ? (
            <><CheckCircle size={18} weight="fill" aria-hidden="true" /> Chosen</>
          ) : (
            <><Circle size={18} aria-hidden="true" /> Required</>
          )}
        </span>
      </legend>

      {alreadyVoted ? (
        <p className="ballot-item-recorded">Your vote for this category is already recorded.</p>
      ) : (
        <div className="td-field">
          <label htmlFor={`award-category-${categoryId}`} className="sr-only">
            Choose a faculty member for {category.category_name}
          </label>
          <select
            id={`award-category-${categoryId}`}
            name={`award-category-${categoryId}`}
            value={value || ''}
            onChange={(event) => onSelect(categoryId, event.target.value)}
            aria-describedby={`award-category-${categoryId}-help`}
          >
            <option value="">Choose a faculty member&hellip;</option>
            {optionFaculty.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.programs?.program_name ? ` · ${member.programs.program_name}` : ''}
              </option>
            ))}
          </select>
          <small id={`award-category-${categoryId}-help`} className="td-field-hint">
            {selectedMember
              ? 'You can change this until you submit the ballot.'
              : 'Only faculty from your school are listed.'}
          </small>
        </div>
      )}
    </fieldset>
  )
})

function BallotSkeleton() {
  return (
    <div className="td-page">
      <div className="td-shell td-shell-wide" role="status" aria-label="Loading your ballot">
        <div className="skeleton sk-title sk-title-short" />
        <div className="skeleton sk-intro" />
        {[0, 1, 2].map((key) => (
          <div key={key} className="skeleton sk-ballot-item" />
        ))}
      </div>
    </div>
  )
}

function Ballot() {
  const navigate = useNavigate()
  const {
    loading,
    votingState,
    awardCategories,
    categoryVoteStatus,
    ballotSelections,
    faculty,
    loadingFaculty,
    submitting,
    allCategoriesVoted,
    handleBallotSelection,
    handleBallotSubmit
  } = useStudentBallot()

  // Voting only makes sense while the school window is actually open.
  // This is a UX guard, not a security boundary -- submit_full_ballot()
  // independently re-checks everything server side regardless.
  useEffect(() => {
    if (loading) return
    if (votingState !== 'school_open') {
      navigate('/student', { replace: true })
    } else if (allCategoriesVoted) {
      navigate('/student/thank-you', { replace: true })
    }
  }, [loading, votingState, allCategoriesVoted, navigate])

  if (loading || votingState !== 'school_open' || allCategoriesVoted) {
    return <BallotSkeleton />
  }

  const total = awardCategories.length || 9

  // Progress counts what the student has chosen on this screen, plus
  // categories already recorded, so the bar moves as they fill it in.
  const chosenCount = awardCategories.filter((category) => {
    const id = String(category.category_id)
    return Boolean(categoryVoteStatus[id] || ballotSelections[id])
  }).length
  const complete = chosenCount === total
  const remaining = total - chosenCount

  async function onSubmit(event) {
    event.preventDefault()
    const result = await handleBallotSubmit()

    if (result.ok) {
      navigate('/student/thank-you')
      return
    }

    if (result.firstMissingId) {
      const field = document.getElementById(`award-category-${result.firstMissingId}`)
      field?.scrollIntoView({ block: 'center' })
      field?.focus({ preventScroll: true })
    }
  }

  return (
    <div className="td-page">
      <div className="td-shell td-shell-wide ballot-shell">
        <button type="button" className="td-btn-text ballot-back" onClick={() => navigate('/student')}>
          <ArrowLeft size={18} aria-hidden="true" />
          Back to status
        </button>

        <h1 className="td-heading">Official ballot</h1>
        <p className="td-subtext ballot-intro">
          Choose one faculty member for each award category. Your selections are submitted together, once.
        </p>

        {loadingFaculty && faculty.length === 0 ? (
          <div className="ballot-list" role="status" aria-label="Loading faculty for your school">
            {[0, 1, 2].map((key) => (
              <div key={key} className="skeleton sk-ballot-item" />
            ))}
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="ballot-list">
              {awardCategories.map((category) => (
                <BallotCategory
                  key={category.category_id}
                  category={category}
                  faculty={faculty}
                  value={ballotSelections[String(category.category_id)]}
                  alreadyVoted={Boolean(categoryVoteStatus[String(category.category_id)])}
                  disabled={submitting}
                  onSelect={handleBallotSelection}
                />
              ))}
            </div>

            <div className="ballot-dock">
              <div className="ballot-dock-inner">
                <div className="ballot-dock-progress">
                  <span className="ballot-dock-count" aria-live="polite">
                    <strong className="num">{chosenCount}</strong>
                    <span> of {total} chosen</span>
                  </span>
                  <span className="ballot-dock-hint">
                    {complete ? 'Ready to submit' : `${remaining} left`}
                  </span>
                  <div className="td-progress-track" aria-hidden="true">
                    <div
                      className={`td-progress-fill${complete ? ' is-complete' : ''}`}
                      style={{ transform: `scaleX(${chosenCount / total})` }}
                    />
                  </div>
                </div>

                <button type="submit" className="td-btn td-btn-primary ballot-submit" disabled={submitting}>
                  {submitting && <span className="spinner" aria-hidden="true" />}
                  {submitting ? 'Submitting' : 'Submit ballot'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default Ballot
