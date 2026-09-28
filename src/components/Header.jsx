import { NavLink, useLocation } from 'react-router-dom'
import { ChatCircleDots, House, Tray } from '@phosphor-icons/react'
import BrandLogos from './BrandLogos'
import './Header.css'

const NAV = [
  { to: '/student', label: 'My ballot', icon: House, end: true },
  { to: '/report-problem', label: 'Report a problem', icon: ChatCircleDots },
  { to: '/my-reports', label: 'My reports', icon: Tray }
]

function Header({ settings }) {
  // The ballot is a focused task with its own back button and submit
  // dock, so the navigation steps aside while it is open.
  const { pathname } = useLocation()
  const focusMode = pathname === '/student/vote'

  const electionLine = [
    settings.election_title,
    settings.academic_year && `A.Y. ${settings.academic_year}`
  ].filter(Boolean).join(' · ')

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="site-header-identity">
          <BrandLogos settings={settings} size="sm" />

          <div className="site-header-text">
            <p className="site-header-university">
              {settings.university_name}
              {settings.organization_name && (
                <span className="site-header-org"> / {settings.organization_name}</span>
              )}
            </p>
            <p className="site-header-system">{settings.system_name}</p>
          </div>
        </div>

        {!focusMode && (<nav className="site-nav" aria-label="Student">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}
            >
              <Icon size={18} weight="duotone" aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>)}
      </div>

      {(electionLine || settings.header_description) && (
        <div className="site-header-band">
          <div className="site-header-band-inner">
            {electionLine && <span className="site-header-election">{electionLine}</span>}
            {settings.header_description && (
              <span className="site-header-desc">{settings.header_description}</span>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

export default Header
