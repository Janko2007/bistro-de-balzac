import { useEffect, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { usePersistentState } from '../lib/persist'
import {
  getPayPeriod,
  loadPayPeriod,
  normalizePayPeriod,
  savePayPeriod,
} from '../lib/payperiod'
import { cx, errorMessage, formatDate, plural } from '../lib/utils'
import { Button, Card, Input, Select } from './ui'

/** Datum (YYYY-MM-DD) pomeren za `n` dana. */
function addDaysISO(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + n))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

/** Drugi period može da počne bilo kog dana od 2. do 28. */
const SPLIT_DAYS = Array.from({ length: 27 }, (_, i) => i + 2)

/**
 * Obračunski period (admin) — na koliko delova se mesec deli za plate.
 *
 *   • dva puta mesečno: prvi period 1–(dan−1), drugi dan–kraj
 *   • jednom mesečno: ceo mesec odjednom
 *
 * Menja izbor perioda u Radnici i u Profilu radnika. Već upisani izveštaji,
 * dnevnice i isplate ostaju gde jesu — menja se samo način grupisanja.
 */
export default function PayPeriodEditor() {
  const toast = useToast()
  const [open, setOpen] = usePersistentState('payperiod.open', false)
  const [saved, setSaved] = useState(() => normalizePayPeriod(getPayPeriod()))
  const [draft, setDraft] = useState(() => normalizePayPeriod(getPayPeriod()))
  const [working, setWorking] = useState(false)

  useEffect(() => {
    loadPayPeriod().then((cfg) => {
      setSaved(cfg)
      setDraft(cfg)
    })
  }, [])

  const current = normalizePayPeriod(draft)
  const dirty = JSON.stringify(current) !== JSON.stringify(saved)

  const summary =
    saved.mode === 'mesec'
      ? 'jednom mesečno · 1–kraj'
      : saved.mode === 'dani'
        ? `svakih ${saved.days} ${plural(saved.days, 'dan')} · od ${formatDate(saved.anchor)}`
        : `dva puta mesečno · 1–${saved.split - 1}. i ${saved.split}–kraj`

  // Prva tri perioda po trenutnom izboru — da se odmah vidi šta će biti.
  const preview = (() => {
    if (current.mode === 'dani') {
      const rows = []
      let start = current.anchor
      for (let i = 0; i < 3; i += 1) {
        const end = addDaysISO(start, current.days - 1)
        rows.push(`${formatDate(start)} – ${formatDate(end)}`)
        start = addDaysISO(end, 1)
      }
      return `Primer: ${rows.join(' · ')} …`
    }
    return null
  })()

  const example =
    preview ??
    (current.mode === 'mesec'
      ? 'Primer: 1–30. novembar, isplata 1. decembra.'
      : `Primer: 1–${current.split - 1}. novembar (isplata ${current.split}.) i ${current.split}–30. novembar (isplata 1. decembra).`)

  async function save() {
    setWorking(true)
    try {
      const value = await savePayPeriod(current)
      setSaved(value)
      setDraft(value)
      toast.success('Obračunski period je sačuvan. Osveži Radnike da vidiš nove periode.')
    } catch (err) {
      toast.error(errorMessage(err, 'Obračunski period nije sačuvan. Da li je puštena skripta -22?'))
    }
    setWorking(false)
  }

  const modes = [
    { value: 'pola', title: 'Dva puta mesečno', hint: 'plata u dva dela' },
    { value: 'mesec', title: 'Jednom mesečno', hint: 'cela plata odjednom' },
    { value: 'dani', title: 'Sam odredi dane', hint: 'period traje koliko ti treba' },
  ]

  return (
    <Card>
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
        <span className="min-w-0 flex-1">
          <span className="block text-base font-extrabold tracking-tight text-stone-900">
            Obračunski period
          </span>
          <span className="block truncate text-xs text-stone-400">{summary}</span>
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-stone-100 p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {modes.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, mode: m.value }))}
                aria-pressed={current.mode === m.value}
                className={cx(
                  'rounded-2xl px-3 py-3 text-left transition',
                  current.mode === m.value
                    ? 'bg-ink text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200/70',
                )}
              >
                <span className="block text-sm font-bold leading-tight">{m.title}</span>
                <span
                  className={cx(
                    'mt-0.5 block text-[11px]',
                    current.mode === m.value ? 'text-stone-300' : 'text-stone-500',
                  )}
                >
                  {m.hint}
                </span>
              </button>
            ))}
          </div>

          {current.mode === 'pola' && (
            <label className="block">
              <span className="label">Drugi period počinje</span>
              <Select
                value={current.split}
                onChange={(e) => setDraft((d) => ({ ...d, split: Number(e.target.value) }))}
              >
                {SPLIT_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}. u mesecu
                  </option>
                ))}
              </Select>
            </label>
          )}

          {current.mode === 'dani' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Koliko dana traje</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="62"
                  value={draft.days ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, days: e.target.value }))}
                  placeholder="npr. 10"
                />
              </label>
              <label className="block">
                <span className="label">Prvi period počinje</span>
                <Input
                  type="date"
                  value={current.anchor}
                  onChange={(e) => setDraft((d) => ({ ...d, anchor: e.target.value }))}
                />
              </label>
              <p className="col-span-2 -mt-1 text-[12px] text-stone-400">
                Periodi se nižu jedan za drugim, svaki traje tačno {current.days} {plural(current.days, 'dan')}, i
                idu unapred i unazad od izabranog datuma.
              </p>
            </div>
          )}

          <p className="rounded-xl bg-stone-50 px-3.5 py-2.5 text-[13px] text-stone-600 ring-1 ring-inset ring-stone-200">
            {example}
          </p>

          <Button className="w-full" loading={working} disabled={!dirty} onClick={save}>
            Sačuvaj
          </Button>
        </div>
      )}
    </Card>
  )
}
