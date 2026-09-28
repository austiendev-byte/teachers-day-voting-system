import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EnvelopeSimpleOpen } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import AuthLayout from '../components/AuthLayout'

function ForgotPassword() {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (!email.trim()) return toast.error('Please enter your email address.')
    setSending(true)
    try {
      const redirectTo = `${window.location.origin}/reset-password`
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
      if (error) throw error
      setSent(true)
      toast.success('Password reset instructions have been sent to your email.')
    } catch (error) {
      toast.error(`Could not send password reset email.\n\n${error.message}`)
    } finally { setSending(false) }
  }

  return (
    <AuthLayout
      tagline="It happens. We'll help you get back into your account."
      title="Reset your password"
      subtitle="Enter the email address you registered with."
    >
      {sent ? (
        <div className="auth-form">
          <div className="auth-note" role="status">
            <EnvelopeSimpleOpen size={24} weight="duotone" aria-hidden="true" />
            <div>
              <strong>Check your inbox</strong>
              <p className="muted auth-note-text">
                We sent a reset link to {email.trim()}. It may take a minute to arrive.
              </p>
            </div>
          </div>
          <Link to="/login" className="btn btn-primary btn-block">Back to login</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label className="label" htmlFor="reset-email">Email</label>
            <input
              className="input"
              id="reset-email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="email"
              enterKeyHint="send"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="student@example.com"
              required
              disabled={sending}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={sending}>
            {sending && <span className="spinner" aria-hidden="true" />}
            {sending ? 'Sending link' : 'Send reset link'}
          </button>
          <Link to="/login" className="btn btn-ghost btn-block">Back to login</Link>
        </form>
      )}
    </AuthLayout>
  )
}
export default ForgotPassword
