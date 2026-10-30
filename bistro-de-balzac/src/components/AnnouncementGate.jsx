import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { imageUrl, loadMine, markSeen } from '../lib/announcements'
import AnnouncementPopup from './AnnouncementPopup'

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
    <AnnouncementPopup
      item={current}
      photo={photo}
      hasImage={Boolean(current.image_path)}
      heading={heading}
      counter={total.current > 1 ? `${Math.min(position, total.current)} / ${total.current}` : null}
      buttonLabel={current.kind === 'poruka' ? 'Videh' : 'Super!'}
      onDismiss={dismiss}
    />
  )
}