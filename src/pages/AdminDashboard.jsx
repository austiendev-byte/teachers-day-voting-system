import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { supabase } from '../lib/supabase'
import { useConfirm } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import {
  ArrowClockwise,
  ArrowRight,
  Buildings,
  CalendarBlank,
  CaretRight,
  ChartBar,
  ChatCircleDots,
  FileXls,
  ImageSquare,
  Images,
  SignOut,
  ShieldWarning,
  SquaresFour,
  Trash,
  Trophy,
  UsersThree,
  CalendarCheck,
  ChalkboardTeacher,
  WarningCircle,
  X
} from '@phosphor-icons/react'
import AdminFacultyUpload from './AdminFacultyUpload'
import AdminFacultyPhotos from './AdminFacultyPhotos'
import AdminResults from './AdminResults'
import AdminElectionManagement from './AdminElectionManagement'
import AdminProblemReports from './AdminProblemReports'
import AdminUsers from './AdminUsers'
import AdminStudentIdUpload from './AdminStudentIdUpload'
import './AdminDashboard.css'

const SCHOOL_ORDER = ['STCS', 'SNHS', 'SAS', 'STHM', 'SOE', 'SBM', 'STED', 'SCJE']

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: SquaresFour },
  { id: 'elections', label: 'Elections', icon: CalendarCheck },
  { id: 'faculty', label: 'Faculty', icon: ChalkboardTeacher },
  { id: 'results', label: 'Results', icon: ChartBar },
  { id: 'winners', label: 'Award overview', icon: Trophy },
  { id: 'reports', label: 'Problem reports', icon: ChatCircleDots },
  { id: 'users', label: 'Students', icon: UsersThree }
]

function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium'
  }).format(new Date(value))
}

function formatTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-PH', {
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US')
}

function getSchoolStatus(row, election, now = new Date()) {
  if (!election) return 'not_configured'
  if (!row.schedule_start || !row.schedule_end) return 'not_configured'

  const electionStart = new Date(election.start_date)
  const electionEnd = new Date(election.end_date)
  const start = new Date(Math.max(
    electionStart.getTime(),
    new Date(row.schedule_start).getTime()
  ))
  const end = new Date(Math.min(
    electionEnd.getTime(),
    new Date(row.schedule_end).getTime()
  ))

  if (end <= start) return 'not_configured'
  if (election.status === 'closed' || now > end) return 'completed'
  if (now < start) return 'upcoming'
  if (now >= start && now <= end && election.status === 'open') return 'open'
  if (now < electionStart) return 'upcoming'
  return 'completed'
}

function statusLabel(status) {
  switch (status) {
    case 'open':
      return 'Voting Open'
    case 'upcoming':
      return 'Upcoming'
    case 'completed':
      return 'Completed'
    default:
      return 'Not Configured'
  }
}

function statusClass(status) {
  switch (status) {
    case 'open':
      return 'status-open'
    case 'upcoming':
      return 'status-upcoming'
    case 'completed':
      return 'status-completed'
    default:
      return 'status-not-configured'
  }
}

function getTopThree(faculty) {
  return [...(faculty || [])]
    .sort((a, b) => {
      const voteDifference = Number(b.vote_count) - Number(a.vote_count)
      if (voteDifference !== 0) return voteDifference
      return String(a.faculty_name || '').localeCompare(String(b.faculty_name || ''))
    })
    .slice(0, 3)
}

function getWinnerInfo(faculty) {
  const sorted = [...(faculty || [])].sort((a, b) => {
    const voteDifference = Number(b.vote_count) - Number(a.vote_count)
    if (voteDifference !== 0) return voteDifference
    return String(a.faculty_name || '').localeCompare(String(b.faculty_name || ''))
  })

  if (!sorted.length) {
    return { state: 'none', faculty: [] }
  }

  const highest = Number(sorted[0].vote_count || 0)

  if (highest <= 0) {
    return { state: 'none', faculty: [] }
  }

  const winners = sorted.filter((item) => Number(item.vote_count || 0) === highest)

  if (winners.length > 1) {
    return { state: 'tie', faculty: winners }
  }

  return { state: 'winner', faculty: winners }
}

function ParticipationMeter({ percentage, label = 'participation' }) {
  const safePercentage = Math.max(0, Math.min(100, Number(percentage || 0)))

  return (
    <div className="meter" aria-label={`${safePercentage.toFixed(1)} percent ${label}`}>
      <div className="meter-head">
        <strong className="num">{safePercentage.toFixed(1)}%</strong>
        <span>{label}</span>
      </div>
      <div className="meter-track" aria-hidden="true">
        <div className="meter-fill" style={{ transform: `scaleX(${safePercentage / 100})` }} />
      </div>
    </div>
  )
}

function SchoolMark({ school, className = 'school-mark' }) {
  return school.logo_url ? (
    <img src={school.logo_url} alt={`${school.school_name || school.school_code} logo`} className={className} />
  ) : (
    <span className={`${className} is-placeholder`} aria-hidden="true">
      {school.school_code?.slice(0, 2) || 'SC'}
    </span>
  )
}

