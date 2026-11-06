import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  currentPeriod,
  isFuturePeriod,
  getPayPeriod,
  isByDays,
  isMonthly,
  isOpenPeriod,
  periodFromKey,
  periodLabel,
  shiftPeriod,
} from '../lib/payperiod'
import { LOCALE, cx } from '../lib/utils'

/** Koliko meseci unazad nudi meni — 12 meseci = 24 perioda (godinu dana). */
const MONTHS = 12

function monthTitle(period) {
  const name = new Intl.DateTimeFormat(LOCALE, { month: 'long' }).format(
    new Date(period.year, period.month - 1, 1),
  )
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`
}

/**
 * Izbor obračunskog perioda — sopstveni padajući meni.
 *
 * Svaki mesec je jedan red sa dva dugmeta (1–15. i 16–kraj), pa je spisak
 * upola kraći, a svi periodi su tu. Godina stoji samo jednom, iznad svojih
 * meseci. Izabrani period je narandžasta pločica, a onaj u toku je samo
 * obojen — bez okvira i linija, da meni bude čist.
 */
export default function PeriodPicker({ period, onChange, className, since = '', inline = false }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  // Godina se piše samo ako staje u polje; inače ostaje „1–15. novembar“.
  const boxRef = useRef(null)
  const fullRef = useRef(null)
  const [noYear, setNoYear] = useState(false)
  const fullLabel = periodLabel(period)
  useLayoutEffect(() => {
    const fit = () => {
      if (!boxRef.current || !fullRef.current) return
      setNoYear(fullRef.current.offsetWidth > boxRef.current.clientWidth)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fullLabel])

  // `since` (YYYY-MM-DD): od kad je radnik u kolektivu — ranijih perioda nema.
  const months = useMemo(() => {
    const list = []
    // Periodi po zadatom broju dana: običan spisak, najnoviji prvi.
    if (isByDays()) {
      let p = currentPeriod()
      for (let i = 0; i < 40; i += 1) {
        if (since && p.to < since) break
        list.push({ a: p, b: null, flat: true })
        p = shiftPeriod(p, -1)
      }
      return list
    }
    const monthly = isMonthly()
    let first = periodFromKey(`${currentPeriod().key.slice(0, 7)}-A`)
    const count = since
      ? Math.min(
          60,
          (first.year - Number(since.slice(0, 4))) * 12 + (first.month - Number(since.slice(5, 7))) + 1,
        )
      : MONTHS
    for (let i = 0; i < Math.max(count, 1); i += 1) {
      if (monthly) {
        list.push({ a: first, b: null })
        first = shiftPeriod(first, -1)
      } else {
        list.push({ a: first, b: shiftPeriod(first, 1) })
        first = shiftPeriod(first, -2) // prvi period prethodnog meseca
      }
    }
    return list
  }, [since, getPayPeriod()])

  const beforeStart = (p) => Boolean(since) && p.to < since

  // Klik van menija ili Esc ga zatvara.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(p) {
    setOpen(false)
    if (p.key !== period.key) onChange(p)
  }

  const option = (p, text) => {
    if (beforeStart(p)) return <span aria-hidden="true" />
    const selected = p.key === period.key
    const now = isOpenPeriod(p)
    return (
      <button
        type="button"
        onClick={() => pick(p)}
        disabled={isFuturePeriod(p)}
        aria-pressed={selected}
        aria-label={`${periodLabel(p)}${now ? ' (u toku)' : ''}`}
        className={cx(
          'rounded-lg px-2 py-1.5 text-[13px] tabular-nums transition',
          'disabled:cursor-default disabled:opacity-30',
          selected
            ? 'bg-brand-600 font-semibold text-white'
            : now
              ? 'font-bold text-brand-700 hover:bg-stone-100'
              : 'font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-900',
        )}
      >
        {text}
      </button>
    )
  }

  return (
    <div
      ref={rootRef}
      className={cx(
        'relative',
        inline ? 'flex w-full items-center gap-3' : 'w-[264px] max-w-full shrink-0',
        className,
      )}
    >
      <p className={cx('label', inline && 'mb-0 shrink-0')} id="period-label">
        Obračunski period
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-labelledby="period-label"
        className={cx(
          'flex items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2.5 text-left text-base text-stone-900 transition',
          inline ? 'min-w-0 flex-1' : 'w-full',
          open ? 'border-brand-500 ring-2 ring-brand-500/25' : 'border-stone-300',
        )}
      >
        <span ref={boxRef} className="relative min-w-0 flex-1 truncate">
          {noYear ? periodLabel(period, false) : fullLabel}
          {/* Nevidljivo merilo: koliko bi zauzeo pun naziv, sa godinom. */}
          <span
            ref={fullRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap"
          >
            {fullLabel}
          </span>
        </span>
        <svg
          className={cx('h-4 w-4 shrink-0 text-stone-400 transition-transform', open && 'rotate-180')}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Meni se spušta PREKO sadržaja ispod (ne gura ga) i ima svoj skrol. */}
      {open && (
        <div
          role="group"
          aria-label="Izaberi obračunski period"
          className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[244px] overflow-y-auto overscroll-contain rounded-xl bg-white px-1.5 pb-1.5 pt-1 shadow-lg shadow-stone-900/10 ring-1 ring-stone-100"
        >
          {months.map(({ a, b, flat }, i) =>
            flat ? (
              <div key={a.key} className="py-px">
                {option(a, periodLabel(a))}
              </div>
            ) : (
            // Bez omotača — naslov godine mora biti direktno u listi da bi
            // ostao gore dok se meseci te godine pomeraju.
            <Fragment key={a.key}>
              {(i === 0 || months[i - 1].a.year !== a.year) && (
                <p className="sticky -top-1 z-[1] bg-white px-2 pb-1 pt-2 text-[10px] font-bold tracking-wider text-stone-400">
                  {a.year}.
                </p>
              )}
              <div className="grid grid-cols-[1fr_60px_60px] items-center gap-0.5 py-px pl-2">
                <span className="whitespace-nowrap text-[13.5px] font-medium text-stone-900">
                  {monthTitle(a)}
                </span>
                {option(a, `${Number(a.from.slice(8, 10))}–${Number(a.to.slice(8, 10))}.`)}
                {b ? option(b, `${Number(b.from.slice(8, 10))}–${Number(b.to.slice(8, 10))}.`) : <span aria-hidden="true" />}
              </div>
            </Fragment>
            ),
          )}
        </div>
      )}
    </div>
  )
}
