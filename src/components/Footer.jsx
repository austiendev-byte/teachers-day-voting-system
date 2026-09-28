import { Link } from 'react-router-dom'
import { ArrowUpRight, ChatCircleDots } from '@phosphor-icons/react'
import './Footer.css'
import devAustienLogo from '../assets/branding/dev-austien-logo.png'

function Footer({ settings }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-dev">
          <img
            src={settings.developer_emblem_url || devAustienLogo}
            alt="Dev Austien"
            className="footer-emblem"
            loading="lazy"
            decoding="async"
            width="44"
            height="44"
          />

          <div>
            <p className="footer-label">Developed &amp; maintained by</p>
            <p className="footer-dev-name">Austien Agang</p>
          </div>
        </div>

        <div className="site-footer-support">
          <p className="footer-label">Need help with the system?</p>

          <div className="footer-actions">
            <Link to="/report-problem" className="btn btn-secondary btn-sm">
              <ChatCircleDots size={16} weight="duotone" aria-hidden="true" />
              Report a problem
            </Link>

            {settings.developer_facebook_url && (
              <a
                href={settings.developer_facebook_url}
                target="_blank"
                rel="noopener noreferrer"
                className="footer-secondary-link"
              >
                Facebook
                <ArrowUpRight size={13} weight="bold" aria-hidden="true" />
              </a>
            )}
          </div>

          {settings.support_instructions && (
            <p className="footer-support-note">{settings.support_instructions}</p>
          )}
        </div>
      </div>

      <p className="footer-copy">
        © {new Date().getFullYear()} {settings.university_name} · {settings.system_name}
      </p>
    </footer>
  )
}

export default Footer
