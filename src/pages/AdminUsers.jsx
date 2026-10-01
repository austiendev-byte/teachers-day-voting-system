import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { ArrowClockwise, CaretLeft, CaretRight, MagnifyingGlass, UsersThree } from '@phosphor-icons/react'
import './AdminUsers.css'

function formatVotedAt(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

// 'voted' once every active category for the student's school has a vote.
function ballotState(status) {
  if (!status || status.voted_categories === 0) return 'not_voted'
  if (status.active_categories > 0 && status.voted_categories >= status.active_categories) return 'voted'
  return 'partial'
}

// PostgREST returns at most 1,000 rows per request (Supabase's default
// max_rows), so admin lists are read in pages until one comes back empty.
const FETCH_PAGE_SIZE = 1000
const ROWS_PER_PAGE = 50
const LIVE_REFRESH_DELAY_MS = 3000

async function fetchAllRows(makeQuery) {
  const rows = []
  for (;;) {
    const { data, error } = await makeQuery().range(rows.length, rows.length + FETCH_PAGE_SIZE - 1)
    if (error) return { data: rows, error }
    if (!data || data.length === 0) return { data: rows, error: null }
    rows.push(...data)
  }
}

// Reloading every student on each vote would mean dozens of requests a
// second at peak, so live updates wait for a short quiet spell.
function debounce(fn, delay) {
  let timer
  const debounced = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(fn, delay)
  }
  debounced.cancel = () => window.clearTimeout(timer)
  return debounced
}

