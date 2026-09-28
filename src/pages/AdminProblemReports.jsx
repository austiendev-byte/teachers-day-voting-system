import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CheckCircle, X } from '@phosphor-icons/react'
import './AdminProblemReports.css'

const STATUS_META = {
  new: { label: 'New', className: 'admin-report-status-new' },
  in_review: { label: 'In review', className: 'admin-report-status-review' },
  resolved: { label: 'Resolved', className: 'admin-report-status-resolved' },
  closed: { label: 'Closed', className: 'admin-report-status-closed' }
}

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'in_review', label: 'In review' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' }
]

function AdminProblemReports() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedReport, setSelectedReport] = useState(null)
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [attachmentLoading, setAttachmentLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('new')
  const [adminResponse, setAdminResponse] = useState('')

  async function loadReports() {
    const { data, error: reportError } = await supabase.rpc('get_support_reports')

    if (reportError) {
      console.error('Admin reports loading error:', reportError)
      setError('We could not load problem reports right now.')
      setLoading(false)
      return
    }

    setReports(data || [])
    setError('')
    setLoading(false)
  }

  useEffect(() => {
    let active = true

    async function initialize() {
      const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin')

      if (!active) return

      if (adminError || !isAdmin) {
        setError('Administrator access is required to view problem reports.')
        setLoading(false)
        return
      }

      await loadReports()
    }

    initialize()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadReports()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    const channel = supabase
      .channel('admin-support-reports')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reports'
        },
        () => loadReports()
      )
      .subscribe()

    return () => {
      active = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      supabase.removeChannel(channel)
    }
  }, [])

  const filteredReports = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return reports.filter((report) => {
      const matchesStatus = filter === 'all' || report.status === filter

      if (!matchesStatus) return false
      if (!normalizedQuery) return true

      return [
        report.reference_number,
        report.student_name,
        report.student_number,
        report.category,
        report.subject,
        report.description
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery))
    })
  }, [reports, filter, query])

  const newCount = reports.filter((report) => report.status === 'new').length
  const reviewCount = reports.filter((report) => report.status === 'in_review').length

  async function openReport(report) {
    setSelectedReport(report)
    setStatus(report.status)
    setAdminResponse(report.admin_response || '')
    setAttachmentUrl('')

    if (!report.attachment_path) {
      return
    }

    setAttachmentLoading(true)

    const { data, error: signedUrlError } = await supabase.storage
      .from('report-attachments')
      .createSignedUrl(report.attachment_path, 300)

    if (signedUrlError) {
      console.error('Admin attachment URL error:', signedUrlError)
    } else {
      setAttachmentUrl(data?.signedUrl || '')
    }

    setAttachmentLoading(false)
  }

  function closeReport() {
    if (saving) return
    setSelectedReport(null)
    setAttachmentUrl('')
  }

  async function saveReport() {
    if (!selectedReport) return

    setSaving(true)

    const { error: updateError } = await supabase.rpc('update_support_report', {
      p_report_id: Number(selectedReport.id),
      p_status: status,
      p_admin_response: adminResponse
    })

    if (updateError) {
      console.error('Report update error:', updateError)
      setSaving(false)
      return
    }

    const updatedReport = {
      ...selectedReport,
      status,
      admin_response: adminResponse.trim() || null,
      updated_at: new Date().toISOString()
    }

    setSelectedReport(updatedReport)
    setReports((current) =>
      current.map((report) => (
        report.id === updatedReport.id ? updatedReport : report
      ))
    )
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="admin-reports-loading">
        <span className="spinner spinner-lg" aria-hidden="true" />
        <div>
          <strong>Loading problem reports</strong>
        </div>
      </div>
    )
  }

  if (error && reports.length === 0) {
    return (
      <div className="admin-reports-error" role="alert">
        {error}
      </div>
    )
  }

  return (
    <div className="admin-reports-module">
      <div className="admin-reports-overview">
        <div className="admin-reports-stat">
          <span>Total</span>
          <strong>{reports.length}</strong>
        </div>
        <div className="admin-reports-stat is-new">
          <span>New</span>
          <strong>{newCount}</strong>
        </div>
        <div className="admin-reports-stat is-review">
          <span>In review</span>
          <strong>{reviewCount}</strong>
        </div>
      </div>

      <div className="admin-reports-toolbar">
        <div className="admin-reports-search">
          <label htmlFor="admin-report-search">Search reports</label>
          <input
            id="admin-report-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Reference, student, subject…"
          />
        </div>

        <div className="admin-reports-filters" role="group" aria-label="Report filters">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={filter === item.value ? 'active' : ''}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="admin-reports-inline-error" role="alert">
          {error}
        </div>
      )}

      {filteredReports.length === 0 ? (
        <div className="admin-reports-empty">
          <div className="admin-reports-empty-mark" aria-hidden="true"><CheckCircle size={24} weight="duotone" /></div>
          <h3>No matching reports</h3>
          <p className="muted">
            There are no reports that match the current search or filter.
          </p>
        </div>
      ) : (
        <div className="admin-reports-table-wrap">
          <table className="admin-reports-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Student</th>
                <th>Category</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Submitted</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {filteredReports.map((report) => {
                const meta = STATUS_META[report.status] || STATUS_META.new

                return (
                  <tr key={report.id}>
                    <td>
                      <strong className="admin-report-reference num">{report.reference_number}</strong>
                    </td>
                    <td>
                      <div className="admin-report-student">
                        <strong>{report.student_name}</strong>
                        <span>{report.student_number}</span>
                      </div>
                    </td>
                    <td>{report.category}</td>
                    <td>
                      <span className="admin-report-subject">{report.subject}</span>
                    </td>
                    <td>
                      <span className={`admin-report-status ${meta.className}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td>{new Date(report.created_at).toLocaleString('en-PH')}</td>
                    <td>
                      <button
                        type="button"
                        className="admin-report-view-button"
                        onClick={() => openReport(report)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedReport && (
        <div className="admin-report-modal-overlay" role="presentation" onClick={closeReport}>
          <section
            className="admin-report-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-report-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-report-modal-head">
              <div>
                <p className="admin-reports-kicker num">{selectedReport.reference_number}</p>
                <h2 id="admin-report-title">{selectedReport.subject}</h2>
                <p className="muted">Submitted {new Date(selectedReport.created_at).toLocaleString('en-PH')}</p>
              </div>
              <button type="button" className="admin-report-close" onClick={closeReport} disabled={saving} aria-label="Close report">
                <X size={18} weight="bold" />
              </button>
            </div>

            <div className="admin-report-detail-top">
              <div>
                <span>Student</span>
                <strong>{selectedReport.student_name}</strong>
                <small>{selectedReport.student_number}</small>
              </div>
              <div>
                <span>Program</span>
                <strong>{selectedReport.program_name || '—'}</strong>
                <small>{selectedReport.program_code || ''}</small>
              </div>
              <div>
                <span>Category</span>
                <strong>{selectedReport.category}</strong>
              </div>
            </div>

            <div className="admin-report-detail-block">
              <h3>Student description</h3>
              <p>{selectedReport.description}</p>
            </div>

            {selectedReport.attachment_path && (
              <div className="admin-report-detail-block">
                <h3>Attachment</h3>
                {attachmentLoading ? (
                  <p className="muted">Preparing attachment…</p>
                ) : attachmentUrl ? (
                  <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="admin-report-attachment">
                    <img src={attachmentUrl} alt="Student report attachment" />
                    <span>Open attachment in a new tab</span>
                  </a>
                ) : (
                  <p className="muted">The attachment could not be opened right now.</p>
                )}
              </div>
            )}

            <div className="admin-report-form-grid">
              <div>
                <label htmlFor="admin-report-status">Status</label>
                <select
                  id="admin-report-status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  disabled={saving}
                >
                  <option value="new">New</option>
                  <option value="in_review">In review</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>

            <div className="admin-report-response-field">
              <label htmlFor="admin-report-response">Response to the student</label>
              <textarea
                id="admin-report-response"
                value={adminResponse}
                onChange={(event) => setAdminResponse(event.target.value)}
                placeholder="Write a short response or resolution note for the student."
                rows={6}
                maxLength={5000}
                disabled={saving}
              />
            </div>

            <div className="admin-report-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeReport} disabled={saving}>
                Close
              </button>
              <button type="button" className="btn btn-primary" onClick={saveReport} disabled={saving}>
                {saving && <span className="spinner" />}
                {saving ? 'Saving' : 'Save response'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default AdminProblemReports