function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${statusClass(status)}`}>
      <span className="status-badge-dot" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  )
}

function SchoolCard({
  school,
  election,
  onOpen,
  onUploadLogo,
  onRemoveLogo,
  uploadingSchoolId
}) {
  const status = getSchoolStatus(school, election)
  const topThree = getTopThree(school.faculty_results)
  const hasVotes = Number(school.votes_cast || 0) > 0
  const winner = getWinnerInfo(school.faculty_results)
  const uploading = uploadingSchoolId === school.school_id

  return (
    <article className={`school-card is-${status}`}>
      <header className="school-card-header">
        <SchoolMark school={school} />
        <div className="school-card-heading">
          <span className="school-card-code">{school.school_code}</span>
          <h3>{school.school_name}</h3>
        </div>
        <StatusBadge status={status} />
      </header>

      <p className="school-card-schedule">
        <CalendarBlank size={15} aria-hidden="true" />
        {school.schedule_start && school.schedule_end
          ? formatDate(school.schedule_start) === formatDate(school.schedule_end)
            ? `${formatDate(school.schedule_start)}, ${formatTime(school.schedule_start)} to ${formatTime(school.schedule_end)}`
            : `${formatDateTime(school.schedule_start)} to ${formatDateTime(school.schedule_end)}`
          : 'Voting window not configured'}
      </p>

      <div className="school-card-metrics">
        <div>
          <span>Eligible</span>
          <strong className="num">{formatNumber(school.eligible_voters)}</strong>
        </div>
        <div>
          <span>Completed</span>
          <strong className="num">{formatNumber(school.completed_ballots ?? school.votes_cast)}</strong>
        </div>
      </div>

      <ParticipationMeter percentage={school.participation} />

      <div className="school-card-results">
        <div className="school-card-results-head">
          <span>Most selected across awards</span>
          {winner.state === 'winner' && hasVotes ? (
            <span className="winner-badge">Leading</span>
          ) : winner.state === 'tie' ? (
            <span className="tie-badge">Tie</span>
          ) : null}
        </div>

        {topThree.length ? (
          <ol className="top-three-list">
            {topThree.map((item, index) => (
              <li className="top-three-row" key={item.faculty_id}>
                <span className={`top-three-rank${index === 0 && hasVotes ? ' is-first' : ''}`}>{index + 1}</span>
                <span className="top-three-person">
                  <strong>{item.faculty_name}</strong>
                  <span>{item.program_name || 'Program not listed'}</span>
                </span>
                <strong className="top-three-votes num">{formatNumber(item.vote_count)}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <p className="school-card-empty">No faculty records yet.</p>
        )}
      </div>

      <footer className="school-card-actions">
        <button
          type="button"
          className="admin-button secondary"
          onClick={() => onOpen(school)}
        >
          View details
        </button>

        <label
          className={`admin-button secondary admin-file-button${uploading ? ' is-busy' : ''}`}
          title="Upload or replace school logo"
        >
          <ImageSquare size={16} aria-hidden="true" />
          {uploading ? 'Uploading' : 'Logo'}
          <input
            type="file"
            accept="image/*"
            onChange={(event) => onUploadLogo(event, school)}
            disabled={uploading}
            hidden
          />
        </label>

        {school.logo_url && (
          <button
            type="button"
            className="icon-button danger"
            onClick={() => onRemoveLogo(school)}
            aria-label={`Remove ${school.school_code} logo`}
            title={`Remove ${school.school_code} logo`}
            disabled={uploading}
          >
            <Trash size={16} />
          </button>
        )}
      </footer>
    </article>
  )
}

function useEscapeToClose(active, onClose) {
  useEffect(() => {
    if (!active) return undefined

    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, onClose])
}

function SchoolDetailModal({ school, election, onClose, onUploadLogo, onRemoveLogo, uploadingSchoolId }) {
  useEscapeToClose(Boolean(school), onClose)

  if (!school) return null

  const status = getSchoolStatus(school, election)
  const faculty = [...(school.faculty_results || [])].sort((a, b) => {
    const voteDifference = Number(b.vote_count) - Number(a.vote_count)
    if (voteDifference !== 0) return voteDifference
    return String(a.faculty_name || '').localeCompare(String(b.faculty_name || ''))
  })
  const winner = getWinnerInfo(faculty)
  const maxVotes = Math.max(...faculty.map((item) => Number(item.vote_count || 0)), 1)
  const percentage = Number(school.participation || 0)
  const uploading = uploadingSchoolId === school.school_id

  return (
    <div className="school-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="school-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="school-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-school-identity">
            <SchoolMark school={school} className="modal-school-logo" />
            <div>
              <div className="school-card-code">{school.school_code}</div>
              <h2 id="school-detail-title">{school.school_name}</h2>
              <StatusBadge status={status} />
            </div>
          </div>

          <button type="button" className="modal-close" onClick={onClose} aria-label="Close school details">
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="modal-body">
          <section className="detail-summary-grid">
            <div className="detail-summary-card">
              <span>Eligible voters</span>
              <strong className="num">{formatNumber(school.eligible_voters)}</strong>
            </div>
            <div className="detail-summary-card">
              <span>Completed ballots</span>
              <strong className="num">{formatNumber(school.votes_cast)}</strong>
            </div>
            <div className="detail-summary-card">
              <span>Not yet completed</span>
              <strong className="num">{formatNumber(Math.max(0, Number(school.eligible_voters || 0) - Number(school.votes_cast || 0)))}</strong>
            </div>
            <div className="detail-summary-card">
              <span>Faculty</span>
              <strong className="num">{formatNumber(faculty.length)}</strong>
            </div>
          </section>

          <section className="detail-two-column">
            <div className="detail-panel">
              <div className="detail-panel-heading">
                <h3>School voting window</h3>
              </div>

              <div className="detail-schedule-box">
                <div>
                  <span>Starts</span>
                  <strong>
                    {school.schedule_start ? formatDateTime(school.schedule_start) : 'Not configured'}
                  </strong>
                </div>
                <ArrowRight className="schedule-arrow" size={18} aria-hidden="true" />
                <div>
                  <span>Ends</span>
                  <strong>
                    {school.schedule_end ? formatDateTime(school.schedule_end) : 'Not configured'}
                  </strong>
                </div>
              </div>

              <p className="overall-period-note">
                Overall election: {formatDateTime(election?.start_date)} to {formatDateTime(election?.end_date)}
              </p>
            </div>

            <div className="detail-panel">
              <div className="detail-panel-heading">
                <h3>Voter participation</h3>
              </div>
              <ParticipationMeter percentage={percentage} label="of eligible students voted" />
            </div>
          </section>

          <section className="detail-panel">
            <div className="detail-panel-heading">
              <h3>Faculty vote distribution</h3>
              <div className="detail-winner-summary">
                {winner.state === 'winner' && winner.faculty[0] ? (
                  <>
                    <span className="winner-badge">Leading</span>
                    <strong>{winner.faculty[0].faculty_name}</strong>
                    <small className="num">{formatNumber(winner.faculty[0].vote_count)} votes</small>
                  </>
                ) : winner.state === 'tie' ? (
                  <>
                    <span className="tie-badge">Tie</span>
                    <small>{winner.faculty.map((item) => item.faculty_name).join(', ')}</small>
                  </>
                ) : (
                  <small>No votes yet</small>
                )}
              </div>
            </div>

            <div className="faculty-bar-chart">
              {faculty.length ? faculty.map((item) => {
                const voteCount = Number(item.vote_count || 0)
                const width = (voteCount / maxVotes) * 100
                return (
                  <div className="bar-row" key={item.faculty_id}>
                    <div className="bar-label">
                      <strong>{item.faculty_name}</strong>
                      <span>{item.program_name || 'Program not listed'}</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ transform: `scaleX(${Math.max(width, 1) / 100})` }} />
                    </div>
                    <strong className="bar-value num">{formatNumber(voteCount)}</strong>
                  </div>
                )
              }) : (
                <div className="detail-empty">No faculty results are available for this school.</div>
              )}
            </div>
          </section>

          <section className="detail-panel">
            <div className="detail-panel-heading">
              <h3>Faculty in {school.school_code}</h3>
              <div className="detail-panel-actions">
                {school.logo_url && (
                  <button
                    type="button"
                    className="text-danger-button"
                    onClick={() => onRemoveLogo(school)}
                    disabled={uploading}
                  >
                    Remove logo
                  </button>
                )}
                <label className="admin-button secondary admin-file-button">
                  <ImageSquare size={16} aria-hidden="true" />
                  {uploading ? 'Uploading' : 'Replace logo'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => onUploadLogo(event, school)}
                    disabled={uploading}
                    hidden
                  />
                </label>
              </div>
            </div>

            <div className="faculty-detail-grid">
              {faculty.length ? faculty.map((item) => (
                <div className="faculty-detail-card" key={item.faculty_id}>
                  {item.photo_url ? (
                    <img src={item.photo_url} alt={item.faculty_name} loading="lazy" />
                  ) : (
                    <div className="faculty-detail-photo-fallback" aria-hidden="true">
                      {item.faculty_name?.charAt(0)?.toUpperCase() || 'F'}
                    </div>
                  )}
                  <div>
                    <strong>{item.faculty_name}</strong>
                    <span>{item.program_name || 'Program not listed'}</span>
                    <small className="num">{item.faculty_code}</small>
                  </div>
                </div>
              )) : (
                <div className="detail-empty">No faculty records are available.</div>
              )}
            </div>
          </section>
        </div>

        <div className="modal-footer">
          <span>Election #{election?.id ?? '-'}, live administrative data</span>
          <button type="button" className="admin-button primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function AdminDashboard() {
  const confirm = useConfirm()
  const toast = useToast()

  const [adminEmail, setAdminEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [accessError, setAccessError] = useState('')
  const [systemStatus, setSystemStatus] = useState('checking')
  const [activeSection, setActiveSection] = useState('overview')

  const [elections, setElections] = useState([])
  const [selectedElectionId, setSelectedElectionId] = useState('')
  const [schoolProgress, setSchoolProgress] = useState([])
  const [facultyDirectory, setFacultyDirectory] = useState([])
  const [reportsCount, setReportsCount] = useState({ total: 0, new: 0, in_review: 0 })

  const [selectedSchool, setSelectedSchool] = useState(null)
  const [showFacultyUpload, setShowFacultyUpload] = useState(false)
  const [showFacultyPhotos, setShowFacultyPhotos] = useState(false)
  const [facultyListSchool, setFacultyListSchool] = useState(null)
  const [uploadingSchoolId, setUploadingSchoolId] = useState(null)
  const refreshTimerRef = useRef(null)
  const closeSchoolDetail = useCallback(() => setSelectedSchool(null), [])
  const closeFacultyList = useCallback(() => setFacultyListSchool(null), [])
  useEscapeToClose(Boolean(facultyListSchool), closeFacultyList)

  const activeElection = useMemo(
    () => elections.find((item) => String(item.id) === String(selectedElectionId)) || null,
    [elections, selectedElectionId]
  )

  const orderedSchools = useMemo(() => {
    const byCode = new Map(schoolProgress.map((school) => [school.school_code, school]))
    const known = SCHOOL_ORDER.map((code) => byCode.get(code)).filter(Boolean)
    const remainder = schoolProgress
      .filter((school) => !SCHOOL_ORDER.includes(school.school_code))
      .sort((a, b) => String(a.school_code).localeCompare(String(b.school_code)))
    return [...known, ...remainder]
  }, [schoolProgress])

  const facultyListSchoolData = useMemo(() => {
    if (!facultyListSchool) return null

    const baseSchool = facultyDirectory.find(
      (school) => school.school_code === facultyListSchool
    )

    if (!baseSchool) return null

    const electionSchool = schoolProgress.find(
      (school) => school.school_code === facultyListSchool
    )

    if (!electionSchool) return baseSchool

    const electionFaculty = new Map(
      (electionSchool.faculty_results || []).map((member) => [
        Number(member.faculty_id),
        member
      ])
    )

    return {
      ...baseSchool,
      schedule_start: electionSchool.schedule_start,
      schedule_end: electionSchool.schedule_end,
      eligible_voters: electionSchool.eligible_voters,
      votes_cast: electionSchool.votes_cast,
      participation: electionSchool.participation,
      faculty_results: baseSchool.faculty_results.map((member) => ({
        ...member,
        ...(electionFaculty.get(Number(member.faculty_id)) || {})
      }))
    }
  }, [facultyDirectory, facultyListSchool, schoolProgress])

  const dashboardSummary = useMemo(() => {
    const eligible = orderedSchools.reduce((sum, school) => sum + Number(school.eligible_voters || 0), 0)
    const votes = orderedSchools.reduce((sum, school) => sum + Number(school.completed_ballots ?? school.votes_cast ?? 0), 0)
    const participation = eligible > 0 ? (votes / eligible) * 100 : 0
    const statusCounts = orderedSchools.reduce((accumulator, school) => {
      const state = getSchoolStatus(school, activeElection)
      accumulator[state] = (accumulator[state] || 0) + 1
      return accumulator
    }, {})

    return {
      eligible,
      votes,
      participation,
      open: statusCounts.open || 0,
      upcoming: statusCounts.upcoming || 0,
      completed: statusCounts.completed || 0,
      notConfigured: statusCounts.not_configured || 0,
      remaining: Math.max(0, eligible - votes)
    }
  }, [activeElection, orderedSchools])

  const reportRefresh = useCallback(async () => {
    const { count, error } = await supabase
      .from('reports')
      .select('id', { count: 'exact', head: true })

    if (error) {
      console.error('Report count error:', error)
      return
    }

    const statuses = await Promise.all(
      ['new', 'in_review'].map(async (status) => {
        const result = await supabase
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .eq('status', status)
        return [status, result.error ? 0 : result.count || 0]
      })
    )

    const statusMap = Object.fromEntries(statuses)
    setReportsCount({
      total: count || 0,
      new: statusMap.new || 0,
      in_review: statusMap.in_review || 0
    })
  }, [])

  const loadElections = useCallback(async () => {
    const { data, error } = await supabase
      .from('elections')
      .select('id, title, start_date, end_date, status')
      .order('start_date', { ascending: false })

    if (error) {
      throw error
    }

    return data || []
  }, [])

  const loadSchoolProgress = useCallback(async (electionId) => {
    if (!electionId) {
      setSchoolProgress([])
      return
    }

    const { data, error } = await supabase.rpc('get_admin_school_progress', {
      p_election_id: Number(electionId)
    })

    if (error) {
      throw error
    }

    setSchoolProgress(data || [])
  }, [])

  const loadFacultyDirectory = useCallback(async () => {
    const { data: schools, error: schoolError } = await supabase
      .from('schools')
      .select('id, school_code, school_name, logo_url')
      .order('school_code', { ascending: true })

    if (schoolError) {
      throw schoolError
    }

    const { data: faculty, error: facultyError } = await supabase
      .from('faculty')
      .select(`
        id,
        faculty_code,
        name,
        school_id,
        photo_url,
        programs (
          program_code,
          program_name
        )
      `)
      .order('name', { ascending: true })

    if (facultyError) {
      throw facultyError
    }

    const groupedSchools = (schools || []).map((school) => ({
      school_id: school.id,
      school_code: school.school_code,
      school_name: school.school_name,
      logo_url: school.logo_url,
      schedule_start: null,
      schedule_end: null,
      eligible_voters: 0,
      votes_cast: 0,
      participation: 0,
      faculty_results: (faculty || [])
        .filter((member) => Number(member.school_id) === Number(school.id))
        .map((member) => ({
          faculty_id: member.id,
          faculty_code: member.faculty_code,
          faculty_name: member.name,
          program_code: member.programs?.program_code || '',
          program_name: member.programs?.program_name || 'Program not listed',
          photo_url: member.photo_url,
          vote_count: 0
        }))
    }))

    setFacultyDirectory(groupedSchools)
  }, [])

  const refreshElectionContext = useCallback(async (preferredId = selectedElectionId) => {
    try {
      const nextElections = await loadElections()
      setElections(nextElections)

      const preferred = nextElections.find((item) => String(item.id) === String(preferredId))
      const now = new Date()
      const nextElection = preferred ||
        nextElections.find((item) => item.status === 'open' && now >= new Date(item.start_date) && now <= new Date(item.end_date)) ||
        nextElections.find((item) => item.status === 'draft' && new Date(item.start_date) > now) ||
        nextElections[0] ||
        null

      if (!nextElection) {
        setSelectedElectionId('')
        setSchoolProgress([])
        return
      }

      setSelectedElectionId(String(nextElection.id))
      await loadSchoolProgress(nextElection.id)
    } catch (error) {
      console.error('Election refresh error:', error)
    }
  }, [loadElections, loadSchoolProgress, selectedElectionId])

  const checkAdmin = useCallback(async () => {
    setLoading(true)
    setAccessError('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setAccessError('Your administrator session could not be verified.')
        setSystemStatus('error')
        return
      }

      const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin')

      if (adminError) {
        console.error('Admin check error:', adminError)
        setAccessError('Administrator access could not be verified.')
        setSystemStatus('error')
        return
      }

      if (!isAdmin) {
        await supabase.auth.signOut({ scope: 'local' })
        window.location.href = '/login'
        return
      }

      setAdminEmail(user.email || '')
      setSystemStatus('online')

      const nextElections = await loadElections()
      setElections(nextElections)
      await loadFacultyDirectory()

      const now = new Date()
      const defaultElection =
        nextElections.find((item) => item.status === 'open' && now >= new Date(item.start_date) && now <= new Date(item.end_date)) ||
        nextElections.find((item) => item.status === 'draft' && new Date(item.start_date) > now) ||
        nextElections[0] ||
        null

      if (defaultElection) {
        setSelectedElectionId(String(defaultElection.id))
        await loadSchoolProgress(defaultElection.id)
      }

      await reportRefresh()
    } catch (error) {
      console.error('Admin dashboard initialization error:', error)
      setAccessError('The administrative dashboard could not be loaded.')
      setSystemStatus('error')
    } finally {
      setLoading(false)
    }
  }, [loadElections, loadSchoolProgress, loadFacultyDirectory, reportRefresh])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkAdmin()
  }, [checkAdmin])

  useEffect(() => {
    if (!selectedElectionId) return undefined

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(() => {
        refreshElectionContext(selectedElectionId)
        reportRefresh()
      }, 350)
    }

    const votesChannel = supabase
      .channel('admin-dashboard-category-votes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'category_votes',
          filter: `election_id=eq.${selectedElectionId}`
        },
        scheduleRefresh
      )
      .subscribe()

    const electionsChannel = supabase
      .channel('admin-dashboard-elections')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'elections' }, scheduleRefresh)
      .subscribe()

    const schedulesChannel = supabase
      .channel('admin-dashboard-schedules')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'election_school_schedules' }, scheduleRefresh)
      .subscribe()

    const schoolsChannel = supabase
      .channel('admin-dashboard-schools')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schools' }, scheduleRefresh)
      .subscribe()

    const reportsChannel = supabase
      .channel('admin-dashboard-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => reportRefresh())
      .subscribe()

    return () => {
      window.clearTimeout(refreshTimerRef.current)
      supabase.removeChannel(votesChannel)
      supabase.removeChannel(electionsChannel)
      supabase.removeChannel(schedulesChannel)
      supabase.removeChannel(schoolsChannel)
      supabase.removeChannel(reportsChannel)
    }
  }, [refreshElectionContext, reportRefresh, selectedElectionId])

  useEffect(() => {
    const refreshFacultyDirectory = () => {
      loadFacultyDirectory().catch((error) => {
        console.error('Faculty directory realtime refresh error:', error)
      })
    }

    const facultyChannel = supabase
      .channel('admin-faculty-directory')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'faculty' },
        refreshFacultyDirectory
      )
      .subscribe()

    const schoolsChannel = supabase
      .channel('admin-faculty-directory-schools')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'schools' },
        refreshFacultyDirectory
      )
      .subscribe()

    return () => {
      supabase.removeChannel(facultyChannel)
      supabase.removeChannel(schoolsChannel)
    }
  }, [loadFacultyDirectory])

  async function handleElectionChange(event) {
    const electionId = event.target.value
    setSelectedElectionId(electionId)

    if (!electionId) {
      setSchoolProgress([])
      return
    }

    try {
      await loadSchoolProgress(electionId)
    } catch (error) {
      console.error('Election school progress error:', error)
      toast.error(`Could not load the selected election.\n\n${error.message}`)
    }
  }

  async function handleLogout() {
    const confirmed = await confirm({
      title: 'Sign out',
      message: 'Are you sure you want to sign out of the administrative console?',
      confirmLabel: 'Sign out'
    })

    if (!confirmed) return

    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) {
      toast.error(error.message)
      return
    }

    sessionStorage.removeItem('userRole')
    window.location.href = '/login'
  }

  function navigateTo(section) {
    setActiveSection(section)
    setShowFacultyUpload(false)
    setShowFacultyPhotos(false)
    setSelectedSchool(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleUploadLogo(event, school) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('School logo must be 2 MB or smaller.')
      return
    }

    setUploadingSchoolId(school.school_id)

    try {
      const path = `schools/${school.school_id}/logo`
      const { error: uploadError } = await supabase
        .storage
        .from('school-logos')
        .upload(path, file, {
          upsert: true,
          contentType: file.type,
          cacheControl: '3600'
        })

      if (uploadError) throw uploadError

      const { data: publicUrlData } = supabase
        .storage
        .from('school-logos')
        .getPublicUrl(path)

      const logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`

      const { error: updateError } = await supabase.rpc('set_school_logo', {
        p_school_id: Number(school.school_id),
        p_logo_url: logoUrl
      })

      if (updateError) throw updateError

      setSchoolProgress((current) => current.map((item) => (
        item.school_id === school.school_id
          ? { ...item, logo_url: logoUrl }
          : item
      )))
    } catch (error) {
      console.error('School logo upload error:', error)
      toast.error(`Could not upload the school logo.\n\n${error.message}`)
    } finally {
      setUploadingSchoolId(null)
    }
  }

  async function handleRemoveLogo(school) {
    const confirmed = await confirm({
      title: 'Remove school logo',
      message: `Remove the logo for ${school.school_code}? The school card will return to its placeholder until a new logo is uploaded.`,
      confirmLabel: 'Remove Logo'
    })

    if (!confirmed) return

    setUploadingSchoolId(school.school_id)

    try {
      const { error: updateError } = await supabase.rpc('set_school_logo', {
        p_school_id: Number(school.school_id),
        p_logo_url: null
      })

      if (updateError) throw updateError

      const { error: storageError } = await supabase
        .storage
        .from('school-logos')
        .remove([`schools/${school.school_id}/logo`])

      if (storageError) {
        console.warn('School logo storage removal warning:', storageError)
      }

      setSchoolProgress((current) => current.map((item) => (
        item.school_id === school.school_id
          ? { ...item, logo_url: null }
          : item
      )))
    } catch (error) {
      console.error('School logo removal error:', error)
      toast.error(`Could not remove the school logo.\n\n${error.message}`)
    } finally {
      setUploadingSchoolId(null)
    }
  }

  function renderSchoolDirectory() {
    return (
      <section className="admin-section-block">
        <div className="admin-section-heading">
          <div>
            <h2>Faculty directory</h2>
            <p>Open a school to see its full faculty list and current vote totals.</p>
          </div>
        </div>

        {facultyDirectory.length === 0 ? (
          <div className="admin-empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Buildings size={22} weight="duotone" /></span>
            <strong>No schools available</strong>
            <span>School and faculty records may not be configured yet.</span>
          </div>
        ) : (
          <div className="faculty-directory-grid">
            {facultyDirectory.map((school) => {
              const count = school.faculty_results?.length || 0
              return (
                <button
                  type="button"
                  key={school.school_id}
                  className="faculty-directory-card"
                  onClick={() => setFacultyListSchool(school.school_code)}
                >
                  <SchoolMark school={school} className="faculty-directory-card-logo" />
                  <span className="faculty-directory-card-body">
                    <strong>{school.school_code}</strong>
                    <span>{school.school_name}</span>
                  </span>
                  <span className="faculty-directory-card-count">
                    <span className="num">{count}</span> faculty
                  </span>
                  <CaretRight className="faculty-directory-card-arrow" size={16} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}

        {facultyListSchoolData && (
          <div className="school-detail-backdrop" role="presentation" onMouseDown={() => setFacultyListSchool(null)}>
            <div
              className="school-detail-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="faculty-list-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="modal-header">
                <div className="modal-school-identity">
                  <SchoolMark school={facultyListSchoolData} className="modal-school-logo" />
                  <div>
                    <div className="school-card-code">{facultyListSchoolData.school_code}</div>
                    <h2 id="faculty-list-title">Faculty list</h2>
                    <span className="results-modal-subtitle">{facultyListSchoolData.school_name}</span>
                  </div>
                </div>

                <button type="button" className="modal-close" onClick={() => setFacultyListSchool(null)} aria-label="Close faculty list">
                  <X size={18} weight="bold" />
                </button>
              </div>

              <div className="modal-body">
                <div className="faculty-directory-list">
                  {(facultyListSchoolData.faculty_results || []).length ? (
                    facultyListSchoolData.faculty_results.map((member) => (
                      <div className="faculty-directory-row" key={member.faculty_id}>
                        {member.photo_url ? (
                          <img src={member.photo_url} alt={member.faculty_name} loading="lazy" />
                        ) : (
                          <div className="faculty-directory-avatar" aria-hidden="true">
                            {member.faculty_name?.charAt(0)?.toUpperCase() || 'F'}
                          </div>
                        )}
                        <div className="faculty-directory-main">
                          <strong>{member.faculty_name}</strong>
                          <span>{member.program_name || 'Program not listed'}</span>
                        </div>
                        <div className="faculty-directory-code num">{member.faculty_code}</div>
                        <div className="faculty-directory-votes">
                          <strong className="num">{formatNumber(member.vote_count)}</strong>
                          <span>votes</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="detail-empty">No faculty records are available for this school.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  if (loading) {
    return (
      <div className="admin-loading" role="status">
        <div className="admin-loading-box">
          <span className="spinner spinner-lg" aria-hidden="true" />
          <div>
            <strong>Preparing the election console</strong>
            <span>Verifying administrator access and loading live election data.</span>
          </div>
        </div>
      </div>
    )
  }

  if (accessError) {
    return (
      <div className="admin-error-screen">
        <div className="admin-error-box">
          <span className="admin-error-icon" aria-hidden="true"><ShieldWarning size={26} weight="duotone" /></span>
          <h2>Administrative access unavailable</h2>
          <p>{accessError}</p>
          <button type="button" className="admin-button primary" onClick={checkAdmin}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  const activeNav = NAV_ITEMS.find((item) => item.id === activeSection) || NAV_ITEMS[0]

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="brand-mark" aria-hidden="true">TD</span>
          <span className="brand-text">
            <strong>Teachers&rsquo; Day</strong>
            <span>Admin console</span>
          </span>
        </div>

        <nav className="admin-nav" aria-label="Administration">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-item${activeSection === id ? ' active' : ''}`}
              aria-current={activeSection === id ? 'page' : undefined}
              onClick={() => navigateTo(id)}
            >
              <Icon className="nav-icon" size={19} weight={activeSection === id ? 'fill' : 'regular'} aria-hidden="true" />
              <span>{label}</span>
              {id === 'reports' && reportsCount.new > 0 && (
                <span className="nav-count num" aria-label={`${reportsCount.new} new`}>{reportsCount.new}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="admin-profile">
            <span className="profile-avatar" aria-hidden="true">
              {adminEmail ? adminEmail.charAt(0).toUpperCase() : 'A'}
            </span>
            <span className="profile-details">
              <strong>Administrator</strong>
              <span title={adminEmail}>{adminEmail}</span>
            </span>
          </div>

          <button type="button" className="logout-button" onClick={handleLogout}>
            <SignOut size={18} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-context">
            <span className="breadcrumb">{activeNav.label}</span>
            <span className="admin-current-election-name">
              {activeElection?.title || 'No election selected'}
            </span>
          </div>

          <div className="topbar-right">
            <span className={`system-status is-${systemStatus}`}>
              <span className="status-dot" aria-hidden="true" />
              {systemStatus === 'online' ? 'Connected' : systemStatus === 'error' ? 'Connection issue' : 'Checking'}
            </span>
            <button
              type="button"
              className="topbar-refresh"
              onClick={() => refreshElectionContext(selectedElectionId)}
            >
              <ArrowClockwise size={16} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        <div className="admin-content" key={activeSection}>
          {activeSection === 'overview' && (
            <section>
              <div className="page-heading admin-page-heading">
                <div>
                  <h1>Election overview</h1>
                  <p>Participation, school schedules, faculty results and support issues in one place.</p>
                </div>

                <div className="election-selector-wrap">
                  <label htmlFor="admin-election-select">Election</label>
                  <select
                    id="admin-election-select"
                    className="admin-select"
                    value={selectedElectionId}
                    onChange={handleElectionChange}
                  >
                    <option value="">No election selected</option>
                    {elections.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title} ({item.status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {reportsCount.new > 0 && (
                <button type="button" className="attention-banner" onClick={() => navigateTo('reports')}>
                  <WarningCircle size={20} weight="fill" aria-hidden="true" />
                  <span>
                    <strong>{reportsCount.new} new problem {reportsCount.new === 1 ? 'report needs' : 'reports need'} attention</strong>
                    <span>Students are waiting on a response.</span>
                  </span>
                  <span className="attention-banner-cta">
                    Review
                    <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </span>
                </button>
              )}

              <div className="summary-strip">
                <div className="summary-cell summary-cell-election">
                  <span className="summary-label">Election status</span>
                  <span className={`election-state is-${activeElection?.status || 'none'}`}>
                    {activeElection?.status || 'None selected'}
                  </span>
                  <span className="summary-note">
                    {activeElection
                      ? `${formatDateTime(activeElection.start_date)} to ${formatDateTime(activeElection.end_date)}`
                      : 'Choose an election above'}
                  </span>
                </div>
                <div className="summary-cell">
                  <span className="summary-label">Eligible voters</span>
                  <strong className="summary-value num">{formatNumber(dashboardSummary.eligible)}</strong>
                  <span className="summary-note">Across participating schools</span>
                </div>
                <div className="summary-cell">
                  <span className="summary-label">Ballots completed</span>
                  <strong className="summary-value num">{formatNumber(dashboardSummary.votes)}</strong>
                  <span className="summary-note">{formatNumber(dashboardSummary.remaining)} still to vote</span>
                </div>
                <div className="summary-cell">
                  <span className="summary-label">Participation</span>
                  <strong className="summary-value num">{dashboardSummary.participation.toFixed(1)}%</strong>
                  <div className="meter-track" aria-hidden="true">
                    <div className="meter-fill" style={{ transform: `scaleX(${Math.min(100, dashboardSummary.participation) / 100})` }} />
                  </div>
                </div>
              </div>

              <section className="admin-section-block">
                <div className="admin-section-heading">
                  <div>
                    <h2>Progress by school</h2>
                    <p>Each school has its own voting window, turnout and current leaders.</p>
                  </div>
                  <ul className="school-status-summary" aria-label="Schools by status">
                    <li><span className="legend-swatch is-open" aria-hidden="true" /><span className="num">{dashboardSummary.open}</span> open</li>
                    <li><span className="legend-swatch is-upcoming" aria-hidden="true" /><span className="num">{dashboardSummary.upcoming}</span> upcoming</li>
                    <li><span className="legend-swatch is-completed" aria-hidden="true" /><span className="num">{dashboardSummary.completed}</span> completed</li>
                    <li><span className="legend-swatch is-neutral" aria-hidden="true" /><span className="num">{dashboardSummary.notConfigured}</span> not configured</li>
                  </ul>
                </div>

                {!activeElection ? (
                  <div className="admin-empty-state">
                    <span className="empty-state-icon" aria-hidden="true"><CalendarBlank size={22} weight="duotone" /></span>
                    <strong>No election selected</strong>
                    <span>Create or select an election to see school-by-school progress.</span>
                    <button type="button" className="admin-button primary" onClick={() => navigateTo('elections')}>Manage elections</button>
                  </div>
                ) : schoolProgress.length === 0 ? (
                  <div className="admin-empty-state">
                    <span className="empty-state-icon" aria-hidden="true"><Buildings size={22} weight="duotone" /></span>
                    <strong>No school progress yet</strong>
                    <span>School schedules or faculty records may not be configured.</span>
                    <button type="button" className="admin-button primary" onClick={() => navigateTo('elections')}>Configure schedules</button>
                  </div>
                ) : (
                  <div className="school-progress-grid">
                    {orderedSchools.map((school) => (
                      <SchoolCard
                        key={school.school_id}
                        school={school}
                        election={activeElection}
                        onOpen={setSelectedSchool}
                        onUploadLogo={handleUploadLogo}
                        onRemoveLogo={handleRemoveLogo}
                        uploadingSchoolId={uploadingSchoolId}
                      />
                    ))}
                  </div>
                )}
              </section>

              {renderSchoolDirectory()}
            </section>
          )}

          {activeSection === 'elections' && (
            <section>
              <div className="page-heading">
                <div>
                  <h1>Elections and schedules</h1>
                  <p>Set each election&rsquo;s overall period and give every school its voting window.</p>
                </div>
              </div>
              <div className="module-card"><AdminElectionManagement /></div>
            </section>
          )}

          {activeSection === 'faculty' && (
            <section>
              <div className="page-heading">
                <div>
                  <h1>Faculty registry</h1>
                  <p>Faculty records, school assignments, profile photos and current results.</p>
                </div>
              </div>

              <div className="management-grid">
                <div className={`management-card${showFacultyUpload ? ' is-open' : ''}`}>
                  <span className="management-icon" aria-hidden="true"><FileXls size={22} weight="duotone" /></span>
                  <div>
                    <h3>Import faculty records</h3>
                    <p>Upload faculty information with the approved Excel template.</p>
                  </div>
                  <button
                    type="button"
                    className="admin-button primary"
                    aria-expanded={showFacultyUpload}
                    onClick={() => setShowFacultyUpload((value) => !value)}
                  >
                    {showFacultyUpload ? 'Hide import' : 'Open import'}
                  </button>
                </div>

                <div className={`management-card${showFacultyPhotos ? ' is-open' : ''}`}>
                  <span className="management-icon" aria-hidden="true"><Images size={22} weight="duotone" /></span>
                  <div>
                    <h3>Faculty photos</h3>
                    <p>Upload images and match them to faculty codes.</p>
                  </div>
                  <button
                    type="button"
                    className="admin-button secondary"
                    aria-expanded={showFacultyPhotos}
                    onClick={() => setShowFacultyPhotos((value) => !value)}
                  >
                    {showFacultyPhotos ? 'Hide photos' : 'Manage photos'}
                  </button>
                </div>
              </div>

              {showFacultyUpload && <div className="module-card submodule"><AdminFacultyUpload /></div>}
              {showFacultyPhotos && <div className="module-card submodule"><AdminFacultyPhotos /></div>}

              {renderSchoolDirectory()}
            </section>
          )}

          {activeSection === 'results' && (
            <section>
              <div className="page-heading">
                <div>
                  <h1>Election results</h1>
                  <p>The official result of each award category, school by school.</p>
                </div>
              </div>
              <div className="module-card"><AdminResults /></div>
            </section>
          )}

          {activeSection === 'winners' && (
            <section>
              <div className="page-heading">
                <div>
                  <h1>School award overview</h1>
                  <p>Combined faculty selections across all award categories. For the official result of each category, use Election results.</p>
                </div>
                <div className="winner-election-context">
                  <span>Election</span>
                  <strong>{activeElection?.title || 'No election selected'}</strong>
                </div>
              </div>

              {orderedSchools.length === 0 ? (
                <div className="admin-empty-state">
                  <span className="empty-state-icon" aria-hidden="true"><Trophy size={22} weight="duotone" /></span>
                  <strong>No school data yet</strong>
                  <span>Select an election with configured schools on the overview.</span>
                </div>
              ) : (
                <div className="winner-grid">
                  {orderedSchools.map((school) => {
                    const winner = getWinnerInfo(school.faculty_results)
                    return (
                      <article className={`winner-card is-${winner.state}`} key={school.school_id}>
                        <div className="winner-card-school">
                          <SchoolMark school={school} className="winner-card-logo" />
                          <div>
                            <span className="school-card-code">{school.school_code}</span>
                            <strong>{school.school_name}</strong>
                          </div>
                        </div>

                        {winner.state === 'winner' ? (
                          <div className="winner-card-result">
                            <span className="winner-badge"><Trophy size={13} weight="fill" aria-hidden="true" /> Leading faculty</span>
                            <strong>{winner.faculty[0].faculty_name}</strong>
                            <span className="num">{formatNumber(winner.faculty[0].vote_count)} votes</span>
                          </div>
                        ) : winner.state === 'tie' ? (
                          <div className="winner-card-result">
                            <span className="tie-badge">Tie</span>
                            {winner.faculty.map((item) => (
                              <strong key={item.faculty_id}>
                                {item.faculty_name} <span className="num">({formatNumber(item.vote_count)})</span>
                              </strong>
                            ))}
                          </div>
                        ) : (
                          <div className="winner-card-result">
                            <span className="winner-card-muted">No selections yet</span>
                            <strong>No category votes recorded</strong>
                          </div>
                        )}

                        <button type="button" className="winner-card-button" onClick={() => setSelectedSchool(school)}>
                          School details
                          <ArrowRight size={15} weight="bold" aria-hidden="true" />
                        </button>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {activeSection === 'users' && (
            <section>
              <div className="page-heading">
                <div>
                  <h1>Students</h1>
                  <p>Control who can register, then approve, suspend or remove student accounts.</p>
                </div>
              </div>
              <AdminStudentIdUpload />
              <div className="module-card"><AdminUsers /></div>
            </section>
          )}

          {activeSection === 'reports' && (
            <section>
              <div className="page-heading">
                <div>
                  <h1>Problem reports</h1>
                  <p>Review student concerns, respond, and keep track of what still needs attention.</p>
                </div>
              </div>
              <div className="module-card"><AdminProblemReports /></div>
            </section>
          )}
        </div>
      </main>

      <SchoolDetailModal
        school={selectedSchool}
        election={activeElection}
        onClose={closeSchoolDetail}
        onUploadLogo={handleUploadLogo}
        onRemoveLogo={handleRemoveLogo}
        uploadingSchoolId={uploadingSchoolId}
      />
    </div>
  )
}

export default AdminDashboard