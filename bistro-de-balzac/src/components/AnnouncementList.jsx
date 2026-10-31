import { useCallback, useEffect, useState } from 'react'
import { usePersistentState } from '../lib/persist'

import { useAuth } from '../context/AuthContext'
import { imageUrl, loadMine } from '../lib/announcements'
import { cx, formatDate } from '../lib/utils'
import RichText from './RichText'
import { Card } from './ui'

/** Jedna slika iz obaveštenja — traži se tek kad se red otvori. */
function Photo({ path }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let active = true
    imageUrl(path).then((u) => active && setUrl(u))
    return () => {
      active = false
    }
  }, [path])
  return url ? (
    <img src={url} alt="" className="mt-2 block max-h-[70dvh] w-full rounded-xl bg-stone-50 object-contain" />
  ) : (
    <div className="mt-2 h-32 animate-pulse rounded-xl bg-stone-100" />
  )
}

/**
 * Sva obaveštenja koja su ikad stigla — i ona koja su iskočila i ona koja nisu
 * stigla da se pročitaju. Zatvoreno dok se ne klikne. Tačka znači „još nisi
 * video“ (iskočiće sledeći put).
 */
export default function AnnouncementList({ bare = false }) {
  const { profile } = useAuth()
  const Shell = bare ? 'div' : Card

  const [items, setItems] = useState([])
  const [seen, setSeen] = useState(new Set())
  const [missing, setMissing] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = usePersistentState('annlist.open', false)
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(async () => {
    if (!profile?.id) return
    const res = await loadMine(profile.id)
    setItems(res.items)
    setSeen(res.seen)
    setMissing(res.missing)
    setLoaded(true)
  }, [profile?.id])

  useEffect(() => {
    load()
  }, [load])

  // Skripta za bazu nije puštena, ili još nema ničega — ne zauzima mesto.
  if (!loaded || missing || items.length === 0) return null

  const unread = items.filter((a) => !seen.has(a.id)).length

  return (
    <Shell>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          if (!open) load()
        }}
        aria-expanded={open}
        className={cx(
          'flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition',
          open ? 'bg-stone-100' : 'hover:bg-stone-50',
        )}
      >
        <svg
          className={cx('h-4 w-4 shrink-0 text-stone-400 transition-transform', open && 'rotate-90')}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="min-w-0 flex-1 text-base font-extrabold tracking-tight text-stone-900">
          Obaveštenja
        </span>
        {unread > 0 && (
          <span className="shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">
            {unread} novo
          </span>
        )}
        <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold tabular-nums text-stone-500">
          {items.length}
        </span>
      </button>

      {open && (
        <ul className="divide-y divide-stone-100 border-t border-stone-100">
          {items.map((a) => {
            const isOpen = expanded === a.id
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : a.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-stone-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-stone-900">{a.title || 'Obaveštenje'}</span>
                      {!seen.has(a.id) && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="novo" />
                      )}
                    </span>
                    <span className="block text-[11px] text-stone-400">
                      {formatDate(a.created_at.slice(0, 10))}
                      {a.target_profile_id ? ' · samo za tebe' : ''}
                    </span>
                    {isOpen && (
                      <span className="mt-1.5 block">
                        {a.body && (
                          <RichText
                            body={a.body}
                            className="space-y-1 text-[14px] leading-relaxed text-stone-600"
                            subtitleClassName="text-[15px] font-bold leading-snug text-stone-500"
                          />
                        )}
                        {a.image_path && <Photo path={a.image_path} />}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Shell>
  )
}
