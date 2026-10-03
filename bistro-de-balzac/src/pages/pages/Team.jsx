import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { loadBadges, loadWorkerBadges } from '../lib/badges'
import Avatar from '../components/Avatar'
import { Card, CardHeader, EmptyState } from '../components/ui'
import { cx, errorMessage } from '../lib/utils'

/**
 * Tim — ko je šta i ko ima koji bedž.
 *
 * Stoji na ekranu Profil, pa ga vide svi, i radnici. Ništa se odavde ne
 * menja; bedževe dodeljuje admin na ekranu Radnici.
 */
export default function Team() {
  const { profile } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [people, setPeople] = useState([])
  const [badges, setBadges] = useState([])
  const [owned, setOwned] = useState(new Map())

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

  const badgeById = useMemo(() => new Map(badges.map((b) => [b.id, b])), [badges])

  // Deo je Profila — dok se učitava ne zauzima mesto.
  if (loading) return null

  return (
    <>
      {/* ---------- Ko je ko ---------- */}
      <Card>
        <CardHeader title="Tim" subtitle={String(people.length)} />

        {people.length === 0 ? (
          <EmptyState icon="👥" title="Nema radnika" />
        ) : (
          <ul className="divide-y divide-stone-100">
            {people.map((person) => {
              const mine = (owned.get(person.id) ?? [])
                .map((row) => badgeById.get(row.badge_id))
                .filter(Boolean)

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
      </Card>
    </>
  )
}
