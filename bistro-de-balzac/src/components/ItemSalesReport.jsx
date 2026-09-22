import { useEffect, useMemo, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { categoryComparator } from '../lib/categories'
import { Button, Card, CategoryToggle, Input, Stat, StatRow } from './ui'
import {
  countLabel,
  cx,
  errorMessage,
  formatMonth,
  formatQty,
  monthRange,
  parseDateInput,
  todayISO,
} from '../lib/utils'

/** "2026-09-15" → "2026-09" */
const monthOf = (iso) => String(iso).slice(0, 7)

/** "2026-09" → "09.2026" (kako se kuca u polje) */
const monthText = (month) => {
  const [y, m] = month.split('-')
  return `${m}.${y}`
}

/** Mesec pomeren za `delta` meseci. */
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Prodaja po artiklima za ceo mesec — koliko je čega prodato.
 *
 * Sabira „prodato“ iz svih zatvorenih smena u mesecu (radi baza, funkcija
 * `item_sales`). Prikazuje SVE artikle — i one koji tog meseca nisu prodati.
 * Dva prikaza: po kategorijama (kao popis) ili najprodavanije prvo.
 */
export default function ItemSalesReport({ items, categories }) {
  const toast = useToast()

  const thisMonth = monthOf(todayISO())
  const [month, setMonth] = useState(thisMonth)
  const [text, setText] = useState(() => monthText(thisMonth))
  const [sales, setSales] = useState(null) // null = učitava se
  const [shiftCount, setShiftCount] = useState(0)
  const [open, setOpen] = useState(false) // cela kartica zatvorena dok se ne klikne
  const [view, setView] = useState('kategorije') // 'kategorije' | 'najprodavanije'
  const [openCats, setOpenCats] = useState(() => new Set())

  useEffect(() => {
    let active = true
    const { from, to } = monthRange(month)
    setSales(null)

    Promise.all([
      supabase.rpc('item_sales', { p_from: from, p_to: to }),
      supabase
        .from('shift_reports')
        .select('id', { count: 'exact', head: true })
        .gte('report_date', from)
        .lte('report_date', to)
        .neq('status', 'otvoren'),
    ]).then(([salesRes, countRes]) => {
      if (!active) return
      if (salesRes.error) {
        toast.error(errorMessage(salesRes.error, 'Ne mogu da učitam prodaju.'))
        setSales([])
        return
      }
      setSales(salesRes.data ?? [])
      setShiftCount(countRes.count ?? 0)
    })

    return () => {
      active = false
    }
  }, [month, toast])

  /** Kucanje meseca: 09.2026, 9.2026, 2026-09 — ili bilo koji datum iz tog meseca. */
  function applyText(value) {
    setText(value)
    const range = parseDateInput(value)
    if (range) setMonth(monthOf(range.from))
  }

  function pick(m) {
    setMonth(m)
    setText(monthText(m))
  }

  /* Svi artikli — i oni koji tog meseca nisu prodati (0). */
  const rows = useMemo(() => {
    if (!sales) return []
    const byId = new Map(sales.map((s) => [s.item_id, s]))

    const out = items
      .filter((i) => i.is_active || byId.has(i.id))
      .map((i) => {
        const s = byId.get(i.id)
        return {
          id: i.id,
          name: i.name,
          unit: i.unit,
          category: i.category,
          sort: i.sort_order ?? 99999,
          sold: Number(s?.sold ?? 0),
          shifts: Number(s?.shifts ?? 0),
        }
      })

    // Prodaja artikla koji je u međuvremenu obrisan iz menija ne sme da nestane.
    const known = new Set(items.map((i) => i.id))
    for (const s of sales) {
      if (known.has(s.item_id)) continue
      out.push({
        id: s.item_id,
        name: s.item_name,
        unit: s.unit,
        category: s.category,
        sort: 99999,
        sold: Number(s.sold ?? 0),
        shifts: Number(s.shifts ?? 0),
      })
    }
    return out
  }, [sales, items])

  const total = rows.reduce((sum, r) => sum + r.sold, 0)
  const soldItems = rows.filter((r) => r.sold > 0).length

  const grouped = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const key = r.category || 'Ostalo'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    for (const list of map.values()) list.sort((a, b) => a.sort - b.sort)
    const compare = categoryComparator(categories)
    return Array.from(map.entries()).sort((a, b) => compare(a[0], b[0]))
  }, [rows, categories])

  const ranked = useMemo(
    () => rows.filter((r) => r.sold > 0).sort((a, b) => b.sold - a.sold),
    [rows],
  )

  function toggleCat(cat) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  function exportCsv() {
    const header = ['Kategorija', 'Artikal', 'Jedinica', 'Prodato', 'Broj smena']
    const lines = grouped.flatMap(([cat, list]) =>
      list.map((r) => [cat, r.name, r.unit, formatQty(r.sold), r.shifts]),
    )
    const csv = [header, ...lines]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
      .join('\r\n')

    // BOM da Excel ispravno prikaže naša slova (č, ć, š, ž, đ)
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prodaja-${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const bad = text.trim() !== '' && !parseDateInput(text)

  return (
    <Card>
      {/* Cela sekcija je zatvorena dok se ne klikne na naslov. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
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
          <span className="block text-[15px] font-semibold tracking-tight text-stone-900">
            Prodaja po artiklima
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-stone-500">
            {formatMonth(month)} · {countLabel(shiftCount, 'smena')}
          </span>
        </span>
        {sales !== null && (
          <span className="shrink-0 text-[15px] font-extrabold tabular-nums text-brand-700">
            {formatQty(total)}
          </span>
        )}
      </button>

      {open && (
      <>
      {/* ---------- Izbor meseca i prikaza ---------- */}
      <div className="space-y-3 border-y border-stone-100 px-4 py-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="sales-month">
              Mesec
            </label>
            <Input
              id="sales-month"
              inputMode="numeric"
              autoComplete="off"
              value={text}
              onChange={(e) => applyText(e.target.value)}
              placeholder="09.2026"
              className={cx('w-[130px]', bad && 'border-rose-400')}
            />
          </div>
          <Button
            variant={month === thisMonth ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => pick(thisMonth)}
          >
            Ovaj mesec
          </Button>
          <Button
            variant={month === shiftMonth(thisMonth, -1) ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => pick(shiftMonth(thisMonth, -1))}
          >
            Prošli mesec
          </Button>
        </div>
        {bad && (
          <p className="text-xs font-medium text-rose-600">
            Nije prepoznat mesec. Probaj 09.2026 ili 2026-09.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {rows.length > 0 && (
            <Button variant="secondary" size="sm" className="order-last ml-auto" onClick={exportCsv}>
              CSV
            </Button>
          )}
          {[
            ['kategorije', 'Po kategorijama'],
            ['najprodavanije', 'Najprodavanije'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={cx(
                'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                view === key
                  ? 'bg-brand-600 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {sales === null ? (
        <p className="px-4 py-8 text-center text-sm text-stone-500">Učitavanje…</p>
      ) : (
        <>
          <StatRow className="mx-4 my-3 grid-cols-3">
            <Stat label="Ukupno prodato" value={formatQty(total)} tone="total" />
            <Stat label="Prodatih artikala" value={soldItems} sub={`od ${rows.length}`} />
            <Stat label="Smena" value={shiftCount} sub="zatvorenih" />
          </StatRow>

          {shiftCount === 0 && (
            <p className="px-4 pb-4 text-center text-sm text-stone-500">
              Za {formatMonth(month)} još nema zatvorenih smena.
            </p>
          )}

          {view === 'kategorije' ? (
            <div className="divide-y divide-stone-100 border-t border-stone-100">
              {grouped.map(([cat, list]) => {
                const open = openCats.has(cat)
                const catTotal = list.reduce((s, r) => s + r.sold, 0)
                return (
                  <div key={cat}>
                    <CategoryToggle
                      title={cat}
                      open={open}
                      onToggle={() => toggleCat(cat)}
                      right={
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-stone-500">
                          prodato {formatQty(catTotal)}
                        </span>
                      }
                    />
                    {open && (
                      <ul className="divide-y divide-stone-100">
                        {list.map((r) => (
                          <SalesRow key={r.id} row={r} />
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="border-t border-stone-100">
              {ranked.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-stone-500">
                  Ovog meseca još ništa nije prodato.
                </p>
              ) : (
                <ol className="divide-y divide-stone-100">
                  {ranked.map((r, i) => (
                    <SalesRow key={r.id} row={r} rank={i + 1} showCategory />
                  ))}
                </ol>
              )}
              {rows.length - ranked.length > 0 && (
                <p className="border-t border-stone-100 px-4 py-2.5 text-xs text-stone-500">
                  {countLabel(rows.length - ranked.length, 'artikal')} ovog meseca nije prodato —
                  vide se u prikazu „Po kategorijama“.
                </p>
              )}
            </div>
          )}
        </>
      )}
      </>
      )}
    </Card>
  )
}

/** Jedan artikal: naziv, u koliko smena je prodavan i koliko je ukupno prodato. */
function SalesRow({ row, rank, showCategory }) {
  const none = row.sold === 0
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      {rank && (
        <span className="w-6 shrink-0 text-right text-xs font-bold tabular-nums text-stone-400">
          {rank}.
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cx(
            'truncate text-sm font-medium',
            none ? 'text-stone-400' : 'text-stone-800',
          )}
        >
          {row.name}
          <span className="ml-1.5 text-xs font-normal text-stone-400">{row.unit}</span>
        </p>
        <p className="truncate text-[11px] text-stone-400">
          {showCategory ? `${row.category} · ` : ''}
          {none ? 'nije prodato' : `u ${countLabel(row.shifts, 'smena')}`}
        </p>
      </div>
      <span
        className={cx(
          'shrink-0 text-base font-extrabold tabular-nums',
          none ? 'text-stone-300' : 'text-stone-900',
        )}
      >
        {formatQty(row.sold)}
      </span>
    </li>
  )
}
