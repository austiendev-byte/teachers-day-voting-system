import React, {
  lazy,
  Suspense
} from 'react'

import {
  BrowserRouter,
  Routes,
  Route,
  Navigate
} from 'react-router-dom'

import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import LoadingScreen from './components/LoadingScreen'

// Route-level code splitting. Without this, every static import above was
// bundled together, so a student loading /login or /student downloaded
// the entire admin panel too -- including AdminFacultyUpload's xlsx
// dependency (~1MB) that only an admin doing a roster import ever needs.
// Each lazy() call becomes its own chunk, fetched only when that route is
// actually visited.
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const ElectionStatus = lazy(() => import('./pages/student/ElectionStatus'))
const Ballot = lazy(() => import('./pages/student/Ballot'))
const ThankYou = lazy(() => import('./pages/student/ThankYou'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const ReportProblem = lazy(() => import('./pages/ReportProblem'))
const MyReports = lazy(() => import('./pages/MyReport'))

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Application render error:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="app-crash">
        <div className="app-crash-card" role="alert">
          <h1>The application could not load</h1>
          <p>Please refresh the page. If the problem continues, check the browser console for the exact error.</p>
          <pre>{String(this.state.error?.message || this.state.error)}</pre>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}

function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <div className="app-shell">
        <Layout>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>

            {/* LOGIN */}
            <Route
              path="/login"
              element={<Login />}
            />

            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* STUDENT REGISTRATION */}
            <Route
              path="/register"
              element={<Register />}
            />

            {/* STUDENT: ELECTION STATUS (landing page after login) */}
            <Route
              path="/student"
              element={
                <ProtectedRoute allowedRole="student">
                  <ElectionStatus />
                </ProtectedRoute>
              }
            />

            {/* STUDENT: BALLOT (voting page only) */}
            <Route
              path="/student/vote"
              element={
                <ProtectedRoute allowedRole="student">
                  <Ballot />
                </ProtectedRoute>
              }
            />

            {/* STUDENT: THANK YOU */}
            <Route
              path="/student/thank-you"
              element={
                <ProtectedRoute allowedRole="student">
                  <ThankYou />
                </ProtectedRoute>
              }
            />

            {/* STUDENT SUPPORT */}
            <Route
              path="/report-problem"
              element={
                <ProtectedRoute allowedRole="student">
                  <ReportProblem />
                </ProtectedRoute>
              }
            />

            <Route
              path="/my-reports"
              element={
                <ProtectedRoute allowedRole="student">
                  <MyReports />
                </ProtectedRoute>
              }
            />

            {/* ADMIN DASHBOARD */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRole="admin">
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />

            {/* DEFAULT ROUTE */}
            <Route
              path="*"
              element={
                <Navigate
                  to="/login"
                  replace
                />
              }
            />

            </Routes>
          </Suspense>
        </Layout>
        </div>
      </BrowserRouter>
    </AppErrorBoundary>
  )
}

export default App