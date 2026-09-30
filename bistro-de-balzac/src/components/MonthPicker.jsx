import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { LOCALE, cx, todayISO } from '../lib/utils'

/** Koliko meseci unazad nudi meni (2 godine). */
const MONTHS_BACK = 24

/** "2026-09" → "Septembar 2026." */
function monthLabel(month) {
  const [y, m] = String(month).split('-').map(Number)
  const name = new Intl.DateTimeFormat(LOCALE, { month: 'long' }).format(new Date(y, m - 1, 1))
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}.`
}

/** "2026-09" → "sep" */
function monthShort(month) {
  const [y, m] = String(month).split('-').map(Number)
  return new Intl.DateTimeFormat(LOCALE, { month: 'short' })
    .format(new Date(y, m - 1, 1))
    .replace(/\.$/, '')
}

/** Mesec pomeren za `delta` meseci: "2026-09" + (-1) → "2026-08" */
function shift(month, delta) {
  const [y, m] = String(month).split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Izbor meseca — sopstveni padajući meni, isti kao kod obračunskog perioda.
 *
 * Meseci idu po tri u redu, godina stoji samo jednom iznad svojih meseci i
 * ostaje gore dok se lista pomera. Tekući mesec je podebljan, izabrani je
 * narandžasta pločica, a budući meseci su isključeni.
 *
 * `compact`    — umesto širokog polja, samo strelica; za zaglavlje kartice.
 * `allowClear` — na vrhu menija stoji „Sve“, a `month` sme da bude prazan.
 */
export default function MonthPicker({
  month,
  onChange,
  label = 'Mesec',
  className,
  compact = false,
  allowClear = false,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const thisMonth = todayISO().slice(0, 7)

  const months = useMemo(() => {
    const list = []
    let m = thisMonth
    for (let i = 0; i < MONTHS_BACK; i += 1) {
      list.push(m)
      m = shift(m, -1)
    }
    return list
  }, [thisMonth])

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

  function pick(value) {
    setOpen(false)
    if (value !== month) onChange(value)
  }

  const chevron = (
    <svg
      className={cx('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
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
  )

  return (
    <div
      ref={rootRef}
      className={cx('relative shrink-0', compact ? '' : 'w-[220px] max-w-full', className)}
    >
      {!compact && (
        <p className="label" id="month-label">
          {label}
        </p>
      )}

      {compact ? (
        /* Samo strelica — stoji u zaglavlju kartice, pored lupe. */
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={month ? monthLabel(month) : 'Izaberi mesec'}
          title={month ? monthLabel(month) : 'Mesec'}
          className={cx(
            'flex items-center gap-1 rounded-xl px-2 py-2 text-[13px] font-semibold transition',
            open || month
              ? 'bg-stone-900 text-white'
              : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700',
          )}
        >
          {month && <span className="pl-0.5">{monthShort(month)}</span>}
          {chevron}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-labelledby="month-label"
          className={cx(
            'flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2.5 text-left text-base text-stone-900 transition',
            open ? 'border-brand-500 ring-2 ring-brand-500/25' : 'border-stone-300',
          )}
        >
          <span className="truncate">{monthLabel(month)}</span>
          <span className="text-stone-400">{chevron}</span>
        </button>
      )}

      {/* Meni se spušta PREKO sadržaja ispod (ne gura ga) i ima svoj skrol. */}
      {open && (
        <div
          role="group"
          aria-label="Izaberi mesec"
          className={cx(
            'absolute top-full z-20 mt-1.5 flex max-h-[244px] flex-wrap gap-1 overflow-y-auto overscroll-contain rounded-xl bg-white px-1.5 pb-1.5 pt-1 shadow-lg shadow-stone-900/10 ring-1 ring-stone-100',
            compact ? 'right-0 w-[230px]' : 'inset-x-0',
          )}
        >
          {allowClear && (
            <button
              type="button"
              onClick={() => pick('')}
              aria-pressed={!month}
              className={cx(
                'w-full rounded-lg py-1.5 text-center text-[13px] font-semibold transition',
                month ? 'text-stone-500 hover:bg-stone-100' : 'bg-stone-900 text-white',
              )}
            >
              Sve
            </button>
          )}
          {months.map((value, i) => {
            const year = value.slice(0, 4)
            const newYear = i === 0 || months[i - 1].slice(0, 4) !== year
            const selected = value === month
            const now = value === thisMonth
            return (
              // Bez omotača — naslov godine mora biti direktno u listi da bi
              // ostao gore dok se meseci te godine pomeraju.
              <Fragment key={value}>
                {newYear && (
                  <p className="sticky -top-1 z-[1] w-full bg-white px-2 pb-1 pt-2 text-[10px] font-bold tracking-wider text-stone-400">
                    {year}.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => pick(value)}
                  aria-pressed={selected}
                  aria-label={monthLabel(value)}
                  className={cx(
                    'w-[calc(33.333%-6px)] rounded-lg py-1.5 text-center text-[13px] transition',
                    selected
                      ? 'bg-brand-600 font-semibold text-white'
                      : now
                        ? 'font-bold text-brand-700 hover:bg-stone-100'
                        : 'font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-900',
                  )}
                >
                  {monthShort(value)}
                </button>
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
