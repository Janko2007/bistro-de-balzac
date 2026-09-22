import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { groupByDueDate, longDay, shortDay, weekdayName } from '../lib/deposits'
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

  async function deleteDeposit() {
    const deposit = modal.deposit
    setWorking(true)
    const { error } = await supabase.from('cash_deposits').delete().eq('id', deposit.id)
    setWorking(false)

    if (error) return toast.error(errorMessage(error))
    setModal(null)
    toast.success('Uplata je poništena — dani se vraćaju u „za uplatu“.')
    load()
  }

  if (loading) return <FullPageLoader />

  return (
    <div className="space-y-4">
      {/* ---------- Koliko ima da se uplati ---------- */}
      <StatRow className="grid-cols-2 sm:grid-cols-4">
        <Stat
          label="Za uplatu"
          value={formatMoney(totals.owed, false)}
          sub="RSD ukupno"
          tone="total"
        />
        <Stat
          label="Dospelo"
          value={formatMoney(totals.due, false)}
          sub={totals.due > 0 ? 'treba uplatiti' : 'nema zaostataka'}
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
          sub="RSD"
          tone="cash"
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
            <Button variant="ghost" size="sm" className="shrink-0" onClick={load}>
              Osveži
            </Button>
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
                        nije dospelo
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
        <div className="sticky bottom-[68px] z-20 lg:bottom-3">
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

      {/* ---------- Istorija uplata ---------- */}
      <Card>
        <CardHeader
          title="Uplaćeno"
          subtitle={`Poslednjih ${WINDOW_DAYS} dana · ${countLabel(deposits.length, 'uplata')}`}
        />

        {deposits.length === 0 ? (
          <EmptyState
            icon="↓"
            title="Još nema upisanih uplata"
            description="Označi dane gore i klikni „Upiši uplatu“."
          />
        ) : (
          <ul className="divide-y divide-stone-100">
            {deposits.map((deposit) => (
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
                      Poništi
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
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
        title="Poništi uplatu"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={working}
              onClick={() => setModal(null)}
            >
              Otkaži
            </Button>
            <Button variant="danger" className="flex-1" loading={working} onClick={deleteDeposit}>
              Poništi uplatu
            </Button>
          </div>
        }
      >
        <p className="text-sm text-stone-600">
          Uplata od <strong>{formatDate(modal?.deposit?.deposited_on)}</strong> na iznos{' '}
          <strong>{formatMoney(modal?.deposit?.amount)}</strong> se briše.
        </p>
        <p className="mt-2 text-sm text-stone-600">
          Dani koje je pokrivala ({(modal?.deposit?.cash_deposit_days ?? []).length}) vraćaju se u
          spisak „za uplatu“. Sami popisi se ne diraju.
        </p>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Jedan dan sa pazarom                                               */
/* ------------------------------------------------------------------ */
function DayRow({ day, checked, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={cx(
        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition',
        checked ? 'bg-brand-50' : 'hover:bg-stone-50',
      )}
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
  )
}
