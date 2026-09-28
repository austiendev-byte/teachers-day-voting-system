import { useState } from 'react'
import { CheckCircle, Eye, EyeSlash } from '@phosphor-icons/react'
import BrandLogos from './BrandLogos'
import './AuthLayout.css'

// Split layout shared by login, registration and password recovery.
// Left: the institution (logos, name, what this system promises).
// Right: the one task on this screen.
function AuthLayout({ tagline, points = [], title, subtitle, wide = false, children }) {
  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <div className="auth-brand-frame" aria-hidden="true" />

        <BrandLogos size="lg" className="auth-brand-logos" />

        <div className="auth-brand-copy">
          <p className="auth-brand-university">Biliran Province State University</p>
          <h1>Teachers&rsquo; Day Voting</h1>
          {tagline && <p className="auth-brand-tagline">{tagline}</p>}
        </div>

        {points.length > 0 && (
          <ul className="auth-brand-points">
            {points.map((point) => (
              <li key={point}>
                <CheckCircle size={20} weight="fill" aria-hidden="true" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="auth-form-col">
        <div className={`auth-panel${wide ? ' auth-panel-wide' : ''}`}>
          <header className="auth-panel-head">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </header>

          {children}
        </div>
      </main>
    </div>
  )
}

export function PasswordInput({ id, value, onChange, ...props }) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="input-affix">
      <input
        className="input"
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        {...props}
      />
      <button
        type="button"
        className="input-affix-button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        aria-controls={id}
      >
        {visible ? <EyeSlash size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}

export default AuthLayout
