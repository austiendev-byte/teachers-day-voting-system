import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'

function ProtectedRoute({ children, allowedRole }) {
  const toast = useToast()
  const role = sessionStorage.getItem('userRole')
  const [sessionEnded, setSessionEnded] = useState(false)

  // The sessionStorage flag above is just a fast, synchronous hint so the
  // right page renders immediately. The real authority is the Supabase
  // session itself. If it ends while this page is open -- the refresh
  // token expires, or the account is signed out elsewhere -- every
  // request on the page would otherwise start failing silently (a vote
  // submission, a data load) with no explanation to the student. This
  // catches that and sends them back to login with a clear reason
  // instead of a dashboard that quietly stops working.
  useEffect(() => {
    if (!role) return undefined

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        sessionStorage.removeItem('userRole')
        toast.error('Your session has ended. Please log in again.')
        setSessionEnded(true)
      }
    })

    return () => {
      listener.subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  if (!role || sessionEnded) {
    return (
      <Navigate
        to="/login"
        replace
      />
    )
  }

  if (
    allowedRole &&
    role !== allowedRole
  ) {
    return (
      <Navigate
        to="/login"
        replace
      />
    )
  }

  return children
}

export default ProtectedRoute