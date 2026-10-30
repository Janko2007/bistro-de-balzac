import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { loadCategories, nextCountOn } from '../lib/categories'
import { loadCountItems, loadCounts, loadStatus, removeCount, saveCount } from '../lib/inventory'
import { cx, errorMessage, formatDate, formatDateTime, formatQty } from '../lib/utils'
import { Button, Input, Modal } from './ui'

const TABS = [
  { key: 'novi', label: 'Novi popis' },
  { key: 'istorija', label: 'Istorija' },
  { key: 'raspored', label: 'Raspored' },
]

/** „12,5“ ili „12.5“ → 12.5; prazno ili neispravno → null. */
function toQty(text) {
  const t = String(text ?? '').trim().replace(',', '.')
  if (t === '' || !/^\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

/** Razlika izbrojano − očekivano, kao oznaka. Minus znači da fali. */
function DiffBadge({ diff, unit }) {
  if (diff === null) return null
  const d = Math.round(diff * 100) / 100
  if (d === 0) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
        tačno
      </span>
    )
  }
  return (
    <span
      className={cx(
        'rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ring-1 ring-inset',
        d < 0
          ? 'bg-rose-50 text-rose-700 ring-rose-600/20'
          : 'bg-amber-50 text-amber-800 ring-amber-600/20',
      )}
    >
      {d < 0 ? `fali ${formatQty(-d)}` : `višak ${formatQty(d)}`}
      {unit ? ` ${unit}` : ''}
    </span>
  )
}

/**
 * Popisi (admin): brojanje artikala, istorija popisa i raspored popisivanja.
 *
 * Izbrojano stanje postaje početno stanje sledeće smene. Pri svakom novom
 * popisu se vidi koliko čega fali od poslednjeg.
 */
