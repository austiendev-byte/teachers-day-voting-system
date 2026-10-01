import bipsuLogo from '../assets/branding/bipsu-logo.jpg'
import fsscLogo from '../assets/branding/ssc/fssc.jpg'
import sasLogo from '../assets/branding/ssc/sas.jpg'
import sbmLogo from '../assets/branding/ssc/sbm.jpg'
import scjeLogo from '../assets/branding/ssc/scje.jpg'
import snhsLogo from '../assets/branding/ssc/snhs.jpg'
import soeLogo from '../assets/branding/ssc/soe.jpg'
import stcsLogo from '../assets/branding/ssc/stcs.png'
import stedLogo from '../assets/branding/ssc/sted.jpg'
import sthmLogo from '../assets/branding/ssc/sthm.jpg'

// The ten official marks, in their fixed order: the university, the
// Federated Supreme Student Council, then each school's SSC. Uploaded
// logos from system_settings win where a setting exists; the bundled
// files are the fallback so a logo slot is never empty or broken.
function BrandLogos({ settings, className = '', size = 'md' }) {
  const logos = [
    { src: settings?.bipsu_logo_url || bipsuLogo, alt: 'BiPSU logo' },
    { src: settings?.bipsu_fssc_logo_url || fsscLogo, alt: 'BiPSU-FSSC logo' },
    { src: sasLogo, alt: 'SAS-SSC logo' },
    { src: sbmLogo, alt: 'SBM-SSC logo' },
    { src: scjeLogo, alt: 'SCJE-SSC logo' },
    { src: snhsLogo, alt: 'SNHS-SSC logo' },
    { src: soeLogo, alt: 'SOE-SSC logo' },
    { src: settings?.stcs_ssc_logo_url || stcsLogo, alt: 'STCS-SSC logo' },
    { src: stedLogo, alt: 'STED-SSC logo' },
    { src: sthmLogo, alt: 'STHM-SSC logo' }
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
