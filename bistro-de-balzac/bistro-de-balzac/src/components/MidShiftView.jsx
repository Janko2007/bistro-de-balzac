import { useCallback, useEffect, useState } from 'react'

import { supabase } from '../lib/supabaseClient'
import { Card, CardHeader } from './ui'
import { SHIFT_LABELS, cx, formatMoney, formatQty } from '../lib/utils'

/**
 * Prva i druga smena za onoga ko radi međusmenu — samo za gledanje.
 *
 * Dok te smene traju, radnik u njih ulazi sam i uređuje ih preko izbora
 * smene gore. Ovde ostaju samo one koje ne može da menja, npr. već
 * zatvorena prva smena — da vidi šta je u njoj upisano.
 */
export default function MidShiftView({ date, myName }) {
  const [allShifts, setAllShifts] = useState([])
  const [open, setOpen] = useState(() => new Set())
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    if (!date) return
    const { data, error } = await supabase.rpc('midshift_view', { p_date: date })
    if (error) {
      // Baza bez skripte za međusmenu — sekcija se prosto ne prikazuje.
      console.error(error)
      setAllShifts([])
    } else {
      setAllShifts(Array.isArray(data) ? data : [])
    }
    setLoaded(true)
  }, [date])

  /* Smena u kojoj je radnik upisan i koja traje se uređuje gore — ovde
     bi bila samo duplirana. */
  const shifts = allShifts.filter((s) => {
    const mine = Array.isArray(s.staff) && s.staff.includes(myName)
    const editable = s.status === 'otvoren' || s.status === 'vracen'
    return !(mine && editable)
  })

  useEffect(() => {
    load()
  }, [load])

  /* Dok kolege kucaju, ovde se vidi isti taj unos. */
  useEffect(() => {
    if (!date) return undefined
    const channel = supabase
      .channel(`medjusmena-${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shift_report_items' },
        () => load(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [date, load])

  function toggle(shift) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(shift)) next.delete(shift)
      else next.add(shift)
      return next
    })
  }

  if (!loaded || shifts.length === 0) return null

  return (
    <Card>
      <CardHeader title="Prva i druga smena" subtitle="Samo za gledanje" />

      <div className="divide-y divide-stone-100">
        {shifts.map((s) => {
          const isOpen = open.has(s.shift)
          const items = Array.isArray(s.items) ? s.items : []
          const staff = Array.isArray(s.staff) ? s.staff : []
          const pazar = (Number(s.cash) || 0) + (Number(s.card) || 0)

          /* Artikli idu u grupe, istim redom kojim su stigli iz baze. */
          const groups = []
          for (const item of items) {
            const last = groups[groups.length - 1]
            if (last && last[0] === item.category) last[1].push(item)
            else groups.push([item.category, [item]])
          }

          return (
            <div key={s.shift}>
              <button
                type="button"
                onClick={() => toggle(s.shift)}
                aria-expanded={isOpen}
                className={cx(
                  'flex w-full items-center gap-2.5 px-4 py-3 text-left transition',
                  isOpen ? 'bg-stone-100' : 'bg-stone-50 hover:bg-stone-100',
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

                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-stone-900">
                    {SHIFT_LABELS[s.shift] ?? s.shift}
                  </span>
                  <span className="block truncate text-xs text-stone-400">
                    {staff.length > 0 ? staff.join(', ') : 'još niko nije ušao'}
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold tabular-nums text-stone-900">
                    {pazar > 0 ? formatMoney(pazar, false) : '—'}
                  </span>
                  <span className="block text-[11px] text-stone-400">
                    {items.length > 0 ? `${items.length} popisano` : 'nema popisa'}
                  </span>
                </span>
              </button>

              {isOpen && items.length === 0 && (
                <p className="px-4 py-5 text-center text-sm text-stone-500">
                  U ovoj smeni još ništa nije upisano.
                </p>
              )}

              {isOpen && items.length > 0 && (
                <div>
                  <div className="flex items-center justify-end gap-1.5 border-b border-stone-100 bg-white px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                    <span className="w-[52px] text-center">Poč.</span>
                    <span className="w-[52px] text-center">Dod.</span>
                    <span className="w-[52px] text-center">Prod.</span>
                    <span className="w-[56px] text-right">Kraj</span>
                  </div>

                  {groups.map(([category, catItems]) => (
                    <div key={category}>
                      <p className="bg-stone-50/70 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-500">
                        {category}
                      </p>
                      {catItems.map((item) => (
                        <div
                          key={item.item_id}
                          className="flex items-center gap-x-3 px-4 py-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm text-stone-700">
                            {item.name}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 text-sm tabular-nums">
                            <span className="w-[52px] text-center text-stone-500">
                              {item.qty_start === null ? '—' : formatQty(item.qty_start)}
                            </span>
                            <span className="w-[52px] text-center text-stone-500">
                              {item.qty_added === null ? '—' : formatQty(item.qty_added)}
                            </span>
                            <span className="w-[52px] text-center font-semibold text-stone-800">
                              {item.qty_sold === null ? '—' : formatQty(item.qty_sold)}
                            </span>
                            <span className="w-[56px] text-right font-bold text-stone-900">
                              {item.qty_end === null ? '—' : formatQty(item.qty_end)}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
