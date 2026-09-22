import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { countLabel, cx, errorMessage, formatDate, parseDateInput, plural } from '../lib/utils'
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  FullPageLoader,
  Input,
  Spinner,
  Stat,
} from '../components/ui'
import ReportListItem from '../components/ReportListItem'

/** Koliko izveštaja staje na jednu stranu. */
const PAGE = 8

const SEARCH_ICON = 'M11 4a7 7 0 100 14 7 7 0 000-14M21 21l-4.35-4.35'

export default function MyReports() {
  const toast = useToast()
  const searchRef = useRef(null)

  const [loading, setLoading] = useState(true) // prvo učitavanje
  const [fetching, setFetching] = useState(false) // promena strane ili pretrage
  const [reports, setReports] = useState([])
  const [found, setFound] = useState(0) // koliko ih ima za trenutnu pretragu
  const [counts, setCounts] = useState({ total: 0, pending: 0 })
  const [page, setPage] = useState(0)

  // Pretraga po datumu — otvara se dugmetom sa lupom pored „Novi popis“.
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const dateSearch = useMemo(
    () => (searchOpen ? parseDateInput(debounced) : null),
    [searchOpen, debounced],
  )
  const searchInvalid = searchOpen && debounced.trim() !== '' && dateSearch === null

  /* Zbir gore — uvek za SVE izveštaje, bez obzira na pretragu i stranu.
     RLS već ograničava na smene u kojima je radnik bio. */
  useEffect(() => {
    Promise.all([
      supabase.from('report_summary').select('id', { count: 'exact', head: true }),
      supabase
        .from('report_summary')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'poslat'),
    ]).then(([all, pending]) => {
      if (all.error || pending.error) console.error(all.error || pending.error)
      setCounts({ total: all.count ?? 0, pending: pending.count ?? 0 })
    })
  }, [])

  /* Jedna strana — baza vraća samo tih 8 i ukupan broj za pretragu. */
  useEffect(() => {
    let active = true
    setFetching(true)

    let query = supabase
      .from('report_summary')
      .select('*', { count: 'exact' })
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)

    if (dateSearch) {
      query = query.gte('report_date', dateSearch.from).lte('report_date', dateSearch.to)
    }

    query.then(({ data, count, error }) => {
      if (!active) return
      if (error) {
        toast.error(errorMessage(error))
      } else {
        setReports(data ?? [])
        setFound(count ?? 0)
      }
      setFetching(false)
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [page, dateSearch, toast])

  function toggleSearch() {
    const next = !searchOpen
    setSearchOpen(next)
    setPage(0)
    // Zatvaranje pretrage vraća ceo spisak.
    if (!next) {
      setSearch('')
      setDebounced('')
    } else {
      setTimeout(() => searchRef.current?.focus(), 0)
    }
  }

  if (loading) return <FullPageLoader />

  const pages = Math.max(1, Math.ceil(found / PAGE))

  const subtitle = dateSearch
    ? `${
        dateSearch.from === dateSearch.to
          ? formatDate(dateSearch.from)
          : `${formatDate(dateSearch.from)} – ${formatDate(dateSearch.to)}`
      } · ${countLabel(found, 'izvestaj')}`
    : 'Smene u kojima si radio'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Ukupno" value={counts.total} sub={plural(counts.total, 'izvestaj')} />
        <Stat
          label="Čeka potvrdu"
          value={counts.pending}
          sub={plural(counts.pending, 'izvestaj')}
        />
      </div>

      <Card>
        <CardHeader
          title="Moji izveštaji"
          subtitle={subtitle}
          // Dugmad su po visini centrirana u odnosu na naslov i podnaslov.
          className="!items-center"
          action={
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant={searchOpen ? 'dark' : 'secondary'}
                className="h-[34px] w-[34px] !px-0"
                onClick={toggleSearch}
                aria-pressed={searchOpen}
                aria-label="Pretraga po datumu"
                title="Pretraga po datumu"
              >
                <svg
                  className="h-[17px] w-[17px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={SEARCH_ICON} />
                </svg>
              </Button>
              <Link to="/novi-popis">
                <Button size="sm" className="h-[34px]">
                  Novi popis
                </Button>
              </Link>
            </div>
          }
        />

        {searchOpen && (
          <div className="border-b border-stone-100 px-4 py-3">
            <div className="relative">
              <Input
                ref={searchRef}
                type="search"
                inputMode="numeric"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(0) // nova pretraga kreće od prve strane
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
            {searchInvalid && (
              <p className="mt-1.5 text-xs font-medium text-rose-600">
                Nije prepoznat datum. Probaj <strong>15</strong>, <strong>15.09</strong>,{' '}
                <strong>15.09.2026</strong> ili <strong>09.2026</strong> za ceo mesec.
              </p>
            )}
          </div>
        )}

        {reports.length === 0 ? (
          fetching ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : dateSearch ? (
            <EmptyState
              icon="🔍"
              title="Nema izveštaja"
              description="Za traženi datum nemaš nijednu smenu."
            />
          ) : (
            <EmptyState
              icon="📝"
              title="Još nema poslatih popisa"
              description="Kad završiš smenu, popuni popis i pošalji ga vlasniku."
              action={
                <Link to="/novi-popis">
                  <Button>Popuni prvi popis</Button>
                </Link>
              }
            />
          )
        ) : (
          <div className={cx('divide-y divide-slate-100 transition', fetching && 'opacity-60')}>
            {/* Samo datum, smena i stanje — iznosi se vide kad se izveštaj otvori. */}
            {reports.map((report) => (
              <ReportListItem key={report.id} report={report} compact />
            ))}
          </div>
        )}

        {/* ---------- Strane: najviše 8 izveštaja na jednoj ---------- */}
        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-stone-100 px-4 py-2.5 text-[13px] text-stone-500">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 0 || fetching}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ‹ Novije
            </Button>
            <span>
              Strana <b className="text-stone-900">{page + 1}</b> od {pages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= pages - 1 || fetching}
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            >
              Starije ›
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
