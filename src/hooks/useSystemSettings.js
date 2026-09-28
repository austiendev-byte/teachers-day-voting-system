import {
    useEffect,
    useRef,
    useState
  } from 'react'
  
  import { supabase } from '../lib/supabase'
  
  // ==========================================
  // DEFAULTS
  // ==========================================
  // Used before the first load completes and as
  // a safe fallback if the settings row can't be
  // read for any reason. Keeps the header/footer
  // from ever rendering blank.
  
  const DEFAULT_SETTINGS = {
    university_name: 'Biliran Province State University',
    organization_name: '',
    system_name: "Teachers' Day Voting System",
    election_title: "Teachers' Day Election",
    academic_year: '',
    header_description: '',
  
    bipsu_logo_url: null,
    stcs_ssc_logo_url: null,
    bipsu_fssc_logo_url: null,
  
    developer_name: '',
    developer_emblem_url: null,
    developer_facebook_url: null,
    support_instructions:
      'Use Report a Problem inside the system for the fastest response.'
  }
  
  // ==========================================
  // HOOK
  // ==========================================
  // Loads the single system_settings row once and refreshes it when the
  // tab regains focus. This hook mounts in Layout, which wraps every
  // route -- including /login -- so every visitor to the site, logged in
  // or not, used to open a Supabase Realtime connection just to read
  // branding text. Branding changes are rare and not time-critical, so a
  // one-time load plus a focus-triggered refresh keeps it current without
  // holding a websocket open for the whole visit. An admin who edits
  // branding will see it update on their own next tab focus / reload;
  // AdminDashboard keeps its own Realtime subscription for admin-only,
  // higher-value sync.

  export function useSystemSettings() {
    const [settings, setSettings] = useState(null)
    const [loading, setLoading] = useState(true)
  
    const cancelledRef = useRef(false)
  
    useEffect(() => {
      cancelledRef.current = false
  
      async function load() {
        const { data, error } =
          await supabase
            .from('system_settings')
            .select('*')
            .eq('id', 1)
            .maybeSingle()
  
        if (cancelledRef.current) {
          return
        }
  
        if (error) {
          console.error(
            'System settings load error:',
            error
          )
  
          setSettings(DEFAULT_SETTINGS)
        } else {
          setSettings(data || DEFAULT_SETTINGS)
        }
  
        setLoading(false)
      }
  
      load()
  
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          load()
        }
      }
  
      document.addEventListener('visibilitychange', handleVisibilityChange)
  
      return () => {
        cancelledRef.current = true
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }, [])
  
    return {
      settings: settings || DEFAULT_SETTINGS,
      loading
    }
  }