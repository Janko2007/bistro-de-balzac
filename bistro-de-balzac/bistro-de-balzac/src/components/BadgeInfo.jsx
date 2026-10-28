import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { loadBadges, loadMonthlyWinners, monthLabel } from '../lib/badges'
import { Card } from './ui'
import { cx, errorMessage } from '../lib/utils'

/**
 * Bedževi (šta je potrebno za svaki) i Radnici meseca (ko je bio kog meseca).
 *
 * Dve odvojene sekcije na Profilu, jedna ispod druge, ispod Tima. Obe su
 * zatvorene dok se ne klikne. Radnici ovde samo čitaju; uslove za bedževe i
 * spisak radnika meseca menja admin na ekranu Radnici.
 */
export default function BadgeInfo({ bare = false }) {
  // Unutar zajedničke kartice na Profilu (bare) nema svoje kartice.
  const Shell = bare ? 'div' : Card

  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [openWinners, setOpenWinners] = useState(false)
  const [badges, setBadges] = useState([])
  const [winners, setWinners] = useState([])
  const [names, setNames] = useState(new Map())

  const load = useCallback(async () => {
    try {
      const [badgeList, winnerList, peopleRes] = await Promise.all([
        loadBadges({ onlyActive: true }),
        loadMonthlyWinners(),
        supabase.from('profiles').select('id, full_name'),
      ])
      setBadges(badgeList)
      setWinners(winnerList)
      setNames(new Map((peopleRes.data ?? []).map((p) => [p.id, p.full_name])))
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Ne mogu da učitam bedževe.'))
    }
    setLoading(false)
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  /* Meseci, najnoviji prvi — za svaki spisak ljudi. */
  const byMonth = useMemo(() => {
    const map = new Map()
    for (const w of winners) {
      if (!map.has(w.month)) map.set(w.month, [])
      map.get(w.month).push(w)
    }
    return [...map.entries()]
  }, [winners])

  // Deo je Profila — dok se učitava ne zauzima mesto.
  if (loading) return null

  /* Isto zaglavlje za obe sekcije: klikom se otvara, sa strelicom i brojem. */
  const header = (title, isOpen, onToggle, count) => (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className={cx(
        'flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition',
        isOpen ? 'bg-stone-100' : 'hover:bg-stone-50',
      )}
    >
      <svg
        className={cx(
          'h-4 w-4 shrink-0 text-stone-400 transition-transform',
          isOpen && 'rotate-90',
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
        {title}
      </span>
      <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold tabular-nums text-stone-500">
        {count}
      </span>
    </button>
  )

  return (
    <>
      {/* ---------- Bedževi: šta je potrebno za svaki ---------- */}
      {badges.length > 0 && (
        <Shell>
          {header('Bedževi', open, () => setOpen((v) => !v), badges.length)}

          {open && (
            <ul className="divide-y divide-stone-100 border-t border-stone-100">
              {badges.map((badge) => (
                <li key={badge.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="text-2xl leading-none" aria-hidden="true">
                    {badge.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-stone-900">{badge.name}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-stone-600">
                      {badge.requirement || badge.description || 'Admin još nije upisao uslov.'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Shell>
      )}

      {/* ---------- Radnici meseca: posebna sekcija ispod bedževa ---------- */}
      <Shell>
        {header('Radnici meseca', openWinners, () => setOpenWinners((v) => !v), byMonth.length)}

        {openWinners &&
          (byMonth.length === 0 ? (
            <p className="border-t border-stone-100 px-4 py-4 text-[13px] text-stone-400">
              Još nije izabran nijedan.
            </p>
          ) : (
            <ul className="divide-y divide-stone-100 border-t border-stone-100">
              {byMonth.map(([month, list]) => (
                <li key={month} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <span className="shrink-0 text-[13px] font-semibold capitalize text-stone-500">
                    {monthLabel(month)}
                  </span>
                  <span className="min-w-0 text-right text-sm font-bold text-stone-900">
                    {list.map((w) => names.get(w.profile_id) ?? 'Radnik').join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </Shell>
    </>
  )
}
