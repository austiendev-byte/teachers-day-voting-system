import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import AuthLayout, { PasswordInput } from '../components/AuthLayout'

function Login() {
  const navigate = useNavigate()
  const toast = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  async function handleLogin(event) {
    event.preventDefault()

    if (!email.trim()) {
      toast.error('Please enter your email.')
      return
    }

    if (!password) {
      toast.error('Please enter your password.')
      return
    }

    setLoggingIn(true)

    // Drop any role hint left by a previous user in this tab so it can
    // never outlive a failed role check for the new account.
    sessionStorage.removeItem('userRole')

    try {
      const { data, error } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password
        })

      if (error) {
        console.error('Login error:', error)
        toast.error(`Login failed.\n\n${error.message}`)
        return
      }

      if (!data.user) {
        toast.error('Login failed. No user account was returned.')
        return
      }

      // Check whether the account is an administrator
      const { data: isAdmin, error: adminError } =
        await supabase.rpc('is_admin')

      if (adminError) {
        console.error(
          'Admin check error:',
          adminError
        )

        toast.error(
          'Login successful, but the system could not determine your account role.'
        )

        await supabase.auth.signOut({ scope: 'local' })
        return
      }

      if (isAdmin) {
        sessionStorage.setItem('userRole', 'admin')
        navigate('/admin', { replace: true })
      } else {
        sessionStorage.setItem('userRole', 'student')
        navigate('/student', { replace: true })
      }
    } catch (error) {
      console.error('Unexpected login error:', error)
      toast.error(
        `An unexpected error occurred during login.\n\n${error.message}`
      )
    } finally {
      setLoggingIn(false)
    }
  }

  return (
    <AuthLayout
      tagline="Log in to cast your ballot and honor the educators who shape your school."
      points={[
        'Secure, one-ballot-per-student process',
        'Live results, broken down by school',
        'Track the problem reports you submit'
      ]}
      title="Welcome back"
      subtitle="Log in with your student or administrator account."
    >
      <form onSubmit={handleLogin} className="auth-form" noValidate>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input
            className="input"
            id="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="student@example.com"
            required
            disabled={loggingIn}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="password">Password</label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={loggingIn}
          />
        </div>

        <div className="auth-row-end">
          <Link to="/forgot-password" className="btn btn-link btn-sm">
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={loggingIn}
        >
          {loggingIn && <span className="spinner" aria-hidden="true" />}
          {loggingIn ? 'Logging in' : 'Log in'}
        </button>
      </form>

      <div className="auth-divider">New to the system?</div>

      <Link to="/register" className="btn btn-secondary btn-block">
        Create a student account
      </Link>
    </AuthLayout>
  )
}

export default Login
