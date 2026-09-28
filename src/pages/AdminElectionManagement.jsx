import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { CalendarPlus, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react'
import './AdminElectionManagement.css'

function AdminElectionManagement() {
  const toast = useToast()
  const confirm = useConfirm()
  // =====================================================
  // DATA
  // =====================================================

  const [elections, setElections] = useState([])
  const [schools, setSchools] = useState([])
  const [selectedElection, setSelectedElection] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [scheduleError, setScheduleError] = useState('')
  const schedulePanelRef = useRef(null)

  // =====================================================
  // LOADING STATES
  // =====================================================

  const [loading, setLoading] = useState(true)
  const [loadingSchedules, setLoadingSchedules] = useState(false)
  const [savingElection, setSavingElection] = useState(false)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [savingScheduleMode, setSavingScheduleMode] = useState(false)

  // =====================================================
  // ELECTION MODAL
  // =====================================================

  const [showElectionModal, setShowElectionModal] = useState(false)
  const [editingElection, setEditingElection] = useState(null)

  const [electionTitle, setElectionTitle] = useState('')
  const [electionStart, setElectionStart] = useState('')
  const [electionEnd, setElectionEnd] = useState('')

  // =====================================================
  // SCHEDULE MODAL
  // =====================================================

  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)

  const [scheduleSchoolId, setScheduleSchoolId] = useState('')
  const [scheduleStart, setScheduleStart] = useState('')
  const [scheduleEnd, setScheduleEnd] = useState('')

  // =====================================================
  // INITIAL LOAD
  // =====================================================

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)

    await Promise.all([
      fetchElections(),
      fetchSchools()
    ])

    setLoading(false)
  }

  // =====================================================
  // FETCH ELECTIONS
  // =====================================================

  async function fetchElections() {
    const { data, error } = await supabase
      .from('elections')
      .select(`
        id,
        title,
        start_date,
        end_date,
        status,
        allow_concurrent_schedules
      `)
      .order('start_date', {
        ascending: false
      })

    if (error) {
      console.error('Election loading error:', error)
      toast.error(error.message)
      return
    }

    setElections(data || [])
  }

  // =====================================================
  // FETCH SCHOOLS
  // =====================================================

  async function fetchSchools() {
    const { data, error } = await supabase
      .from('schools')
      .select(`
        id,
        school_code,
        school_name
      `)
      .order('id')

    if (error) {
      console.error('School loading error:', error)
      toast.error(error.message)
      return
    }

    setSchools(data || [])
  }

  // =====================================================
  // DATE HELPERS
  // =====================================================

  function toDateTimeLocal(dateString) {
    if (!dateString) {
      return ''
    }

    const date = new Date(dateString)

    const year = date.getFullYear()

    const month = String(
      date.getMonth() + 1
    ).padStart(2, '0')

    const day = String(
      date.getDate()
    ).padStart(2, '0')

    const hours = String(
      date.getHours()
    ).padStart(2, '0')

    const minutes = String(
      date.getMinutes()
    ).padStart(2, '0')

    return `${year}-${month}-${day}T${hours}:${minutes}`
  }

  function formatDate(dateString) {
    if (!dateString) {
      return '—'
    }

    return new Date(dateString).toLocaleDateString(
      undefined,
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }
    )
  }

  function formatTime(dateString) {
    if (!dateString) {
      return '—'
    }

    return new Date(dateString).toLocaleTimeString(
      undefined,
      {
        hour: 'numeric',
        minute: '2-digit'
      }
    )
  }

  // End of a range: just the time when it ends the same day it
  // starts, otherwise date and time so multi-day windows read right.
  function formatRangeEnd(startString, endString) {
    if (!endString) {
      return '—'
    }

    return formatDate(startString) === formatDate(endString)
      ? formatTime(endString)
      : `${formatDate(endString)}, ${formatTime(endString)}`
  }

  // =====================================================
  // CREATE ELECTION MODAL
  // =====================================================

  function openCreateElection() {
    setEditingElection(null)

    setElectionTitle('')
    setElectionStart('')
    setElectionEnd('')

    setShowElectionModal(true)
  }

  // =====================================================
  // EDIT ELECTION MODAL
  // =====================================================

  function openEditElection(election) {
    setEditingElection(election)

    setElectionTitle(election.title)

    setElectionStart(
      toDateTimeLocal(election.start_date)
    )

    setElectionEnd(
      toDateTimeLocal(election.end_date)
    )

    setShowElectionModal(true)
  }

  // =====================================================
  // CLOSE ELECTION MODAL
  // =====================================================

  function closeElectionModal() {
    if (savingElection) {
      return
    }

    setShowElectionModal(false)
    setEditingElection(null)

    setElectionTitle('')
    setElectionStart('')
    setElectionEnd('')
  }

  // =====================================================
  // SAVE ELECTION
  // =====================================================

  async function handleSaveElection(event) {
    event.preventDefault()

    if (!electionTitle.trim()) {
      toast.error('Please enter an election title.')
      return
    }

    if (!electionStart || !electionEnd) {
      toast.error('Please provide both election dates.')
      return
    }

    const start = new Date(electionStart)
    const end = new Date(electionEnd)

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      toast.error('Please provide valid election dates.')
      return
    }

    if (end <= start) {
      toast.error(
        'Election end must be later than the start.'
      )
      return
    }

    setSavingElection(true)

    try {
      // UPDATE EXISTING ELECTION
      if (editingElection) {
        const { error } = await supabase.rpc(
          'update_election',
          {
            p_election_id: editingElection.id,
            p_title: electionTitle.trim(),
            p_start_date: start.toISOString(),
            p_end_date: end.toISOString()
          }
        )

        if (error) {
          throw error
        }

        toast.success('Election updated successfully.')
      }

      // CREATE NEW ELECTION
      else {
        const { error } = await supabase.rpc(
          'create_election',
          {
            p_title: electionTitle.trim(),
            p_start_date: start.toISOString(),
            p_end_date: end.toISOString()
          }
        )

        if (error) {
          throw error
        }

        toast.success('Election created successfully.')
      }

      setShowElectionModal(false)
      setEditingElection(null)

      setElectionTitle('')
      setElectionStart('')
      setElectionEnd('')

      await fetchElections()
    } catch (error) {
      console.error('Save election error:', error)

      toast.error(
        error?.message ||
        'Unable to save the election.'
      )
    } finally {
      setSavingElection(false)
    }
  }

  // =====================================================
  // DELETE ELECTION
  // =====================================================

  async function handleDeleteElection(election) {
    const confirmed = await confirm({
      title: `Delete "${election.title}"?`,
      message:
        'This permanently deletes the election, its school schedules, and all voting records. It cannot be undone.',
      confirmLabel: 'Delete election',
      danger: true
    })

    if (!confirmed) {
      return
    }

    const { error } = await supabase.rpc(
      'delete_election',
      {
        p_election_id: election.id
      }
    )

    if (error) {
      console.error('Delete election error:', error)
      toast.error(error.message)
      return
    }

    if (selectedElection?.id === election.id) {
      setSelectedElection(null)
      setSchedules([])
    }

    toast.success('Election deleted successfully.')

    await fetchElections()
  }

  // =====================================================
  // OPEN ELECTION
  // =====================================================

  async function handleOpenElection(election) {
    const confirmed = await confirm({
      title: `Open "${election.title}"?`,
      message:
        'You can open an election before its start time. ' +
        'Voting then begins automatically at the start time and ' +
        "follows each school's configured schedule, without an " +
        'administrator needing to be logged in.',
      confirmLabel: 'Open election'
    })

    if (!confirmed) {
      return
    }

    const { error } = await supabase.rpc(
      'open_election',
      {
        p_election_id: election.id
      }
    )

    if (error) {
      console.error('Open election error:', error)
      toast.error(error.message)
      return
    }

    toast.success('Election opened successfully.')

    await fetchElections()
  }

  // =====================================================
  // CLOSE ELECTION
  // =====================================================

  async function handleCloseElection(election) {
    const confirmed = await confirm({
      title: `Close "${election.title}"?`,
      message: 'Students will no longer be able to submit votes.',
      confirmLabel: 'Close election',
      danger: true
    })

    if (!confirmed) {
      return
    }

    const { error } = await supabase.rpc(
      'close_election',
      {
        p_election_id: election.id
      }
    )

    if (error) {
      console.error('Close election error:', error)
      toast.error(error.message)
      return
    }

    toast.success('Election closed successfully.')

    await fetchElections()

    if (selectedElection?.id === election.id) {
      setSelectedElection(previous => ({
        ...previous,
        status: 'closed'
      }))
    }
  }

  // =====================================================
  // SCHEDULE MODE (CONCURRENT / SEQUENTIAL)
  // =====================================================

  async function handleScheduleModeChange(allowConcurrent) {
    if (!selectedElection) {
      return
    }

    setSavingScheduleMode(true)

    const { error } = await supabase.rpc(
      'set_election_schedule_mode',
      {
        p_election_id: selectedElection.id,
        p_allow_concurrent: allowConcurrent
      }
    )

    setSavingScheduleMode(false)

    if (error) {
      console.error('Schedule mode error:', error)
      toast.error(error.message)
      return
    }

    setSelectedElection(previous => ({
      ...previous,
      allow_concurrent_schedules: allowConcurrent
    }))

    await fetchElections()
  }

  // =====================================================
  // SELECT ELECTION / LOAD SCHEDULES
  // =====================================================

  async function selectElection(election) {
    setSelectedElection(election)
    setSchedules([])
    setScheduleError('')
    setLoadingSchedules(true)

    // Move the admin directly to the schedule workspace.
    requestAnimationFrame(() => {
      schedulePanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    })

    try {
      const { data, error } = await supabase.rpc(
        'get_election_school_schedules',
        { p_election_id: election.id }
      )

      if (error) {
        console.error('Schedule loading error:', error)
        setScheduleError(error.message)
        return
      }

      setSchedules(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Unexpected schedule error:', error)
      setScheduleError(
        error?.message || 'Unable to load school schedules.'
      )
    } finally {
      setLoadingSchedules(false)
    }
  }

  // =====================================================
  // GET SCHEDULE FOR SCHOOL
  // =====================================================

  function getSchoolSchedule(schoolId) {
    return schedules.find(
      schedule =>
        Number(schedule.school_id) ===
        Number(schoolId)
    )
  }

  // =====================================================
  // ADD SCHEDULE
  // =====================================================

  function openAddSchedule(school) {
    setEditingSchedule(null)

    setScheduleSchoolId(
      String(school.id)
    )

    setScheduleStart('')
    setScheduleEnd('')

    setShowScheduleModal(true)
  }

  // =====================================================
  // EDIT SCHEDULE
  // =====================================================

  function openEditSchedule(schedule) {
    setEditingSchedule(schedule)

    setScheduleSchoolId(
      String(schedule.school_id)
    )

    setScheduleStart(
      toDateTimeLocal(schedule.start_date)
    )

    setScheduleEnd(
      toDateTimeLocal(schedule.end_date)
    )

    setShowScheduleModal(true)
  }

  // =====================================================
  // CLOSE SCHEDULE MODAL
  // =====================================================

  function closeScheduleModal() {
    if (savingSchedule) {
      return
    }

    setShowScheduleModal(false)
    setEditingSchedule(null)

    setScheduleSchoolId('')
    setScheduleStart('')
    setScheduleEnd('')
  }

  // =====================================================
  // SAVE SCHEDULE
  // =====================================================

  async function handleSaveSchedule(event) {
    event.preventDefault()

    if (!selectedElection) {
      toast.error('Please select an election.')
      return
    }

    if (!scheduleSchoolId) {
      toast.error('Please select a school.')
      return
    }

    if (!scheduleStart || !scheduleEnd) {
      toast.error(
        'Please provide both schedule times.'
      )
      return
    }

    const start = new Date(scheduleStart)
    const end = new Date(scheduleEnd)

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      toast.error('Please provide valid schedule dates.')
      return
    }

    if (end <= start) {
      toast.error(
        'Schedule end must be later than the start.'
      )
      return
    }

    /*
      Make sure the school's voting schedule stays
      inside the overall election period.
    */

    const electionStart = new Date(
      selectedElection.start_date
    )

    const electionEnd = new Date(
      selectedElection.end_date
    )

    if (
      start < electionStart ||
      end > electionEnd
    ) {
      toast.error(
        'The school voting schedule must be inside ' +
        'the overall election period.'
      )

      return
    }

    setSavingSchedule(true)

    try {
      const { error } = await supabase.rpc(
        'save_election_school_schedule',
        {
          p_election_id: selectedElection.id,
          p_school_id: Number(
            scheduleSchoolId
          ),
          p_start_date: start.toISOString(),
          p_end_date: end.toISOString()
        }
      )

      if (error) {
        throw error
      }

      toast.success(
        'School schedule saved successfully.'
      )

      setShowScheduleModal(false)
      setEditingSchedule(null)
      setScheduleError('')

      setScheduleSchoolId('')
      setScheduleStart('')
      setScheduleEnd('')

      await selectElection(
        selectedElection
      )
    } catch (error) {
      console.error(
        'Save schedule error:',
        error
      )

      toast.error(
        error?.message ||
        'Unable to save the schedule.'
      )
    } finally {
      setSavingSchedule(false)
    }
  }

  // =====================================================
  // DELETE SCHEDULE
  // =====================================================

  async function handleDeleteSchedule(schedule) {
    const confirmed = await confirm({
      title: `Remove the ${schedule.school_code} schedule?`,
      message: 'Students from this school will not be able to vote until a new schedule is added.',
      confirmLabel: 'Remove schedule',
      danger: true
    })

    if (!confirmed) {
      return
    }

    const { error } = await supabase.rpc(
      'delete_election_school_schedule',
      {
        p_schedule_id:
          schedule.schedule_id
      }
    )

    if (error) {
      console.error(
        'Delete schedule error:',
        error
      )

      toast.error(error.message)
      return
    }

    toast.success(
      'Schedule removed successfully.'
    )

    await selectElection(
      selectedElection
    )
  }

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <div className="election-module-loading">
        <div className="module-spinner" />

        <span>
          Loading election configuration
        </span>
      </div>
    )
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div className="election-module">

      {/* =================================================
          MODULE HEADER
      ================================================= */}

      <div className="election-module-header">

        <button
          type="button"
          className="em-primary-button"
          onClick={openCreateElection}
        >
          <Plus size={16} weight="bold" aria-hidden="true" />
          Create election
        </button>

      </div>

      {/* =================================================
          ELECTION TABLE
      ================================================= */}

      <div className="em-panel">

        <div className="em-panel-header">

          <div>
            <h3>
              Registered elections
            </h3>
          </div>

          <span className="em-record-count">
            {elections.length} record
            {elections.length !== 1 ? 's' : ''}
          </span>

        </div>

        {elections.length === 0 ? (

          <div className="em-empty">

            <div className="em-empty-icon" aria-hidden="true">
              <CalendarPlus size={24} weight="duotone" />
            </div>

            <strong>
              No elections configured
            </strong>

            <span>
              Create your first election event
              to begin configuration.
            </span>

            <button
              type="button"
              className="em-primary-button"
              onClick={openCreateElection}
            >
              Create election
            </button>

          </div>

        ) : (

          <div className="em-table-wrapper">

            <table className="em-table">

              <thead>
                <tr>
                  <th>ID</th>
                  <th>Election</th>
                  <th>Period</th>
                  <th>Status</th>

                  <th className="em-actions-column">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>

              <tbody>

                {elections.map(election => (

                  <tr key={election.id}>

                    <td>
                      <span className="em-id">
                        #
                        {String(
                          election.id
                        ).padStart(3, '0')}
                      </span>
                    </td>

                    <td>
                      <div className="em-election-name">

                        <strong>
                          {election.title}
                        </strong>

                        <span>
                          Created election record
                        </span>

                      </div>
                    </td>

                    <td>
                      <div className="em-period">

                        <strong>
                          {formatDate(
                            election.start_date
                          )}
                        </strong>

                        <span>
                          {formatTime(
                            election.start_date
                          )}

                          {' to '}

                          {formatRangeEnd(
                            election.start_date,
                            election.end_date
                          )}
                        </span>

                      </div>
                    </td>

                    <td>
                      <span
                        className={
                          `em-status ${election.status}`
                        }
                      >
                        <i />

                        {election.status}
                      </span>

                      {election.status === 'draft' && (
                        <small className="em-status-note">
                          Students cannot vote until this election is opened.
                        </small>
                      )}
                    </td>

                    <td>

                      <div className="em-actions">

                        <button
                          type="button"
                          className="em-action-btn"
                          title="Manage schedules"
                          onClick={() =>
                            selectElection(
                              election
                            )
                          }
                        >
                          Schedule
                        </button>

                        <button
                          type="button"
                          className="em-action-btn"
                          title="Edit election"
                          onClick={() =>
                            openEditElection(
                              election
                            )
                          }
                        >
                          <PencilSimple size={14} aria-hidden="true" />
                          Edit
                        </button>

                        {election.status ===
                          'draft' && (

                          <button
                            type="button"
                            className="em-action-btn open"
                            onClick={() =>
                              handleOpenElection(
                                election
                              )
                            }
                          >
                            Open
                          </button>

                        )}

                        {election.status ===
                          'open' && (

                          <button
                            type="button"
                            className="em-action-btn close"
                            onClick={() =>
                              handleCloseElection(
                                election
                              )
                            }
                          >
                            Close
                          </button>

                        )}

                        <button
                          type="button"
                          className="em-action-btn danger"
                          onClick={() =>
                            handleDeleteElection(
                              election
                            )
                          }
                        >
                          <Trash size={14} aria-hidden="true" />
                          Delete
                        </button>

                      </div>

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        )}

      </div>

      {/* =================================================
          SCHOOL SCHEDULE PANEL
      ================================================= */}

      {selectedElection && (

        <div ref={schedulePanelRef} className="em-panel schedule-panel">

          <div className="em-panel-header">

            <div>

              <h3>
                School voting schedule
              </h3>

              <p className="em-selected-election">
                Election:{' '}

                <strong>
                  {selectedElection.title}
                </strong>
              </p>

            </div>

            <button
              type="button"
              className="em-secondary-button"
              onClick={() => {
                setSelectedElection(null)
                setSchedules([])
              }}
            >
              <X size={15} weight="bold" aria-hidden="true" />
              Close
            </button>

          </div>

          {/* SUMMARY */}

          <div className="schedule-summary">

            <div>
              <span>
                Schools
              </span>

              <strong>
                {schools.length}
              </strong>
            </div>

            <div>
              <span>
                Configured
              </span>

              <strong>
                {schedules.length}
              </strong>
            </div>

            <div>
              <span>
                Remaining
              </span>

              <strong>
                {Math.max(
                  schools.length -
                  schedules.length,
                  0
                )}
              </strong>
            </div>

            <div>
              <span>
                Election
              </span>

              <strong>
                #{selectedElection.id}
              </strong>
            </div>

          </div>

          <label className="em-schedule-mode">
            <input
              type="checkbox"
              checked={selectedElection.allow_concurrent_schedules !== false}
              disabled={savingScheduleMode}
              onChange={(event) =>
                handleScheduleModeChange(event.target.checked)
              }
            />
            <span>
              <strong>Allow schools to vote at the same time</strong>
              <small>
                When off, school voting windows must not overlap.
              </small>
            </span>
          </label>

          {scheduleError && !loadingSchedules && (
            <div className="em-schedule-error">
              <div>
                <strong>Unable to load schedules</strong>
                <span>{scheduleError}</span>
              </div>
              <button
                type="button"
                className="em-action-btn"
                onClick={() => selectElection(selectedElection)}
              >
                Retry
              </button>
            </div>
          )}

          {loadingSchedules ? (

            <div className="schedule-loading">

              <div className="module-spinner" />

              <span>
                Loading school schedules
              </span>

            </div>

          ) : (

            <div className="em-table-wrapper">

              <table
                className="em-table schedule-table"
              >

                <thead>
                  <tr>
                    <th>School</th>
                    <th>Voting date</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>

                <tbody>

                  {schools.map(school => {
                    const schedule =
                      getSchoolSchedule(
                        school.id
                      )

                    return (
                      <tr key={school.id}>

                        <td>
                          <div className="school-cell">

                            <span className="school-code">
                              {school.school_code}
                            </span>

                            <span className="school-name">
                              {school.school_name}
                            </span>

                          </div>
                        </td>

                        <td>

                          {schedule ? (

                            <span>
                              {formatDate(
                                schedule.start_date
                              )}
                            </span>

                          ) : (

                            <span className="not-configured">
                              —
                            </span>

                          )}

                        </td>

                        <td>

                          {schedule ? (

                            <span className="time-cell">
                              {formatTime(
                                schedule.start_date
                              )}
                            </span>

                          ) : (

                            <span className="not-configured">
                              —
                            </span>

                          )}

                        </td>

                        <td>

                          {schedule ? (

                            <span className="time-cell">
                              {formatRangeEnd(
                                schedule.start_date,
                                schedule.end_date
                              )}
                            </span>

                          ) : (

                            <span className="not-configured">
                              —
                            </span>

                          )}

                        </td>

                        <td>

                          {schedule ? (

                            <span
                              className={
                                'schedule-status configured'
                              }
                            >
                              <i />
                              Configured
                            </span>

                          ) : (

                            <span
                              className={
                                'schedule-status missing'
                              }
                            >
                              <i />
                              Not configured
                            </span>

                          )}

                        </td>

                        <td>

                          {schedule ? (

                            <div className="schedule-actions">

                              <button
                                type="button"
                                className="em-action-btn"
                                onClick={() =>
                                  openEditSchedule(
                                    schedule
                                  )
                                }
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                className={
                                  'em-action-btn danger'
                                }
                                onClick={() =>
                                  handleDeleteSchedule(
                                    schedule
                                  )
                                }
                              >
                                Delete
                              </button>

                            </div>

                          ) : (

                            <button
                              type="button"
                              className={
                                'em-action-btn open'
                              }
                              onClick={() =>
                                openAddSchedule(
                                  school
                                )
                              }
                            >
                              <Plus size={14} weight="bold" aria-hidden="true" />
                              Add schedule
                            </button>

                          )}

                        </td>

                      </tr>
                    )
                  })}

                </tbody>

              </table>

            </div>

          )}

        </div>

      )}

      {/* =================================================
          ELECTION MODAL
      ================================================= */}

      {showElectionModal && (

        <div
          className="em-modal-overlay"
          onMouseDown={
            closeElectionModal
          }
        >

          <div
            className="em-modal"
            onMouseDown={event =>
              event.stopPropagation()
            }
          >

            <div className="em-modal-header">

              <div>

                <h3>
                  {editingElection
                    ? 'Edit election'
                    : 'Create election'}
                </h3>

              </div>

              <button
                type="button"
                className="em-modal-close"
                aria-label="Close"
                onClick={
                  closeElectionModal
                }
              >
                <X size={18} weight="bold" />
              </button>

            </div>

            <form
              className="em-form"
              onSubmit={
                handleSaveElection
              }
            >

              <div className="em-form-field">

                <label>
                  Election title
                </label>

                <input
                  type="text"
                  value={electionTitle}
                  onChange={event =>
                    setElectionTitle(
                      event.target.value
                    )
                  }
                  placeholder="Teachers' Day 2027"
                  required
                />

              </div>

              <div className="em-form-grid">

                <div className="em-form-field">

                  <label>
                    Overall start
                  </label>

                  <input
                    type="datetime-local"
                    value={electionStart}
                    onChange={event =>
                      setElectionStart(
                        event.target.value
                      )
                    }
                    required
                  />

                </div>

                <div className="em-form-field">

                  <label>
                    Overall end
                  </label>

                  <input
                    type="datetime-local"
                    value={electionEnd}
                    onChange={event =>
                      setElectionEnd(
                        event.target.value
                      )
                    }
                    required
                  />

                </div>

              </div>

              <div className="em-form-note">

                <p>
                  The overall election period
                  defines the boundaries of the
                  election. Individual school
                  voting periods are configured
                  separately.
                </p>

              </div>

              <div className="em-modal-actions">

                <button
                  type="button"
                  className="em-secondary-button"
                  onClick={
                    closeElectionModal
                  }
                  disabled={
                    savingElection
                  }
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="em-primary-button"
                  disabled={
                    savingElection
                  }
                >
                  {savingElection
                    ? 'Saving'
                    : editingElection
                      ? 'Save changes'
                      : 'Create election'}
                </button>

              </div>

            </form>

          </div>

        </div>

      )}

      {/* =================================================
          SCHEDULE MODAL
      ================================================= */}

      {showScheduleModal && (

        <div
          className="em-modal-overlay"
          onMouseDown={
            closeScheduleModal
          }
        >

          <div
            className="em-modal"
            onMouseDown={event =>
              event.stopPropagation()
            }
          >

            <div className="em-modal-header">

              <div>

                <h3>
                  {editingSchedule
                    ? 'Edit voting schedule'
                    : 'Add voting schedule'}
                </h3>

              </div>

              <button
                type="button"
                className="em-modal-close"
                aria-label="Close"
                onClick={
                  closeScheduleModal
                }
              >
                <X size={18} weight="bold" />
              </button>

            </div>

            <form
              className="em-form"
              onSubmit={
                handleSaveSchedule
              }
            >

              <div className="em-form-field">

                <label>
                  School
                </label>

                <select
                  value={
                    scheduleSchoolId
                  }
                  onChange={event =>
                    setScheduleSchoolId(
                      event.target.value
                    )
                  }
                  disabled={
                    !!editingSchedule
                  }
                  required
                >

                  <option value="">
                    Select school
                  </option>

                  {schools.map(
                    school => (

                      <option
                        key={school.id}
                        value={school.id}
                      >
                        {school.school_code}
                        {' · '}
                        {school.school_name}
                      </option>

                    )
                  )}

                </select>

              </div>

              <div className="em-form-grid">

                <div className="em-form-field">

                  <label>
                    Voting start
                  </label>

                  <input
                    type="datetime-local"
                    value={scheduleStart}
                    onChange={event =>
                      setScheduleStart(
                        event.target.value
                      )
                    }
                    required
                  />

                </div>

                <div className="em-form-field">

                  <label>
                    Voting end
                  </label>

                  <input
                    type="datetime-local"
                    value={scheduleEnd}
                    onChange={event =>
                      setScheduleEnd(
                        event.target.value
                      )
                    }
                    required
                  />

                </div>

              </div>

              <div className="em-form-note">

                <p>
                  Students may only submit
                  votes during the configured
                  voting period for their school.
                </p>

              </div>

              <div className="em-modal-actions">

                <button
                  type="button"
                  className="em-secondary-button"
                  onClick={
                    closeScheduleModal
                  }
                  disabled={
                    savingSchedule
                  }
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="em-primary-button"
                  disabled={
                    savingSchedule
                  }
                >
                  {savingSchedule
                    ? 'Saving'
                    : editingSchedule
                      ? 'Update schedule'
                      : 'Save schedule'}
                </button>

              </div>

            </form>

          </div>

        </div>

      )}

    </div>
  )
}

export default AdminElectionManagement