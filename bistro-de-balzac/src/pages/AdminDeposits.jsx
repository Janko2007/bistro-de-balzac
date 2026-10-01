import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { groupByDueDate, longDay, shortDay, weekdayName } from '../lib/deposits'
import { heading, printDocument, statGrid, table } from '../lib/print'
import MonthPicker from '../components/MonthPicker'
import ReportPicker from '../components/ReportPicker'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  FullPageLoader,
  Input,
  Modal,
  MoneyInput,
  Stat,
  StatRow,
} from '../components/ui'
import {
  countLabel,
  cx,
  daysAgoISO,
  errorMessage,
  formatDate,
  formatMoney,
  monthRange,
  parseDateInput,
  parseNumber,
  todayISO,
} from '../lib/utils'

/** Koliko unazad se gleda. Pazar se uplaćuje dva puta nedeljno — pola godine
 *  je više nego dovoljno, a upit ostaje mali. */
const WINDOW_DAYS = 180

export default function AdminDeposits() {
  const { profile } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState([]) // dani sa pazarom u prozoru
  const [deposits, setDeposits] = useState([]) // istorija uplata
  const [selected, setSelected] = useState(() => new Set())

  const [modal, setModal] = useState(null) // { kind, deposit? }
  const [form, setForm] = useState({})
  const [working, setWorking] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  /* Istorija uplata: vidi se samo poslednja, strelica otvara još četiri, a
     starije se dobijaju izborom meseca ili pretragom. */
  const [depOpen, setDepOpen] = useState(false)
  const [depSearchOpen, setDepSearchOpen] = useState(false)
  const [depSearch, setDepSearch] = useState('')
  const [depMonth, setDepMonth] = useState('') // '' = svi meseci
  const [dayToDelete, setDayToDelete] = useState(null) // dan čiji se popisi brišu

  /* ---------------------------------------------------------------- */
  /*  Učitavanje                                                       */
  /* ---------------------------------------------------------------- */
  const load = useCallback(async () => {
    const since = daysAgoISO(WINDOW_DAYS)

    const [cashRes, depRes] = await Promise.all([
      supabase
        .from('daily_cash')
        .select('*')
        .gte('report_date', since)
        .order('report_date', { ascending: false }),
      supabase
        .from('cash_deposits')
        .select('*, cash_deposit_days(business_date, amount)')
        .gte('deposited_on', since)
        .order('deposited_on', { ascending: false }),
    ])

    if (cashRes.error || depRes.error) {
      toast.error(errorMessage(cashRes.error || depRes.error, 'Ne mogu da učitam pazare.'))
      setLoading(false)
      return
    }

    setDays(
      (cashRes.data ?? []).map((row) => ({
        date: row.report_date,
        cash: Number(row.cash_amount ?? 0),
        card: Number(row.card_amount ?? 0),
        closed: Number(row.closed_shifts ?? 0),
        open: Number(row.open_shifts ?? 0),
      })),
    )
    setDeposits(depRes.data ?? [])
    setSelected(new Set())
    setLoading(false)
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  /* ---------------------------------------------------------------- */
  /*  Šta je uplaćeno, a šta nije                                      */
  /* ---------------------------------------------------------------- */
  const paidDays = useMemo(() => {
    const map = new Map()
    for (const dep of deposits) {
      for (const day of dep.cash_deposit_days ?? []) map.set(day.business_date, dep)
    }
    return map
  }, [deposits])

  const openDays = useMemo(
    () => days.filter((d) => d.cash > 0 && !paidDays.has(d.date)),
    [days, paidDays],
  )

  const groups = useMemo(() => groupByDueDate(openDays), [openDays])

  const totals = useMemo(() => {
    const month = todayISO().slice(0, 7)
    return {
      owed: openDays.reduce((sum, d) => sum + d.cash, 0),
      due: groups.filter((g) => g.overdue).reduce((sum, g) => sum + g.total, 0),
      paidThisMonth: deposits
        .filter((d) => String(d.deposited_on).startsWith(month))
        .reduce((sum, d) => sum + Number(d.amount ?? 0), 0),
      nextDue: groups.find((g) => !g.overdue)?.due ?? null,
    }
  }, [openDays, groups, deposits])

  /* ---------------------------------------------------------------- */
  /*  Istorija uplata — poslednje tri, ostalo na zahtev                 */
  /* ---------------------------------------------------------------- */
  /** Zatvoren spisak pokazuje samo poslednju uplatu, otvoren najviše pet. */
  const DEPOSITS_CLOSED = 1
  const DEPOSITS_SHOWN = 5

  const depRange = useMemo(() => parseDateInput(depSearch), [depSearch])
  const depSearchInvalid = depSearchOpen && depSearch.trim() !== '' && depRange === null

  /* Pretraga i izbor meseca hvataju i dan uplate i dane koje je ta uplata
     pokrila — tražiš „25.09“ bez obzira na to da li ti je to dan pazara ili
     dan odlaska u banku. */
  const depMatches = useCallback(
    (dep, from, to) => {
      const hit = (date) => date >= from && date <= to
      return (
        hit(String(dep.deposited_on)) ||
        (dep.cash_deposit_days ?? []).some((day) => hit(String(day.business_date)))
      )
    },
    [],
  )

  const searchingDeposits = depSearchOpen && depRange !== null
  const monthPicked = depMonth !== ''

  const foundDeposits = useMemo(() => {
    let list = deposits
    if (monthPicked) {
      const { from, to } = monthRange(depMonth)
      list = list.filter((dep) => depMatches(dep, from, to))
    }
    if (searchingDeposits) {
      list = list.filter((dep) => depMatches(dep, depRange.from, depRange.to))
    }
    return list
  }, [deposits, depMonth, monthPicked, searchingDeposits, depRange, depMatches])

  /* Dok se traži ili je izabran mesec, vidi se sve što je nađeno — spisak je
     tada ionako kratak. Inače stoji samo poslednja uplata, a strelica otvara
     još četiri; dalje se ide mesecom, da istorija ne preraste ceo ekran. */
  const filteringDeposits = searchingDeposits || monthPicked
  const visibleDeposits = filteringDeposits
    ? foundDeposits
    : deposits.slice(0, depOpen ? DEPOSITS_SHOWN : DEPOSITS_CLOSED)
  const moreDeposits = Math.min(DEPOSITS_SHOWN, deposits.length) - DEPOSITS_CLOSED

  const selectedTotal = useMemo(
    () => openDays.filter((d) => selected.has(d.date)).reduce((sum, d) => sum + d.cash, 0),
    [openDays, selected],
  )

  /* ---------------------------------------------------------------- */
  /*  Označavanje                                                      */
  /* ---------------------------------------------------------------- */
  function toggleDay(date) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function toggleGroup(group) {
    const allOn = group.days.every((d) => selected.has(d.date))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const d of group.days) {
        if (allOn) next.delete(d.date)
        else next.add(d.date)
      }
      return next
    })
  }

  /* ---------------------------------------------------------------- */
  /*  Upis uplate                                                      */
  /* ---------------------------------------------------------------- */
  function openDepositModal() {
    if (selected.size === 0) return
    setForm({
      deposited_on: todayISO(),
      amount: String(selectedTotal),
      note: '',
    })
    setModal({ kind: 'deposit' })
  }

  async function saveDeposit(e) {
    e.preventDefault()
    const amount = parseNumber(form.amount)
    if (amount <= 0) return toast.error('Unesi iznos uplate.')

    const chosen = openDays.filter((d) => selected.has(d.date))
    if (chosen.length === 0) return toast.error('Označi bar jedan dan.')

    setWorking(true)

    const { data: deposit, error } = await supabase
      .from('cash_deposits')
      .insert({
        deposited_on: form.deposited_on || todayISO(),
        amount,
        note: (form.note ?? '').trim(),
        created_by: profile.id,
      })
      .select('id')
      .single()

    if (error) {
      setWorking(false)
      return toast.error(errorMessage(error))
    }

    const { error: daysError } = await supabase.from('cash_deposit_days').insert(
      chosen.map((d) => ({
        business_date: d.date,
        deposit_id: deposit.id,
        amount: d.cash,
      })),
    )

    if (daysError) {
      // Uplata bez dana nema smisla — briše se da ne ostane pola upisa.
      await supabase.from('cash_deposits').delete().eq('id', deposit.id)
      setWorking(false)
      return toast.error(
        daysError.code === '23505'
          ? 'Neki od označenih dana su u međuvremenu već uplaćeni. Osveži spisak.'
          : errorMessage(daysError),
      )
    }

    setWorking(false)
    setModal(null)
    toast.success(`Uplata ${formatMoney(amount)} je upisana za ${countLabel(chosen.length, 'dan')}.`)
    load()
  }

  /**
   * Brisanje svih popisa jednog dana — odatle i njegov pazar.
   *
   * Pazar se nigde ne čuva posebno; računa se iz popisa. Zato se „stanje“ za
   * taj dan skida tako što se obrišu popisi koji su ga napravili. Idu u korpu,
   * pa se 12 sati mogu vratiti.
   */
  async function deleteDay() {
    const date = dayToDelete.date
    setWorking(true)

    const { data, error } = await supabase
      .from('shift_reports')
      .select('id')
      .eq('report_date', date)

    if (error) {
      setWorking(false)
      return toast.error(errorMessage(error))
    }

    for (const row of data ?? []) {
      const res = await supabase.rpc('trash_report', { p_id: row.id })
      if (res.error) {
        setWorking(false)
        return toast.error(errorMessage(res.error))
      }
    }

    setWorking(false)
    setDayToDelete(null)
    toast.success(`Popisi za ${formatDate(date)} su obrisani.`)
    load()
  }

  /**
   * Brisanje uplate.
   *
   * Dani se brišu prvo, pa tek onda sama uplata — baza to radi i sama
   * (`on delete cascade`), ali u starijim bazama ta veza nije bila
   * postavljena, pa bi brisanje palo na vezanim redovima.
   *
   * `select()` posle brisanja vraća obrisane redove. Ako se ne vrati nijedan,
   * uplata NIJE obrisana (npr. nalog nema admin prava) — a bez ove provere
   * aplikacija bi prijavila uspeh iako se ništa nije promenilo.
   */
  async function deleteDeposit() {
    const deposit = modal.deposit
    setWorking(true)

    const daysRes = await supabase
      .from('cash_deposit_days')
      .delete()
      .eq('deposit_id', deposit.id)

    if (daysRes.error) {
      setWorking(false)
      return toast.error(errorMessage(daysRes.error))
    }

    const { data, error } = await supabase
      .from('cash_deposits')
      .delete()
      .eq('id', deposit.id)
      .select('id')
    setWorking(false)

    if (error) return toast.error(errorMessage(error))
    if (!data || data.length === 0) {
      return toast.error('Uplata nije obrisana. Proveri da si prijavljen kao admin.')
    }

    setModal(null)
    toast.success('Uplata je obrisana — dani se vraćaju u „za uplatu“.')
    load()
  }

  /* ---------------------------------------------------------------- */
  /*  Izveštaj za štampu                                               */
  /* ---------------------------------------------------------------- */
  /** Šta čeka uplatu i šta je već uplaćeno — `parts` bira šta ulazi. */
  function printDeposits(parts) {
    const has = (key) => parts.includes(key)

    const owedRows = []
    for (const group of groups) {
      owedRows.push({
        kind: 'group',
        label: `Uplata ${longDay(group.due)}${group.overdue ? ' — kasni' : ''}`,
        right: formatMoney(group.total, false),
      })
      for (const day of group.days) {
        owedRows.push([
          formatDate(day.date),
          weekdayName(day.date),
          String(day.closed),
          formatMoney(day.cash, false),
        ])
      }
    }
    if (owedRows.length > 0) {
      owedRows.push({
        kind: 'total',
        cells: ['Ukupno za uplatu', '', '', formatMoney(totals.owed, false)],
      })
    }

    const depositRows = deposits.map((d) => [
      formatDate(d.deposited_on),
      (d.cash_deposit_days ?? [])
        .slice()
        .sort((a, b) => (a.business_date < b.business_date ? -1 : 1))
        .map((day) => shortDay(day.business_date))
        .join(', '),
      d.note || '',
      { value: formatMoney(d.amount, false), align: 'right', strong: true },
    ])
    if (depositRows.length > 0) {
      depositRows.push({
        kind: 'total',
        cells: [
          'Ukupno uplaćeno',
          '',
          '',
          formatMoney(
            deposits.reduce((sum, d) => sum + Number(d.amount ?? 0), 0),
            false,
          ),
        ],
      })
    }

    /* Pazar po danima — koliko je ušlo i da li je taj dan uplaćen. */
    const DAYS_ON_PAPER = 45
    const recent = days.filter((d) => d.cash > 0 || d.card > 0).slice(0, DAYS_ON_PAPER)

    const dayRows = recent.map((d) => {
      const dep = paidDays.get(d.date)
      return [
        formatDate(d.date),
        weekdayName(d.date),
        formatMoney(d.cash + d.card, false),
        formatMoney(d.card, false),
        formatMoney(d.cash, false),
        dep
          ? { value: `uplaćeno ${formatDate(dep.deposited_on)}`, muted: true }
          : { value: d.open > 0 ? 'smena u toku' : 'čeka uplatu', strong: d.open === 0 },
      ]
    })

    if (dayRows.length > 0) {
      const sum = recent.reduce(
        (acc, d) => ({ cash: acc.cash + d.cash, card: acc.card + d.card }),
        { cash: 0, card: 0 },
      )
      dayRows.push({
        kind: 'total',
        cells: [
          'Ukupno',
          `${recent.length} ${recent.length === 1 ? 'dan' : 'dana'}`,
          formatMoney(sum.cash + sum.card, false),
          formatMoney(sum.card, false),
          formatMoney(sum.cash, false),
          '',
        ],
      })
    }

    printDocument({
      title: 'Uplate pazara',
      subtitle: 'Gotovina iz zatvorenih smena — šta čeka polog, a šta je već uplaćeno',
      meta: [
        { label: 'Na dan', value: formatDate(todayISO()) },
        { label: 'Period', value: `poslednjih ${WINDOW_DAYS} dana` },
      ],
      content: [
        has('zbir')
          ? statGrid([
              { label: 'Za uplatu', value: formatMoney(totals.owed, false) },
              {
                label: 'Rok stigao',
                value: formatMoney(totals.due, false),
                sub: totals.due > 0 ? 'uplati odmah' : 'nema zaostatka',
              },
              {
                label: 'Sledeća uplata',
                value: totals.nextDue ? formatDate(totals.nextDue) : '—',
                sub: totals.nextDue ? weekdayName(totals.nextDue) : 'sve je uplaćeno',
              },
              {
                label: 'Uplaćeno ovog meseca',
                value: formatMoney(totals.paidThisMonth, false),
              },
            ])
          : '',
        has('zauplatu')
          ? heading(
              'Za uplatu po danima',
              'ponedeljkom: petak–nedelja · petkom: ponedeljak–četvrtak',
            )
          : '',
        has('zauplatu')
          ? table({
              columns: [
                { label: 'Datum', width: '16%' },
                { label: 'Dan' },
                { label: 'Smena', align: 'right', width: '12%' },
                { label: 'Gotovina', align: 'right', width: '18%' },
              ],
              rows: owedRows,
              empty: 'Sve je uplaćeno — nema dana koji čeka polog.',
            })
          : '',
        has('uplaceno') ? heading('Uplaćeno', `${countLabel(deposits.length, 'uplata')}`) : '',
        has('uplaceno')
          ? table({
              columns: [
                { label: 'Datum uplate', width: '16%' },
                { label: 'Za dane' },
                { label: 'Napomena', width: '24%' },
                { label: 'Iznos', align: 'right', width: '16%' },
              ],
              rows: depositRows,
              empty: 'Još nema upisanih uplata.',
            })
          : '',
        has('dani')
          ? heading('Pazar po danima', `poslednjih ${DAYS_ON_PAPER} dana sa prometom`)
          : '',
        has('dani')
          ? table({
              columns: [
                { label: 'Datum', width: '14%' },
                { label: 'Dan', width: '14%' },
                { label: 'Pazar', align: 'right', width: '14%' },
                { label: 'Kartice', align: 'right', width: '14%' },
                { label: 'Gotovina', align: 'right', width: '14%' },
                { label: 'Uplata' },
              ],
              rows: dayRows,
              empty: 'Nema dana sa prometom.',
            })
          : '',
      ].join(''),
    })
  }

  if (loading) return <FullPageLoader />

  return (
    <div className="space-y-4">
      {/* ---------- Koliko ima da se uplati ---------- */}
      <StatRow className="grid-cols-2 sm:grid-cols-4">
        {/* „Za uplatu“ je sve što još nije u banci; „Rok stigao“ je onaj deo
            kojem je dan uplate već došao — to ide prvo. */}
        <Stat label="Za uplatu" value={formatMoney(totals.owed, false)} tone="total" />
        <Stat
          label="Rok stigao"
          value={formatMoney(totals.due, false)}
          sub={totals.due > 0 ? 'uplati odmah' : 'nema zaostatka'}
          tone={totals.due > 0 ? 'expense' : 'default'}
        />
        <Stat
          label="Sledeća uplata"
          value={totals.nextDue ? shortDay(totals.nextDue) : '—'}
          sub={totals.nextDue ? weekdayName(totals.nextDue) : 'sve je uplaćeno'}
        />
        <Stat
          label="Uplaćeno ovog meseca"
          value={formatMoney(totals.paidThisMonth, false)}
        />
      </StatRow>

      {/* ---------- Dani koji čekaju uplatu ---------- */}
      <Card>
        <CardHeader
          title="Za uplatu po danima"
          subtitle={
            <>
              Ponedeljkom: petak, subota, nedelja
              <br />
              Petkom: ponedeljak–četvrtak
            </>
          }
          action={
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                Preuzmi
              </Button>
              <Button variant="ghost" size="sm" onClick={load}>
                Osveži
              </Button>
            </div>
          }
        />

        {groups.length === 0 ? (
          <EmptyState
            icon="✓"
            title="Sve je uplaćeno"
            description="Nema dana sa gotovinom koji čeka polog u banku."
          />
        ) : (
          <div className="divide-y divide-stone-100">
            {groups.map((group) => {
              const allOn = group.days.every((d) => selected.has(d.date))
              return (
                <div key={group.due}>
                  {/* Zaglavlje grupe = dan uplate */}
                  <div className="flex items-center gap-2.5 bg-stone-50 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      {/* Sme da se prelomi — uz naslov stoje i bedž i dugme,
                          pa bi se na telefonu datum odsekao. */}
                      <p className="text-xs font-bold uppercase leading-snug tracking-wide text-stone-600">
                        Uplata {longDay(group.due)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-stone-500">
                        {countLabel(group.days.length, 'dan')} · {formatMoney(group.total)}
                      </p>
                    </div>

                    {group.overdue ? (
                      <Badge className="bg-rose-100 text-rose-700 ring-rose-600/20">
                        {group.due === todayISO() ? 'danas' : 'kasni'}
                      </Badge>
                    ) : (
                      <Badge className="bg-stone-100 text-stone-600 ring-stone-500/20">
                        još ima vremena
                      </Badge>
                    )}

                    <Button variant="ghost" size="sm" onClick={() => toggleGroup(group)}>
                      {allOn ? 'Poništi' : 'Označi sve'}
                    </Button>
                  </div>

                  {/* Dani u grupi */}
                  {group.days.map((day) => (
                    <DayRow
                      key={day.date}
                      day={day}
                      checked={selected.has(day.date)}
                      onToggle={() => toggleDay(day.date)}
                      onDelete={() => setDayToDelete(day)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        )}

        <p className="border-t border-stone-100 px-4 py-2.5 text-xs text-stone-500">
          Računa se samo <strong>gotovina</strong> iz zatvorenih smena — kartice idu pravo na
          račun, a smena koja je još u toku nema zaključen pazar.
        </p>
      </Card>

      {/* ---------- Traka sa označenim danima ---------- */}
      {selected.size > 0 && (
        {/* Iznad donje navigacije, uz prostor za crtu za gašenje na iPhone-u. */}
        <div className="sticky bottom-[calc(68px+env(safe-area-inset-bottom,0px))] z-20 lg:bottom-4">
          <div className="flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-white">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wide text-stone-400">
                Označeno {countLabel(selected.size, 'dan')}
              </p>
              <p className="truncate text-lg font-bold tabular-nums">
                {formatMoney(selectedTotal)}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
              Poništi
            </Button>
            <Button size="sm" onClick={openDepositModal}>
              Upiši uplatu
            </Button>
          </div>
        </div>
      )}

      {/* Šta ulazi u preuzet izveštaj */}
      <ReportPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Preuzmi izveštaj o uplatama"
        options={[
          { key: 'zbir', label: 'Zbirni pregled' },
          { key: 'zauplatu', label: 'Za uplatu po danima' },
          { key: 'uplaceno', label: 'Uplaćeno' },
          { key: 'dani', label: 'Pazar po danima' },
        ]}
        onConfirm={printDeposits}
      />

      {/* ---------- Istorija uplata ----------
          Vide se poslednje tri. Ostalo se otvara strelicom na dnu ili se
          traži lupom po datumu — spisak inače preraste ceo ekran. */}
      <Card>
        <CardHeader
          title="Uplaćeno"
          subtitle={filteringDeposits ? String(foundDeposits.length) : String(deposits.length)}
          action={
            deposits.length > 0 ? (
              <div className="flex shrink-0 items-center gap-1">
                {/* Strelica bira mesec, lupa traži po datumu. */}
                <MonthPicker compact allowClear month={depMonth} onChange={setDepMonth} />
                <button
                  type="button"
                  onClick={() => {
                    setDepSearchOpen((v) => !v)
                    setDepSearch('')
                  }}
                  aria-label="Pretraga po datumu"
                  aria-pressed={depSearchOpen}
                  className={cx(
                    'rounded-xl p-2 transition',
                    depSearchOpen
                      ? 'bg-stone-900 text-white'
                      : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700',
                  )}
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                  </svg>
                </button>
              </div>
            ) : null
          }
        />

        {depSearchOpen && deposits.length > 0 && (
          <div className="px-4 pb-1 pt-3">
            <Input
              type="search"
              inputMode="numeric"
              autoFocus
              value={depSearch}
              onChange={(e) => setDepSearch(e.target.value)}
              placeholder="Pretraži po datumu"
              aria-label="Pretraga uplata po datumu"
              className={cx(depSearchInvalid && 'border-rose-400')}
            />
            {depSearchInvalid && (
              <p className="mt-1.5 text-[12px] font-medium text-rose-600">
                Probaj 15 · 15.09 · 15.09.2026 · 09.2026
              </p>
            )}
          </div>
        )}

        {deposits.length === 0 ? (
          <EmptyState icon="↓" title="Još nema upisanih uplata" />
        ) : visibleDeposits.length === 0 ? (
          <EmptyState icon="🔍" title="Nema uplate za taj period" />
        ) : (
          <ul className="divide-y divide-stone-100">
            {visibleDeposits.map((deposit) => (
              <li key={deposit.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-stone-900">
                      {formatDate(deposit.deposited_on)}
                      <span className="ml-2 font-normal text-stone-500">
                        {weekdayName(deposit.deposited_on)}
                      </span>
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(deposit.cash_deposit_days ?? [])
                        .slice()
                        .sort((a, b) => (a.business_date < b.business_date ? -1 : 1))
                        .map((day) => (
                          <span
                            key={day.business_date}
                            className="rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600"
                          >
                            {shortDay(day.business_date)}
                          </span>
                        ))}
                    </div>
                    {deposit.note && (
                      <p className="mt-1.5 text-xs text-stone-500">{deposit.note}</p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-base font-bold tabular-nums text-emerald-700">
                      {formatMoney(deposit.amount, false)}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-0.5 text-rose-600"
                      onClick={() => setModal({ kind: 'undo', deposit })}
                    >
                      Obriši
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Strelica otvara još četiri uplate. Dalje od toga se ne ide spiskom
            — starije se uzimaju mesecom ili lupom. */}
        {!filteringDeposits && moreDeposits > 0 && (
          <button
            type="button"
            onClick={() => setDepOpen((v) => !v)}
            aria-expanded={depOpen}
            className="flex w-full items-center justify-center gap-2 border-t border-stone-100 px-4 py-3 text-[13px] font-semibold text-stone-500 transition hover:bg-stone-50"
          >
            <svg
              className={cx('h-4 w-4 transition-transform', depOpen && 'rotate-180')}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
            {depOpen ? 'Prikaži manje' : `Još ${moreDeposits}`}
          </button>
        )}
      </Card>

      {/* ================================================================ */}
      {/*  Modal: upis uplate                                              */}
      {/* ================================================================ */}
      <Modal
        open={modal?.kind === 'deposit'}
        onClose={() => !working && setModal(null)}
        title="Upiši uplatu pazara"
      >
        {modal?.kind === 'deposit' && (
          <form onSubmit={saveDeposit} className="space-y-4">
            <div className="rounded-xl bg-stone-50 px-4 py-3 text-sm">
              {openDays
                .filter((d) => selected.has(d.date))
                .sort((a, b) => (a.date < b.date ? -1 : 1))
                .map((d) => (
                  <div key={d.date} className="flex justify-between py-0.5">
                    <span className="text-stone-600">{longDay(d.date)}</span>
                    <span className="font-bold tabular-nums">{formatMoney(d.cash, false)}</span>
                  </div>
                ))}
              <div className="mt-1 flex justify-between border-t border-stone-200 pt-1.5">
                <span className="font-semibold text-stone-700">Zbir</span>
                <span className="font-extrabold tabular-nums text-brand-700">
                  {formatMoney(selectedTotal)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Datum uplate" required>
                <Input
                  type="date"
                  value={form.deposited_on ?? todayISO()}
                  max={todayISO()}
                  onChange={(e) => setForm((f) => ({ ...f, deposited_on: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Iznos" required hint="Ispravi ako se razlikuje od zbira.">
                <MoneyInput
                  value={form.amount ?? ''}
                  onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
                />
              </Field>
            </div>

            <Field label="Napomena">
              <Input
                value={form.note ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="npr. uplaćeno u pošti"
              />
            </Field>

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setModal(null)}
              >
                Otkaži
              </Button>
              <Button type="submit" variant="success" className="flex-1" loading={working}>
                Upiši uplatu
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ================================================================ */}
      {/*  Modal: poništavanje uplate                                      */}
      {/* ================================================================ */}
      <Modal
        open={modal?.kind === 'undo'}
        onClose={() => !working && setModal(null)}
        title="Da li si siguran?"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={working}
              onClick={() => setModal(null)}
            >
              Ne, vrati me
            </Button>
            <Button variant="danger" className="flex-1" loading={working} onClick={deleteDeposit}>
              Da, obriši
            </Button>
          </div>
        }
      >
        <p className="text-sm text-stone-600">
          Briše se uplata od <strong>{formatDate(modal?.deposit?.deposited_on)}</strong> na iznos{' '}
          <strong>{formatMoney(modal?.deposit?.amount, false)}</strong>.
        </p>
        <p className="mt-2 text-[13px] text-stone-400">
          {countLabel((modal?.deposit?.cash_deposit_days ?? []).length, 'dan')} se vraća u „za
          uplatu“. Popisi se ne diraju.
        </p>
      </Modal>

      {/* ================================================================ */}
      {/*  Modal: brisanje popisa jednog dana                              */}
      {/* ================================================================ */}
      <Modal
        open={!!dayToDelete}
        onClose={() => !working && setDayToDelete(null)}
        title="Da li si siguran?"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={working}
              onClick={() => setDayToDelete(null)}
            >
              Ne, vrati me
            </Button>
            <Button variant="danger" className="flex-1" loading={working} onClick={deleteDay}>
              Da, obriši
            </Button>
          </div>
        }
      >
        <p className="text-sm text-stone-600">
          Brišu se <strong>svi popisi</strong> za{' '}
          <strong>{dayToDelete ? longDay(dayToDelete.date) : ''}</strong> — sa njima nestaje i
          pazar od <strong>{formatMoney(dayToDelete?.cash ?? 0, false)}</strong>.
        </p>
        <p className="mt-2 text-[13px] text-stone-400">
          Nestaju i dnevnice i prodaja po artiklima za taj dan. Popisi idu u korpu i mogu da se
          vrate 12 sati (Pregled → Obrisani popisi).
        </p>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Jedan dan sa pazarom                                               */
/* ------------------------------------------------------------------ */
function DayRow({ day, checked, onToggle, onDelete }) {
  return (
    <div className={cx('flex items-center', checked ? 'bg-brand-50' : 'hover:bg-stone-50')}>
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left transition"
    >
      <span
        className={cx(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition',
          checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-300 bg-white',
        )}
      >
        {checked && (
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M4 10.5l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-stone-900">
          {longDay(day.date)}
        </span>
        <span className="block truncate text-[11px] text-stone-500">
          {countLabel(day.closed, 'smena')} · kartice {formatMoney(day.card, false)}
          {day.open > 0 && ' · smena u toku nije uračunata'}
        </span>
      </span>

      <span className="shrink-0 text-right text-sm font-bold tabular-nums text-stone-900">
        {formatMoney(day.cash, false)}
      </span>
    </button>

    {/* Probni ili pogrešan dan se odavde briše — zajedno sa popisima koji
        su ga napravili, jer se pazar iz njih i računa. */}
    <button
      type="button"
      onClick={onDelete}
      aria-label={`Obriši popise za ${longDay(day.date)}`}
      title="Obriši popise tog dana"
      className="shrink-0 rounded-lg p-2 pr-3 text-stone-300 transition hover:text-rose-600"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
    </div>
  )
}
