import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePermanentState, usePersistentState } from '../lib/persist'

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
} from '../components/ui'
import DownloadIcon from '../components/DownloadIcon'
import MidMark from '../components/MidMark'
import ReportListItem from '../components/ReportListItem'
import { dailyTaskFor } from '../lib/rules'
import { displayNames } from '../lib/scheduleImage'
import ReportPicker from '../components/ReportPicker'
import ReportTrash from '../components/ReportTrash'
import AdminDeposits from './AdminDeposits'
import StorageCleanup from '../components/StorageCleanup'
import { heading, printDocument, statGrid, table } from '../lib/print'
import {
  LOCALE,
  SHIFTS,
  SHIFT_LABELS,
  SHIFT_SHORT,
  STATUS_LABELS,
  cx,
  daysAgoISO,
  errorMessage,
  formatDate,
  formatMoney,
  parseDateInput,
  shiftRank,
  todayISO,
} from '../lib/utils'

/** Koliko dana odmah, i koliko se dodaje na Prikaži više. */
const DAYS_FIRST = 3
const DAYS_STEP = 3
/** Kolone tabele dnevnih obaveza na računaru: dan, obaveza, prva smena, druga smena. */
const TASK_COLS = 'md:grid-cols-[150px_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-x-6'
const TASK_GRID = `flex flex-wrap items-center gap-x-3 gap-y-2 md:grid md:items-center ${TASK_COLS}`
const TASK_FIRST = 5
const TASK_STEP = 5

/** Dugmad ispod liste dana: prvo Prikaži više, a ispod nje Prikaži sve. */
function MoreButtons({ shown, total, onMore, onAll }) {
  if (shown >= total) return null
  return (
    <div className="space-y-2 border-t border-stone-200 p-3">
      <Button variant="secondary" className="w-full" onClick={onMore}>
        Prikaži više
      </Button>
      <Button variant="ghost" className="w-full" onClick={onAll}>
        Prikaži sve ({total - shown} dana više)
      </Button>
    </div>
  )
}

const QUICK_RANGES = [
  { key: 'danas', label: 'Danas', from: () => todayISO(), to: () => todayISO() },
  { key: 'juce', label: 'Juče i danas', from: () => daysAgoISO(1), to: () => todayISO() },
  { key: 'sedam', label: '7 dana', from: () => daysAgoISO(6), to: () => todayISO() },
  { key: 'trideset', label: '30 dana', from: () => daysAgoISO(29), to: () => todayISO() },
  { key: 'tekuci', label: 'Tekući mesec', from: () => thisMonth().from, to: () => thisMonth().to, month: true },
  { key: 'prosli', label: 'Prošli mesec', from: () => prevMonth().from, to: () => prevMonth().to, month: true },
]

/** Prvi i poslednji dan meseca u kojem smo sada (YYYY-MM-DD) — ceo mesec, ne samo do danas. */
function thisMonth() {
  const [y, m] = todayISO().split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const mm = String(m).padStart(2, '0')
  const dd = String(last).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${dd}` }
}

/** Prvi i poslednji dan prošlog meseca (YYYY-MM-DD). */
function prevMonth() {
  const [y, m] = todayISO().split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  const last = new Date(py, pm, 0).getDate()
  const mm = String(pm).padStart(2, '0')
  const dd = String(last).padStart(2, '0')
  return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${dd}` }
}


