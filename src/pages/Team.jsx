import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { loadBadges, loadWorkerBadges } from '../lib/badges'
import Avatar from '../components/Avatar'
import { Card, EmptyState } from '../components/ui'
import { cx, errorMessage } from '../lib/utils'

/**
 * Tim — ko je šta i ko ima koji bedž.
 *
 * Stoji na ekranu Profil, pa ga vide svi, i radnici. Ništa se odavde ne
 * menja; bedževe dodeljuje admin na ekranu Radnici.
 */
export default function Team({ bare = false }) {
  // Unutar zajedničke kartice na Profilu (bare) nema svoje kartice.
  const Shell = bare ? 'div' : Card

  const { profile } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [people, setPeople] = useState([])
  const [badges, setBadges] = useState([])
  const [owned, setOwned] = useState(new Map())
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [peopleRes, badgeList, ownedMap] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, avatar_path, role, position, is_active, sort_order')
          .eq('is_deleted', false)
          .eq('is_active', true)
          .order('sort_order')
          .order('full_name'),
        loadBadges({ onlyActive: true }),
        loadWorkerBadges(),
      ])

      if (peopleRes.error) throw peopleRes.error
      setPeople(peopleRes.data ?? [])
      setBadges(badgeList)
      setOwned(ownedMap)
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Ne mogu da učitam tim.'))
    }
    setLoading(false)
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  // Deo je Profila — dok se učitava ne zauzima mesto.
  if (loading) return null

  return (
    <>
      {/* ---------- Ko je ko ---------- */}
      <Shell>
        {/* Zatvoren dok se ne klikne — da se ne skroluje preko celog tima. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cx(
            'flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition',
            open ? 'bg-stone-100' : 'hover:bg-stone-50',
          )}
        >
          <svg
            className={cx(
              'h-4 w-4 shrink-0 text-stone-400 transition-transform',
              open && 'rotate-90',
            )}
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
            Tim
          </span>
          <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold tabular-nums text-stone-500">
            {people.length}
          </span>
        </button>

        {!open ? null : people.length === 0 ? (
          <EmptyState icon="👥" title="Nema radnika" />
        ) : (
          <ul className="divide-y divide-stone-100">
            {people.map((person) => {
              // Redosled kao u spisku bedževa — admin ga podešava u Radnici.
              const ownedIds = new Set((owned.get(person.id) ?? []).map((row) => row.badge_id))
              const mine = badges.filter((b) => ownedIds.has(b.id))

              return (
                <li key={person.id} className="flex items-start gap-3 px-4 py-3">
                  <Avatar
                    name={person.full_name}
                    path={person.avatar_path}
                    zoomable
                    className={cx(
                      'h-10 w-10 shrink-0 text-sm',
                      person.role === 'admin' ? 'bg-ink text-white' : 'bg-stone-200 text-stone-700',
                    )}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-stone-900">
                      {person.full_name}
                      {person.id === profile?.id && (
                        <span className="ml-1.5 text-[11px] font-semibold text-sky-600">ti</span>
                      )}
                    </p>
                    <p className="text-xs text-stone-400">
                      {person.position?.trim() || (person.role === 'admin' ? 'Admin' : 'Radnik')}
                    </p>

                    {mine.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {mine.map((badge) => (
                          <span
                            key={badge.id}
                            title={badge.description || badge.name}
                            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20"
                          >
                            <span aria-hidden="true">{badge.icon}</span>
                            {badge.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Shell>
    </>
  )
}
