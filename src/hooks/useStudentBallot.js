import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

// ==========================================
// OVERALL ELECTION STATE
// ==========================================

function getElectionState(electionData, now) {
  if (!electionData) return 'closed'

  const startTime = new Date(electionData.start_date)
  const endTime = new Date(electionData.end_date)

  if (electionData.status === 'closed') {
    return 'closed'
  }

  if (now < startTime) {
    return 'not_started'
  }

  if (now > endTime) {
    return 'closed'
  }

  if (electionData.status === 'open') {
    return 'open'
  }

  // Inside the election period but never opened by the organizers.
  // Voting starts automatically only for elections opened in advance.
  return 'awaiting_open'
}

// ==========================================
// STUDENT SCHOOL VOTING STATE
// ==========================================

function getStudentVotingState(electionData, scheduleData, now) {
  if (!electionData) return 'election_closed'

  const overallState = getElectionState(electionData, now)

  if (overallState === 'not_started') {
    return 'election_not_started'
  }

  if (overallState === 'awaiting_open') {
    return 'election_awaiting_open'
  }

  if (overallState === 'closed') {
    return 'election_closed'
  }

  if (!scheduleData) {
    return 'schedule_not_configured'
  }

  const electionStart = new Date(electionData.start_date)
  const electionEnd = new Date(electionData.end_date)
  const scheduleStart = new Date(scheduleData.start_date ?? scheduleData.schedule_start)
  const scheduleEnd = new Date(scheduleData.end_date ?? scheduleData.schedule_end)

  if (Number.isNaN(scheduleStart.getTime()) || Number.isNaN(scheduleEnd.getTime())) {
    return 'schedule_not_configured'
  }

  const effectiveStart = new Date(Math.max(electionStart.getTime(), scheduleStart.getTime()))
  const effectiveEnd = new Date(Math.min(electionEnd.getTime(), scheduleEnd.getTime()))

  if (effectiveEnd <= effectiveStart) {
    return 'schedule_not_configured'
  }

  if (now < effectiveStart) {
    return 'school_not_started'
  }

  if (now > effectiveEnd) {
    return 'school_closed'
  }

  return 'school_open'
}

export const STATE_COPY = {
  election_not_started: {
    title: 'Election has not started',
    message: 'The university election period has not started yet.',
    tone: 'info'
  },
  election_awaiting_open: {
    title: 'Voting has not been opened yet',
    message: 'The election period has started, but the organizers have not opened voting yet. Please check back shortly.',
    tone: 'info'
  },
  school_not_started: {
    title: 'Your school voting window is upcoming',
    message: 'Voting will become available when your school schedule begins.',
    tone: 'warning'
  },
  school_open: {
    title: 'Voting is open for your school',
    message: 'You may now complete the nine-category official ballot and submit it once.',
    tone: 'success'
  },
  school_closed: {
    title: 'Your school voting window has ended',
    message: 'Your school-specific voting period is no longer available.',
    tone: 'closed'
  },
  election_closed: {
    title: 'Election period has ended',
    message: 'The overall Teachers\u2019 Day election period is now closed.',
    tone: 'closed'
  },
  schedule_not_configured: {
    title: 'Voting schedule not configured',
    message: 'Your school voting schedule has not been configured yet.',
    tone: 'neutral'
  }
}