export default function AdminDashboard() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [reports, setReports] = useState([])
  // Datum -> ko je tog dana radio međusmenu. Međusmena nema svoj red u spisku;
  // pored imena u prvoj i drugoj smeni piše „Među“.
  const [midByDate, setMidByDate] = useState(() => new Map())
  const [workers, setWorkers] = useState([])

  // Podrazumevano se vide samo juče i danas — ostalo se otvara kroz filtere.
  // Izbor perioda i filtera ostaje i posle odjave, dok ga ne promeniš. Brzi izbor se pamti
  // kao ime (npr. Tekući mesec), a ne kao datumi — pa i sledećeg meseca važi novi mesec.
  const [rangeKey, setRangeKey] = usePermanentState('dash.range', 'juce')
  const [customFrom, setCustomFrom] = usePermanentState('dash.customFrom', daysAgoISO(1))
  const [customTo, setCustomTo] = usePermanentState('dash.customTo', todayISO())
  const preset = QUICK_RANGES.find((r) => r.key === rangeKey)
  const from = preset ? preset.from() : customFrom
  const to = preset ? preset.to() : customTo
  // Ručno menjanje jednog datuma prelazi na proizvoljan period, od trenutno prikazanog.
  const setFrom = (value) => {
    setCustomFrom(value)
    setCustomTo(to)
    setRangeKey('custom')
  }
  const setTo = (value) => {
    setCustomFrom(from)
    setCustomTo(value)
    setRangeKey('custom')
  }
  const [shift, setShift] = usePermanentState('dash.shift', '')
  const [status, setStatus] = usePermanentState('dash.status', '')
  const [worker, setWorker] = usePermanentState('dash.worker', '')
  const [filtersOpen, setFiltersOpen] = usePersistentState('dash.filtersOpen', false)

  const [search, setSearch] = usePersistentState('dash.search', '')
  const [debounced, setDebounced] = useState(search)
  const [pickerOpen, setPickerOpen] = useState(false)

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

  /* Vrti se samo prvi put. Kad se menja filter ili period, stari spisak
     ostaje na ekranu dok novi ne stigne — bez praznog ekrana i poskakivanja. */
  const load = useCallback(async () => {

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

    // Međusmena se ne prikazuje kao posebna smena — samo prva i druga.
    const [{ data, error }, midRes] = await Promise.all([
      query.neq('shift', 'medjusmena'),
      supabase
        .from('report_summary')
        .select('report_date, staff_ids')
        .eq('shift', 'medjusmena')
        .gte('report_date', rangeFrom)
        .lte('report_date', rangeTo),
    ])

    if (error) toast.error(errorMessage(error))
    else {
      setReports(data ?? [])
      const mid = new Map()
      for (const r of midRes.data ?? []) {
        const set = mid.get(r.report_date) ?? new Set()
        for (const wid of r.staff_ids ?? []) set.add(wid)
        mid.set(r.report_date, set)
      }
      setMidByDate(mid)
    }
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

  /**
   * Ko je radio smenu — svi iz nje, a ne samo onaj ko ju je otvorio.
   * Imena se uzimaju iz već učitanog spiska radnika (za filter), bez
   * dodatnog upita.
   */
  const nameById = useMemo(() => new Map(workers.map((w) => [w.id, w.full_name])), [workers])

  const namesOf = useCallback(
    (report) => {
      const mid = midByDate.get(report.report_date)
      return (report.staff_ids ?? [])
        .map((wid) => {
          const name = nameById.get(wid)
          return name ? (mid?.has(wid) ? `${name} (Među)` : name) : null
        })
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    },
    [nameById, midByDate],
  )

  /** Isto, ali kao objekti — oznaka „Među“ se na listi crta pored imena. */
  // Samo ime; ako ih ima dva ista, uz ime ide i početno slovo prezimena.
  const shortById = useMemo(() => displayNames(nameById), [nameById])
  const staffOf = useCallback(
    (report) => {
      const mid = midByDate.get(report.report_date)
      return (report.staff_ids ?? [])
        .map((wid) => ({ name: shortById.get(wid), mid: !!mid?.has(wid) }))
        .filter((s) => s.name)
        // Prvo oni koji su radili smenu, pa na kraju oni sa međusmenom.
        .sort((a, b) => Number(a.mid) - Number(b.mid) || a.name.localeCompare(b.name))
    },
    [shortById, midByDate],
  )

  /* Brzi izbor iz zbirnog bloka: čeka potvrdu / vraćeni na ispravku / manjak.
     Izdvaja samo te izveštaje u listi; brojevi iznad ostaju za ceo period. */
  const [quick, setQuick] = useState('')

  // Izveštaji kojima je poslat manjak (artikli označeni + izabrani radnici).
  const [manjakIds, setManjakIds] = useState(() => new Set())
  const reportKey = reports.map((r) => r.id).join(',')
  useEffect(() => {
    if (reports.length === 0) {
      setManjakIds(new Set())
      return undefined
    }
    let active = true
    const ids = reports.map((r) => r.id)
    Promise.all([
      supabase.from('shift_report_items').select('report_id').eq('check_status', 'fali').in('report_id', ids),
      supabase.from('shift_report_staff').select('report_id').eq('manjak_sent', true).in('report_id', ids),
    ]).then(([short, sent]) => {
      if (!active || short.error) return
      const marked = new Set((short.data ?? []).map((x) => x.report_id))
      // Baza bez oznaka (skripta -29): računa se svaki izveštaj sa označenim manjkom.
      const delivered = sent.error ? null : new Set((sent.data ?? []).map((x) => x.report_id))
      setManjakIds(new Set([...marked].filter((id) => delivered === null || delivered.has(id))))
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey])

  const returnedCount = reports.filter((r) => r.status === 'vracen').length
  const visibleReports = useMemo(() => {
    if (quick === 'manjak') return reports.filter((r) => manjakIds.has(r.id))
    if (quick) return reports.filter((r) => r.status === quick)
    return reports
  }, [reports, quick, manjakIds])

  /**
   * Grupisanje po datumu za pregledniju listu.
   * Unutar dana smene idu redom kako se rade: prva, međusmena, druga.
   */
  const byDate = useMemo(() => {
    const map = new Map()
    for (const r of visibleReports) {
      if (!map.has(r.report_date)) map.set(r.report_date, [])
      map.get(r.report_date).push(r)
    }
    for (const list of map.values()) list.sort((a, b) => shiftRank(a.shift) - shiftRank(b.shift))
    return Array.from(map.entries())
  }, [visibleReports])

  /* Koliko dana se odmah vidi u listi i u dnevnim obavezama; ostalo otvaraju dugmad
     „Prikaži više“ (još 3 dana) i „Prikaži sve“. Pri promeni filtera kreće ispočetka. */
  const [dayLimit, setDayLimit] = useState(DAYS_FIRST)
  const [taskLimit, setTaskLimit] = useState(TASK_FIRST)
  const [tasksOpen, setTasksOpen] = usePersistentState('dash.tasksOpen', false)
  useEffect(() => {
    setDayLimit(DAYS_FIRST)
    setTaskLimit(TASK_FIRST)
  }, [rangeFrom, rangeTo, shift, status, worker, quick])
  const listDays = byDate.slice(0, dayLimit)

  /* Dnevne obaveze: za svaki dan iz perioda — da li je obaveza urađena u svakoj smeni. */
  const [ruleDocs, setRuleDocs] = useState([])
  useEffect(() => {
    supabase
      .from('rule_docs')
      .select('title, body')
      .then(({ data }) => setRuleDocs(data ?? []))
  }, [])
  const taskDays = useMemo(() => {
    const map = new Map()
    for (const r of reports) {
      if (!map.has(r.report_date)) map.set(r.report_date, [])
      map.get(r.report_date).push(r)
    }
    for (const list of map.values()) list.sort((a, b) => shiftRank(a.shift) - shiftRank(b.shift))
    return Array.from(map.entries())
  }, [reports])
  const taskCounts = useMemo(() => {
    const closed = reports.filter((r) => r.status !== 'otvoren')
    return { done: closed.filter((r) => r.daily_task_done).length, total: closed.length }
  }, [reports])

  function applyQuickRange(range) {
    setRangeKey(range.key)
  }

  function resetFilters() {
    setRangeKey('juce')
    setShift('')
    setStatus('')
    setWorker('')
  }

  /* Kratak opis izabranih filtera — vidi se i kad je meni zatvoren. */
  const activeRange = preset
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
      namesOf(r).join(', '),
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

  /** Isti spisak, samo uredan za štampu ili PDF — `parts` bira šta ulazi. */
  function printReports(parts) {
    const has = (key) => parts.includes(key)

    const columns = [
      { label: 'Datum', width: '13%' },
      { label: 'Smena', width: '15%' },
      { label: 'Radnik' },
      { label: 'Status', width: '15%' },
      { label: 'Pazar', align: 'right', width: '13%' },
      { label: 'Kartice', align: 'right', width: '13%' },
      { label: 'Predato', align: 'right', width: '13%' },
    ]

    const rows = []
    for (const [date, dayReports] of byDate) {
      const dayTotal = dayReports.reduce((s, r) => s + Number(r.total_amount ?? 0), 0)
      rows.push({
        kind: 'group',
        label: new Intl.DateTimeFormat(LOCALE, {
          weekday: 'long',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(new Date(`${date}T00:00:00`)),
        right: formatMoney(dayTotal, false),
      })
      for (const r of dayReports) {
        rows.push([
          formatDate(r.report_date),
          SHIFT_LABELS[r.shift] ?? r.shift,
          namesOf(r).join(', ') || '—',
          STATUS_LABELS[r.status] ?? r.status,
          formatMoney(r.total_amount, false),
          formatMoney(r.card_amount, false),
          formatMoney(r.cash_amount, false),
        ])
      }
    }
    rows.push({
      kind: 'total',
      cells: [
        'Ukupno',
        '',
        `${reports.length} ${reports.length === 1 ? 'izveštaj' : 'izveštaja'}`,
        '',
        formatMoney(totals.total, false),
        formatMoney(totals.card, false),
        formatMoney(totals.cash, false),
      ],
    })

    /* Pazar po danima — isti period, samo sabran po danu. */
    const dayColumns = [
      { label: 'Datum', width: '16%' },
      { label: 'Dan' },
      { label: 'Smena', align: 'right', width: '10%' },
      { label: 'Pazar', align: 'right', width: '15%' },
      { label: 'Kartice', align: 'right', width: '15%' },
      { label: 'Predato', align: 'right', width: '15%' },
    ]

    const dayRows = byDate.map(([date, dayReports]) => {
      const sum = dayReports.reduce(
        (acc, r) => ({
          total: acc.total + Number(r.total_amount ?? 0),
          card: acc.card + Number(r.card_amount ?? 0),
          cash: acc.cash + Number(r.cash_amount ?? 0),
        }),
        { total: 0, card: 0, cash: 0 },
      )
      return [
        formatDate(date),
        new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(new Date(`${date}T00:00:00`)),
        String(dayReports.length),
        formatMoney(sum.total, false),
        formatMoney(sum.card, false),
        formatMoney(sum.cash, false),
      ]
    })

    if (dayRows.length > 0) {
      dayRows.push({
        kind: 'total',
        cells: [
          'Ukupno',
          `${byDate.length} ${byDate.length === 1 ? 'dan' : 'dana'}`,
          String(reports.length),
          formatMoney(totals.total, false),
          formatMoney(totals.card, false),
          formatMoney(totals.cash, false),
        ],
      })
    }

    printDocument({
      title: 'Izveštaji smena',
      subtitle: filterSummary,
      meta: [
        { label: 'Period', value: `${formatDate(rangeFrom)} – ${formatDate(rangeTo)}` },
        { label: 'Izveštaja', value: String(reports.length) },
      ],
      content: [
        has('zbir')
          ? statGrid([
              { label: 'Pazar', value: formatMoney(totals.total, false), sub: 'RSD' },
              { label: 'Kartice', value: formatMoney(totals.card, false), sub: 'RSD' },
              { label: 'Predato', value: formatMoney(totals.cash, false), sub: 'RSD' },
              { label: 'Čeka potvrdu', value: String(totals.pending), sub: `od ${reports.length}` },
            ])
          : '',
        has('dani') ? heading('Pazar po danima') : '',
        has('dani')
          ? table({ columns: dayColumns, rows: dayRows, empty: 'Za izabrani period nema pazara.' })
          : '',
        has('smene') ? heading('Smene pojedinačno') : '',
        has('smene')
          ? table({ columns, rows, empty: 'Za izabrani period nema poslatih popisa.' })
          : '',
      ].join(''),
    })
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
            filtersOpen ? 'bg-stone-50' : 'hover:bg-stone-50',
          )}
        >
          <svg
            className={cx(
              'h-4 w-4 shrink-0 text-stone-400 transition-transform',
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
            <p className="text-base font-bold text-stone-900">Filteri</p>
            <p className="truncate text-sm text-stone-500">{filterSummary}</p>
          </div>

          {extraCount > 0 && (
            <Badge className="shrink-0 bg-brand-100 text-brand-800 ring-brand-600/20">
              +{extraCount}
            </Badge>
          )}
        </button>

        {filtersOpen && (
          <div className="space-y-4 border-t border-stone-200 p-4">
            {/* Brzi izbor perioda: šest jednakih dugmadi u dva reda (na računaru u jednom). */}
            <div>
              <p className="label">Period</p>
              <div className="grid grid-cols-3 gap-1.5 md:grid-cols-6">
                {QUICK_RANGES.map((range) => {
                  const active = rangeKey === range.key
                  return (
                    <button
                      key={range.label}
                      type="button"
                      onClick={() => applyQuickRange(range)}
                      aria-pressed={active}
                      className={cx(
                        'whitespace-nowrap rounded-xl px-1 py-2 text-[13px] font-semibold transition',
                        active
                          ? 'bg-ink text-white'
                          : 'bg-stone-100 text-stone-700 hover:bg-stone-200/70',
                      )}
                    >
                      {range.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Proizvoljan period — dva datuma spojena u jedan red. */}
            <div className="flex items-end gap-2">
              <Field label="Od" className="min-w-0 flex-1">
                <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <span className="pb-3 text-stone-300" aria-hidden="true">
                →
              </span>
              <Field label="Do" className="min-w-0 flex-1">
                <Input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Smena">
                <Select value={shift} onChange={(e) => setShift(e.target.value)}>
                  <option value="">Sve smene</option>
                  {SHIFTS.filter((s) => s.value !== 'medjusmena').map((s) => (
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

            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button variant="secondary" onClick={resetFilters} disabled={extraCount === 0}>
                Poništi
              </Button>
              <Button onClick={() => setFiltersOpen(false)}>Gotovo</Button>
            </div>
          </div>
        )}
      </Card>
      {/* ---------- Zbirni podaci ---------- */}
      {/* Pazar je veliki broj, a ispod njega se vidi kako se deli na kartice i
          predato. Dinari se ne pišu — svi iznosi u aplikaciji su u dinarima. */}
      <Card className="p-4">
        {(() => {
          // Keš je prvi i narandžast; kartice su drugi, beli deo trake.
          const cashShare = totals.total > 0 ? Math.min(100, Math.max(0, (totals.cash / totals.total) * 100)) : 0
          const cardShare = totals.total > 0 ? 100 - cashShare : 0
          const shownTiles =
            1 +
            [totals.pending, returnedCount, manjakIds.size].filter((n, i) => n > 0 || quick === ['poslat', 'vracen', 'manjak'][i]).length
          return (
            <>
              <div className="rounded-2xl bg-ink px-4 py-4 text-white">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="eyebrow text-stone-400">Pazar</p>
                  <p className="min-w-0 truncate text-[12px] text-stone-400">{filterSummary}</p>
                </div>
                <p className="mt-0.5 text-4xl font-extrabold tabular-nums tracking-tight">
                  {formatMoney(totals.total, false)}
                </p>

                <div
                  className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/15"
                  role="img"
                  aria-label={`Keš ${Math.round(cashShare)}%, kartice ${Math.round(cardShare)}%`}
                >
                  <div className="h-full bg-brand-500 transition-all" style={{ width: `${cashShare}%` }} />
                  <div className="h-full bg-white/80 transition-all" style={{ width: `${cardShare}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-[12px] tabular-nums text-stone-300">
                  <span className="flex items-center gap-1.5 font-bold text-brand-400">
                    <span className="h-2 w-2 rounded-full bg-brand-500" aria-hidden="true" />
                    keš {formatMoney(totals.cash, false)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-white/80" aria-hidden="true" />
                    kartice {formatMoney(totals.card, false)}
                  </span>
                </div>
              </div>

              {/* Klik na pločicu izdvaja te izveštaje u listi ispod; drugi klik skida izbor. */}
              <div
                className={cx(
                  'mt-2.5 grid gap-2',
                  // Pločice razvlače da popune ceo red — bez praznog mesta.
                  shownTiles === 1 && 'grid-cols-1',
                  shownTiles === 2 && 'grid-cols-2',
                  shownTiles === 3 && 'grid-cols-3',
                  shownTiles >= 4 && 'grid-cols-2 sm:grid-cols-4',
                )}
              >
                {[
                  { key: '', label: 'Izveštaja', value: reports.length, tone: 'plain' },
                  { key: 'poslat', label: 'Čeka potvrdu', value: totals.pending, tone: 'brand' },
                  { key: 'vracen', label: 'Vraćeno na ispravku', value: returnedCount, tone: 'amber' },
                  { key: 'manjak', label: 'Manjak', value: manjakIds.size, tone: 'rose' },
                ]
                  // Pločica se vidi samo kad ima šta da pokaže; „Izveštaja“ je uvek tu.
                  .filter((tile) => tile.key === '' || tile.value > 0 || quick === tile.key)
                  .map((tile) => {
                  const on = quick === tile.key
                  const lit = tile.value > 0 && tile.tone !== 'plain'
                  const palette = {
                    brand: 'bg-brand-50 text-brand-700 ring-brand-600/25',
                    amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
                    rose: 'bg-rose-50 text-rose-700 ring-rose-600/25',
                  }
                  return (
                    <button
                      key={tile.label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setQuick(tile.key === '' || on ? '' : tile.key)}
                      className={cx(
                        'rounded-2xl px-2 py-2.5 text-center transition ring-1 ring-inset',
                        lit ? palette[tile.tone] : 'bg-stone-100 text-stone-900 ring-transparent hover:bg-stone-200/70',
                        on && '!ring-stone-700',
                      )}
                    >
                      <p className={cx('text-[10px] font-bold uppercase leading-tight tracking-wide', lit ? '' : 'text-stone-500')}>
                        {tile.label}
                      </p>
                      <p className="mt-0.5 text-[15px] font-extrabold tabular-nums">
                        {tile.value}
                        {tile.key === 'poslat' && (
                          <span className="ml-1 text-[11px] font-semibold text-stone-400">od {reports.length}</span>
                        )}
                      </p>
                    </button>
                  )
                })}
              </div>
            </>
          )
        })()}
      </Card>      {/* ---------- Lista izveštaja ---------- */}
      <Card>
        <CardHeader
          title="Izveštaji smena"
          subtitle={
            loading
              ? 'Učitavanje…'
              : dateSearch
                ? dateSearch.from === dateSearch.to
                  ? formatDate(dateSearch.from)
                  : `${formatDate(dateSearch.from)} – ${formatDate(dateSearch.to)}`
                : `${visibleReports.length}${quick ? ` od ${reports.length}` : ''}`
          }
          action={
            <div className="flex shrink-0 items-center gap-1">
              {reports.length > 0 && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Preuzmi izveštaje"
                    title="Preuzmi"
                    onClick={() => setPickerOpen(true)}
                  >
                    <DownloadIcon />
                  </Button>
                  <Button variant="secondary" size="sm" onClick={exportCsv}>
                    CSV
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={load}
                disabled={loading}
                aria-label="Osveži"
                title="Osveži"
              >
                ↻
              </Button>
            </div>
          }
        />

        {/* Pretraga po datumu — traži kroz celu istoriju, bez obzira na filter */}
        <div className="border-b border-stone-100 p-4">
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
          {searchInvalid && (
            <p className="mt-1.5 text-[12px] font-medium text-rose-600">
              Probaj 15 · 15.09 · 15.09.2026 · 09.2026
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner className="h-7 w-7 text-brand-600" />
          </div>
        ) : visibleReports.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="Nema izveštaja"
            description={dateSearch ? undefined : 'Proširi period u Filterima.'}
          />
        ) : (
          <div>
            {listDays.map(([date, dayReports]) => {
              const dayTotal = dayReports.reduce((s, r) => s + Number(r.total_amount ?? 0), 0)
              return (
                <div key={date} className="border-t-[6px] border-stone-200/70 first:border-t-0">
                  <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-2">
                    <span className="min-w-0 truncate">
                      <span className="text-[13px] font-extrabold capitalize text-stone-900">
                        {new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(new Date(`${date}T00:00:00`))}
                      </span>
                      <span className="ml-2 text-[12px] font-medium tabular-nums text-stone-400">
                        {new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit' }).format(
                          new Date(`${date}T00:00:00`),
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-[12px] font-extrabold tabular-nums text-stone-700 ring-1 ring-inset ring-stone-200">
                      {formatMoney(dayTotal, false)}
                    </span>
                  </div>
                  {/* Na računaru su dve smene istog dana jedna pored druge; na telefonu jedna ispod druge. */}
                  <div
                    className={cx(
                      'divide-y divide-stone-100',
                      dayReports.length > 1 &&
                        'md:grid md:grid-cols-2 md:divide-y-0 md:[&>a]:border-t md:[&>a]:border-stone-100 md:[&>a:nth-child(even)]:border-l md:[&>a:nth-child(-n+2)]:border-t-0',
                    )}
                  >
                    {dayReports.map((report) => (
                      <ReportListItem
                        key={report.id}
                        report={report}
                        showAuthor
                        staffNames={staffOf(report)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            <MoreButtons
              shown={listDays.length}
              total={byDate.length}
              onMore={() => setDayLimit((n) => n + DAYS_STEP)}
              onAll={() => setDayLimit(byDate.length)}
            />
          </div>
        )}
      </Card>

      {/* ---------- Dnevne obaveze: da li su urađene po danima i smenama ---------- */}
      {taskDays.length > 0 && (
        <Card>
          {/* Padajući meni: zatvoren je dok se ne klikne, a gore se vidi koliko je urađeno. */}
          <button
            type="button"
            onClick={() => setTasksOpen((v) => !v)}
            aria-expanded={tasksOpen}
            className={cx(
              'flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition',
              tasksOpen ? 'bg-stone-100' : 'hover:bg-stone-50',
            )}
          >
            <svg
              className={cx('h-4 w-4 shrink-0 text-stone-400 transition-transform', tasksOpen && 'rotate-90')}
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
              <span className="block text-base font-extrabold tracking-tight text-stone-900">Dnevne obaveze</span>
              <span className="block text-xs text-stone-400">
                urađeno {taskCounts.done} od {taskCounts.total} smena
              </span>
            </span>
          </button>
          {tasksOpen && (
          <>
          {/* Na računaru: tabela sa jednakim kolonama, da se odmah vidi šta je šta. */}
          <div className={`hidden border-t border-stone-100 bg-stone-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-stone-400 md:grid ${TASK_COLS}`}>
            <span>Dan</span>
            <span>Obaveza</span>
            <span>Prva smena</span>
            <span>Druga smena</span>
          </div>
          <ul className="divide-y divide-stone-100 border-t border-stone-100">
            {taskDays.slice(0, taskLimit).map(([date, list]) => {
              const task = dailyTaskFor(ruleDocs, date)
              const text = task.text
                .split('\n')
                .map((l) => l.replace(/^[\s>*\-•#]+/, '').trim())
                .filter(Boolean)
                .slice(0, 2)
                .join(' · ')
              const when = new Date(`${date}T00:00:00`)
              return (
                <li key={date} className={`px-4 py-3.5 ${TASK_GRID}`}>
                  <p className="shrink-0 whitespace-nowrap text-[13px] font-extrabold capitalize text-stone-900">
                    {new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(when)}
                    <span className="ml-1.5 text-[12px] font-medium tabular-nums text-stone-400">
                      {new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit' }).format(when)}
                    </span>
                  </p>
                  <p className="min-w-0 flex-1 basis-40 text-[12.5px] text-stone-500 md:truncate md:flex-none" title={text}>
                    {text || 'Nema obaveze za ovaj dan.'}
                  </p>
                  {list.map((r) => {
                    const open = r.status === 'otvoren'
                    const done = !!r.daily_task_done
                    const team = staffOf(r)
                    return (
                      <div
                        key={r.id}
                        className={cx(
                          'flex min-w-0 items-center gap-2.5',
                          r.shift === 'druga' ? 'md:col-start-4' : 'md:col-start-3',
                        )}
                      >
                        <span
                          className={cx(
                            'shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset',
                            open
                              ? 'bg-stone-100 text-stone-500 ring-stone-200'
                              : done
                                ? 'bg-emerald-100 text-emerald-800 ring-emerald-600/20'
                                : 'bg-rose-100 text-rose-700 ring-rose-600/20',
                          )}
                        >
                          {SHIFT_SHORT[r.shift] ?? r.shift} · {open ? 'u toku' : done ? 'urađena' : 'nije urađena'}
                        </span>
                        <span className="min-w-0 text-[12.5px] font-semibold leading-snug text-stone-700">
                          {team.length > 0
                            ? team.map((m, i) => (
                                <span key={`${m.name}-${i}`} className="whitespace-nowrap">
                                  {m.name}
                                  {m.mid && <MidMark className="ml-1 align-middle" />}
                                  {i < team.length - 1 && ', '}
                                </span>
                              ))
                            : 'nema upisanih'}
                        </span>
                      </div>
                    )
                  })}
                </li>
              )
            })}
          </ul>
          <MoreButtons
            shown={Math.min(taskLimit, taskDays.length)}
            total={taskDays.length}
            onMore={() => setTaskLimit((n) => n + TASK_STEP)}
            onAll={() => setTaskLimit(taskDays.length)}
          />
          </>
          )}
        </Card>
      )}

      {/* Šta ulazi u preuzet izveštaj */}
      <ReportPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Preuzmi izveštaje smena"
        options={[
          { key: 'zbir', label: 'Zbirni pregled' },
          { key: 'dani', label: 'Pazar po danima' },
          { key: 'smene', label: 'Smene pojedinačno' },
        ]}
        onConfirm={printReports}
      />

      {/* Uplate: padajući meni, iznad obrisanih popisa. */}
      <AdminDeposits embedded />

      {/* Obrisani popisi — padajući meni, 12 sati mogu da se vrate */}
      <ReportTrash onRestored={load} />

      {/* Održavanje prostora — da besplatnih 1 GB nikad ne popuniš */}

      <StorageCleanup />
    </div>
  )
}
