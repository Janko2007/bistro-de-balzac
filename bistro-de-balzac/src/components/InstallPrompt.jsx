import { useEffect, useState } from 'react'
import { Button } from './ui'

const DISMISS_KEY = 'kafic-popis-install-dismissed'

/**
 * Banner "Dodaj na početni ekran".
 * - Android/Chrome/Edge: koristi beforeinstallprompt i pravi install dijalog.
 * - iOS/Safari: nema API — prikazuje se uputstvo (Podeli -> Na početni ekran).
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [showIosHint, setShowIosHint] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === '1') return undefined

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    if (isStandalone) return undefined

    const handler = (e) => {
      e.preventDefault()
      setDeferred(e)
    }
    window.addEventListener('beforeinstallprompt', handler)

    const ua = window.navigator.userAgent
    const isIos = /iphone|ipad|ipod/i.test(ua)
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
    if (isIos && isSafari) setShowIosHint(true)

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDeferred(null)
    setShowIosHint(false)
  }

  async function install() {
    if (!deferred) return
    deferred.prompt()
    await deferred.userChoice
    dismiss()
  }

  if (!deferred && !showIosHint) return null

  return (
    <div className="fixed inset-x-3 bottom-20 z-40 animate-slide-up rounded-2xl border border-slate-200 bg-white p-4 shadow-xl lg:inset-x-auto lg:right-5 lg:bottom-5 lg:max-w-sm">
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900">Instaliraj aplikaciju</p>
          {deferred ? (
            <p className="mt-0.5 text-xs text-slate-600">
              Dodaj je na početni ekran — otvara se kao prava aplikacija, bez pretraživača.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-600">
              Pritisni <span className="font-semibold">Podeli</span> (ikonica sa strelicom), pa{' '}
              <span className="font-semibold">„Dodaj na početni ekran“</span>.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            {deferred && (
              <Button size="sm" onClick={install}>
                Instaliraj
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Ne sada
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
