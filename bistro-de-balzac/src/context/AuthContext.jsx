import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { resolveLogin } from '../lib/utils'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  const fetchProfile = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, email, full_name, phone, role, daily_wage, is_active, is_deleted, avatar_path, created_at',
      )
      .eq('id', userId)
      .maybeSingle()

    if (!mounted.current) return null
    if (error) {
      console.error('Greška pri učitavanju profila:', error)
      setProfile(null)
      return null
    }
    setProfile(data)
    return data
  }, [])

  useEffect(() => {
    mounted.current = true

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted.current) return
        setSession(data.session ?? null)
        if (data.session?.user) await fetchProfile(data.session.user.id)
      })
      .finally(() => {
        if (mounted.current) setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession ?? null)

      if (!newSession?.user) {
        setProfile(null)
        return
      }
      // Supabase preporuka: ne pozivati await unutar ovog callback-a.
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
        setTimeout(() => fetchProfile(newSession.user.id), 0)
      }
    })

    return () => {
      mounted.current = false
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  /** `username` je puno ime radnika (ili email, za naloge iz Supabase panela). */
  const signIn = useCallback(async (username, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: resolveLogin(username),
      password,
    })
    return { data, error }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session?.user) return fetchProfile(session.user.id)
    return null
  }, [session, fetchProfile])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      isAdmin: profile?.role === 'admin',
      isActive: profile?.is_active !== false,
      signIn,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth mora biti unutar <AuthProvider>')
  return ctx
}
