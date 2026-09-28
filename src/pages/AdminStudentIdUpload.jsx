import * as XLSX from 'xlsx'
import { downloadEligibleIdTemplate, parseEligibleIds } from '../lib/eligibleIds'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DownloadSimple, FileXls, IdentificationCard, WarningCircle, X } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import './AdminStudentIdUpload.css'

// IDs are sent to the database in chunks; the import function accepts
// at most 5000 per call.
const CHUNK_SIZE = 1000
const PREVIEW_LIMIT = 12
const numberFormatter = new Intl.NumberFormat('en-US')

function AdminStudentIdUpload() {
  const toast = useToast()
  const confirm = useConfirm()
  const fileInputRef = useRef(null)

  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState('')
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)

  const loadSummary = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_eligible_student_ids_summary')

    if (error) {
      console.error('Eligible ID summary error:', error)
      setSummaryError('Could not load the eligible ID list. The database update for this feature may not be applied yet.')
      return
    }

    setSummaryError('')
    setSummary(Array.isArray(data) ? data[0] : data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSummary()
  }, [loadSummary])

  function resetFile() {
    setFileName('')
    setParsed(null)
    setParseError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleFile(event) {
    const file = event.target.files?.[0]
    if (!file) return

    setResult(null)
    setParsed(null)
    setParseError('')
    setFileName(file.name)

    const reader = new FileReader()

    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target.result, { type: 'array' })
        const outcome = parseEligibleIds(workbook)

        if (outcome.error) {
          setParseError(outcome.error)
          return
        }

        setParsed(outcome)
      } catch (error) {
        console.error('Eligible ID file parse error:', error)
        setParseError('Could not read this file. Save it as .xlsx or .csv and try again.')
      }
    }

    reader.onerror = () => setParseError('Could not read the selected file. Please try again.')
    reader.readAsArrayBuffer(file)
  }

  async function handleImport() {
    if (!parsed?.ids.length) return

    const confirmed = await confirm({
      title: `Import ${numberFormatter.format(parsed.ids.length)} Student IDs?`,
      message:
        'Students with these IDs will be able to register. IDs already on the list are left as they are, and nothing is deleted.',
      confirmLabel: 'Import IDs'
    })

    if (!confirmed) return

    setImporting(true)
    setProgress(0)

    const totals = { inserted: 0, reactivated: 0, already_active: 0 }

    try {
      for (let start = 0; start < parsed.ids.length; start += CHUNK_SIZE) {
        const chunk = parsed.ids.slice(start, start + CHUNK_SIZE)
        const { data, error } = await supabase.rpc('admin_import_eligible_student_ids', {
          p_student_ids: chunk
        })

        if (error) {
          throw new Error(
            `${error.message}${start > 0 ? `\n\n${numberFormatter.format(start)} IDs were imported before this error.` : ''}`
          )
        }

        const row = Array.isArray(data) ? data[0] : data
        totals.inserted += row?.inserted || 0
        totals.reactivated += row?.reactivated || 0
        totals.already_active += row?.already_active || 0
        setProgress(Math.min(parsed.ids.length, start + chunk.length))
      }

      setResult(totals)
      toast.success(`Imported ${numberFormatter.format(totals.inserted + totals.reactivated)} new eligible Student IDs.`)
      resetFile()
      await loadSummary()
    } catch (error) {
      console.error('Eligible ID import error:', error)
      toast.error(`The import stopped.\n\n${error.message}`)
      await loadSummary()
    } finally {
      setImporting(false)
    }
  }

  const notRegistered = summary ? Math.max(0, summary.active - summary.registered) : 0

  return (
    <section className="id-import" aria-labelledby="id-import-title">
      <header className="id-import-head">
        <span className="id-import-icon" aria-hidden="true">
          <IdentificationCard size={22} weight="duotone" />
        </span>
        <div>
          <h2 id="id-import-title">Eligible student IDs</h2>
          <p>Only students whose ID is on this list can create an account.</p>
        </div>
        <button type="button" className="admin-button secondary" onClick={downloadEligibleIdTemplate}>
          <DownloadSimple size={15} aria-hidden="true" />
          Template
        </button>
      </header>

      {summaryError ? (
        <div className="alert alert-error">
          <WarningCircle size={18} weight="fill" aria-hidden="true" />
          {summaryError}
        </div>
      ) : (
        <dl className="id-import-stats">
          <div>
            <dt>On the list</dt>
            <dd className="num">{summary ? numberFormatter.format(summary.active) : '-'}</dd>
          </div>
          <div>
            <dt>Registered</dt>
            <dd className="num">{summary ? numberFormatter.format(summary.registered) : '-'}</dd>
          </div>
          <div>
            <dt>Not yet registered</dt>
            <dd className="num">{summary ? numberFormatter.format(notRegistered) : '-'}</dd>
          </div>
        </dl>
      )}

      {summary && summary.active === 0 && !parsed && (
        <div className="alert alert-warning">
          <WarningCircle size={18} weight="fill" aria-hidden="true" />
          The list is empty, so no student can register yet. Import the official ID list to open registration.
        </div>
      )}

      {!parsed && (
        <label className={`id-import-drop${importing ? ' is-disabled' : ''}`}>
          <FileXls size={26} weight="duotone" aria-hidden="true" />
          <span>
            <strong>Choose an Excel or CSV file</strong>
            <small>One column with the header <b>Student ID</b>. IDs are imported exactly as written.</small>
          </span>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFile}
            disabled={importing}
          />
        </label>
      )}

      {parseError && (
        <div className="alert alert-error" role="alert">
          <WarningCircle size={18} weight="fill" aria-hidden="true" />
          <span>
            <strong>{fileName}</strong>: {parseError}
          </span>
        </div>
      )}

      {parsed && (
        <div className="id-import-preview">
          <div className="id-import-preview-head">
            <div>
              <strong>{fileName}</strong>
              <span>
                <span className="num">{numberFormatter.format(parsed.ids.length)}</span> unique IDs ready
                {parsed.duplicates > 0 && <>, {numberFormatter.format(parsed.duplicates)} duplicates merged</>}
                {parsed.issues.length > 0 && <>, {numberFormatter.format(parsed.issues.length)} rows skipped</>}
              </span>
            </div>
            <button type="button" className="icon-button" onClick={resetFile} disabled={importing} aria-label="Choose a different file">
              <X size={16} />
            </button>
          </div>

          {parsed.issues.length > 0 && (
            <details className="id-import-issues">
              <summary>
                <WarningCircle size={16} weight="fill" aria-hidden="true" />
                {numberFormatter.format(parsed.issues.length)} rows will be skipped
              </summary>
              <ul>
                {parsed.issues.slice(0, 50).map((issue) => <li key={issue}>{issue}</li>)}
                {parsed.issues.length > 50 && <li>…and {parsed.issues.length - 50} more</li>}
              </ul>
            </details>
          )}

          {parsed.ids.length > 0 && (
            <ul className="id-import-sample" aria-label="First IDs in the file">
              {parsed.ids.slice(0, PREVIEW_LIMIT).map((id) => <li key={id} className="num">{id}</li>)}
              {parsed.ids.length > PREVIEW_LIMIT && (
                <li className="id-import-more">+{numberFormatter.format(parsed.ids.length - PREVIEW_LIMIT)} more</li>
              )}
            </ul>
          )}

          <div className="id-import-actions">
            {importing && (
              <div className="id-import-progress" role="status">
                <div className="meter-track" aria-hidden="true">
                  <div className="meter-fill" style={{ transform: `scaleX(${progress / parsed.ids.length})` }} />
                </div>
                <span className="num">{numberFormatter.format(progress)} / {numberFormatter.format(parsed.ids.length)}</span>
              </div>
            )}
            <button
              type="button"
              className="admin-button primary"
              onClick={handleImport}
              disabled={importing || parsed.ids.length === 0}
            >
              {importing && <span className="spinner" aria-hidden="true" />}
              {importing ? 'Importing' : `Import ${numberFormatter.format(parsed.ids.length)} IDs`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="alert alert-success" role="status">
          <span>
            Import complete: <strong className="num">{numberFormatter.format(result.inserted)}</strong> added
            {result.reactivated > 0 && <>, <strong className="num">{numberFormatter.format(result.reactivated)}</strong> re-activated</>}
            , <strong className="num">{numberFormatter.format(result.already_active)}</strong> were already on the list.
          </span>
        </div>
      )}
    </section>
  )
}

export default AdminStudentIdUpload
