import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Keep authentication isolated to the current browser tab.  This prevents a
// student registering/signing in from replacing an administrator's session in
// another tab on the same device.
export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  {
    auth: {
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'teachers-day-voting-auth'
    }
  }
)
