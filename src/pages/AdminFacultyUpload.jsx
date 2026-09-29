import * as XLSX from 'xlsx'
import { useMemo, useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

// One row per assignment. The same Faculty Code may appear on several
// rows to give a faculty member more programs, majors or schools.
const REQUIRED_COLUMNS = [
  'Faculty Code',
  'Name',
  'School Code',
  'Program Code'
]

function cell(row, column) {
  return String(row[column] ?? '').trim()
}

// Blank or "ALL" = every major of the program. Otherwise match the
// major code ("BSBA-FM"), its short form ("FM") or its name.
function findMajor(programMajors, programCode, value) {
  const wanted = value.toLowerCase()

  return programMajors.find((major) => {
    const code = major.major_code.toLowerCase()
    const shortCode = code.replace(`${programCode.toLowerCase()}-`, '')

    return (
      code === wanted ||
      shortCode === wanted ||
      major.major_name.toLowerCase() === wanted
    )
  })
}

function AdminFacultyUpload() {
  const toast = useToast()
  const confirm = useConfirm()

  const [assignments, setAssignments] = useState([])
  const [errors, setErrors] = useState([])
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')

  // Validated rows grouped per faculty member for the preview.
  const facultyGroups = useMemo(() => {
    const groups = new Map()

    for (const assignment of assignments) {
      if (!groups.has(assignment.facultyCode)) {
        groups.set(assignment.facultyCode, {
          facultyCode: assignment.facultyCode,
          name: assignment.name,
          existing: assignment.existing,
          rows: []
        })
      }

      groups.get(assignment.facultyCode).rows.push(assignment)
    }

    return [...groups.values()]
  }, [assignments])

  function handleFileUpload(event) {
    const file = event.target.files[0]

    if (!file) {
      return
    }

    setErrors([])
    setAssignments([])
    setImportMessage('')

    const reader = new FileReader()

    reader.onload = (event) => {
      const data = event.target.result

      const workbook = XLSX.read(data, {
        type: 'array'
      })

      const worksheet =
        workbook.Sheets[workbook.SheetNames[0]]

      const rawRows = XLSX.utils.sheet_to_json(
        worksheet,
        {
          defval: ''
        }
      )

      const rows = rawRows.filter((row) =>
        [...REQUIRED_COLUMNS, 'Major'].some(
          (column) => cell(row, column) !== ''
        )
      )

      validateFacultyData(rows)
    }

    reader.onerror = () => {
      setErrors([
        'Could not read the selected file. Please try again.'
      ])
    }

    reader.readAsArrayBuffer(file)
  }

  async function validateFacultyData(rows) {
    const validationErrors = []

    if (rows.length === 0) {
      setErrors([
        'The Excel file does not contain any faculty data.'
      ])
      return
    }

    // Check Excel columns
    const columns = Object.keys(rows[0])

    REQUIRED_COLUMNS.forEach((column) => {
      if (!columns.includes(column)) {
        validationErrors.push(
          `Missing column: ${column}`
        )
      }
    })

    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }

    setValidating(true)

    try {
      const [schoolResult, programResult, majorResult, facultyResult] =
        await Promise.all([
          supabase
            .from('schools')
            .select('id, school_code, school_name'),
          supabase
            .from('programs')
            .select('id, program_code, program_name, school_id'),
          supabase
            .from('majors')
            .select('id, major_code, major_name, program_id'),
          supabase
            .from('faculty')
            .select('faculty_code, name')
        ])

      const loadError =
        schoolResult.error ||
        programResult.error ||
        majorResult.error ||
        facultyResult.error

      if (loadError) {
        console.error('Error loading reference data:', loadError)

        setErrors([
          `Could not load schools, programs and majors from Supabase.\n\n${loadError.message}`
        ])

        return
      }

      const schools = schoolResult.data || []
      const programs = programResult.data || []
      const majors = majorResult.data || []

      const existingNames = new Map(
        (facultyResult.data || []).map((item) => [
          item.faculty_code,
          item.name
        ])
      )

      const namesInFile = new Map()
      const seenAssignments = new Set()
      const validated = []

      // Validate every Excel row
      rows.forEach((row, index) => {
        const rowNumber = index + 2

        const facultyCode = cell(row, 'Faculty Code')
        const name = cell(row, 'Name')
        const schoolCode = cell(row, 'School Code')
        const programCode = cell(row, 'Program Code')
        const major = cell(row, 'Major')

        const rowErrors = []

        // Required fields
        if (facultyCode === '') rowErrors.push('Faculty Code is missing.')
        if (name === '') rowErrors.push('Name is missing.')
        if (schoolCode === '') rowErrors.push('School Code is missing.')
        if (programCode === '') rowErrors.push('Program Code is missing.')

        // Same code must always carry the same name
        if (facultyCode && name) {
          const earlierName = namesInFile.get(facultyCode)

          if (earlierName && earlierName !== name) {
            rowErrors.push(
              `Faculty Code "${facultyCode}" is used for both "${earlierName}" and "${name}".`
            )
          } else {
            namesInFile.set(facultyCode, name)
          }

          const existingName = existingNames.get(facultyCode)

          if (existingName && existingName !== name) {
            rowErrors.push(
              `Faculty Code "${facultyCode}" already belongs to "${existingName}".`
            )
          }
        }

        // Find school
        const school = schools.find(
          (item) => item.school_code === schoolCode
        )

        if (schoolCode && !school) {
          rowErrors.push(`School Code "${schoolCode}" does not exist.`)
        }

        // Find program
        const program = programs.find(
          (item) => item.program_code === programCode
        )

        if (programCode && !program) {
          rowErrors.push(`Program Code "${programCode}" does not exist.`)
        }

        // Check program-school relationship
        if (school && program && program.school_id !== school.id) {
          rowErrors.push(
            `Program "${programCode}" does not belong to School "${schoolCode}".`
          )
        }

        // Major: blank or ALL = every major; otherwise it must be one
        // of this program's majors.
        let matchedMajor = null

        if (program && major !== '' && major.toUpperCase() !== 'ALL') {
          const programMajors = majors.filter(
            (item) => item.program_id === program.id
          )

          if (programMajors.length === 0) {
            rowErrors.push(
              `Program "${programCode}" has no majors. Leave Major blank.`
            )
          } else {
            matchedMajor = findMajor(programMajors, programCode, major)

            if (!matchedMajor) {
              rowErrors.push(
                `Major "${major}" does not exist for ${programCode}. Use one of: ${programMajors
                  .map((item) => item.major_code.replace(`${programCode}-`, ''))
                  .join(', ')}, or ALL.`
              )
            }
          }
        }

        // Duplicate rows in the same file
        const assignmentKey = [
          facultyCode,
          program?.id ?? programCode,
          matchedMajor?.id ?? 'all'
        ].join('|')

        if (rowErrors.length === 0 && seenAssignments.has(assignmentKey)) {
          rowErrors.push('This assignment is listed more than once.')
        }

        seenAssignments.add(assignmentKey)

        if (rowErrors.length > 0) {
          rowErrors.forEach((message) =>
            validationErrors.push(`Row ${rowNumber}: ${message}`)
          )
          return
        }

        validated.push({
          facultyCode,
          name,
          schoolCode,
          programCode,
          programId: program.id,
          majorId: matchedMajor?.id ?? null,
          majorLabel: matchedMajor
            ? matchedMajor.major_code.replace(`${programCode}-`, '')
            : majors.some((item) => item.program_id === program.id)
              ? 'All majors'
              : '',
          existing: existingNames.has(facultyCode)
        })
      })

      if (validationErrors.length > 0) {
        setErrors(validationErrors)
        setAssignments([])
        return
      }

      setAssignments(validated)
    } catch (error) {
      console.error(
        'Unexpected validation error:',
        error
      )

      setErrors([
        `An unexpected error occurred while validating the file.\n\n${error.message}`
      ])
    } finally {
      setValidating(false)
    }
  }

  async function handleImportFaculty() {
    if (assignments.length === 0) {
      return
    }

    const newCount = facultyGroups.filter((group) => !group.existing).length
    const existingCount = facultyGroups.length - newCount

    const confirmed = await confirm({
      title: 'Import faculty',
      message:
        `Import ${assignments.length} assignment(s) for ${facultyGroups.length} faculty member(s)?\n\n` +
        `${newCount} new faculty member(s)` +
        (existingCount > 0
          ? `, ${existingCount} existing faculty member(s) will get the new assignments added.`
          : '.'),
      confirmLabel: 'Import'
    })

    if (!confirmed) {
      return
    }

    setImporting(true)
    setImportMessage('')
    setErrors([])

    try {
      const { data, error } = await supabase.rpc('admin_import_faculty', {
        p_rows: assignments.map((assignment) => ({
          faculty_code: assignment.facultyCode,
          name: assignment.name,
          program_id: assignment.programId,
          major_id: assignment.majorId
        }))
      })

      if (error) {
        console.error('Faculty import error:', error)

        setErrors([
          `Faculty import failed: ${error.message}`
        ])

        return
      }

      const result = (Array.isArray(data) ? data[0] : data) || {}

      const message =
        `${result.new_faculty ?? 0} new faculty member(s) and ` +
        `${result.new_assignments ?? 0} new assignment(s) imported. ` +
        'Assignments that already existed were skipped.'

      setImportMessage(message)
      toast.success(message)
      setAssignments([])
    } catch (error) {
      console.error(
        'Unexpected import error:',
        error
      )

      setErrors([
        `An unexpected error occurred during import.\n\n${error.message}`
      ])
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <h3>Faculty Excel Upload</h3>

      <p className="help-text" style={{ marginBottom: 8 }}>
        Columns: Faculty Code, Name, School Code, Program Code, Major.
        Use one row per program or major a faculty member teaches, repeating
        the same Faculty Code and Name. They can be in different schools.
        Leave Major blank or write ALL for every major of the program.
        Re-uploading an existing Faculty Code adds its new rows.
      </p>

      <a
        className="btn btn-secondary btn-sm"
        href="/faculty-upload-sample.xlsx"
        download
        style={{ marginBottom: 12 }}
      >
        <DownloadSimple size={16} weight="bold" aria-hidden="true" />
        Download sample Excel file
      </a>

      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Faculty Code</th>
              <th>Name</th>
              <th>School Code</th>
              <th>Program Code</th>
              <th>Major</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>F001</td><td>Juan Dela Cruz</td><td>SBM</td><td>BSBA</td><td>FM</td></tr>
            <tr><td>F001</td><td>Juan Dela Cruz</td><td>SBM</td><td>BSBA</td><td>MM</td></tr>
            <tr><td>F001</td><td>Juan Dela Cruz</td><td>STCS</td><td>BSIT</td><td></td></tr>
            <tr><td>F002</td><td>Maria Santos</td><td>STED</td><td>BSED</td><td>ALL</td></tr>
          </tbody>
        </table>
      </div>

      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileUpload}
        disabled={validating || importing}
      />

      {validating && (
        <p className="muted row" style={{ marginTop: 12 }}>
          <span className="spinner" /> Checking Excel data against Supabase...
        </p>
      )}

      {errors.length > 0 && (
        <div className="alert alert-error" style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8 }}>Errors</h4>

          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {errors.map((error, index) => (
              <li key={index}>
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!validating &&
        errors.length === 0 &&
        facultyGroups.length > 0 && (
          <div className="card card-tight" style={{ marginTop: 16 }}>
            <h4>
              Validated Faculty ({facultyGroups.length}) &middot; {assignments.length} assignment(s)
            </h4>

            <p className="muted" style={{ marginBottom: 10 }}>
              All rows are valid and ready to import.
            </p>

            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Teaches</th>
                  </tr>
                </thead>
                <tbody>
                  {facultyGroups.map((group) => (
                    <tr key={group.facultyCode}>
                      <td>{group.facultyCode}</td>
                      <td>
                        {group.name}
                        {group.existing && (
                          <div className="muted" style={{ fontSize: '0.85em' }}>
                            Existing: adds assignments
                          </div>
                        )}
                      </td>
                      <td>
                        {group.rows.map((row) => (
                          <div key={`${row.programId}-${row.majorId ?? 'all'}`}>
                            {row.schoolCode} / {row.programCode}
                            {row.majorLabel ? ` / ${row.majorLabel}` : ''}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              className="btn btn-primary"
              onClick={handleImportFaculty}
              disabled={importing}
            >
              {importing && <span className="spinner" />}
              {importing
                ? 'Importing...'
                : 'Import Faculty'}
            </button>
          </div>
        )}

      {importMessage && (
        <div className="alert alert-success" style={{ marginTop: 16 }}>
          {importMessage}
        </div>
      )}
    </div>
  )
}

export default AdminFacultyUpload
