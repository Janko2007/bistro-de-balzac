import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  console.error(
    '[Bistro de Balzac] Nedostaju VITE_SUPABASE_URL i/ili VITE_SUPABASE_ANON_KEY. ' +
      'Napravi .env fajl po uzoru na .env.example i restartuj `npm run dev`.',
  )
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'kafic-popis-auth',
  },
})

/** Naziv lokala u zaglavlju aplikacije. */
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Bistro de Balzac'

/** URL za pozivanje Edge Funkcije create-worker. */
export const FUNCTIONS_URL = url ? `${url}/functions/v1` : ''
