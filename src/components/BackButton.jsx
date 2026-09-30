import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'

// Returns to the previous in-app screen. When the page was opened
// directly (new tab, refresh, bookmark) there is no in-app history, so
// it goes to `fallback` instead of leaving the site.
function BackButton({ fallback = '/', label = 'Back', className = '' }) {
  const navigate = useNavigate()

  function goBack() {
    // React Router keeps an index of in-app entries in history.state.
    const index = window.history.state?.idx ?? 0

    if (index > 0) {
      navigate(-1)
    } else {
      navigate(fallback, { replace: true })
    }
  }

  return (
    <button type="button" className={`td-btn-text back-button ${className}`.trim()} onClick={goBack}>
      <ArrowLeft size={18} aria-hidden="true" />
      {label}
    </button>
  )
}

export default BackButton
