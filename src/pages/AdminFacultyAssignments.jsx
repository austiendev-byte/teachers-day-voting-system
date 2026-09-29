import { useCallback, useEffect, useMemo, useState } from 'react'
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { formatTeaches } from '../lib/facultyLabels'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

const LIST_LIMIT = 30

function shortMajor(major, programCode) {
  return major.major_code.replace(`${programCode}-`, '')
}

async function fetchAssignmentData() {
  const [schoolResult, programResult, facultyResult] = await Promise.all([
    supabase
      .from('schools')
      .select('id, school_code, school_name')
      .order('school_code', { ascending: true }),
    supabase
      .from('programs')
      .select('id, program_code, program_name, school_id, majors ( id, major_code, major_name )')
      .order('program_code', { ascending: true }),
    supabase
      .from('faculty')
      .select(`
        id,
        faculty_code,
        name,
        faculty_assignments (
          id,
          program_id,
          major_id,
          majors ( major_code ),
          programs ( program_code, school_id )
        )
      `)
      .order('name', { ascending: true })
  ])

  return {
    error: schoolResult.error || programResult.error || facultyResult.error,
    schools: schoolResult.data || [],
    programs: programResult.data || [],
    faculty: facultyResult.data || []
  }
}

function AdminFacultyAssignments({ onChanged }) {
  const toast = useToast()
  const confirm = useConfirm()

  const [schools, setSchools] = useState([])
  const [programs, setPrograms] = useState([])
  const [faculty, setFaculty] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const [schoolId, setSchoolId] = useState('')
  const [programId, setProgramId] = useState('')
  const [majorId, setMajorId] = useState('')

  // Applies a fetchAssignmentData() result. Kept apart from the fetch so
  // the mount effect only sets state inside the promise callback.
  const applyData = useCallback((result) => {
    if (result.error) {
      console.error('Error loading faculty assignments:', result.error)
      setLoadError(`Could not load faculty assignments.\n\n${result.error.message}`)
      return
    }

    setLoadError('')
    setSchools(result.schools)
    setPrograms(result.programs)
    setFaculty(result.faculty)
  }, [])

  const loadData = useCallback(async () => {
    applyData(await fetchAssignmentData())
  }, [applyData])

  useEffect(() => {
    let cancelled = false

    fetchAssignmentData().then((result) => {
      if (cancelled) return
      applyData(result)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [applyData])

  const schoolById = useMemo(
    () => new Map(schools.map((school) => [school.id, school])),
    [schools]
  )

  const programById = useMemo(
    () => new Map(programs.map((program) => [program.id, program])),
    [programs]
  )

  const filteredFaculty = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) return faculty

    return faculty.filter(
      (member) =>
        member.name.toLowerCase().includes(query) ||
        member.faculty_code.toLowerCase().includes(query)
    )
  }, [faculty, search])

  const selected = faculty.find((member) => member.id === selectedId) || null

  // The selected faculty member's assignments, sorted school → program → major.
  const selectedRows = useMemo(() => {
    if (!selected) return []

    return (selected.faculty_assignments || [])
      .map((assignment) => {
        const program = programById.get(assignment.program_id)
        const school = program ? schoolById.get(program.school_id) : null
        const major = program?.majors?.find((item) => item.id === assignment.major_id)

        return {
          id: assignment.id,
          programId: assignment.program_id,
          majorId: assignment.major_id,
          schoolCode: school?.school_code || '?',
          programCode: program?.program_code || '?',
          programName: program?.program_name || '',
          majorLabel: major
            ? `${shortMajor(major, program.program_code)} · ${major.major_name}`
            : program?.majors?.length
              ? 'All majors'
              : ''
        }
      })
      .sort((a, b) =>
        a.schoolCode.localeCompare(b.schoolCode) ||
        a.programCode.localeCompare(b.programCode) ||
        a.majorLabel.localeCompare(b.majorLabel)
      )
  }, [selected, programById, schoolById])

  const programsForSchool = programs.filter(
    (program) => String(program.school_id) === String(schoolId)
  )
  const selectedProgram = programById.get(Number(programId))
  const programMajors = selectedProgram?.majors || []

  function teachesSummary(member) {
    const bySchool = new Map()

    for (const assignment of member.faculty_assignments || []) {
      const code = schoolById.get(assignment.programs?.school_id)?.school_code || '?'
      if (!bySchool.has(code)) bySchool.set(code, [])
      bySchool.get(code).push(assignment)
    }

    return [...bySchool.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, rows]) => `${code}: ${formatTeaches(rows)}`)
      .join(' | ')
  }

  function selectFaculty(id) {
    setSelectedId(id)
    setSchoolId('')
    setProgramId('')
    setMajorId('')
  }

  async function refresh() {
    await loadData()
    onChanged?.()
  }

  async function handleRemove(row) {
    const confirmed = await confirm({
      title: 'Remove assignment',
      message:
        `Remove ${row.schoolCode} / ${row.programCode}` +
        `${row.majorLabel ? ` / ${row.majorLabel}` : ''} from ${selected.name}?\n\n` +
        'If this is their only assignment in that school, they will no longer appear on that school’s ballot.',
      confirmLabel: 'Remove'
    })

    if (!confirmed) return

    setSaving(true)

    try {
      const { error } = await supabase
        .from('faculty_assignments')
        .delete()
        .eq('id', row.id)

      if (error) {
        console.error('Error removing assignment:', error)
        toast.error(error.message)
        return
      }

      toast.success('Assignment removed.')
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleAdd(event) {
    event.preventDefault()

    if (!selected || !selectedProgram) {
      toast.error('Choose a school and a program first.')
      return
    }

    const newMajorId = majorId ? Number(majorId) : null
    const sameProgram = selectedRows.filter((row) => row.programId === selectedProgram.id)

    if (sameProgram.some((row) => row.majorId === newMajorId)) {
      toast.error('This faculty member already has that assignment.')
      return
    }

    if (newMajorId && sameProgram.some((row) => row.majorId === null)) {
      toast.error(`${selected.name} already teaches all majors of ${selectedProgram.program_code}.`)
      return
    }

    setSaving(true)

    try {
      const { error } = await supabase
        .from('faculty_assignments')
        .insert({
          faculty_id: selected.id,
          program_id: selectedProgram.id,
          major_id: newMajorId
        })

      if (error) {
        console.error('Error adding assignment:', error)
        toast.error(error.message)
        return
      }

      // "All majors" replaces the program's single-major rows.
      if (newMajorId === null && sameProgram.length > 0) {
        const { error: cleanupError } = await supabase
          .from('faculty_assignments')
          .delete()
          .in('id', sameProgram.map((row) => row.id))

        if (cleanupError) {
          console.error('Error tidying single-major rows:', cleanupError)
        }
      }

      toast.success('Assignment added.')
      setProgramId('')
      setMajorId('')
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <p className="muted row">
        <span className="spinner" /> Loading faculty assignments...
      </p>
    )
  }

  return (
    <div className="stack">
      <div>
        <h3>Faculty assignments</h3>
        <p className="help-text">
          A faculty member appears on the ballot of every school they have an
          assignment in. Pick a faculty member to add or remove schools,
          programs and majors.
        </p>
      </div>

      {loadError && <div className="alert alert-error">{loadError}</div>}

      <div className="field">
        <label className="label" htmlFor="assignment-search">
          Find faculty
        </label>
        <input
          className="input"
          id="assignment-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or faculty code"
        />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Teaches</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {filteredFaculty.slice(0, LIST_LIMIT).map((member) => (
              <tr key={member.id}>
                <td className="num">{member.faculty_code}</td>
                <td>{member.name}</td>
                <td>{teachesSummary(member) || <span className="muted">No assignments</span>}</td>
                <td>
                  <button
                    type="button"
                    className={`btn btn-sm ${member.id === selectedId ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => selectFaculty(member.id)}
                    aria-pressed={member.id === selectedId}
                  >
                    <PencilSimple size={14} weight="bold" aria-hidden="true" />
                    Edit
                  </button>
                </td>
              </tr>
            ))}

            {filteredFaculty.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  {faculty.length === 0 ? 'No faculty imported yet.' : 'No faculty match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filteredFaculty.length > LIST_LIMIT && (
        <p className="muted">
          Showing {LIST_LIMIT} of {filteredFaculty.length}. Search to narrow the list.
        </p>
      )}

      {selected && (
        <div className="card card-tight stack">
          <div>
            <h4>{selected.name}</h4>
            <p className="muted num">{selected.faculty_code}</p>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>School</th>
                  <th>Program</th>
                  <th>Major</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.schoolCode}</td>
                    <td>
                      <strong>{row.programCode}</strong>
                      <div className="muted">{row.programName}</div>
                    </td>
                    <td>{row.majorLabel || <span className="muted">&mdash;</span>}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleRemove(row)}
                        disabled={saving}
                        aria-label={`Remove ${row.schoolCode} ${row.programCode} ${row.majorLabel}`}
                      >
                        <Trash size={14} weight="bold" aria-hidden="true" />
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}

                {selectedRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No assignments. This faculty member is not on any ballot.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <form className="row" onSubmit={handleAdd} style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ minWidth: 150 }}>
              <label className="label" htmlFor="assignment-school">School</label>
              <select
                className="input"
                id="assignment-school"
                value={schoolId}
                onChange={(event) => {
                  setSchoolId(event.target.value)
                  setProgramId('')
                  setMajorId('')
                }}
                disabled={saving}
              >
                <option value="">Select school</option>
                {schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.school_code} · {school.school_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ minWidth: 150 }}>
              <label className="label" htmlFor="assignment-program">Program</label>
              <select
                className="input"
                id="assignment-program"
                value={programId}
                onChange={(event) => {
                  setProgramId(event.target.value)
                  setMajorId('')
                }}
                disabled={saving || !schoolId}
              >
                <option value="">Select program</option>
                {programsForSchool.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.program_code} · {program.program_name}
                  </option>
                ))}
              </select>
            </div>

            {programMajors.length > 0 && (
              <div className="field" style={{ minWidth: 150 }}>
                <label className="label" htmlFor="assignment-major">Major</label>
                <select
                  className="input"
                  id="assignment-major"
                  value={majorId}
                  onChange={(event) => setMajorId(event.target.value)}
                  disabled={saving}
                >
                  <option value="">All majors</option>
                  {programMajors.map((major) => (
                    <option key={major.id} value={major.id}>
                      {shortMajor(major, selectedProgram.program_code)} · {major.major_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !programId}
            >
              {saving ? <span className="spinner" /> : <Plus size={16} weight="bold" aria-hidden="true" />}
              Add assignment
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

export default AdminFacultyAssignments
