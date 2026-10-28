import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import {
  currentPeriod,
  isFuturePeriod,
  isOpenPeriod,
  periodFromKey,
  periodLabel,
  shiftPeriod,
} from '../lib/payperiod'
import { LOCALE, cx } from '../lib/utils'

/** Koliko meseci unazad nudi meni — 12 meseci = 24 perioda (godinu dana). */
const MONTHS = 12

const lastDayOf = (year, month) => new Date(year, month, 0).getDate()

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
export default function PeriodPicker({ period, onChange, className }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  const months = useMemo(() => {
    const list = []
    let first = periodFromKey(`${currentPeriod().key.slice(0, 7)}-A`)
    for (let i = 0; i < MONTHS; i += 1) {
      list.push({ a: first, b: shiftPeriod(first, 1) })
      first = shiftPeriod(first, -2) // prvi period prethodnog meseca
    }
    return list
  }, [])

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
          'rounded-lg py-1.5 text-[13px] tabular-nums transition',
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
    <div ref={rootRef} className={cx('relative w-[264px] max-w-full shrink-0', className)}>
      <p className="label" id="period-label">
        Obračunski period
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-labelledby="period-label"
        className={cx(
          'flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2.5 text-left text-base text-stone-900 transition',
          open ? 'border-brand-500 ring-2 ring-brand-500/25' : 'border-stone-300',
        )}
      >
        <span className="truncate">{periodLabel(period)}</span>
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
          {months.map(({ a, b }, i) => (
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
                {option(a, '1–15.')}
                {option(b, `16–${lastDayOf(b.year, b.month)}.`)}
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
