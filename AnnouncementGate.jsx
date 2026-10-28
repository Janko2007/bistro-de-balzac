import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { imageUrl, loadMine, markSeen } from '../lib/announcements'
import Celebration from './Celebration'

/**
 * Obaveštenja koja iskaču — jednom.
 *
 * Čim se radnik prijavi ili vrati u aplikaciju, sve što još nije video izlazi
 * jedno po jedno. Kad klikne „Super“, upisuje se da je viđeno i više ne
 * iskače, a ostaje sačuvano u Profilu → Obaveštenja.
 */
export default function AnnouncementGate() {
  const { profile } = useAuth()
  const [queue, setQueue] = useState([])
  const [photo, setPhoto] = useState(null)
  const total = useRef(0)
  const shown = useRef(0)
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    if (!profile?.id || busy.current) return
    const { items, seen, missing } = await loadMine(profile.id)
    if (missing) return
    // Najstarije prvo — da se čitaju redom kako su stizala.
    const unread = items
      .filter((a) => !seen.has(a.id))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    setQueue((prev) => {
      const ids = new Set(prev.map((p) => p.id))
      const fresh = unread.filter((u) => !ids.has(u.id))
      if (fresh.length > 0) total.current += fresh.length
      return fresh.length > 0 ? [...prev, ...fresh] : prev
    })
  }, [profile?.id])

  /* Pri prijavi, pri povratku u aplikaciju i na svaki minut. */
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 60000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const current = queue[0] ?? null

  useEffect(() => {
    let active = true
    setPhoto(null)
    if (current?.image_path) {
      imageUrl(current.image_path).then((url) => {
        if (active) setPhoto(url)
      })
    }
    return () => {
      active = false
    }
  }, [current?.id, current?.image_path])

  async function dismiss() {
    if (!current || busy.current) return
    busy.current = true
    shown.current += 1
    const done = current
    setQueue((prev) => prev.filter((p) => p.id !== done.id))
    await markSeen(done.id, profile.id)
    busy.current = false
    if (queue.length <= 1) {
      total.current = 0
      shown.current = 0
    }
  }

  if (!current) return null

  // O meni je reč (bedž, radnik meseca) — obraća mu se lično.
  const aboutMe = current.subject_id === profile?.id
  const heading =
    aboutMe && (current.kind === 'bedz' || current.kind === 'radnik_meseca')
      ? 'Čestitamo! 🎉'
      : null
  const position = shown.current + 1

  return (
    <>
      {/* key: efekat kreće iznova za svako novo obaveštenje */}
      <Celebration key={current.id} effect={current.effect} />

      <div
        className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label={current.title || 'Obaveštenje'}
      >
        <div className="relative max-h-[92dvh] w-full max-w-sm animate-zoom-in overflow-y-auto rounded-[2rem] bg-white px-6 pb-6 pt-8 text-center shadow-2xl">
          {total.current > 1 && (
            <p className="absolute right-5 top-4 text-[11px] font-semibold tabular-nums text-stone-400">
              {Math.min(position, total.current)} / {total.current}
            </p>
          )}

          <div className="text-6xl leading-none" aria-hidden="true">
            {current.icon || '📣'}
          </div>

          {heading && <p className="mt-4 text-sm font-bold uppercase tracking-wider text-brand-600">{heading}</p>}

          {current.title && (
            <h2 className="mt-3 text-xl font-extrabold leading-tight tracking-tight text-stone-900">
              {current.title}
            </h2>
          )}

          {current.body && (
            <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-stone-600">
              {current.body}
            </p>
          )}

          {current.image_path && (
            <div className="mt-4 overflow-hidden rounded-2xl bg-stone-100">
              {photo ? (
                <img src={photo} alt="" className="max-h-72 w-full object-cover" />
              ) : (
                <div className="h-40 animate-pulse bg-stone-200" />
              )}
            </div>
          )}

          <button
            type="button"
            onClick={dismiss}
            className="mt-6 w-full rounded-2xl bg-brand-600 px-5 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-brand-700 active:scale-[.99]"
          >
            {current.kind === 'poruka' ? 'Videh' : 'Super!'}
          </button>
        </div>
      </div>
    </>
  )
}
