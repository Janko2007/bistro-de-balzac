import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { usePersistentState } from '../lib/persist'
import { supabase } from '../lib/supabaseClient'
import { cx, errorMessage, formatDate, parseDateInput } from '../lib/utils'
import { Button, Input, Spinner } from './ui'
import ReportListItem from './ReportListItem'

/** Prvo se vide poslednja tri; „Prikaži još“ dodaje po tri. */
const STEP = 3

const FILTERS = [
  { key: '', label: 'Svi' },
  { key: 'potvrdjen', label: 'Potvrđen' },
  { key: 'vracen', label: 'Vraćen na ispravku' },
]

/**
 * Moji izveštaji — red na Profilu koji se otvara klikom, ispod „Bonusi i
 * isplate“. Otvoren pokazuje poslednja tri izveštaja; dugme „Prikaži još“
 * dodaje po tri, a dugmad „Potvrđen“ i „Vraćen na ispravku“ izdvajaju
 * samo takve. Pretraga po datumu radi uz njih.
 */
export default function MyReportsFold() {
  const toast = useToast()
  const { profile } = useAuth()

  const [open, setOpen] = usePersistentState('myreports.open', false)
  const [search, setSearch] = usePersistentState('myreports.search', '')
  const [filter, setFilter] = usePersistentState('myreports.filter', '')
  const [limit, setLimit] = useState(STEP)
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

  // Kad se menja filter ili pretraga, kreće se ponovo od poslednja tri.
  useEffect(() => {
    setLimit(STEP)
  }, [filter, dateSearch])

  // Koliko ih ukupno ima — za broj na zaglavlju.
  // Samo smene u kojima je radnik trenutno upisan: ko je izašao ili je izbačen, one ne vidi.
  useEffect(() => {
    if (!profile?.id) return
    supabase
      .from('report_summary')
      .select('id', { count: 'exact', head: true })
      .contains('staff_ids', [profile.id])
      .then(({ count }) => setTotal(count ?? 0))
  }, [profile?.id])

  // Učitava se tek kad se red otvori.
  useEffect(() => {
    if (!open || !profile?.id) return undefined
    let active = true
    setLoading(true)

    let query = supabase
      .from('report_summary')
      .select('*', { count: 'exact' })
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })
      .contains('staff_ids', [profile.id])
      .range(0, limit - 1)

    if (filter) query = query.eq('status', filter)
    if (dateSearch) query = query.gte('report_date', dateSearch.from).lte('report_date', dateSearch.to)

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
  }, [open, limit, filter, dateSearch, toast, profile?.id])

  const remaining = Math.max(0, found - reports.length)

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
          {/* Filter po stanju: potvrđeni / vraćeni na ispravku */}
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cx(
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                  filter === f.key
                    ? f.key === 'vracen'
                      ? 'bg-rose-600 text-white'
                      : 'bg-ink text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Pretraga po datumu */}
          <div className="px-4 pb-1 pt-3">
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
                  : ''}
            </p>
          </div>

          {loading && reports.length === 0 ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-5 w-5 text-brand-600" />
            </div>
          ) : reports.length === 0 ? (
            <p className="px-4 py-5 text-sm text-stone-400">
              {dateSearch || filter ? 'Nema izveštaja za taj izbor.' : 'Još nema poslatih popisa.'}
            </p>
          ) : (
            <div className={cx('divide-y divide-stone-100 transition', loading && 'opacity-60')}>
              {reports.map((report) => (
                <ReportListItem key={report.id} report={report} compact />
              ))}
            </div>
          )}

          {remaining > 0 && (
            <div className="border-t border-stone-100 px-4 py-3">
              <Button
                variant="secondary"
                className="w-full"
                disabled={loading}
                onClick={() => setLimit((n) => n + STEP)}
              >
                Prikaži još {Math.min(STEP, remaining)}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