function AdminUsers({ electionId, electionTitle }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [users, setUsers] = useState([])
  const [voteStatus, setVoteStatus] = useState(new Map())
  const [schoolFilter, setSchoolFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [ballotFilter, setBallotFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState(null)
  const [page, setPage] = useState(1)

  const loadUsers = useCallback(async () => {
    const { data, error } = await fetchAllRows(() => supabase.rpc('admin_list_students'))
    if (error) {
      console.error('Admin users loading error:', error)
      toast.error(`Could not load student accounts.\n\n${error.message}`)
    } else {
      setUsers(data)
    }
    setLoading(false)
  }, [toast])

  const loadVoteStatus = useCallback(async () => {
    if (!electionId) {
      setVoteStatus(new Map())
      return
    }
    const { data, error } = await fetchAllRows(() => supabase.rpc('admin_student_vote_status', { p_election_id: Number(electionId) }))
    if (error) {
      console.error('Student vote status loading error:', error)
      return
    }
    setVoteStatus(new Map(data.map((row) => [Number(row.student_id), row])))
  }, [electionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers()
    const refresh = debounce(loadUsers, LIVE_REFRESH_DELAY_MS)
    const channel = supabase.channel('admin-student-management').on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, refresh).subscribe()
    return () => {
      refresh.cancel()
      supabase.removeChannel(channel)
    }
  }, [loadUsers])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadVoteStatus()
    if (!electionId) return undefined
    const refresh = debounce(loadVoteStatus, LIVE_REFRESH_DELAY_MS)
    const channel = supabase
      .channel('admin-student-vote-status')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'category_votes', filter: `election_id=eq.${electionId}` }, refresh)
      .subscribe()
    return () => {
      refresh.cancel()
      supabase.removeChannel(channel)
    }
  }, [electionId, loadVoteStatus])

  function refreshAll() {
    loadUsers()
    loadVoteStatus()
  }

  const schoolOptions = useMemo(() => [...new Map(users.map(u => [u.school_id, { id: u.school_id, code: u.school_code, name: u.school_name }]).filter(x => x[0] != null)).values()].sort((a,b) => String(a.code).localeCompare(String(b.code))), [users])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return users.filter(u =>
      (schoolFilter === 'ALL' || String(u.school_id) === schoolFilter) &&
      (statusFilter === 'ALL' || u.account_status === statusFilter) &&
      (ballotFilter === 'ALL' || ballotState(voteStatus.get(Number(u.id))) === ballotFilter) &&
      (!query || String(u.name || '').toLowerCase().includes(query) || String(u.student_id || '').toLowerCase().includes(query))
    )
  }, [users, voteStatus, schoolFilter, statusFilter, ballotFilter, search])

  const ballotSummary = useMemo(() => {
    const counts = { voted: 0, partial: 0, not_voted: 0 }
    users
      .filter(u => schoolFilter === 'ALL' || String(u.school_id) === schoolFilter)
      .forEach(u => { counts[ballotState(voteStatus.get(Number(u.id)))] += 1 })
    return counts
  }, [users, voteStatus, schoolFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * ROWS_PER_PAGE
  const visible = filtered.slice(pageStart, pageStart + ROWS_PER_PAGE)

  // Any filter change starts the list over at page 1.
  function filterSetter(setter) {
    return (event) => {
      setter(event.target.value)
      setPage(1)
    }
  }

  async function approve(user) {
    setWorkingId(user.id)
    const { error } = await supabase.rpc('admin_set_student_status', { p_student_id: Number(user.id), p_status: 'approved' })
    if (error) toast.error(error.message); else setUsers((current) => current.map((u) => (u.id === user.id ? { ...u, account_status: 'approved' } : u)))
    setWorkingId(null)
  }

  async function setPending(user) {
    setWorkingId(user.id)
    const { error } = await supabase.rpc('admin_set_student_status', { p_student_id: Number(user.id), p_status: 'pending' })
    if (error) toast.error(error.message); else setUsers((current) => current.map((u) => (u.id === user.id ? { ...u, account_status: 'pending' } : u)))
    setWorkingId(null)
  }

  async function remove(user) {
    const confirmed = await confirm({
      title: `Delete ${user.name || user.student_id}?`,
      message: 'This removes the student profile and their sign-in account. It cannot be undone.',
      confirmLabel: 'Delete account',
      danger: true
    })
    if (!confirmed) return
    setWorkingId(user.id)
    const { error } = await supabase.rpc('admin_delete_student', { p_student_id: Number(user.id) })
    if (error) toast.error(error.message); else setUsers((current) => current.filter((u) => u.id !== user.id))
    setWorkingId(null)
  }

  return (
    <section className="admin-users-panel">
      <div className="admin-users-toolbar">
        <div className="admin-users-filters">
          <label className="sr-only" htmlFor="admin-users-school">School</label>
          <select id="admin-users-school" className="admin-select" value={schoolFilter} onChange={filterSetter(setSchoolFilter)}>
            <option value="ALL">All schools</option>
            {schoolOptions.map((school) => <option key={school.id} value={school.id}>{school.code} · {school.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="admin-users-status">Status</label>
          <select id="admin-users-status" className="admin-select" value={statusFilter} onChange={filterSetter(setStatusFilter)}>
            <option value="ALL">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="suspended">Suspended</option>
          </select>
          {electionId && (
            <>
              <label className="sr-only" htmlFor="admin-users-ballot">Ballot</label>
              <select id="admin-users-ballot" className="admin-select" value={ballotFilter} onChange={filterSetter(setBallotFilter)}>
                <option value="ALL">Voted and not voted</option>
                <option value="voted">Voted</option>
                <option value="not_voted">Not voted</option>
                {ballotSummary.partial > 0 && <option value="partial">Partially voted</option>}
              </select>
            </>
          )}
          <div className="admin-users-search">
            <MagnifyingGlass size={15} aria-hidden="true" />
            <label className="sr-only" htmlFor="admin-users-search">Search students</label>
            <input
              id="admin-users-search"
              type="search"
              placeholder="Search name or student ID"
              value={search}
              onChange={filterSetter(setSearch)}
            />
          </div>
        </div>
        <div className="admin-users-toolbar-end">
          {!loading && (
            <span className="admin-users-count">
              <span className="num">{filtered.length.toLocaleString('en-US')}</span> of <span className="num">{users.length.toLocaleString('en-US')}</span> students
            </span>
          )}
          <button type="button" className="admin-button secondary" onClick={refreshAll}>
            <ArrowClockwise size={15} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {electionId ? (
        <div className="admin-users-ballot-summary">
          <span>Ballots for <strong>{electionTitle || 'the selected election'}</strong>{schoolFilter !== 'ALL' && ' in this school'}:</span>
          <span className="admin-user-ballot voted"><span className="num">{ballotSummary.voted}</span> voted</span>
          <span className="admin-user-ballot not_voted"><span className="num">{ballotSummary.not_voted}</span> not voted</span>
          {ballotSummary.partial > 0 && (
            <span className="admin-user-ballot partial"><span className="num">{ballotSummary.partial}</span> partial</span>
          )}
        </div>
      ) : (
        <p className="admin-users-ballot-summary">Select an election on the overview to see who has voted.</p>
      )}

      {loading ? (
        <div className="admin-users-skeleton" role="status" aria-label="Loading student accounts">
          {[0, 1, 2, 3].map((key) => <div key={key} className="skeleton" />)}
        </div>
      ) : (
        <div className="admin-users-table-wrap">
          <table className="admin-users-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>School</th>
                <th>Program</th>
                <th>Status</th>
                {electionId && <th>Ballot</th>}
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.name}</strong>
                    <span className="num">{user.student_id}</span>
                  </td>
                  <td className="num">{user.school_code || '-'}</td>
                  <td className="num">{user.program_code || '-'}</td>
                  <td><span className={`admin-user-status ${user.account_status}`}>{user.account_status}</span></td>
                  {electionId && (() => {
                    const status = voteStatus.get(Number(user.id))
                    const state = ballotState(status)
                    return (
                      <td>
                        <span className={`admin-user-ballot ${state}`}>
                          {state === 'voted' ? 'Voted' : state === 'partial' ? `${status.voted_categories} of ${status.active_categories}` : 'Not voted'}
                        </span>
                        {status?.last_voted_at && <span className="admin-user-voted-at">{formatVotedAt(status.last_voted_at)}</span>}
                      </td>
                    )
                  })()}
                  <td>
                    <div className="admin-user-actions">
                      {user.account_status !== 'approved' && (
                        <button type="button" className="admin-button primary" disabled={workingId === user.id} onClick={() => approve(user)}>Approve</button>
                      )}
                      {user.account_status === 'approved' && (
                        <button type="button" className="admin-button secondary" disabled={workingId === user.id} onClick={() => setPending(user)}>Suspend</button>
                      )}
                      <button type="button" className="admin-button danger" disabled={workingId === user.id} onClick={() => remove(user)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="admin-users-empty">
              <UsersThree size={24} weight="duotone" aria-hidden="true" />
              <strong>No matching students</strong>
              <span>No student accounts match the selected filters.</span>
            </div>
          )}
        </div>
      )}

      {!loading && pageCount > 1 && (
        <nav className="admin-users-pager" aria-label="Student list pages">
          <span>
            Showing <span className="num">{(pageStart + 1).toLocaleString('en-US')}</span>–<span className="num">{(pageStart + visible.length).toLocaleString('en-US')}</span> of <span className="num">{filtered.length.toLocaleString('en-US')}</span>
          </span>
          <div className="admin-users-pager-buttons">
            <button type="button" className="admin-button secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
              <CaretLeft size={14} aria-hidden="true" />
              Previous
            </button>
            <span className="num">Page {currentPage} of {pageCount}</span>
            <button type="button" className="admin-button secondary" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
              Next
              <CaretRight size={14} aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </section>
  )
}
export default AdminUsers
