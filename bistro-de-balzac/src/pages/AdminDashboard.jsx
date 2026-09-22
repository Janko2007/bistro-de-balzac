import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Stat,
} from '../components/ui'
import ReportListItem from '../components/ReportListItem'
import StorageCleanup from '../components/StorageCleanup'
import {
  LOCALE,
  SHIFTS,
  SHIFT_LABELS,
  STATUS_LABELS,
  cx,
  daysAgoISO,
  errorMessage,
  formatDate,
  formatMoney,
  parseDateInput,
  todayISO,
} from '../lib/utils'

const QUICK_RANGES = [
  { label: 'Danas', from: () => todayISO(), to: () => todayISO() },
  { label: 'Juče i danas', from: () => daysAgoISO(1), to: () => todayISO() },
  { label: '7 dana', from: () => daysAgoISO(6), to: () => todayISO() },
  { label: '30 dana', from: () => daysAgoISO(29), to: () => todayISO() },
  { label: 'Tekući mesec', from: () => `${todayISO().slice(0, 7)}-01`, to: () => todayISO() },
]


export default function AdminDashboard() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [reports, setReports] = useState([])
  const [workers, setWorkers] = useState([])

  // Podrazumevano se vide samo juče i danas — ostalo se otvara kroz filtere.
  const [from, setFrom] = useState(daysAgoISO(1))
  const [to, setTo] = useState(todayISO())
  const [shift, setShift] = useState('')
  const [status, setStatus] = useState('')
  const [worker, setWorker] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('is_deleted', false)
      .order('full_name')
      .then(({ data, error }) => {
        if (error) console.error(error)
        else setWorkers(data ?? [])
      })
  }, [])

  /* Pretraga po datumu privremeno zamenjuje izabrani period — tako se
     traženi dan nađe i kad je filter podešen samo na juče i danas. */
  const dateSearch = useMemo(() => parseDateInput(debounced), [debounced])
  const searchInvalid = debounced.trim() !== '' && dateSearch === null
  const rangeFrom = dateSearch?.from ?? from
  const rangeTo = dateSearch?.to ?? to

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)

    let query = supabase
      .from('report_summary')
      .select('*')
      .gte('report_date', rangeFrom)
      .lte('report_date', rangeTo)
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(300)

    if (shift) query = query.eq('shift', shift)
    if (status) query = query.eq('status', status)
    if (worker) query = query.eq('created_by', worker)

    const { data, error } = await query

    if (error) toast.error(errorMessage(error))
    else setReports(data ?? [])
    setLoading(false)
  }, [rangeFrom, rangeTo, shift, status, worker, toast])

  useEffect(() => {
    load()
  }, [load])

  const totals = useMemo(() => {
    return reports.reduce(
      (acc, r) => {
        acc.cash += Number(r.cash_amount ?? 0)
        acc.card += Number(r.card_amount ?? 0)
        acc.total += Number(r.total_amount ?? 0)
        if (r.status === 'poslat') acc.pending += 1
        return acc
      },
      { cash: 0, card: 0, total: 0, pending: 0 },
    )
  }, [reports])

  /** Grupisanje po datumu za pregledniju listu. */
  const byDate = useMemo(() => {
    const map = new Map()
    for (const r of reports) {
      if (!map.has(r.report_date)) map.set(r.report_date, [])
      map.get(r.report_date).push(r)
    }
    return Array.from(map.entries())
  }, [reports])

  function applyQuickRange(range) {
    setFrom(range.from())
    setTo(range.to())
  }

  function resetFilters() {
    setFrom(daysAgoISO(1))
    setTo(todayISO())
    setShift('')
    setStatus('')
    setWorker('')
  }

  /* Kratak opis izabranih filtera — vidi se i kad je meni zatvoren. */
  const activeRange = QUICK_RANGES.find((r) => r.from() === from && r.to() === to)
  const extraCount = [shift, status, worker].filter(Boolean).length

  const filterSummary = [
    activeRange ? activeRange.label : `${formatDate(from)} – ${formatDate(to)}`,
    shift ? SHIFT_LABELS[shift] : null,
    status ? STATUS_LABELS[status] : null,
    worker ? workers.find((w) => w.id === worker)?.full_name : null,
  ]
    .filter(Boolean)
    .join(' · ')

  function exportCsv() {
    const header = [
      'Datum',
      'Smena',
      'Radnik',
      'Pazar',
      'Kartice',
      'Predato',
      'Status',
    ]
    const rows = reports.map((r) => [
      r.report_date,
      SHIFT_LABELS[r.shift] ?? r.shift,
      r.created_by_name ?? '',
      r.total_amount,
      r.card_amount,
      r.cash_amount,
      STATUS_LABELS[r.status] ?? r.status,
    ])

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
      .join('\r\n')

    // BOM da Excel ispravno prikaže naša slova (č, ć, š, ž, đ)
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pazar-${rangeFrom}-do-${rangeTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* ---------- Filteri (padajući meni, zatvoren po defaultu) ---------- */}
      <Card>
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          className={cx(
            'flex w-full items-center gap-3 px-4 py-3.5 text-left transition',
            filtersOpen ? 'bg-slate-50' : 'hover:bg-slate-50',
          )}
        >
          <svg
            className={cx(
              'h-4 w-4 shrink-0 text-slate-400 transition-transform',
              filtersOpen && 'rotate-90',
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

          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-slate-900">Filteri</p>
            <p className="truncate text-sm text-slate-500">{filterSummary}</p>
          </div>

          {extraCount > 0 && (
            <Badge className="shrink-0 bg-brand-100 text-brand-800 ring-brand-600/20">
              +{extraCount}
            </Badge>
          )}
        </button>

        {filtersOpen && (
          <div className="space-y-3 border-t border-slate-200 p-4">
            <div className="flex flex-wrap gap-2">
              {QUICK_RANGES.map((range) => {
                const active = from === range.from() && to === range.to()
                return (
                  <button
                    key={range.label}
                    type="button"
                    onClick={() => applyQuickRange(range)}
                    className={cx(
                      'rounded-full px-3.5 py-1.5 text-sm font-semibold transition ring-1 ring-inset',
                      active
                        ? 'bg-ink text-white ring-ink'
                        : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
                    )}
                  >
                    {range.label}
                  </button>
                )
              })}
            </div>

            {/* Proizvoljan period */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Ili izaberi tačan period
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Od">
                  <Input
                    type="date"
                    value={from}
                    max={to}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </Field>
                <Field label="Do">
                  <Input
                    type="date"
                    value={to}
                    min={from}
                    max={todayISO()}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </Field>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Smena">
                <Select value={shift} onChange={(e) => setShift(e.target.value)}>
                  <option value="">Sve smene</option>
                  {SHIFTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Svi statusi</option>
                  <option value="poslat">Čeka potvrdu</option>
                  <option value="potvrdjen">Potvrđen</option>
                  <option value="vracen">Vraćen na ispravku</option>
                </Select>
              </Field>
              <Field label="Radnik">
                <Select value={worker} onChange={(e) => setWorker(e.target.value)}>
                  <option value="">Svi radnici</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setFiltersOpen(false)}>
                Zatvori
              </Button>
              {extraCount > 0 && (
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  Poništi filtere
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ---------- Zbirni podaci ---------- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* Redosled svuda isti: pazar, kartice, predato. */}
        <Stat label="Pazar" value={formatMoney(totals.total, false)} tone="total" sub="RSD" />
        <Stat label="Kartice" value={formatMoney(totals.card, false)} tone="card" sub="RSD" />
        <Stat label="Predato" value={formatMoney(totals.cash, false)} tone="cash" sub="RSD" />
        <Stat label="Čeka potvrdu" value={totals.pending} sub={`od ${reports.length} izveštaja`} />
      </div>

      {/* ---------- Lista izveštaja ---------- */}
      <Card>
        <CardHeader
          title="Izveštaji smena"
          subtitle={
            loading
              ? 'Učitavanje…'
              : dateSearch
                ? `Pretraga: ${
                    dateSearch.from === dateSearch.to
                      ? formatDate(dateSearch.from)
                      : `${formatDate(dateSearch.from)} – ${formatDate(dateSearch.to)}`
                  } · ${reports.length} rezultata`
                : `${reports.length} rezultata`
          }
          action={
            <div className="flex shrink-0 items-center gap-1">
              {reports.length > 0 && (
                <Button variant="secondary" size="sm" onClick={exportCsv}>
                  ⬇ CSV
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
                ↻ Osveži
              </Button>
            </div>
          }
        />

        {/* Pretraga po datumu — traži kroz celu istoriju, bez obzira na filter */}
        <div className="border-b border-slate-200 p-4">
          <div className="relative">
            <Input
              type="search"
              inputMode="numeric"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pretraži po datumu"
              aria-label="Pretraga po datumu"
              className={cx('pr-9', searchInvalid && 'border-rose-400')}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute inset-y-0 right-3 text-lg text-slate-400 transition hover:text-slate-700"
                aria-label="Obriši pretragu"
              >
                ×
              </button>
            )}
          </div>
          {searchInvalid && (
            <p className="mt-1.5 text-xs font-medium text-rose-600">
              Nije prepoznat datum. Probaj <strong>15</strong>, <strong>15.09</strong>,{' '}
              <strong>15.09.2026</strong> ili <strong>09.2026</strong> za ceo mesec.
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner className="h-7 w-7 text-brand-600" />
          </div>
        ) : reports.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="Nema izveštaja"
            description={
              dateSearch
                ? 'Za traženi datum nema poslatih popisa.'
                : 'Za izabrani period i filtere nema poslatih popisa. Otvori Filtere gore da proširiš period.'
            }
          />
        ) : (
          <div>
            {byDate.map(([date, dayReports]) => {
              const dayTotal = dayReports.reduce((s, r) => s + Number(r.total_amount ?? 0), 0)
              return (
                <div key={date}>
                  <div className="flex items-center justify-between bg-slate-50 px-4 py-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      {new Intl.DateTimeFormat(LOCALE, {
                        weekday: 'long',
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      }).format(new Date(`${date}T00:00:00`))}
                    </span>
                    <span className="text-xs font-bold tabular-nums text-slate-600">
                      {formatMoney(dayTotal)}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {dayReports.map((report) => (
                      <ReportListItem key={report.id} report={report} showAuthor />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Održavanje prostora — da besplatnih 1 GB nikad ne popuniš */}
      <StorageCleanup />
    </div>
  )
}
