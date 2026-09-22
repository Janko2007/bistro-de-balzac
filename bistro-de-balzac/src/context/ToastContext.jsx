import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { cx } from '../lib/utils'

const ToastContext = createContext(null)

let nextId = 1

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (message, type = 'info', duration = 4000) => {
      const id = nextId++
      setToasts((prev) => [...prev, { id, message, type }])
      if (duration > 0) setTimeout(() => dismiss(id), duration)
      return id
    },
    [dismiss],
  )

  const api = useMemo(
    () => ({
      success: (msg, d) => push(msg, 'success', d),
      error: (msg, d) => push(msg, 'error', d ?? 6000),
      info: (msg, d) => push(msg, 'info', d),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Na telefonu obaveštenje stoji IZNAD donje trake, a ne preko nje.
          Visinu donjih traka javlja ekran kroz `--toast-offset` (vidi
          useToastOffset); podrazumevano je to samo donja navigacija (56px). */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--toast-offset,56px)+env(safe-area-inset-bottom,0px))] z-[100] flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:top-0 sm:items-end sm:safe-top">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={cx(
              'pointer-events-auto w-full max-w-sm animate-slide-up rounded-xl px-4 py-3 text-left text-sm font-medium shadow-lg ring-1',
              t.type === 'success' && 'bg-emerald-600 text-white ring-emerald-700',
              t.type === 'error' && 'bg-rose-600 text-white ring-rose-700',
              t.type === 'info' && 'bg-slate-900 text-white ring-slate-700',
            )}
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * Ekran koji ima svoju traku na dnu (npr. „Zatvori smenu“) javlja koliko je
 * visoko sve na dnu zajedno sa donjom navigacijom, pa obaveštenja idu iznad.
 */
export function useToastOffset(px, active = true) {
  useEffect(() => {
    if (!active) return undefined
    const root = document.documentElement
    root.style.setProperty('--toast-offset', `${px}px`)
    return () => root.style.removeProperty('--toast-offset')
  }, [px, active])
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast mora biti unutar <ToastProvider>')
  return ctx
}
