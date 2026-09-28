import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CaretRight, Plus, Tray, WarningCircle, X } from '@phosphor-icons/react'
import './MyReports.css'

const dateFormatter = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

const STATUS_META = {
  new: { label: 'New', className: 'report-status-new' },
  in_review: { label: 'In Review', className: 'report-status-review' },
  resolved: { label: 'Resolved', className: 'report-status-resolved' },
  closed: { label: 'Closed', className: 'report-status-closed' }
}

function MyReports() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedReport, setSelectedReport] = useState(null)
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [attachmentLoading, setAttachmentLoading] = useState(false)

  async function loadReports() {
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setError('Your session could not be identified. Please log in again.')
      setLoading(false)
      return
    }

    const { data, error: reportsError } = await supabase
      .from('reports')
      .select(`
        id,
        reference_number,
        category,
        subject,
        description,
        attachment_path,
        status,
        admin_response,
        created_at,
        updated_at
      `)
      .order('created_at', { ascending: false })

    if (reportsError) {
      console.error('My reports loading error:', reportsError)
      setError('We could not load your reports right now. Please try again.')
      setLoading(false)
      return
    }

    setReports(data || [])
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      await Promise.resolve()
      if (!cancelled) {
        await loadReports()
      }
    }

    initialize()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadReports()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    // No Realtime subscription here by design: a student's own report list
    // does not need a live database connection. Loading once on mount and
    // refreshing when the tab regains focus keeps this page current without
    // holding a websocket open for the duration of the visit.

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  async function openReport(report) {
    setSelectedReport(report)
    setAttachmentUrl('')

    if (!report.attachment_path) {
      return
    }

    setAttachmentLoading(true)

    const { data, error: signedUrlError } = await supabase.storage
      .from('report-attachments')
      .createSignedUrl(report.attachment_path, 300)

    if (signedUrlError) {
      console.error('Attachment URL error:', signedUrlError)
    } else {
      setAttachmentUrl(data?.signedUrl || '')
    }

    setAttachmentLoading(false)
  }

  function closeReport() {
    setSelectedReport(null)
    setAttachmentUrl('')
  }

  if (loading) {
    return (
      <div className="my-reports-page" role="status" aria-label="Loading your reports">
        <div className="skeleton sk-reports-head" />
        {[0, 1, 2].map((key) => (
          <div key={key} className="skeleton sk-report-row" />
        ))}
      </div>
    )
  }

  return (
    <div className="my-reports-page">
      <header className="my-reports-head">
        <div>
          <h1>My reports</h1>
          <p className="muted">
            Track the problems you submitted and read the administrator&rsquo;s responses.
          </p>
        </div>

        <Link to="/report-problem" className="btn btn-primary">
          <Plus size={16} weight="bold" aria-hidden="true" />
          New report
        </Link>
      </header>

      {error && (
        <div className="alert alert-error my-reports-error" role="alert">
          <WarningCircle size={18} weight="fill" aria-hidden="true" />
          {error}
        </div>
      )}

      {reports.length === 0 ? (
        <section className="empty-state my-reports-empty">
          <span className="empty-state-icon" aria-hidden="true">
            <Tray size={22} weight="duotone" />
          </span>
          <strong>No reports yet</strong>
          <span>When you report a problem, it appears here with its reference number and status.</span>
          <Link to="/report-problem" className="btn btn-secondary my-reports-empty-action">
            Report a problem
          </Link>
        </section>
      ) : (
        <section aria-label="Your reports">
          <p className="my-reports-summary">
            {reports.length} {reports.length === 1 ? 'report' : 'reports'}
          </p>

          <ul className="my-reports-list">
            {reports.map((report) => {
              const status = STATUS_META[report.status] || STATUS_META.new

              return (
                <li key={report.id}>
                  <button
                    type="button"
                    className="my-report-row"
                    onClick={() => openReport(report)}
                  >
                    <span className="my-report-main">
                      <span className="my-report-reference num">{report.reference_number}</span>
                      <strong>{report.subject}</strong>
                      <span className="my-report-category">{report.category}</span>
                    </span>

                    <span className="my-report-meta">
                      <span className={`report-status ${status.className}`}>
                        {status.label}
                      </span>
                      <small>{dateFormatter.format(new Date(report.created_at))}</small>
                    </span>

                    <CaretRight className="my-report-caret" size={18} aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {selectedReport && (
        <div className="my-report-modal-overlay" role="presentation" onClick={closeReport}>
          <section
            className="my-report-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="my-report-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="my-report-modal-head">
              <div>
                <p className="my-report-reference num">{selectedReport.reference_number}</p>
                <h2 id="my-report-modal-title">{selectedReport.subject}</h2>
              </div>
              <button type="button" className="my-report-close" onClick={closeReport} aria-label="Close report">
                <X size={18} weight="bold" />
              </button>
            </div>

            <dl className="my-report-detail-grid">
              <div>
                <dt>Category</dt>
                <dd>{selectedReport.category}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`report-status ${(STATUS_META[selectedReport.status] || STATUS_META.new).className}`}>
                    {STATUS_META[selectedReport.status]?.label || selectedReport.status}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{new Date(selectedReport.created_at).toLocaleString('en-PH')}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{new Date(selectedReport.updated_at).toLocaleString('en-PH')}</dd>
              </div>
            </dl>

            <div className="my-report-detail-block">
              <h3>Your description</h3>
              <p>{selectedReport.description}</p>
            </div>

            {selectedReport.attachment_path && (
              <div className="my-report-detail-block">
                <h3>Attachment</h3>
                {attachmentLoading ? (
                  <div className="skeleton sk-attachment" />
                ) : attachmentUrl ? (
                  <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="my-report-attachment-link">
                    <img src={attachmentUrl} alt="Reported issue screenshot" />
                    <span>Open attachment in a new tab</span>
                  </a>
                ) : (
                  <p className="muted">The attachment could not be opened right now.</p>
                )}
              </div>
            )}

            <div className="my-report-response-block">
              <h3>Administrator response</h3>
              {selectedReport.admin_response ? (
                <p>{selectedReport.admin_response}</p>
              ) : (
                <p className="muted">No response yet. You will see it here once the administrator replies.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default MyReports
