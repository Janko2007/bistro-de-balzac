import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { EMPTY_STATS, loadWorkStats, settle } from '../lib/earnings'
import { currentPeriod, isOpenPeriod } from '../lib/payperiod'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardHeader, EmptyState, FullPageLoader, Stat } from '../components/ui'
import {
  SHIFT_LABELS,
  countLabel,
  cx,
  errorMessage,
  formatDate,
  formatMoney,
  plural,
} from '../lib/utils'

/** Dnevnice radnika — deo ekrana Profil (ispod osnovnih podataka i pravila). */
export default function MyEarnings() {
  const { profile } = useAuth()
  const toast = useToast()

  const [period, setPeriod] = useState(() => currentPeriod())
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(EMPTY_STATS)
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Dnevnice"
          subtitle={isOpenPeriod(period) ? 'Period je još u toku' : 'Zatvoren period'}
          action={<PeriodPicker period={period} onChange={setPeriod} />}
          // Na uskom telefonu meni prelazi ispod naslova umesto da ga skrati.
          className="flex-wrap"
        />

        {loading ? (
          <FullPageLoader />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
              <Stat label="Odrađeno smena" value={calc.shifts} sub={`× ${formatMoney(calc.wage, false)}`} />
              <Stat label="Zarađeno" value={formatMoney(calc.earned, false)} sub="RSD" />
              <Stat
                label="Bonus"
                value={formatMoney(calc.bonus, false)}
                sub="RSD na platu"
                tone="cash"
              />
              <Stat label="Isplaćeno" value={formatMoney(calc.paid, false)} sub="RSD" />
            </div>

            <div className="mx-4 mb-4 flex items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3.5 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                Imaš da primiš
              </p>
              <p className="text-2xl font-extrabold tabular-nums">{formatMoney(calc.balance)}</p>
            </div>

            {calc.returned > 0 && (
              <p className="px-4 pb-3 text-xs text-amber-700">
                {calc.returned}{' '}
                {plural(calc.returned, [
                  'smena je vraćena',
                  'smene su vraćene',
                  'smena je vraćeno',
                ])}{' '}
                na
                ispravku i ne ulazi u obračun dok je ne pošalješ ponovo.
              </p>
            )}
          </>
        )}
      </Card>

      {/* ---------- Smene ---------- */}
      <Card>
        <CardHeader
          title="Odrađene smene"
          subtitle={`${countLabel(calc.shifts, 'smena')} u ovom periodu`}
        />
        {calc.shiftList.length === 0 ? (
          <EmptyState
            icon="🗓️"
            title="Nema smena u ovom periodu"
            description="Svaka poslata smena se ovde pojavljuje i ulazi u obračun."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {calc.shiftList.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/izvestaj/${s.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50"
                >
                  <span className="text-sm font-semibold text-slate-800">
                    {formatDate(s.report_date)}
                  </span>
                  <span className="text-xs text-slate-500">{SHIFT_LABELS[s.shift] ?? s.shift}</span>
                  <span
                    className={cx(
                      'ml-auto text-sm font-bold tabular-nums',
                      s.status === 'potvrdjen' ? 'text-emerald-700' : 'text-slate-500',
                    )}
                  >
                    +{formatMoney(calc.wage, false)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------- Bonusi i isplate ---------- */}
      <Card>
        {/* Zatvoreno dok se ne klikne na naslov. */}
        <button
          type="button"
          onClick={() => setPaysOpen((v) => !v)}
          aria-expanded={paysOpen}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
        >
          <svg
            className={cx('h-4 w-4 shrink-0 text-stone-400 transition-transform', paysOpen && 'rotate-90')}
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
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold tracking-tight text-stone-900">
              Bonusi i isplate
            </span>
            <span className="mt-0.5 block truncate text-[13px] text-stone-500">
              {calc.payouts.length} u ovom periodu
            </span>
          </span>
        </button>

        {!paysOpen ? null : calc.payouts.length === 0 ? (
          <p className="border-t border-stone-100 px-4 py-8 text-center text-sm text-slate-500">
            Još nema upisanih stavki za ovaj period.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-stone-100">
            {calc.payouts.map((p) => {
              const isBonus = p.kind === 'bonus'
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-lg" aria-hidden="true">
                    {isBonus ? '🎁' : '💵'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {isBonus ? 'Bonus' : 'Isplata'} · {formatDate(p.paid_on)}
                    </p>
                    {p.note && <p className="truncate text-xs text-slate-500">{p.note}</p>}
                  </div>
                  <span
                    className={cx(
                      'shrink-0 text-sm font-bold tabular-nums',
                      isBonus ? 'text-emerald-700' : 'text-slate-900',
                    )}
                  >
                    {isBonus ? '+' : '−'}
                    {formatMoney(p.amount, false)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {paysOpen && (
          <p className="border-t border-stone-100 px-4 py-3 text-xs text-slate-500">
            Dnevnicu, bonuse i isplate upisuje admin. Ako se nešto ne slaže, javi mu se.
          </p>
        )}
      </Card>
    </div>
  )
}