export default function InventoryManager({ open, onClose, items, categories, onChanged }) {
  const toast = useToast()

  const [tab, setTab] = useState('novi')
  const [status, setStatus] = useState(null) // Map(item_id -> stanje) | null dok se učitava
  const [statusError, setStatusError] = useState('')
  const [picked, setPicked] = useState(null) // Set naziva grupa; null = još nije izabrano
  const [values, setValues] = useState({}) // item_id -> tekst
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const [counts, setCounts] = useState(null)
  const [openCount, setOpenCount] = useState(null) // { id, rows } | { id, loading }
  const [toDelete, setToDelete] = useState(null)

  const [plan, setPlan] = useState({}) // category id -> { days, on }
  const [planBusy, setPlanBusy] = useState(false)

  const activeCategories = useMemo(() => categories.filter((c) => c.is_active), [categories])

  const reloadStatus = useCallback(async () => {
    setStatusError('')
    try {
      setStatus(await loadStatus())
    } catch (err) {
      console.error(err)
      setStatus(new Map())
      setStatusError(
        'Popisi još nisu uključeni u bazi. Pusti skriptu AZURIRANJE-BAZE-21 u Supabase-u.',
      )
    }
  }, [])

  const reloadCounts = useCallback(async () => {
    try {
      setCounts(await loadCounts())
    } catch (err) {
      console.error(err)
      setCounts([])
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setTab('novi')
    setValues({})
    setNote('')
    setOpenCount(null)
    setToDelete(null)
    setStatus(null)
    setCounts(null)
    reloadStatus()
    reloadCounts()
  }, [open, reloadStatus, reloadCounts])

  // Grupe koje se popisuju na X dana (žestine) su unapred izabrane.
  useEffect(() => {
    if (!open || picked !== null) return
    const scheduled = activeCategories.filter((c) => Number(c.count_every_days) > 0)
    setPicked(new Set((scheduled.length ? scheduled : activeCategories.slice(0, 1)).map((c) => c.name)))
  }, [open, picked, activeCategories])

  useEffect(() => {
    if (!open) return
    const next = {}
    for (const c of activeCategories) {
      next[c.id] = { days: String(c.count_every_days ?? 0), on: c.count_on ?? '' }
    }
    setPlan(next)
  }, [open, activeCategories])

  const itemsByCategory = useMemo(() => {
    const map = new Map()
    for (const item of items.filter((i) => i.is_active)) {
      if (!map.has(item.category)) map.set(item.category, [])
      map.get(item.category).push(item)
    }
    for (const list of map.values()) list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    return map
  }, [items])

  const shownCategories = activeCategories.filter(
    (c) => picked?.has(c.name) && (itemsByCategory.get(c.name)?.length ?? 0) > 0,
  )

  const filled = useMemo(() => {
    const out = []
    for (const [id, text] of Object.entries(values)) {
      const qty = toQty(text)
      if (qty !== null) out.push({ item_id: id, qty })
    }
    return out
  }, [values])

  const invalid = Object.values(values).some((t) => String(t).trim() !== '' && toQty(t) === null)

  function togglePick(name) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function save() {
    if (filled.length === 0) return toast.error('Upiši stanje bar jednog artikla.')
    if (invalid) return toast.error('Neki broj nije ispravan.')

    // Grupa se računa kao popisana samo ako je svaki njen artikal upisan.
    const whole = activeCategories
      .filter((c) => {
        const list = itemsByCategory.get(c.name) ?? []
        return list.length > 0 && list.every((i) => toQty(values[i.id]) !== null)
      })
      .map((c) => c.name)

    setSaving(true)
    try {
      await saveCount({ items: filled, categories: whole, note: note.trim() })
      toast.success('Popis je sačuvan. Ovo je početno stanje sledeće smene.')
      setValues({})
      setNote('')
      await Promise.all([reloadStatus(), reloadCounts()])
      onChanged?.()
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Popis nije sačuvan. Da li je puštena skripta -21?'))
    }
    setSaving(false)
  }

  async function showCount(id) {
    if (openCount?.id === id) return setOpenCount(null)
    setOpenCount({ id, loading: true })
    try {
      setOpenCount({ id, rows: await loadCountItems(id) })
    } catch (err) {
      toast.error(errorMessage(err))
      setOpenCount(null)
    }
  }

  async function deleteCount(id) {
    setSaving(true)
    try {
      await removeCount(id)
      toast.success('Popis je obrisan.')
      setToDelete(null)
      setOpenCount(null)
      await Promise.all([reloadStatus(), reloadCounts()])
    } catch (err) {
      toast.error(errorMessage(err))
    }
    setSaving(false)
  }

  async function savePlan() {
    setPlanBusy(true)
    try {
      for (const c of activeCategories) {
        const p = plan[c.id]
        if (!p) continue
        const on = p.on || null
        // Datum ima smisla samo kad se grupa ne popisuje svaku smenu.
        let days = Math.max(0, Math.round(Number(p.days) || 0))
        if (on && days === 0) days = 7
        if (days === Number(c.count_every_days ?? 0) && (on ?? null) === (c.count_on ?? null)) continue
        const { error } = await supabase
          .from('categories')
          .update({ count_every_days: days, count_on: on })
          .eq('id', c.id)
        if (error) throw error
      }
      toast.success('Raspored je sačuvan.')
      onChanged?.()
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Raspored nije sačuvan. Da li je puštena skripta -21?'))
    }
    setPlanBusy(false)
  }

  return (
    <Modal open={open} onClose={() => !saving && !planBusy && onClose()} title="Popisi" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={cx(
                'rounded-2xl px-2 py-2.5 text-[13px] font-semibold transition',
                tab === t.key ? 'bg-ink text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ---------------- NOVI POPIS ---------------- */}
        {tab === 'novi' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {activeCategories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => togglePick(c.name)}
                  aria-pressed={picked?.has(c.name)}
                  className={cx(
                    'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                    picked?.has(c.name)
                      ? 'bg-brand-600 text-white'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200',
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>

            {statusError && (
              <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20">
                {statusError}
              </p>
            )}

            {status === null ? (
              <p className="py-6 text-center text-sm text-stone-400">Učitavam…</p>
            ) : shownCategories.length === 0 ? (
              <p className="py-6 text-center text-sm text-stone-400">Izaberi grupu iznad.</p>
            ) : (
              <div className="space-y-4">
                {shownCategories.map((c) => (
                  <section key={c.id}>
                    <h3 className="mb-1 text-sm font-extrabold tracking-tight text-stone-900">{c.name}</h3>
                    <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200">
                      {(itemsByCategory.get(c.name) ?? []).map((item) => {
                        const st = status.get(item.id)
                        const typed = toQty(values[item.id])
                        const diff =
                          typed !== null && st && st.expected !== null ? typed - st.expected : null
                        return (
                          <li key={item.id} className="px-3 py-2.5">
                            <div className="flex items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-stone-900">{item.name}</p>
                                <p className="text-[11px] text-stone-400">
                                  {st && st.expected !== null ? (
                                    <>
                                      očekivano <b className="text-stone-600">{formatQty(st.expected)}</b>
                                      {item.unit ? ` ${item.unit}` : ''}
                                    </>
                                  ) : (
                                    'nema prethodnog stanja'
                                  )}
                                </p>
                              </div>
                              <Input
                                inputMode="decimal"
                                placeholder="0"
                                value={values[item.id] ?? ''}
                                onChange={(e) => setValues((v) => ({ ...v, [item.id]: e.target.value }))}
                                aria-label={`Izbrojano: ${item.name}`}
                                className="!w-24 text-right tabular-nums"
                              />
                            </div>

                            {/* Šta se desilo od poslednjeg popisa. */}
                            {st && st.prevAt && (
                              <p className="mt-1 text-[11px] leading-relaxed text-stone-400">
                                popis {formatDate(st.prevAt.slice(0, 10))}: {formatQty(st.prevQty)} · prodato{' '}
                                {formatQty(st.sold)} · dodato {formatQty(st.added)}
                              </p>
                            )}
                            {diff !== null && (
                              <div className="mt-1">
                                <DiffBadge diff={diff} unit={item.unit} />
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Napomena (nije obavezno)"
              aria-label="Napomena"
            />

            <p className="rounded-xl bg-stone-100 px-3.5 py-2.5 text-xs leading-relaxed text-stone-600">
              Šta ostaviš prazno, ne popisuje se. Izbrojano stanje postaje <b>početno stanje sledeće
              smene</b>, pa se od njega skida prodato.
            </p>

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
                Zatvori
              </Button>
              <Button className="flex-1" loading={saving} disabled={filled.length === 0 || invalid} onClick={save}>
                Sačuvaj popis{filled.length > 0 ? ` (${filled.length})` : ''}
              </Button>
            </div>
          </div>
        )}

        {/* ---------------- ISTORIJA ---------------- */}
        {tab === 'istorija' && (
          <div className="space-y-2">
            {counts === null ? (
              <p className="py-6 text-center text-sm text-stone-400">Učitavam…</p>
            ) : counts.length === 0 ? (
              <p className="py-6 text-center text-sm text-stone-400">Još nema popisa.</p>
            ) : (
              <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200">
                {counts.map((c) => {
                  const detail = openCount?.id === c.id ? openCount : null
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => showCount(c.id)}
                        aria-expanded={Boolean(detail)}
                        className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-stone-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-stone-900">
                            {formatDateTime(c.counted_at)}
                          </span>
                          <span className="block truncate text-[11px] text-stone-400">
                            {c.creator?.full_name ?? 'admin'}
                            {c.note ? ` · ${c.note}` : ''}
                          </span>
                        </span>
                        <span aria-hidden="true" className="text-stone-300">
                          {detail ? '▴' : '▾'}
                        </span>
                      </button>

                      {detail && (
                        <div className="border-t border-stone-100 bg-stone-50/50 px-3 py-3">
                          {detail.loading ? (
                            <p className="text-sm text-stone-400">Učitavam…</p>
                          ) : (
                            <>
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[520px] text-left text-xs">
                                  <thead className="text-[10px] uppercase tracking-wide text-stone-400">
                                    <tr>
                                      <th className="py-1 pr-2 font-semibold">Artikal</th>
                                      <th className="px-2 py-1 text-right font-semibold">Prošli</th>
                                      <th className="px-2 py-1 text-right font-semibold">Prodato</th>
                                      <th className="px-2 py-1 text-right font-semibold">Dodato</th>
                                      <th className="px-2 py-1 text-right font-semibold">Očekivano</th>
                                      <th className="px-2 py-1 text-right font-semibold">Izbrojano</th>
                                      <th className="py-1 pl-2 text-right font-semibold">Razlika</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-stone-100 tabular-nums">
                                    {[...detail.rows]
                                      .sort((a, b) => String(a.category).localeCompare(String(b.category), 'sr') || a.item_name.localeCompare(b.item_name, 'sr'))
                                      .map((r) => {
                                        const diff =
                                          r.expected_qty === null ? null : Number(r.counted_qty) - Number(r.expected_qty)
                                        return (
                                          <tr key={r.id}>
                                            <td className="py-1.5 pr-2 font-semibold text-stone-800">{r.item_name}</td>
                                            <td className="px-2 py-1.5 text-right text-stone-500">{formatQty(r.prev_counted_qty)}</td>
                                            <td className="px-2 py-1.5 text-right text-stone-500">{formatQty(r.sold_since)}</td>
                                            <td className="px-2 py-1.5 text-right text-stone-500">{formatQty(r.added_since)}</td>
                                            <td className="px-2 py-1.5 text-right text-stone-500">{formatQty(r.expected_qty)}</td>
                                            <td className="px-2 py-1.5 text-right font-bold text-stone-900">{formatQty(r.counted_qty)}</td>
                                            <td className="py-1.5 pl-2 text-right">
                                              <DiffBadge diff={diff} />
                                            </td>
                                          </tr>
                                        )
                                      })}
                                  </tbody>
                                </table>
                              </div>

                              {toDelete === c.id ? (
                                <div className="mt-3 rounded-lg bg-rose-50 p-2.5 ring-1 ring-inset ring-rose-200">
                                  <p className="text-xs font-bold text-rose-900">Obrisati ovaj popis?</p>
                                  <p className="mt-0.5 text-[11px] text-rose-800">
                                    Stanje se vraća na ono pre njega.
                                  </p>
                                  <div className="mt-2 flex justify-end gap-2">
                                    <Button variant="secondary" size="sm" onClick={() => setToDelete(null)}>
                                      Ne
                                    </Button>
                                    <Button variant="danger" size="sm" loading={saving} onClick={() => deleteCount(c.id)}>
                                      Da, obriši
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-2 text-right">
                                  <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setToDelete(c.id)}>
                                    Obriši popis
                                  </Button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {/* ---------------- RASPORED ---------------- */}
        {tab === 'raspored' && (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              Na koliko dana se grupa popisuje i kog datuma je sledeći popis. Na taj dan radnik u smeni
              upisuje početno stanje. Prazno = ne zakazuje se.
            </p>
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200">
              {activeCategories.map((c) => {
                const p = plan[c.id] ?? { days: '0', on: '' }
                const auto = nextCountOn(c)
                return (
                  <li key={c.id} className="px-3 py-3">
                    <p className="text-sm font-bold text-stone-900">{c.name}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="block text-[11px] font-semibold text-stone-500">
                        Na svakih (dana)
                        <Input
                          type="number"
                          min="0"
                          max="90"
                          value={p.days}
                          onChange={(e) => setPlan((s) => ({ ...s, [c.id]: { ...p, days: e.target.value } }))}
                          className="mt-1"
                        />
                      </label>
                      <label className="block text-[11px] font-semibold text-stone-500">
                        Sledeći popis
                        <Input
                          type="date"
                          value={p.on}
                          onChange={(e) => setPlan((s) => ({ ...s, [c.id]: { ...p, on: e.target.value } }))}
                          className="mt-1"
                        />
                      </label>
                    </div>
                    <p className="mt-1.5 text-[11px] text-stone-400">
                      {Number(c.count_every_days) > 0
                        ? `Sada: na ${c.count_every_days} dana${auto ? ` · sledeći ${formatDate(auto)}` : ''}`
                        : 'Sada: svaku smenu'}
                    </p>
                  </li>
                )
              })}
            </ul>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onClose} disabled={planBusy}>
                Zatvori
              </Button>
              <Button className="flex-1" loading={planBusy} onClick={savePlan}>
                Sačuvaj raspored
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
