import { useEffect, useMemo, useState } from 'react'

import { supabase } from '../lib/supabaseClient'
import { Button, Modal } from './ui'
import { SHIFT_LABELS, cx, errorMessage, formatDate, formatQty, shiftRank } from '../lib/utils'

const r2 = (n) => Math.round(Number(n) * 100) / 100

/** Smene idu redom: datum, pa prva → druga. */
const orderKey = (r) => `${r.report_date}|${shiftRank(r.shift)}|${r.created_at ?? ''}`

/**
 * Poređenje dve smene — admin bira sa kojom smenom poredi, a aplikacija
 * sama računa šta se poklapa a šta ne.
 *
 * Primer: krajnje stanje prve smene = početno stanje druge. Ako je izabrana
 * smena POSLE ove, poredi se krajnje ove sa početnim izabrane; ako je PRE,
 * poredi se krajnje izabrane sa početnim ove.
 */
export default function CompareShifts({ report, onClose }) {
  const [candidates, setCandidates] = useState([])
  const [otherId, setOtherId] = useState('')
  const [otherItems, setOtherItems] = useState(null)
  const [error, setError] = useState('')
  const [showOk, setShowOk] = useState(false)

  /* Smene u blizini (±5 dana), bez prazne „međusmene“. */
  useEffect(() => {
    let active = true
    const from = new Date(`${report.report_date}T12:00:00`)
    const lo = new Date(from)
    lo.setDate(lo.getDate() - 5)
    const hi = new Date(from)
    hi.setDate(hi.getDate() + 5)
    const iso = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    supabase
      .from('shift_reports')
      .select('id, report_date, shift, status, created_at')
      .gte('report_date', iso(lo))
      .lte('report_date', iso(hi))
      .neq('shift', 'medjusmena')
      .then(({ data, error: err }) => {
        if (!active) return
        if (err) {
          setError(errorMessage(err))
          return
        }
        const list = (data ?? [])
          .filter((r) => r.id !== report.id)
          .sort((a, b) => orderKey(a).localeCompare(orderKey(b)))
        setCandidates(list)

        // Podrazumevano: prva sledeća smena, a ako je nema — prethodna.
        const mine = orderKey(report)
        const next = list.find((r) => orderKey(r) > mine)
        const prev = [...list].reverse().find((r) => orderKey(r) < mine)
        setOtherId((next ?? prev)?.id ?? '')
      })

    return () => {
      active = false
    }
  }, [report])

  useEffect(() => {
    if (!otherId) {
      setOtherItems(null)
      return undefined
    }
    let active = true
    setOtherItems(null)
    supabase
      .from('shift_report_items')
      .select('item_id, item_name, category, unit, qty_start, qty_end')
      .eq('report_id', otherId)
      .then(({ data, error: err }) => {
        if (!active) return
        if (err) setError(errorMessage(err))
        else setOtherItems(data ?? [])
      })
    return () => {
      active = false
    }
  }, [otherId])

  const other = candidates.find((c) => c.id === otherId) ?? null
  const otherIsLater = other ? orderKey(other) > orderKey(report) : true

  /* Za svaki artikal: „krajnje“ one smene koja je ranija i „početno“ one koja je kasnija. */
  const result = useMemo(() => {
    if (!otherItems) return null
    const mine = new Map((report.items ?? []).map((i) => [i.item_id, i]))
    const theirs = new Map(otherItems.map((i) => [i.item_id, i]))
    const ids = new Set([...mine.keys(), ...theirs.keys()])

    const rows = []
    for (const id of ids) {
      const a = mine.get(id)
      const b = theirs.get(id)
      const name = a?.item_name ?? b?.item_name
      const category = a?.category ?? b?.category ?? ''
      const unit = a?.unit ?? b?.unit ?? ''
      // ranija smena daje krajnje, kasnija početno
      const end = otherIsLater ? a?.qty_end : b?.qty_end
      const start = otherIsLater ? b?.qty_start : a?.qty_start
      const known = end !== null && end !== undefined && start !== null && start !== undefined
      rows.push({
        id,
        name,
        category,
        unit,
        end,
        start,
        known,
        same: known && r2(end) === r2(start),
        diff: known ? r2(Number(start) - Number(end)) : null,
      })
    }
    rows.sort((x, y) => x.category.localeCompare(y.category, 'sr') || x.name.localeCompare(y.name, 'sr'))
    return {
      bad: rows.filter((r) => r.known && !r.same),
      ok: rows.filter((r) => r.same),
      unknown: rows.filter((r) => !r.known),
    }
  }, [otherItems, report, otherIsLater])

  const earlier = otherIsLater ? report : other
  const later = otherIsLater ? other : report

  return (
    <Modal open onClose={onClose} title="Uporedi smene" size="lg">
      <div className="space-y-4">
        <div className="rounded-2xl bg-stone-100 px-4 py-3 text-sm">
          <p className="font-bold text-stone-900">
            {formatDate(report.report_date)} · {SHIFT_LABELS[report.shift]}
          </p>
          <p className="mt-0.5 text-[12px] text-stone-500">poredi se sa:</p>
          <select
            value={otherId}
            onChange={(e) => setOtherId(e.target.value)}
            className="field mt-1.5"
            aria-label="Smena sa kojom se poredi"
          >
            {candidates.length === 0 && <option value="">Nema drugih smena u blizini</option>}
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {formatDate(c.report_date)} · {SHIFT_LABELS[c.shift]}
                {orderKey(c) > orderKey(report) ? ' (posle)' : ' (pre)'}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        {other && (
          <p className="text-[13px] text-stone-500">
            Krajnje stanje: <b className="text-stone-800">{SHIFT_LABELS[earlier.shift]}</b>{' '}
            {formatDate(earlier.report_date)} → početno stanje:{' '}
            <b className="text-stone-800">{SHIFT_LABELS[later.shift]}</b>{' '}
            {formatDate(later.report_date)}
          </p>
        )}

        {result === null && other && <p className="py-6 text-center text-sm text-stone-400">Računam…</p>}

        {result && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-emerald-50 py-2.5">
                <p className="text-xl font-extrabold tabular-nums text-emerald-700">{result.ok.length}</p>
                <p className="text-[11px] font-semibold text-emerald-800">poklapa se</p>
              </div>
              <div className={cx('rounded-2xl py-2.5', result.bad.length > 0 ? 'bg-rose-50' : 'bg-stone-100')}>
                <p className={cx('text-xl font-extrabold tabular-nums', result.bad.length > 0 ? 'text-rose-700' : 'text-stone-400')}>
                  {result.bad.length}
                </p>
                <p className={cx('text-[11px] font-semibold', result.bad.length > 0 ? 'text-rose-800' : 'text-stone-400')}>
                  ne poklapa se
                </p>
              </div>
              <div className="rounded-2xl bg-stone-100 py-2.5">
                <p className="text-xl font-extrabold tabular-nums text-stone-500">{result.unknown.length}</p>
                <p className="text-[11px] font-semibold text-stone-500">nema podatka</p>
              </div>
            </div>

            {result.bad.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-rose-200">
                <div className="grid grid-cols-[1fr_64px_64px_64px] gap-2 bg-rose-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                  <span>Ne poklapa se</span>
                  <span className="text-right">Krajnje</span>
                  <span className="text-right">Početno</span>
                  <span className="text-right">Razlika</span>
                </div>
                {result.bad.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-[1fr_64px_64px_64px] gap-2 border-t border-rose-100 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate font-semibold text-stone-800">{r.name}</span>
                    <span className="text-right tabular-nums text-stone-600">{formatQty(r.end)}</span>
                    <span className="text-right tabular-nums text-stone-600">{formatQty(r.start)}</span>
                    <span className="text-right font-extrabold tabular-nums text-rose-600">
                      {r.diff > 0 ? '+' : ''}
                      {formatQty(r.diff)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {result.ok.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowOk((v) => !v)}
                  aria-expanded={showOk}
                  className="text-sm font-semibold text-stone-500 hover:text-stone-800"
                >
                  {showOk ? 'Sakrij poklopljene ▴' : `Prikaži poklopljene (${result.ok.length}) ▾`}
                </button>
                {showOk && (
                  <ul className="mt-2 divide-y divide-stone-100 rounded-2xl border border-stone-200">
                    {result.ok.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                        <span className="min-w-0 truncate text-stone-700">{r.name}</span>
                        <span className="shrink-0 font-bold tabular-nums text-emerald-700">
                          ✓ {formatQty(r.end)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {result.unknown.length > 0 && (
              <p className="text-[12px] text-stone-400">
                Nema podatka (artikal nije popisan u jednoj od smena):{' '}
                {result.unknown.map((r) => r.name).join(', ')}
              </p>
            )}
          </>
        )}

        <Button variant="secondary" className="w-full" onClick={onClose}>
          Zatvori
        </Button>
      </div>
    </Modal>
  )
}
