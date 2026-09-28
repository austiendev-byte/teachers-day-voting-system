import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { ArrowClockwise, UsersThree } from '@phosphor-icons/react'
import './AdminUsers.css'

function AdminUsers() {
  const toast = useToast()
  const confirm = useConfirm()
  const [users, setUsers] = useState([])
  const [schoolFilter, setSchoolFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState(null)

  async function loadUsers() {
    setLoading(true)
    const { data, error } = await supabase.rpc('admin_list_students')
    if (error) {
      console.error('Admin users loading error:', error)
      setUsers([])
    } else {
      setUsers(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadUsers()
    const channel = supabase.channel('admin-student-management').on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, loadUsers).subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const schoolOptions = useMemo(() => [...new Map(users.map(u => [u.school_id, { id: u.school_id, code: u.school_code, name: u.school_name }]).filter(x => x[0] != null)).values()].sort((a,b) => String(a.code).localeCompare(String(b.code))), [users])
  const filtered = useMemo(() => users.filter(u => (schoolFilter === 'ALL' || String(u.school_id) === schoolFilter) && (statusFilter === 'ALL' || u.account_status === statusFilter)), [users, schoolFilter, statusFilter])

  async function approve(user) {
    setWorkingId(user.id)
    const { error } = await supabase.rpc('admin_set_student_status', { p_student_id: Number(user.id), p_status: 'approved' })
    if (error) toast.error(error.message); else await loadUsers()
    setWorkingId(null)
  }

  async function setPending(user) {
    setWorkingId(user.id)
    const { error } = await supabase.rpc('admin_set_student_status', { p_student_id: Number(user.id), p_status: 'pending' })
    if (error) toast.error(error.message); else await loadUsers()
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
    if (error) toast.error(error.message); else await loadUsers()
    setWorkingId(null)
  }

  return (
    <section className="admin-users-panel">
      <div className="admin-users-toolbar">
        <div className="admin-users-filters">
          <label className="sr-only" htmlFor="admin-users-school">School</label>
          <select id="admin-users-school" className="admin-select" value={schoolFilter} onChange={(event) => setSchoolFilter(event.target.value)}>
            <option value="ALL">All schools</option>
            {schoolOptions.map((school) => <option key={school.id} value={school.id}>{school.code} · {school.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="admin-users-status">Status</label>
          <select id="admin-users-status" className="admin-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <div className="admin-users-toolbar-end">
          {!loading && (
            <span className="admin-users-count">
              <span className="num">{filtered.length}</span> of <span className="num">{users.length}</span> students
            </span>
          )}
          <button type="button" className="admin-button secondary" onClick={loadUsers}>
            <ArrowClockwise size={15} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

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
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.name}</strong>
                    <span className="num">{user.student_id}</span>
                  </td>
                  <td className="num">{user.school_code || '-'}</td>
                  <td className="num">{user.program_code || '-'}</td>
                  <td><span className={`admin-user-status ${user.account_status}`}>{user.account_status}</span></td>
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
    </section>
  )
}
export default AdminUsers
