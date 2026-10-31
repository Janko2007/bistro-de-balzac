import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { ABOUT } from '../lib/about'
import { APP_NAME, getRemember, setRemember } from '../lib/supabaseClient'
import { errorMessage } from '../lib/utils'
import { Button, Field, Input, Spinner } from '../components/ui'

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRememberState] = useState(() => getRemember())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = `Prijava · ${APP_NAME}`
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink">
        <Spinner className="h-8 w-8 text-white" />
      </div>
    )
  }

  if (session) {
    return <Navigate to={location.state?.from || '/'} replace />
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!username.trim() || !password) {
      setError('Unesi ime i prezime i lozinku.')
      return
    }

    setSubmitting(true)
    setRemember(remember)
    const { error: signInError } = await signIn(username, password)
    setSubmitting(false)

    if (signInError) {
      setError(errorMessage(signInError))
      return
    }
    navigate(location.state?.from || '/', { replace: true })
  }

  return (
    <div className="login-bg flex min-h-screen flex-col bg-ink px-4 py-10 safe-top safe-bottom">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <div className="mb-8 text-center">
          <img
            src="/icons/icon-192.png"
            alt=""
            className="mx-auto h-20 w-20 rounded-2xl shadow-lg"
          />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-white">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-stone-400">Evidencija smena, popisa i pazara</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl bg-white p-5 shadow-2xl"
          noValidate
        >
          <Field label="Ime i prezime" hint="Isto kao što ti je admin upisao nalog.">
            <Input
              type="text"
              autoComplete="username"
              autoCapitalize="words"
              autoCorrect="off"
              placeholder="Marko Marković"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              required
            />
          </Field>

          <Field label="Lozinka">
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="pr-16"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-3 text-xs font-semibold text-stone-500 hover:text-stone-800"
              >
                {showPassword ? 'Sakrij' : 'Prikaži'}
              </button>
            </div>
          </Field>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-stone-700">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRememberState(e.target.checked)}
              disabled={submitting}
              className="h-5 w-5 rounded border-stone-300 accent-brand-600"
            />
            Zapamti me
          </label>

          {error && (
            <div className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
              {error}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            {submitting ? 'Prijavljivanje…' : 'Prijavi se'}
          </Button>
        </form>
      </div>

      {/* Diskretan potpis na dnu — isti nacrtani logo kao u „O aplikaciji“. */}
      <a
        href={ABOUT.website}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ABOUT.name}
        className="mx-auto mt-8 flex items-end gap-1.5 opacity-50 transition hover:opacity-80"
      >
        <span
          aria-hidden="true"
          className="block h-[9px] w-[18px] shrink-0 bg-[#3ec4b4]"
          style={{ borderRadius: '18px 18px 0 0' }}
        />
        <span
          aria-hidden="true"
          className="text-[14px] font-extrabold leading-[0.78] tracking-[-0.04em] text-white"
        >
          {ABOUT.name.toLowerCase()}
        </span>
      </a>
    </div>
  )
}