export default function useStudentBallot() {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()

  const [student, setStudent] = useState(null)
  const [accountStatus, setAccountStatus] = useState('approved')

  const [election, setElection] = useState(null)
  const [schoolSchedule, setSchoolSchedule] = useState(null)
  const [scheduleError, setScheduleError] = useState('')
  const [faculty, setFaculty] = useState([])
  const [ballotSelections, setBallotSelections] = useState({})
  const [awardCategories, setAwardCategories] = useState([])
  const [categoryVoteStatus, setCategoryVoteStatus] = useState({})

  const [loading, setLoading] = useState(true)
  const [loadingFaculty, setLoadingFaculty] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState('')

  const [stateNow, setStateNow] = useState(() => new Date())

  // The in-flight election refresh promise, or null.
  const refreshingElectionRef = useRef(null)
  const lastElectionStateRef = useRef('')
  const loadedOpenElectionRef = useRef(null)
  const lastVotingStateRef = useRef('')
  const lastScheduleKeyRef = useRef('')
  // The election last applied to state. The focus/online listeners are
  // registered once per student and keep the refreshElection closure from
  // that render, so comparing against the `election` state variable there
  // always saw null and wiped the ballot on every tab switch.
  const electionRef = useRef(null)

  // ==========================================
  // INITIAL LOAD
  // ==========================================

  useEffect(() => {
    loadStudentData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ==========================================
  // ELECTION + SCHEDULE REFRESH (NO REALTIME)
  // ==========================================
  useEffect(() => {
    if (!student) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setStateNow(new Date())
        refreshElection(student)
      }
    }

    const handleOnline = () => {
      setStateNow(new Date())
      refreshElection(student)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id])

  // ==========================================
  // SCHEDULED VOTING-STATE UPDATE (no per-second re-render)
  // ==========================================
  useEffect(() => {
    const boundaryDates = [
      election?.start_date,
      election?.end_date,
      schoolSchedule?.start_date,
      schoolSchedule?.end_date
    ]
      .map((value) => new Date(value || '').getTime())
      .filter((value) => Number.isFinite(value) && value > Date.now())

    if (boundaryDates.length === 0) {
      return undefined
    }

    const nextBoundary = Math.min(...boundaryDates)
    // Browsers run any setTimeout longer than 2^31-1 ms (~24.8 days)
    // immediately, which turned a far-off boundary into a tight
    // re-render loop. Cap the wait; when the cap fires, this effect
    // reschedules toward the real boundary.
    const MAX_TIMER_DELAY = 60 * 60 * 1000
    const delay = Math.min(
      MAX_TIMER_DELAY,
      Math.max(50, nextBoundary - Date.now() + 50)
    )

    const timer = window.setTimeout(() => {
      setStateNow(new Date())
    }, delay)

    return () => window.clearTimeout(timer)
  }, [stateNow, election?.start_date, election?.end_date, schoolSchedule?.start_date, schoolSchedule?.end_date])

  // ==========================================
  // WATCH VOTING STATE
  // ==========================================
  useEffect(() => {
    if (!student || !election || accountStatus !== 'approved') return

    const state = getStudentVotingState(election, schoolSchedule, stateNow)

    const stateKey = [election.id, schoolSchedule?.id || 'none', election.status, state].join('-')

    if (lastElectionStateRef.current === stateKey) {
      return
    }

    lastElectionStateRef.current = stateKey

    if (state === 'school_open') {
      if (loadedOpenElectionRef.current !== election.id) {
        loadedOpenElectionRef.current = election.id
        loadOpenElectionData(student, election)
      }
      return
    }

    loadedOpenElectionRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stateNow,
    election?.id,
    election?.status,
    election?.start_date,
    election?.end_date,
    schoolSchedule?.id,
    schoolSchedule?.start_date,
    schoolSchedule?.end_date,
    student?.id,
    accountStatus
  ])

  // ==========================================
  // LOAD STUDENT DATA
  // ==========================================

  async function loadStudentData() {
    setLoading(true)
    setLoadError('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        console.error('Error getting auth user:', userError)
        toast.error('Your session could not be identified. Please log in again.')
        navigate('/login', { replace: true })
        return
      }

      const { data: studentData, error: studentError } = await supabase
        .from('students')
        .select(`
          id,
          student_id,
          name,
          account_status,
          program_id,
          programs (
            id,
            program_code,
            program_name,
            school_id,
            schools (
              id,
              school_code,
              school_name
            )
          )
        `)
        .eq('auth_user_id', user.id)
        .maybeSingle()

      if (studentError) {
        console.error('Error getting student:', studentError)
        setLoadError(`Could not load your student profile.\n\n${studentError.message}`)
        return
      }

      if (!studentData) {
        toast.error('Student profile not found. Please contact the administrator.')
        await supabase.auth.signOut({ scope: 'local' })
        sessionStorage.removeItem('userRole')
        navigate('/login', { replace: true })
        return
      }

      setStudent(studentData)
      setAccountStatus(studentData.account_status || 'approved')
      await refreshElection(studentData)
    } catch (error) {
      console.error('Unexpected student loading error:', error)
      setLoadError(`An unexpected error occurred.\n\n${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ==========================================
  // LOAD SCHOOL SCHEDULE
  // ==========================================

  async function loadSchoolSchedule(electionId) {
    if (!electionId) {
      setSchoolSchedule(null)
      return null
    }

    setScheduleError('')

    const { data, error } = await supabase.rpc('get_my_school_election_schedule', {
      p_election_id: Number(electionId)
    })

    if (error) {
      console.error('Error loading school schedule:', error)
      setScheduleError('We could not load your school voting schedule right now.')
      setSchoolSchedule(null)
      return null
    }

    const rawSchedule = (data || [])[0] || null

    const matchingSchedule = rawSchedule
      ? {
          ...rawSchedule,
          id: rawSchedule.id ?? rawSchedule.schedule_id,
          election_id: rawSchedule.election_id ?? electionId,
          start_date: rawSchedule.start_date ?? rawSchedule.schedule_start,
          end_date: rawSchedule.end_date ?? rawSchedule.schedule_end
        }
      : null

    const scheduleKey = matchingSchedule
      ? [matchingSchedule.id || 'none', matchingSchedule.start_date || '', matchingSchedule.end_date || ''].join('|')
      : 'none'

    if (lastScheduleKeyRef.current !== scheduleKey) {
      lastScheduleKeyRef.current = scheduleKey
      setSchoolSchedule(matchingSchedule)
    }

    return matchingSchedule
  }

  // ==========================================
  // REFRESH ELECTION
  // ==========================================

  // Overlapping callers (StrictMode's double mount, a focus refresh
  // during the initial load) share the refresh already in flight.
  // Returning early instead let the initial load finish with no
  // election, which read as "election closed" and bounced the ballot
  // page back to the status page.
  function refreshElection(studentData) {
    if (!studentData) {
      return Promise.resolve(null)
    }

    if (!refreshingElectionRef.current) {
      refreshingElectionRef.current = runElectionRefresh(studentData)
    }

    return refreshingElectionRef.current
  }

  async function runElectionRefresh(studentData) {
    try {
      const { data, error } = await supabase.rpc('get_student_elections')

      if (error) {
        console.error('Error getting elections:', error)
        return null
      }

      const elections = data || []
      const now = new Date()
      setStateNow(now)

      const currentOpenElection = elections.find((item) => {
        if (item.status !== 'open') return false
        const start = new Date(item.start_date)
        const end = new Date(item.end_date)
        return now >= start && now <= end
      })

      const upcomingElection = elections
        .filter((item) => {
          const start = new Date(item.start_date)
          return start > now && (item.status === 'draft' || item.status === 'open')
        })
        .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))[0]

      const fallbackElection = elections.slice().sort((a, b) => new Date(b.start_date) - new Date(a.start_date))[0]

      const selectedElection = currentOpenElection || upcomingElection || fallbackElection || null

      if (!selectedElection) {
        electionRef.current = null
        setElection(null)
        setSchoolSchedule(null)
        setScheduleError('')
        setFaculty([])
        setAwardCategories([])
        setBallotSelections({})
        setCategoryVoteStatus({})
        lastElectionStateRef.current = ''
        loadedOpenElectionRef.current = null
        return null
      }

      const matchingSchedule = await loadSchoolSchedule(selectedElection.id)

      // Only a different election invalidates the ballot. Status and date
      // changes are handled by the voting-state logic below.
      const electionChanged = electionRef.current?.id !== selectedElection.id
      electionRef.current = selectedElection

      setElection((previousElection) => {
        if (
          previousElection &&
          previousElection.id === selectedElection.id &&
          previousElection.title === selectedElection.title &&
          previousElection.status === selectedElection.status &&
          previousElection.start_date === selectedElection.start_date &&
          previousElection.end_date === selectedElection.end_date
        ) {
          return previousElection
        }
        return selectedElection
      })

      if (electionChanged) {
        setBallotSelections({})
        setFaculty([])
        setAwardCategories([])
        setCategoryVoteStatus({})
        lastElectionStateRef.current = ''
        loadedOpenElectionRef.current = null
      }

      const state = getStudentVotingState(selectedElection, matchingSchedule, now)

      const previousVotingState = lastVotingStateRef.current
      lastVotingStateRef.current = state

      if (state === 'school_open') {
        if (loadedOpenElectionRef.current !== selectedElection.id) {
          loadedOpenElectionRef.current = selectedElection.id
          await loadOpenElectionData(studentData, selectedElection)
        }
      } else {
        loadedOpenElectionRef.current = null

        if (previousVotingState === 'school_open') {
          setFaculty([])
          setBallotSelections({})
        }

        if (
          state === 'election_not_started' ||
          state === 'schedule_not_configured' ||
          state === 'election_closed' ||
          state === 'school_closed'
        ) {
          setAwardCategories([])
          setBallotSelections({})
          setCategoryVoteStatus({})
        }
      }

      return { election: selectedElection, schedule: matchingSchedule, state }
    } catch (error) {
      console.error('Election refresh error:', error)
      return null
    } finally {
      refreshingElectionRef.current = null
    }
  }

  // ==========================================
  // LOAD OPEN-ELECTION DATA
  // ==========================================

  async function loadOpenElectionData(studentData, electionData) {
    if (!studentData || !electionData) return

    try {
      await Promise.all([loadFaculty(studentData), loadAwardCategories(electionData.id)])
    } catch (error) {
      console.error('Error loading open election data:', error)
    }
  }

  // ==========================================
  // LOAD AWARD CATEGORIES + VOTE STATUS
  // ==========================================

  async function loadAwardCategories(electionId) {
    const { data, error } = await supabase.rpc('get_student_category_statuses', {
      p_election_id: Number(electionId)
    })

    if (error) {
      console.error('Error getting award categories:', error)
      toast.error('We could not load the award categories right now.')
      setAwardCategories([])
      setBallotSelections({})
      setCategoryVoteStatus({})
      return
    }

    const nextCategories = Array.isArray(data) ? data : []
    const nextStatus = Object.fromEntries(
      nextCategories.map((category) => [String(category.category_id), Boolean(category.has_voted)])
    )

    setAwardCategories(nextCategories)
    setCategoryVoteStatus(nextStatus)
  }

  // ==========================================
  // LOAD FACULTY
  // ==========================================

  async function loadFaculty(studentData) {
    if (!studentData?.programs?.school_id) {
      return
    }

    setLoadingFaculty(true)

    try {
      const schoolId = studentData.programs.school_id

      const { data, error } = await supabase
        .from('faculty')
        .select(`
          id,
          faculty_code,
          name,
          programs (
            program_code,
            program_name
          )
        `)
        .eq('school_id', schoolId)
        .order('name', { ascending: true })

      if (error) {
        console.error('Error getting faculty:', error)
        toast.error(`Could not load faculty.\n\n${error.message}`)
        return
      }

      setFaculty(data || [])
    } finally {
      setLoadingFaculty(false)
    }
  }

  // ==========================================
  // DERIVED STATE
  // ==========================================

  const effectiveSchoolWindow = useMemo(() => {
    if (!election || !schoolSchedule) return null

    const electionStart = new Date(election.start_date)
    const electionEnd = new Date(election.end_date)
    const scheduleStart = new Date(schoolSchedule.start_date ?? schoolSchedule.schedule_start)
    const scheduleEnd = new Date(schoolSchedule.end_date ?? schoolSchedule.schedule_end)

    if (Number.isNaN(scheduleStart.getTime()) || Number.isNaN(scheduleEnd.getTime())) {
      return null
    }

    const start = new Date(Math.max(electionStart.getTime(), scheduleStart.getTime()))
    const end = new Date(Math.min(electionEnd.getTime(), scheduleEnd.getTime()))

    if (end <= start) return null

    return { start, end }
  }, [election, schoolSchedule])

  const votingState = getStudentVotingState(election, schoolSchedule, stateNow)
  const overallElectionState = getElectionState(election, stateNow)
  const currentStateCopy = STATE_COPY[votingState] || STATE_COPY.election_closed

  const votedCategoryCount = awardCategories.reduce(
    (count, category) => count + (categoryVoteStatus[String(category.category_id)] ? 1 : 0),
    0
  )

  const pendingCategories = awardCategories.filter(
    (category) => !categoryVoteStatus[String(category.category_id)]
  )

  const allCategoriesVoted = awardCategories.length > 0 && pendingCategories.length === 0

  const missingBallotSelections = pendingCategories.filter(
    (category) => !ballotSelections[String(category.category_id)]
  )

  // ==========================================
  // BALLOT ACTIONS
  // ==========================================

  function handleBallotSelection(categoryId, facultyId) {
    setBallotSelections((previous) => ({
      ...previous,
      [String(categoryId)]: facultyId
    }))
  }

  async function handleBallotSubmit() {
    if (!election) {
      toast.error('There is no active election.')
      return { ok: false }
    }

    const fresh = await refreshElection(student)
    const electionForCheck = fresh?.election || election
    const scheduleForCheck = fresh ? fresh.schedule : schoolSchedule

    const currentState = getStudentVotingState(electionForCheck, scheduleForCheck, new Date())

    if (currentState !== 'school_open') {
      toast.error('Voting is not currently open for your school.')
      return { ok: false }
    }

    if (awardCategories.length !== 9) {
      toast.error('The official ballot is not fully configured yet. Please try again shortly.')
      return { ok: false }
    }

    if (missingBallotSelections.length > 0) {
      const firstMissing = missingBallotSelections[0]
      toast.error(`Please select a faculty member for ${firstMissing.category_name}.`)
      return { ok: false, firstMissingId: firstMissing.category_id }
    }

    const ballot = pendingCategories.map((category) => ({
      category_id: Number(category.category_id),
      faculty_id: Number(ballotSelections[String(category.category_id)])
    }))

    const summary = ballot
      .map((item) => {
        const category = awardCategories.find((c) => Number(c.category_id) === item.category_id)
        const member = faculty.find((f) => Number(f.id) === item.faculty_id)
        return `${category?.display_order || ''}. ${category?.category_name || 'Award'} \u2014 ${member?.name || 'Selected faculty'}`
      })
      .join('\n')

    const confirmed = await confirm({
      title: 'Review and submit your official ballot',
      message:
        `${summary}\n\n` +
        'This will submit your remaining selections as one official ballot. ' +
        'After submission, these selections cannot be changed.',
      confirmLabel: 'Submit Official Ballot'
    })

    if (!confirmed) return { ok: false }

    setSubmitting(true)

    try {
      const { error } = await supabase.rpc('submit_full_ballot', {
        p_election_id: Number(electionForCheck.id),
        p_votes: ballot
      })

      if (error) {
        console.error('Ballot submission error:', error)
        toast.error(error.message || 'We could not record your ballot. Please try again.')
        return { ok: false }
      }

      const completedStatus = Object.fromEntries(
        awardCategories.map((category) => [String(category.category_id), true])
      )

      setCategoryVoteStatus(completedStatus)
      setBallotSelections({})

      return { ok: true }
    } catch (error) {
      console.error('Unexpected ballot submission error:', error)
      toast.error('Something went wrong while recording your ballot. Please try again.')
      return { ok: false }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    const confirmed = await confirm({
      title: 'Log out',
      message: 'Are you sure you want to log out?',
      confirmLabel: 'Logout'
    })

    if (!confirmed) return

    await supabase.auth.signOut({ scope: 'local' })
    sessionStorage.removeItem('userRole')
    navigate('/login', { replace: true })
  }

  const school = student?.programs?.schools

  return {
    student,
    accountStatus,
    school,
    schoolName: school?.school_name || 'Your School',
    schoolCode: school?.school_code || '',
    election,
    schoolSchedule,
    scheduleError,
    faculty,
    loadingFaculty,
    awardCategories,
    categoryVoteStatus,
    ballotSelections,
    loading,
    submitting,
    loadError,
    stateNow,
    votingState,
    overallElectionState,
    currentStateCopy,
    effectiveSchoolWindow,
    votedCategoryCount,
    pendingCategories,
    allCategoriesVoted,
    missingBallotSelections,
    handleBallotSelection,
    handleBallotSubmit,
    handleLogout,
    reload: loadStudentData
  }
}
