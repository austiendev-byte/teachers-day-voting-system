import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, SignOut } from '@phosphor-icons/react'
import useStudentBallot from '../../hooks/useStudentBallot'
import './StudentPages.css'

function ThankYou() {
  const navigate = useNavigate()
  const { loading, student, schoolName, awardCategories, allCategoriesVoted, handleLogout } = useStudentBallot()

  useEffect(() => {
    if (!loading && !allCategoriesVoted) {
      navigate('/student', { replace: true })
    }
  }, [loading, allCategoriesVoted, navigate])

  if (loading || !allCategoriesVoted) {
    return (
      <div className="td-page">
        <div className="td-shell thank-you-shell" role="status" aria-label="Loading">
          <div className="skeleton sk-seal" />
          <div className="skeleton sk-title sk-title-short" />
        </div>
      </div>
    )
  }

  const total = awardCategories.length || 9

  return (
    <div className="td-page">
      <div className="td-shell thank-you-shell">
        <div className="seal" aria-hidden="true">
          <span className="seal-ring" />
          <span className="seal-core">
            <Check size={40} weight="bold" />
          </span>
        </div>

        <h1 className="thank-you-heading">Thank you for voting</h1>

        <p className="td-subtext thank-you-text">
          {student?.name}, your official ballot for {schoolName} is recorded. All {total} award
          categories are complete, which confirms your part in this year&rsquo;s Teachers&rsquo; Day election.
        </p>

        <dl className="thank-you-receipt">
          <div>
            <dt>School</dt>
            <dd>{schoolName}</dd>
          </div>
          <div>
            <dt>Categories</dt>
            <dd className="num">{total} / {total}</dd>
          </div>
        </dl>

        <div className="thank-you-actions">
          <Link to="/student" className="td-btn td-btn-ghost">Back to status</Link>
          <button type="button" className="td-btn-text" onClick={handleLogout}>
            <SignOut size={18} aria-hidden="true" />
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}

export default ThankYou
