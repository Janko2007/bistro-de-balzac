import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { EMPTY_STATS, loadWorkStats, settle } from '../lib/earnings'
import { currentPeriod } from '../lib/payperiod'
import PeriodPicker from '../components/PeriodPicker'
import { Card, EmptyState, FullPageLoader } from '../components/ui'
import {
  SHIFT_LABELS,
  cx,
  errorMessage,
  formatDate,
  formatMoney,
  plural,
} from '../lib/utils'

/** Zaglavlje reda koji se otvara klikom — isto kao ostale sekcije na Profilu. */
function Toggle({ title, count, open, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
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
        {title}
      </span>
      <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold tabular-nums text-stone-500">
        {count}
      </span>
    </button>
  )
}

/**
 * Dnevnice radnika — deo ekrana Profil.
 *
 * Gore jedan veliki iznos („imaš da primiš“) i jedan sitan red ispod njega.
 * Odrađene smene i isplate su zatvorene dok se ne kliknu.
 */
export default function MyEarnings() {
  const { profile } = useAuth()
  const toast = useToast()

  const [period, setPeriod] = useState(() => currentPeriod())
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(EMPTY_STATS)
  const [shiftsOpen, setShiftsOpen] = useState(false)
  const [paysOpen, setPaysOpen] = useState(false)

  const range = useMemo(
    () => ({ from: period.from, to: period.to, periodKey: period.key }),
    [period],
  )

  const load = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    try {
      const map = await loadWorkStats({ ...range, profileId: profile.id })
      setStats(map.get(profile.id) ?? EMPTY_STATS)
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Ne mogu da učitam obračun.'))
    }
    setLoading(false)
  }, [profile?.id, range, toast])

  useEffect(() => {
    load()
  }, [load])

  const calc = settle(profile, stats)

  /* Sitan red ispod iznosa: dani, procenat, bonus, isplaćeno — samo ono što postoji. */
  const detail = [
    calc.model === 'plata' ? `plata ${formatMoney(calc.base, false)}` : `${calc.days} ${plural(calc.days, 'dan')}`,
    calc.fromPercent > 0 ? `procenat ${formatMoney(calc.fromPercent, false)}` : null,
    calc.bonus > 0 ? `bonus ${formatMoney(calc.bonus, false)}` : null,
    `isplaćeno ${formatMoney(calc.paid, false)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="space-y-4">
      {/* ---------- Koliko imam da primim ---------- */}
      <Card className="p-4">
        <PeriodPicker period={period} onChange={setPeriod} />

        {loading ? (
          <FullPageLoader />
        ) : (
          <div className="mt-4">
            {/* Ako je primio više nego što je zaradio, piše se rečju — minus
                uz „imaš da primiš“ se čita kao greška. */}
            <p className="eyebrow">{calc.balance < 0 ? 'Primio si više' : 'Imaš da primiš'}</p>
            <p
              className={cx(
                'text-3xl font-extrabold tabular-nums tracking-tight',
                calc.balance < 0 ? 'text-rose-600' : 'text-brand-600',
              )}
            >
              {formatMoney(Math.abs(calc.balance), false)}
            </p>
            <p className="mt-1.5 text-[13px] tabular-nums text-stone-500">{detail}</p>

            {calc.returned > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                {countReturned(calc.returned)} ne ulazi u obračun dok je ne pošalješ ponovo.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* ---------- Odrađene smene i isplate: zatvoreno dok se ne klikne ---------- */}
      <Card className="divide-y divide-stone-100">
        <div>
          <Toggle
            title="Odrađene smene"
            count={calc.shifts}
            open={shiftsOpen}
            onClick={() => setShiftsOpen((v) => !v)}
          />
          {shiftsOpen &&
            (calc.shiftList.length === 0 ? (
              <EmptyState icon="🗓️" title="Nema smena u ovom periodu" />
            ) : (
              <ul className="divide-y divide-stone-100 border-t border-stone-100">
                {calc.shiftList.map((s) => (
                  <li key={s.id}>
                    <Link
                      to={`/izvestaj/${s.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-stone-50"
                    >
                      <span className="text-sm font-semibold text-stone-800">
                        {formatDate(s.report_date)}
                      </span>
                      <span className="text-xs text-stone-500">
                        {SHIFT_LABELS[s.shift] ?? s.shift}
                      </span>
                      {/* Na dnevnici se uz smenu vidi i koliko nosi; ako je admin za taj
                          dan upisao umanjeni iznos, piše on. */}
                      {calc.model === 'dnevnica' && (
                        <span
                          className={cx(
                            'ml-auto text-sm font-bold tabular-nums',
                            s.wage_override !== null && s.wage_override !== undefined
                              ? 'text-rose-600'
                              : s.status === 'potvrdjen'
                                ? 'text-emerald-700'
                                : 'text-stone-500',
                          )}
                        >
                          +
                          {formatMoney(
                            s.wage_override !== null && s.wage_override !== undefined
                              ? s.wage_override
                              : calc.wage,
                            false,
                          )}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
        </div>

        <div>
          <Toggle
            title="Bonusi i isplate"
            count={calc.payouts.length}
            open={paysOpen}
            onClick={() => setPaysOpen((v) => !v)}
          />
          {paysOpen &&
            (calc.payouts.length === 0 ? (
              <p className="border-t border-stone-100 px-4 py-4 text-sm text-stone-400">
                Još nema stavki za ovaj period.
              </p>
            ) : (
              <ul className="divide-y divide-stone-100 border-t border-stone-100">
                {calc.payouts.map((p) => {
                  const isBonus = p.kind === 'bonus'
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-lg" aria-hidden="true">
                        {isBonus ? '🎁' : '💵'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-stone-800">
                          {isBonus ? 'Bonus' : 'Isplata'} · {formatDate(p.paid_on)}
                        </p>
                        {p.note && <p className="truncate text-xs text-stone-500">{p.note}</p>}
                      </div>
                      <span
                        className={cx(
                          'shrink-0 text-sm font-bold tabular-nums',
                          isBonus ? 'text-emerald-700' : 'text-stone-900',
                        )}
                      >
                        {isBonus ? '+' : '−'}
                        {formatMoney(p.amount, false)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ))}
        </div>
      </Card>
    </div>
  )
}

/** „1 smena je vraćena na ispravku“ / „2 smene su vraćene na ispravku“ */
function countReturned(n) {
  return `${n} ${plural(n, ['smena je vraćena', 'smene su vraćene', 'smena je vraćeno'])} na ispravku i`
}
