import bipsuLogo from '../assets/branding/bipsu-logo.jpg'
import stcsSscLogo from '../assets/branding/stcs-ssc-logo.png'
import bipsuFsscLogo from '../assets/branding/bipsu-fssc-logo.jpg'

// The three official marks, in their fixed order. Uploaded logos from
// system_settings win; the bundled files are the fallback so a logo
// slot is never empty or broken.
function BrandLogos({ settings, className = '', size = 'md' }) {
  const logos = [
    { src: settings?.bipsu_logo_url || bipsuLogo, alt: 'BiPSU logo' },
    { src: settings?.stcs_ssc_logo_url || stcsSscLogo, alt: 'STCS-SSC logo' },
    { src: settings?.bipsu_fssc_logo_url || bipsuFsscLogo, alt: 'BiPSU-FSSC logo' }
  ]

  return (
    <div className={`brand-logos brand-logos-${size} ${className}`.trim()}>
      {logos.map((logo) => (
        <img
          key={logo.alt}
          src={logo.src}
          alt={logo.alt}
          className="brand-logo"
          decoding="async"
          width="48"
          height="48"
        />
      ))}
    </div>
  )
}

export default BrandLogos
