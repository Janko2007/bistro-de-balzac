import { useEffect, useMemo, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { usePersistentState } from '../lib/persist'
import { supabase } from '../lib/supabaseClient'
import { cx, errorMessage, formatDate, parseDateInput } from '../lib/utils'
import { Button, Input, Spinner } from './ui'
import ReportListItem from './ReportListItem'

/** Bez pretrage se vide samo poslednja tri; rezultati pretrage idu po osam. */
const LATEST = 3
const PAGE = 8

/**
 * Moji izveštaji — red na Profilu koji se otvara klikom, ispod „Bonusi i
 * isplate“. Otvoren pokazuje poslednja tri izveštaja; ostali se nalaze
 * pretragom po datumu.
 */
export default function MyReportsFold() {
  const toast = useToast()

  const [open, setOpen] = usePersistentState('myreports.open', false)
  const [search, setSearch] = usePersistentState('myreports.search', '')
  const [page, setPage] = usePersistentState('myreports.page', 0)
  const [debounced, setDebounced] = useState(search)

  const [total, setTotal] = useState(null)
  const [reports, setReports] = useState([])
  const [found, setFound] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const dateSearch = useMemo(() => parseDateInput(debounced), [debounced])
  const searchInvalid = debounced.trim() !== '' && dateSearch === null

  // Koliko ih ukupno ima — za broj na zaglavlju.
  useEffect(() => {
    supabase
      .from('report_summary')
      .select('id', { count: 'exact', head: true })
      .then(({ count }) => setTotal(count ?? 0))
  }, [])

  // Učitava se tek kad se red otvori.
  useEffect(() => {
    if (!open) return undefined
    let active = true
    setLoading(true)

    let query = supabase
      .from('report_summary')
      .select('*', { count: 'exact' })
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (dateSearch) {
      query = query
        .gte('report_date', dateSearch.from)
        .lte('report_date', dateSearch.to)
        .range(page * PAGE, page * PAGE + PAGE - 1)
    } else {
      query = query.range(0, LATEST - 1)
    }

    query.then(({ data, count, error }) => {
      if (!active) return
      if (error) toast.error(errorMessage(error))
      else {
        setReports(data ?? [])
        setFound(count ?? 0)
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [open, page, dateSearch, toast])

  const pages = Math.max(1, Math.ceil(found / PAGE))

  return (
    <div>
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
        <span className="min-w-0 flex-1 text-base font-extrabold tracking-tight text-stone-900">Moji izveštaji</span>
        {total !== null && (
          <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold tabular-nums text-stone-500">
            {total}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-stone-100">
          {/* Pretraga po datumu: bez nje se vidi samo poslednja tri */}
          <div className="px-4 pb-1 pt-3">
            <div className="relative">
              <Input
                type="search"
                inputMode="numeric"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(0)
                }}
                placeholder="Pretraži po datumu"
                aria-label="Pretraga po datumu"
                className={cx('pr-9', searchInvalid && 'border-rose-400')}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setPage(0)
                  }}
                  className="absolute inset-y-0 right-3 text-lg text-stone-400 transition hover:text-stone-700"
                  aria-label="Obriši pretragu"
                >
                  ×
                </button>
              )}
            </div>
            <p className={cx('mt-1.5 text-[12px]', searchInvalid ? 'font-medium text-rose-600' : 'text-stone-400')}>
              {searchInvalid
                ? 'Probaj 15 · 15.09 · 15.09.2026 · 09.2026'
                : dateSearch
                  ? `${
                      dateSearch.from === dateSearch.to
                        ? formatDate(dateSearch.from)
                        : `${formatDate(dateSearch.from)} – ${formatDate(dateSearch.to)}`
                    } · ${found}`
                  : 'Poslednja tri izveštaja. Ostale nađi pretragom.'}
            </p>
          </div>

          {loading && reports.length === 0 ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-5 w-5 text-brand-600" />
            </div>
          ) : reports.length === 0 ? (
            <p className="px-4 py-5 text-sm text-stone-400">
              {dateSearch ? 'Nema izveštaja za taj datum.' : 'Još nema poslatih popisa.'}
            </p>
          ) : (
            <div className={cx('divide-y divide-stone-100 transition', loading && 'opacity-60')}>
              {reports.map((report) => (
                <ReportListItem key={report.id} report={report} compact />
              ))}
            </div>
          )}

          {dateSearch && pages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-stone-100 px-4 py-2.5 text-[13px] text-stone-500">
              <Button variant="secondary" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                ‹ Novije
              </Button>
              <span>
                <b className="text-stone-900">{page + 1}</b> / {pages}
              </span>
              <Button variant="secondary" size="sm" disabled={page >= pages - 1 || loading} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>
                Starije ›
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
