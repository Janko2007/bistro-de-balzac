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

/**
 * „Zapamti me“ na prijavi: uključeno (podrazumevano) čuva prijavu trajno,
 * isključeno je čuva samo dok se aplikacija ne zatvori. Postojeće prijave
 * ostaju gde jesu — čitaju se iz oba mesta.
 */
const REMEMBER_KEY = 'kafic-popis-remember'

export function getRemember() {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0'
  } catch {
    return true
  }
}

export function setRemember(value) {
  try {
    localStorage.setItem(REMEMBER_KEY, value ? '1' : '0')
  } catch {
    /* bez trajnog skladišta — prijava ostaje samo u ovoj sesiji */
  }
}

const authStorage = {
  getItem: (key) => {
    try {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      const keep = getRemember()
      ;(keep ? localStorage : sessionStorage).setItem(key, value)
      ;(keep ? sessionStorage : localStorage).removeItem(key)
    } catch {
      /* skladište nedostupno */
    }
  },
  removeItem: (key) => {
    try {
      sessionStorage.removeItem(key)
      localStorage.removeItem(key)
    } catch {
      /* skladište nedostupno */
    }
  },
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'kafic-popis-auth',
    storage: authStorage,
  },
})

/** Naziv lokala u zaglavlju aplikacije. */
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Bistro de Balzac'

/** URL za pozivanje Edge Funkcije create-worker. */
export const FUNCTIONS_URL = url ? `${url}/functions/v1` : ''
