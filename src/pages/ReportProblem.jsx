import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { ArrowRight, CheckCircle, ImageSquare, UploadSimple, WarningCircle } from '@phosphor-icons/react'
import BackButton from '../components/BackButton'
import './ReportProblem.css'

const CATEGORIES = [
  'Login Problem',
  'Voting Problem',
  'Faculty Information',
  'Schedule Problem',
  'Account Problem',
  'Website Problem',
  'Other'
]

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024

function ReportProblem() {
  const toast = useToast()
  const fileInputRef = useRef(null)

  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [category, setCategory] = useState('Voting Problem')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [submittedReport, setSubmittedReport] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadUser() {
      const {
        data: { user: currentUser },
        error: userError
      } = await supabase.auth.getUser()

      if (cancelled) return

      if (userError || !currentUser) {
        setError('Your session could not be identified. Please log in again.')
      } else {
        setUser(currentUser)
      }

      setLoading(false)
    }

    loadUser()

    return () => {
      cancelled = true
    }
  }, [])

  function handleAttachmentChange(event) {
    const file = event.target.files?.[0] || null

    if (!file) {
      setAttachment(null)
      return
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file for the screenshot.')
      event.target.value = ''
      setAttachment(null)
      return
    }

    if (file.size > MAX_ATTACHMENT_SIZE) {
      toast.error('The screenshot must be 5 MB or smaller.')
      event.target.value = ''
      setAttachment(null)
      return
    }

    setAttachment(file)
  }

  function removeAttachment() {
    setAttachment(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function uploadAttachment() {
    if (!attachment || !user) return null

    const extension = attachment.name.split('.').pop()?.toLowerCase() || 'jpg'
    const baseName = attachment.name
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 70)

    const filePath = `reports/${user.id}/${Date.now()}-${baseName || 'screenshot'}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from('report-attachments')
      .upload(filePath, attachment, {
        cacheControl: '3600',
        upsert: false,
        contentType: attachment.type
      })

    if (uploadError) {
      throw new Error('We could not upload your screenshot. Please try again.')
    }

    return filePath
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    const trimmedSubject = subject.trim()
    const trimmedDescription = description.trim()

    if (trimmedSubject.length < 3) {
      toast.error('Please provide a short subject for your report.')
      return
    }

    if (trimmedDescription.length < 5) {
      toast.error('Please describe the problem briefly so the administrator can help you.')
      return
    }

    if (!user) {
      toast.error('Your session could not be identified. Please log in again.')
      return
    }

    setSubmitting(true)

    let attachmentPath = null

    try {
      attachmentPath = await uploadAttachment()

      const { data, error: reportError } = await supabase.rpc(
        'create_support_report',
        {
          p_category: category,
          p_subject: trimmedSubject,
          p_description: trimmedDescription,
          p_attachment_path: attachmentPath
        }
      )

      if (reportError) {
        if (attachmentPath) {
          await supabase.storage.from('report-attachments').remove([attachmentPath])
        }

        console.error('Report submission error:', reportError)
        toast.error('We could not submit your report. Please try again.')
        return
      }

      const report = Array.isArray(data) ? data[0] : data

      setSubmittedReport(report || null)
      setSubject('')
      setDescription('')
      setAttachment(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }

      toast.success('Your problem report has been submitted.')
    } catch (submitError) {
      if (attachmentPath) {
        await supabase.storage.from('report-attachments').remove([attachmentPath])
      }

      console.error('Unexpected report submission error:', submitError)
      setError('Something went wrong while submitting your report. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="report-page" role="status" aria-label="Checking your account">
        <div className="report-layout">
          <div className="skeleton report-skeleton-main" />
          <div className="skeleton report-skeleton-side" />
        </div>
      </div>
    )
  }

  if (error && !user) {
    return (
      <div className="report-page">
        <div className="report-message">
          <span className="report-message-icon is-danger" aria-hidden="true">
            <WarningCircle size={26} weight="duotone" />
          </span>
          <h1>We could not identify your account</h1>
          <p className="muted">{error}</p>
          <Link to="/login" className="btn btn-primary">
            Return to login
          </Link>
        </div>
      </div>
    )
  }

  if (submittedReport) {
    return (
      <div className="report-page">
        <div className="report-message">
          <BackButton fallback="/student" />

          <span className="report-message-icon is-success" aria-hidden="true">
            <CheckCircle size={28} weight="fill" />
          </span>
          <h1>Report submitted</h1>
          <p className="muted">
            The administrator can now review your concern. Keep this reference number to follow it up.
          </p>

          <div className="report-reference-box">
            <span>Reference number</span>
            <strong className="num">{submittedReport.reference_number}</strong>
          </div>

          <div className="report-success-actions">
            <Link to="/my-reports" className="btn btn-primary">
              View my reports
            </Link>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSubmittedReport(null)}
            >
              Submit another report
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="report-page">
      <BackButton fallback="/student" />

      <header className="report-head">
        <h1>Report a problem</h1>
        <p className="muted">
          Tell the administrator briefly what went wrong. Your report gets a reference number so you can track it later.
        </p>
      </header>

      <div className="report-layout">
        <section className="report-card" aria-label="Report form">
          <form onSubmit={handleSubmit} className="report-form">
            <fieldset className="report-field report-categories" disabled={submitting}>
              <legend>What is it about?</legend>
              <div className="report-chip-group">
                {CATEGORIES.map((item) => (
                  <label key={item} className={`report-chip${category === item ? ' is-active' : ''}`}>
                    <input
                      type="radio"
                      name="report-category"
                      value={item}
                      checked={category === item}
                      onChange={(event) => setCategory(event.target.value)}
                    />
                    {item}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="report-field">
              <div className="report-label-row">
                <label htmlFor="report-subject">Subject</label>
                <small className="num">{subject.length}/160</small>
              </div>
              <input
                id="report-subject"
                type="text"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Example: I cannot submit my vote"
                maxLength={160}
                disabled={submitting}
                required
              />
            </div>

            <div className="report-field">
              <div className="report-label-row">
                <label htmlFor="report-description">Describe the problem</label>
                <small className="num">{description.length}/5000</small>
              </div>
              <textarea
                id="report-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Briefly explain what happened and what you expected to happen."
                maxLength={5000}
                rows={6}
                disabled={submitting}
                required
              />
            </div>

            <div className="report-field">
              <span className="report-field-label">Screenshot <span className="muted">(optional)</span></span>

              {attachment ? (
                <div className="report-file-chip">
                  <ImageSquare size={20} weight="duotone" aria-hidden="true" />
                  <span>{attachment.name}</span>
                  <button
                    type="button"
                    className="report-remove-file"
                    onClick={removeAttachment}
                    disabled={submitting}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label htmlFor="report-attachment" className="report-dropzone">
                  <UploadSimple size={22} aria-hidden="true" />
                  <span>
                    <strong>Add a screenshot</strong>
                    <small>Image only, up to 5 MB</small>
                  </span>
                </label>
              )}

              <input
                ref={fileInputRef}
                id="report-attachment"
                className="sr-only"
                type="file"
                accept="image/*"
                onChange={handleAttachmentChange}
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="alert alert-error" role="alert">
                <WarningCircle size={18} weight="fill" aria-hidden="true" />
                {error}
              </div>
            )}

            <div className="report-submit-row">
              <p className="muted">
                Please leave out passwords and other sensitive information.
              </p>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting && <span className="spinner" aria-hidden="true" />}
                {submitting ? 'Submitting' : 'Submit report'}
              </button>
            </div>
          </form>
        </section>

        <aside className="report-help">
          <h2>What happens next</h2>

          <ol className="report-steps">
            <li>
              <strong>You submit</strong>
              <p className="muted">A short description of the problem, with a screenshot if it helps.</p>
            </li>
            <li>
              <strong>The administrator reviews it</strong>
              <p className="muted">They read the report and any screenshot you attached.</p>
            </li>
            <li>
              <strong>You get a response</strong>
              <p className="muted">The status and reply appear in My reports.</p>
            </li>
          </ol>

          <Link to="/my-reports" className="report-help-link">
            View my reports
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </div>
  )
}

export default ReportProblem
