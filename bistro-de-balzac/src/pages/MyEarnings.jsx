import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePersistentState } from '../lib/persist'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { EMPTY_STATS, loadWorkStats, settle } from '../lib/earnings'
import { currentPeriod } from '../lib/payperiod'
import MyReportsFold from '../components/MyReportsFold'
import PeriodPicker from '../components/PeriodPicker'
import { Card, FullPageLoader } from '../components/ui'
import {
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
 * Moji izveštaji i isplate su zatvoreni dok se ne kliknu.
 */
export default function MyEarnings() {
  const { profile } = useAuth()
  const toast = useToast()

  const [period, setPeriod] = usePersistentState('myearn.period', () => currentPeriod())
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(EMPTY_STATS)
  const [paysOpen, setPaysOpen] = usePersistentState('myearn.paysOpen', false)

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

  /* Uslovi rada (ranije ispod imena): dnevnica ili plata, procenat, u timu od. */
  const percent = Number(profile?.percent ?? 0)
  const terms = [
    calc.model === 'plata'
      ? `plata ${formatMoney(profile?.monthly_salary, false)}`
      : calc.model === 'procenat'
        ? null
        : `dnevnica ${formatMoney(profile?.daily_wage, false)}`,
    percent > 0 ? `${percent}%${calc.model === 'procenat' ? ' od pazara' : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="space-y-4">
      {/* ---------- Koliko imam da primim ---------- */}
      <Card className="p-4">
        <PeriodPicker
          period={period}
          onChange={setPeriod}
          inline
          since={profile?.created_at?.slice(0, 10) ?? ''}
        />

        {loading ? (
          <FullPageLoader />
        ) : (
          (() => {
            const earned = Number(calc.base ?? 0) + Number(calc.fromPercent ?? 0)
            const owed = earned + Number(calc.bonus ?? 0)
            const share = owed > 0 ? Math.min(100, Math.max(0, (Number(calc.paid ?? 0) / owed) * 100)) : 0
            const over = calc.balance < 0
            const tiles = [
              calc.model === 'dnevnica' ? ['Dana', String(calc.days ?? 0)] : null,
              ['Zarađeno', formatMoney(earned, false)],
              calc.bonus > 0 ? ['Bonus', formatMoney(calc.bonus, false)] : null,
              ['Isplaćeno', formatMoney(calc.paid, false)],
            ].filter(Boolean)

            return (
              <div className="mt-4">
                {/* Ako je primio više nego što je zaradio, piše se rečju — minus
                    uz „imaš da primiš“ se čita kao greška. */}
                <div className="rounded-2xl bg-ink px-4 py-4 text-white">
                  <p className="eyebrow text-stone-400">{over ? 'Primio si više' : 'Imaš da primiš'}</p>
                  <p
                    className={cx(
                      'mt-0.5 text-4xl font-extrabold tabular-nums tracking-tight',
                      over ? 'text-rose-400' : 'text-white',
                    )}
                  >
                    {formatMoney(Math.abs(calc.balance), false)}
                  </p>
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-white/15"
                    role="progressbar"
                    aria-label="Koliko ti je već isplaćeno"
                    aria-valuenow={Math.round(share)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className={cx('h-full rounded-full transition-all', over ? 'bg-rose-400' : 'bg-brand-500')}
                      style={{ width: `${share}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[12px] tabular-nums text-stone-400">
                    isplaćeno {formatMoney(calc.paid, false)} od {formatMoney(owed, false)}
                  </p>
                </div>

                <div className="mt-2.5 grid gap-2" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
                  {tiles.map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-stone-100 px-2 py-2.5 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">{label}</p>
                      <p className="mt-0.5 text-[15px] font-extrabold tabular-nums text-stone-900">{value}</p>
                    </div>
                  ))}
                </div>

                {terms && <p className="mt-2.5 text-center text-[12px] tabular-nums text-stone-400">{terms}</p>}

                {calc.returned > 0 && (
                  <p className="mt-2 text-center text-xs text-amber-700">
                    {countReturned(calc.returned)} ne ulazi u obračun dok je ne pošalješ ponovo.
                  </p>
                )}
              </div>
            )
          })()        )}
      </Card>

      {/* ---------- Moji izveštaji i isplate: zatvoreno dok se ne klikne ---------- */}
      <Card className="divide-y divide-stone-100">
        {/* Moji izveštaji: poslednja tri, ostali pretragom */}
        <MyReportsFold />

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