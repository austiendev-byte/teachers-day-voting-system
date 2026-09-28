import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LinkBreak } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import AuthLayout, { PasswordInput } from '../components/AuthLayout'

function ResetPassword() {
  const navigate = useNavigate()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => { if (mounted) setReady(Boolean(data.session)) })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (mounted && (event === 'PASSWORD_RECOVERY' || session)) setReady(true)
    })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    if (password.length < 6) return toast.error('Password must be at least 6 characters long.')
    if (password !== confirmPassword) return toast.error('Passwords do not match.')
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      toast.success('Password updated. Please log in again.')
      await supabase.auth.signOut()
      navigate('/login', { replace: true })
    } catch (error) {
      toast.error(`Could not update your password.\n\n${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword

  return (
    <AuthLayout
      tagline="Choose a new password to secure your account."
      title="Set a new password"
      subtitle={ready ? 'Use at least 6 characters.' : undefined}
    >
      {!ready ? (
        <div className="auth-form">
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true"><LinkBreak size={22} weight="duotone" /></span>
            <strong>Open the link from your email</strong>
            <span>This page only works from the password reset link we sent you.</span>
          </div>
          <Link to="/forgot-password" className="btn btn-secondary btn-block">Send a new link</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label className="label" htmlFor="new-password">New password</label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
              disabled={saving}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="confirm-new-password">Confirm password</label>
            <PasswordInput
              id="confirm-new-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={6}
              disabled={saving}
              aria-invalid={mismatch}
            />
            {mismatch && <p className="field-error" role="alert">Passwords do not match yet.</p>}
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
            {saving && <span className="spinner" aria-hidden="true" />}
            {saving ? 'Saving' : 'Update password'}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
export default ResetPassword
