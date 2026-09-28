import { useLocation } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'
import { useSystemSettings } from '../hooks/useSystemSettings'


function SiteChrome({ children }) {
  const { settings } = useSystemSettings()

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Header settings={settings} />
      <main id="main" className="site-main">{children}</main>
      <Footer settings={settings} />
    </>
  )
}

function Layout({ children }) {
  const location = useLocation()
  const path = location.pathname

  const isAdminRoute = path.startsWith('/admin')
  const isAuthRoute = [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password'
  ].includes(path)

  // Authentication pages are completely independent from the shared site
  // chrome and the system_settings query. This prevents a header/footer,
  // optional branding row, or settings request from affecting login.
  if (isAuthRoute || isAdminRoute) {
    return children
  }

  return <SiteChrome>{children}</SiteChrome>
}

export default Layout
