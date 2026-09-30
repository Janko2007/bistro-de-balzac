import { useEffect, useMemo, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { categoryComparator } from '../lib/categories'
import { heading, printDocument, statGrid, table } from '../lib/print'
import MonthPicker from './MonthPicker'
import ReportPicker from './ReportPicker'
import { Button, Card, CategoryToggle, Stat, StatRow } from './ui'
import {
  countLabel,
  cx,
  errorMessage,
  formatMonth,
  formatQty,
  monthRange,
  todayISO,
} from '../lib/utils'

/** "2026-09-15" → "2026-09" */
const monthOf = (iso) => String(iso).slice(0, 7)

/**
 * Prodaja po artiklima za ceo mesec — koliko je čega prodato.
 *
 * Sabira „prodato“ iz svih zatvorenih smena u mesecu (radi baza, funkcija
 * `item_sales`). Prikazuje SVE artikle — i one koji tog meseca nisu prodati.
 * Dva prikaza: po kategorijama (kao popis) ili najprodavanije prvo.
 */
export default function ItemSalesReport({ items, categories }) {
  const toast = useToast()

  const [month, setMonth] = useState(() => monthOf(todayISO()))
  const [sales, setSales] = useState(null) // null = učitava se
  const [shiftCount, setShiftCount] = useState(0)
  const [open, setOpen] = useState(false) // cela kartica zatvorena dok se ne klikne
  const [view, setView] = useState('kategorije') // 'kategorije' | 'najprodavanije'
  const [openCats, setOpenCats] = useState(() => new Set())
  const [pickerOpen, setPickerOpen] = useState(false)

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

  /** Prodaja na papiru — `parts` bira šta ulazi. */
  function printSales(parts) {
    const has = (key) => parts.includes(key)

    const columns = [
      { label: 'Artikal' },
      { label: 'Jed.', width: '10%' },
      { label: 'Smena', align: 'right', width: '12%' },
      { label: 'Prodato', align: 'right', width: '14%' },
    ]

    const bodyRows = []
    for (const [cat, list] of grouped) {
      const catTotal = list.reduce((s, r) => s + r.sold, 0)
      bodyRows.push({ kind: 'group', label: cat, right: formatQty(catTotal) })
      for (const r of list) {
        bodyRows.push({
          muted: r.sold === 0,
          cells: [
            r.name,
            r.unit,
            r.sold === 0 ? '—' : String(r.shifts),
            { value: formatQty(r.sold), strong: r.sold > 0 },
          ],
        })
      }
    }
    bodyRows.push({ kind: 'total', cells: ['Ukupno prodato', '', '', formatQty(total)] })

    const topColumns = [
      { label: '#', align: 'right', width: '7%' },
      { label: 'Artikal' },
      { label: 'Kategorija', width: '26%' },
      { label: 'Prodato', align: 'right', width: '14%' },
    ]
    const topRows = ranked
      .slice(0, 20)
      .map((r, i) => [`${i + 1}.`, `${r.name} (${r.unit})`, r.category, formatQty(r.sold)])

    printDocument({
      title: 'Prodaja po artiklima',
      subtitle: `${formatMonth(month)} · ${countLabel(shiftCount, 'smena')} zatvoreno`,
      meta: [
        { label: 'Mesec', value: formatMonth(month) },
        { label: 'Prodato artikala', value: `${soldItems} od ${rows.length}` },
      ],
      content: [
        has('zbir')
          ? statGrid([
              { label: 'Ukupno prodato', value: formatQty(total), sub: 'komada / jedinica' },
              { label: 'Prodatih artikala', value: String(soldItems), sub: `od ${rows.length}` },
              { label: 'Smena', value: String(shiftCount), sub: 'zatvorenih' },
            ])
          : '',
        has('kategorije') ? heading('Po kategorijama') : '',
        has('kategorije')
          ? table({ columns, rows: bodyRows, empty: 'Za ovaj mesec nema prodaje.' })
          : '',
        has('najprodavanije') && topRows.length > 0 ? heading('Najprodavanije', 'prvih 20') : '',
        has('najprodavanije') && topRows.length > 0
          ? table({ columns: topColumns, rows: topRows })
          : '',
      ].join(''),
    })
  }

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
      {/* Šta ulazi u preuzet izveštaj */}
      <ReportPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={`Preuzmi prodaju — ${formatMonth(month)}`}
        options={[
          { key: 'zbir', label: 'Zbirni pregled' },
          { key: 'kategorije', label: 'Po kategorijama' },
          { key: 'najprodavanije', label: 'Najprodavanije' },
        ]}
        onConfirm={printSales}
      />

      {/* ---------- Izbor meseca i prikaza ---------- */}
      <div className="space-y-3 border-y border-stone-100 px-4 py-3">
        <MonthPicker month={month} onChange={setMonth} />

        <div className="flex flex-wrap items-center gap-1.5">
          {rows.length > 0 && (
            <span className="order-last ml-auto flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                Preuzmi
              </Button>
              <Button variant="secondary" size="sm" onClick={exportCsv}>
                CSV
              </Button>
            </span>
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
