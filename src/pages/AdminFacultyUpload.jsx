import * as XLSX from 'xlsx'
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

function AdminFacultyUpload() {
  const toast = useToast()
  const confirm = useConfirm()

  const [facultyData, setFacultyData] = useState([])
  const [errors, setErrors] = useState([])
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')

  function handleFileUpload(event) {
    const file = event.target.files[0]

    if (!file) {
      return
    }

    setErrors([])
    setFacultyData([])
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

      const rows = rawRows.filter((row) => {
        const facultyCode = String(
          row['Faculty Code'] || ''
        ).trim()

        const name = String(
          row['Name'] || ''
        ).trim()

        const programCode = String(
          row['Program Code'] || ''
        ).trim()

        const major = String(
          row['Major'] || ''
        ).trim()

        const schoolCode = String(
          row['School Code'] || ''
        ).trim()

        return (
          facultyCode !== '' ||
          name !== '' ||
          programCode !== '' ||
          major !== '' ||
          schoolCode !== ''
        )
      })

      console.log('Excel data:', rows)

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

    const requiredColumns = [
      'Faculty Code',
      'Name',
      'Program Code',
      'Major',
      'School Code'
    ]

    if (rows.length === 0) {
      setErrors([
        'The Excel file does not contain any faculty data.'
      ])
      return
    }

    // Check Excel columns
    const columns = Object.keys(rows[0])

    requiredColumns.forEach((column) => {
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
      // Get schools
      const { data: schools, error: schoolError } =
        await supabase
          .from('schools')
          .select('id, school_code, school_name')

      if (schoolError) {
        console.error(
          'Error loading schools:',
          schoolError
        )

        setErrors([
          `Could not load schools from Supabase.\n\n${schoolError.message}`
        ])

        return
      }

      // Get programs
      const { data: programs, error: programError } =
        await supabase
          .from('programs')
          .select(
            'id, program_code, program_name, school_id'
          )

      if (programError) {
        console.error(
          'Error loading programs:',
          programError
        )

        setErrors([
          `Could not load programs from Supabase.\n\n${programError.message}`
        ])

        return
      }

      // Get majors
      const { data: majors, error: majorError } =
        await supabase
          .from('majors')
          .select(
            'id, major_code, major_name, program_id'
          )

      if (majorError) {
        console.error(
          'Error loading majors:',
          majorError
        )

        setErrors([
          `Could not load majors from Supabase.\n\n${majorError.message}`
        ])

        return
      }

      // Get existing faculty codes
      const { data: existingFaculty, error: facultyError } =
        await supabase
          .from('faculty')
          .select('faculty_code')

      if (facultyError) {
        console.error(
          'Error loading existing faculty:',
          facultyError
        )

        setErrors([
          `Could not check existing faculty records.\n\n${facultyError.message}`
        ])

        return
      }

      // Validate every Excel row
      rows.forEach((faculty, index) => {
        const rowNumber = index + 2

        const facultyCode = String(
          faculty['Faculty Code'] || ''
        ).trim()

        const name = String(
          faculty['Name'] || ''
        ).trim()

        const programCode = String(
          faculty['Program Code'] || ''
        ).trim()

        const major = String(
          faculty['Major'] || ''
        ).trim()

        const schoolCode = String(
          faculty['School Code'] || ''
        ).trim()

        // Required fields
        if (facultyCode === '') {
          validationErrors.push(
            `Row ${rowNumber}: Faculty Code is missing.`
          )
        }

        if (name === '') {
          validationErrors.push(
            `Row ${rowNumber}: Name is missing.`
          )
        }

        if (programCode === '') {
          validationErrors.push(
            `Row ${rowNumber}: Program Code is missing.`
          )
        }

        if (schoolCode === '') {
          validationErrors.push(
            `Row ${rowNumber}: School Code is missing.`
          )
        }

        // Check duplicate faculty code in database
        const alreadyExists = existingFaculty.some(
          (item) =>
            item.faculty_code === facultyCode
        )

        if (alreadyExists) {
          validationErrors.push(
            `Row ${rowNumber}: Faculty Code "${facultyCode}" already exists.`
          )
        }

        // Find school
        const school = schools.find(
          (item) =>
            item.school_code === schoolCode
        )

        if (!school) {
          validationErrors.push(
            `Row ${rowNumber}: School Code "${schoolCode}" does not exist.`
          )
        }

        // Find program
        const program = programs.find(
          (item) =>
            item.program_code === programCode
        )

        if (!program) {
          validationErrors.push(
            `Row ${rowNumber}: Program Code "${programCode}" does not exist.`
          )
        }

        // Check program-school relationship
        if (
          school &&
          program &&
          program.school_id !== school.id
        ) {
          validationErrors.push(
            `Row ${rowNumber}: Program "${programCode}" does not belong to School "${schoolCode}".`
          )
        }

        // BSED validation
        if (programCode === 'BSED') {
          if (major === '') {
            validationErrors.push(
              `Row ${rowNumber}: BSED faculty must have a Major.`
            )
          } else if (program) {
            const matchingMajor = majors.find(
              (item) =>
                item.major_name === major &&
                item.program_id === program.id
            )

            if (!matchingMajor) {
              validationErrors.push(
                `Row ${rowNumber}: Major "${major}" does not exist for BSED.`
              )
            }
          }
        }

        // Non-BSED should not have a major
        if (
          programCode !== 'BSED' &&
          major !== ''
        ) {
          validationErrors.push(
            `Row ${rowNumber}: Major should be blank for non-BSED programs.`
          )
        }
      })

      if (validationErrors.length > 0) {
        setErrors(validationErrors)
        setFacultyData([])
        return
      }

      setFacultyData(rows)

      console.log(
        'Excel and Supabase validation successful!'
      )
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
    if (facultyData.length === 0) {
      return
    }

    const confirmed = await confirm({
      title: 'Import faculty',
      message: `Import ${facultyData.length} faculty record(s) into the database?`,
      confirmLabel: 'Import'
    })

    if (!confirmed) {
      return
    }

    setImporting(true)
    setImportMessage('')
    setErrors([])

    try {
      // Get schools
      const { data: schools, error: schoolError } =
        await supabase
          .from('schools')
          .select('id, school_code')

      if (schoolError) {
        console.error(
          'Error loading schools:',
          schoolError
        )

        setErrors([
          `Could not load schools.\n\n${schoolError.message}`
        ])

        return
      }

      // Get programs
      const { data: programs, error: programError } =
        await supabase
          .from('programs')
          .select(
            'id, program_code, school_id'
          )

      if (programError) {
        console.error(
          'Error loading programs:',
          programError
        )

        setErrors([
          `Could not load programs.\n\n${programError.message}`
        ])

        return
      }

      // Convert Excel data into faculty table format
      const facultyToInsert = []

      for (const faculty of facultyData) {
        const facultyCode = String(
          faculty['Faculty Code']
        ).trim()

        const name = String(
          faculty['Name']
        ).trim()

        const programCode = String(
          faculty['Program Code']
        ).trim()

        const schoolCode = String(
          faculty['School Code']
        ).trim()

        const school = schools.find(
          (item) =>
            item.school_code === schoolCode
        )

        const program = programs.find(
          (item) =>
            item.program_code === programCode
        )

        if (!school || !program) {
          setErrors([
            `Row for Faculty Code "${facultyCode}" refers to a school or program that no longer exists. Please re-validate the file.`
          ])

          return
        }

        facultyToInsert.push({
          faculty_code: facultyCode,
          name: name,
          program_id: program.id,
          school_id: school.id
        })
      }

      console.log(
        'Data ready for Supabase:',
        facultyToInsert
      )

      // Insert faculty
      const { error: insertError } =
        await supabase
          .from('faculty')
          .insert(facultyToInsert)

      if (insertError) {
        console.error(
          'Faculty import error:',
          insertError
        )

        setErrors([
          `Faculty import failed: ${insertError.message}`
        ])

        return
      }

      setImportMessage(
        `${facultyToInsert.length} faculty records imported successfully!`
      )

      toast.success(
        `${facultyToInsert.length} faculty records imported successfully!`
      )

      setFacultyData([])
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

      <p className="help-text" style={{ marginBottom: 12 }}>
        Required columns: Faculty Code, Name, Program Code, Major (BSED only), School Code.
      </p>

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
        facultyData.length > 0 && (
          <div className="card card-tight" style={{ marginTop: 16 }}>
            <h4>Validated Faculty ({facultyData.length})</h4>

            <p className="muted" style={{ marginBottom: 10 }}>
              All faculty records are valid and ready to import.
            </p>

            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Program</th>
                    <th>School</th>
                  </tr>
                </thead>
                <tbody>
                  {facultyData.map((faculty, index) => (
                    <tr key={index}>
                      <td>{faculty['Faculty Code']}</td>
                      <td>
                        {faculty['Name']}
                        {faculty['Major'] ? ` (${faculty['Major']})` : ''}
                      </td>
                      <td>{faculty['Program Code']}</td>
                      <td>{faculty['School Code']}</td>
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
