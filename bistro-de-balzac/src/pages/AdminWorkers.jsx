import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { EMPTY_STATS, loadWorkStats, settle } from '../lib/earnings'
import { currentPeriod, periodLabel } from '../lib/payperiod'
import Avatar, { AvatarEditor } from '../components/Avatar'
import PeriodPicker from '../components/PeriodPicker'
import ReportPicker from '../components/ReportPicker'
import { heading, printDocument, statGrid, table } from '../lib/print'
import RuleDocs from '../components/RuleDocs'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  FullPageLoader,
  Input,
  Modal,
  MoneyInput,
  Select,
  Stat,
} from '../components/ui'
import {
  SHIFT_SHORT,
  countLabel,
  cx,
  errorMessage,
  formatDate,
  formatMoney,
  formatQty,
  parseNumber,
  plural,
  shiftRank,
  todayISO,
} from '../lib/utils'

const emptyNew = {
  full_name: '',
  phone: '',
  password: '',
  role: 'radnik',
  pay_model: 'dnevnica',
  daily_wage: '',
  monthly_salary: '',
  percent: '',
}

/**
 * Način plaćanja — dnevnica ili plata, uz procenat od pazara.
 *
 * Isti blok stoji i u „Novi nalog“ i u „Izmeni“, pa se sve menja na jednom
 * mestu. Procenat ide uz oba načina: računa se od pazara smena koje je taj
 * radnik radio u obračunskom periodu.
 */
function PayFields({ form, setForm }) {
  const plata = form.pay_model === 'plata'
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  return (
    <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-3.5">
      <div>
        <span className="label">Način plaćanja</span>
        <div className="flex gap-2">
          {[
            ['dnevnica', 'Dnevnica', 'po smeni'],
            ['plata', 'Plata', 'mesečno'],
          ].map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              onClick={() => set({ pay_model: value })}
              aria-pressed={form.pay_model === value}
              className={cx(
                'flex-1 rounded-xl border px-3 py-2.5 text-left transition',
                form.pay_model === value
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-stone-200 bg-white hover:bg-stone-50',
              )}
            >
              <span className="block text-sm font-bold text-stone-900">{label}</span>
              <span className="block text-[11px] text-stone-500">{hint}</span>
            </button>
          ))}
        </div>
      </div>

      {plata ? (
        <Field label="Mesečna plata" hint="Za pola meseca ide polovina.">
          <MoneyInput value={form.monthly_salary} onChange={(v) => set({ monthly_salary: v })} />
        </Field>
      ) : (
        <Field label="Dnevnica">
          <MoneyInput value={form.daily_wage} onChange={(v) => set({ daily_wage: v })} />
        </Field>
      )}

      <Field label="Procenat od pazara" hint="Opciono.">
        <div className="relative">
          <Input
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder="0"
            value={form.percent}
            onChange={(e) => set({ percent: e.target.value })}
            className="pr-9"
          />
          <span className="absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-stone-500">
            %
          </span>
        </div>
      </Field>
    </div>
  )
}

/** Lozinka koju je lako pročitati i otkucati na telefonu. */
function generatePassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 4; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
  out += '-'
  for (let i = 0; i < 4; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export default function AdminWorkers() {
  const { profile, refreshProfile } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [people, setPeople] = useState([])
  const [stats, setStats] = useState(new Map())
  const [period, setPeriod] = useState(() => currentPeriod())

  const [working, setWorking] = useState(false)
  const [modal, setModal] = useState(null) // { kind, person? }
  const [form, setForm] = useState(emptyNew)
  const [created, setCreated] = useState(null)
  const [fnHelp, setFnHelp] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [payoutToRemove, setPayoutToRemove] = useState(null) // id stavke koja se briše
  const [showInactive, setShowInactive] = useState(false)
  // { reportId, value } — smena kojoj se upravo menja iznos dnevnice
  const [wageRow, setWageRow] = useState(null)

  const range = useMemo(
    () => ({ from: period.from, to: period.to, periodKey: period.key }),
    [period],
  )

  const load = useCallback(async () => {
    // Redosled zadaje admin strelicama; ime je samo rezerva kad su isti.
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_deleted', false)
      .order('sort_order')
      .order('full_name')

    if (error) {
      toast.error(errorMessage(error))
      setLoading(false)
      return
    }
    setPeople(data ?? [])

    try {
      setStats(await loadWorkStats(range))
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Ne mogu da učitam obračun dnevnica.'))
    }
    setLoading(false)
  }, [range, toast])

  useEffect(() => {
    load()
  }, [load])

  /* ---------------------------------------------------------------- */
  /*  Zbirni obračun                                                   */
  /* ---------------------------------------------------------------- */
  const rows = useMemo(
    () => people.map((p) => ({ person: p, calc: settle(p, stats.get(p.id) ?? EMPTY_STATS) })),
    [people, stats],
  )

  /* Neaktivni ne stoje među aktivnima — sklonjeni su na dno, iza dugmeta. */
  const activeRows = useMemo(() => rows.filter((r) => r.person.is_active), [rows])
  const inactiveRows = useMemo(() => rows.filter((r) => !r.person.is_active), [rows])

  /**
   * Zamena mesta sa susedom iznad (-1) ili ispod (+1).
   * Menja se samo redosled aktivnih — neaktivni stoje na dnu, iza dugmeta.
   */
  async function moveWorker(index, dir) {
    const a = activeRows[index]?.person
    const b = activeRows[index + dir]?.person
    if (!a || !b) return

    // Odmah na ekranu, pa u bazu — da spisak ne „poskoči“ posle odgovora.
    setPeople((prev) =>
      prev.map((p) => {
        if (p.id === a.id) return { ...p, sort_order: b.sort_order }
        if (p.id === b.id) return { ...p, sort_order: a.sort_order }
        return p
      }),
    )

    const [r1, r2] = await Promise.all([
      supabase.from('profiles').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('profiles').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    if (r1.error || r2.error) {
      toast.error(errorMessage(r1.error || r2.error, 'Redosled nije sačuvan.'))
      load()
    }
  }

  /** Koliko radnik još ima da primi u izabranom periodu. */
  function owedOf(person) {
    return settle(person, stats.get(person.id) ?? EMPTY_STATS).balance
  }

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          days: acc.days + r.calc.days,
          shifts: acc.shifts + r.calc.shifts,
          earned: acc.earned + r.calc.earned,
          bonus: acc.bonus + r.calc.bonus,
          paid: acc.paid + r.calc.paid,
          balance: acc.balance + r.calc.balance,
        }),
        { days: 0, shifts: 0, earned: 0, bonus: 0, paid: 0, balance: 0 },
      ),
    [rows],
  )

  /* ---------------------------------------------------------------- */
  /*  Obračun na papiru                                                */
  /* ---------------------------------------------------------------- */
  /** Spisak za isplatu: obračun po radniku i mesto za potpis — `parts` bira šta ulazi. */
  function printSettlement(parts) {
    const has = (key) => parts.includes(key)

    const columns = [
      { label: 'Radnik' },
      { label: 'Osnova', align: 'right', width: '14%' },
      // Dnevnica se računa po danu — međusmena u dve smene je jedan dan.
      { label: 'Dana', align: 'right', width: '8%' },
      { label: 'Zarađeno', align: 'right', width: '12%' },
      { label: 'Bonus', align: 'right', width: '10%' },
      { label: 'Isplaćeno', align: 'right', width: '12%' },
      { label: 'Za isplatu', align: 'right', width: '12%' },
      { label: 'Potpis', width: '15%' },
    ]

    const bodyRows = rows
      .filter(({ person, calc }) => person.is_active || calc.shifts > 0 || calc.balance !== 0)
      .map(({ person, calc }) => ({
        cells: [
          person.full_name || '—',
          // Osnova: dnevnica po danu ili mesečna plata, plus procenat ako ga ima.
          (calc.model === 'plata'
            ? `${formatMoney(calc.salary, false)}/mes`
            : `${formatMoney(calc.wage, false)}/dan`) +
            (calc.model === 'dnevnica' && calc.reduced > 0
              ? ` (${calc.reduced} umanjeno)`
              : '') +
            (calc.percent > 0 ? ` +${formatQty(calc.percent)}%` : ''),
          String(calc.days),
          formatMoney(calc.earned, false),
          calc.bonus > 0 ? `+${formatMoney(calc.bonus, false)}` : '—',
          formatMoney(calc.paid, false),
          { value: formatMoney(calc.balance, false), strong: true },
          '',
        ],
      }))

    bodyRows.push({
      kind: 'total',
      cells: [
        'Ukupno',
        '',
        String(totals.days),
        formatMoney(totals.earned, false),
        totals.bonus > 0 ? `+${formatMoney(totals.bonus, false)}` : '—',
        formatMoney(totals.paid, false),
        formatMoney(totals.balance, false),
        '',
      ],
    })

    /* Sve isplate i bonusi u periodu — da se vidi šta je već dato. */
    const entries = rows
      .flatMap(({ person, calc }) =>
        calc.payouts.map((p) => ({ name: person.full_name, ...p })),
      )
      .sort((a, b) => String(b.paid_on).localeCompare(String(a.paid_on)))

    const payoutRows = entries.map((p) => [
      formatDate(p.paid_on),
      p.name || '—',
      p.kind === 'bonus' ? 'Bonus' : 'Isplata',
      p.note || '',
      {
        value: `${p.kind === 'bonus' ? '+' : '−'}${formatMoney(p.amount, false)}`,
        align: 'right',
        strong: true,
      },
    ])

    const returned = rows.reduce((sum, r) => sum + r.calc.returned, 0)

    printDocument({
      title: 'Obračun dnevnica',
      subtitle: `Obračunski period ${periodLabel(period)}`,
      meta: [
        { label: 'Period', value: `${formatDate(period.from)} – ${formatDate(period.to)}` },
        { label: 'Radnika', value: String(bodyRows.length - 1) },
      ],
      content: [
        has('zbir')
          ? statGrid([
              { label: 'Odrađeno dana', value: String(totals.days) },
              { label: 'Zarađeno', value: formatMoney(totals.earned, false) },
              { label: 'Bonusi', value: formatMoney(totals.bonus, false) },
              { label: 'Isplaćeno', value: formatMoney(totals.paid, false) },
              { label: 'Za isplatu', value: formatMoney(totals.balance, false) },
            ])
          : '',
        has('radnici') ? heading('Po radnicima', 'za isplatu = zarađeno + bonusi − isplaćeno') : '',
        has('radnici')
          ? table({ columns, rows: bodyRows, empty: 'Nema radnika u ovom periodu.' })
          : '',
        has('radnici') && returned > 0
          ? `<p class="empty">${countLabel(returned, 'smena')} vraćeno na ispravku — ne ulazi u obračun dok se ne ispravi.</p>`
          : '',
        has('isplate') && entries.length > 0 ? heading('Isplate i bonusi u periodu') : '',
        has('isplate') && entries.length > 0
          ? table({
              columns: [
                { label: 'Datum', width: '14%' },
                { label: 'Radnik', width: '24%' },
                { label: 'Vrsta', width: '12%' },
                { label: 'Napomena' },
                { label: 'Iznos', align: 'right', width: '14%' },
              ],
              rows: payoutRows,
            })
          : '',
      ].join(''),
      // Prazno polje „Potpis“ dobija liniju na kojoj se potpisuje.
      extraCss: `
        table.t tr:not(.tot):not(.g) td:empty { border-bottom: 1px solid #b9b3ad; }
        table.t td { height: 24px; }
      `,
    })
  }

  /* ---------------------------------------------------------------- */
  /*  Edge Function                                                    */
  /* ---------------------------------------------------------------- */
  async function callFunction(body) {
    const { data, error } = await supabase.functions.invoke('manage-worker', { body })
    if (data?.error) return { error: data.error }
    if (error) {
      // Funkcija je odgovorila greškom (npr. „radnik već postoji“) — poruka je
      // u telu odgovora, a ne u `data`.
      const res = error.context
      if (res && typeof res.json === 'function') {
        let payload = null
        try {
          payload = await res.json()
        } catch {
          /* odgovor nije JSON */
        }
        if (payload?.error) return { error: payload.error }
        if (res.status === 401) {
          return { error: 'Prijava je istekla — odjavi se i prijavi ponovo, pa pokušaj opet.' }
        }
        if (res.status !== 404) {
          return { error: payload?.message || `Greška na serveru (${res.status}). Pokušaj ponovo.` }
        }
      }
      setFnHelp(true)
      return { error: 'Edge Function „manage-worker" nije dostupna. Uputstvo je ispod forme.' }
    }
    return { data }
  }

  /* ---------------------------------------------------------------- */
  /*  Radnje                                                           */
  /* ---------------------------------------------------------------- */
  function openNew() {
    setForm({ ...emptyNew, password: generatePassword() })
    setCreated(null)
    setFnHelp(false)
    setModal({ kind: 'new' })
  }

  function openEdit(person) {
    setForm({
      full_name: person.full_name ?? '',
      phone: person.phone ?? '',
      password: '',
      role: person.role,
      pay_model: person.pay_model === 'plata' ? 'plata' : 'dnevnica',
      daily_wage: String(person.daily_wage ?? ''),
      monthly_salary: String(person.monthly_salary ?? ''),
      percent: Number(person.percent) ? String(person.percent) : '',
    })
    setModal({ kind: 'edit', person })
  }

  async function createWorker(e) {
    e.preventDefault()
    const name = form.full_name.trim().replace(/\s+/g, ' ')

    if (name.split(' ').length < 2) return toast.error('Unesi ime i prezime.')
    if (form.password.length < 6) return toast.error('Lozinka mora imati bar 6 karaktera.')

    setWorking(true)
    const { data, error } = await callFunction({
      action: 'create',
      full_name: name,
      phone: form.phone.trim(),
      password: form.password,
      role: form.role,
      pay_model: form.pay_model,
      daily_wage: parseNumber(form.daily_wage),
      monthly_salary: parseNumber(form.monthly_salary),
      percent: parseNumber(form.percent),
    })
    setWorking(false)

    if (error) return toast.error(error)

    setCreated({ username: name, password: form.password })
    toast.success('Nalog je otvoren.')
    load()
  }

  async function saveEdit(e) {
    e.preventDefault()
    const person = modal.person
    const name = form.full_name.trim().replace(/\s+/g, ' ')
    if (!name) return toast.error('Unesi ime i prezime.')

    setWorking(true)
    const payload = {
      full_name: name,
      phone: form.phone.trim() || null,
      pay_model: form.pay_model === 'plata' ? 'plata' : 'dnevnica',
      daily_wage: parseNumber(form.daily_wage),
      monthly_salary: parseNumber(form.monthly_salary),
      percent: parseNumber(form.percent),
    }
    // Adresa naloga se NE menja: Supabase prijava ostaje na staroj, a radnik
    // se prijavljuje novim imenom jer aplikacija mejl traži po imenu.
    if (person.id !== profile.id) payload.role = form.role

    const { error } = await supabase.from('profiles').update(payload).eq('id', person.id)
    setWorking(false)

    if (error) {
      toast.error(
        error.code === '23505'
          ? 'Radnik sa tim imenom već postoji.'
          : errorMessage(error),
      )
      return
    }

    if (name !== person.full_name) {
      toast.info('Ime je promenjeno — od sada se prijavljuje novim imenom.')
    } else {
      toast.success('Podaci su sačuvani.')
    }
    setModal(null)
    load()
  }

  async function setPassword() {
    const person = modal.person
    if (form.password.length < 6) return toast.error('Lozinka mora imati bar 6 karaktera.')

    setWorking(true)
    const { error } = await callFunction({
      action: 'password',
      id: person.id,
      password: form.password,
    })
    setWorking(false)

    if (error) return toast.error(error)
    setModal({ kind: 'password-done', person, password: form.password })
  }

  async function deleteWorker() {
    const person = modal.person
    setWorking(true)
    const { data, error } = await callFunction({ action: 'delete', id: person.id })
    setWorking(false)

    if (error) return toast.error(error)

    setModal(null)
    toast.success(
      data?.kept_history
        ? `${person.full_name} je obrisan. Izveštaji (${data.reports}) ostaju u istoriji.`
        : `${person.full_name} je obrisan.`,
    )
    load()
  }

  /** Nova (ili uklonjena) slika — odmah na spisku, u otvorenom prozoru i u zaglavlju. */
  function avatarChanged(person, path) {
    setPeople((prev) => prev.map((p) => (p.id === person.id ? { ...p, avatar_path: path } : p)))
    setModal((m) =>
      m?.person?.id === person.id ? { ...m, person: { ...m.person, avatar_path: path } } : m,
    )
    if (person.id === profile.id) refreshProfile()
  }

  async function toggleActive(person) {
    if (person.id === profile.id) return toast.error('Ne možeš da deaktiviraš svoj nalog.')

    const { error } = await supabase
      .from('profiles')
      .update({ is_active: !person.is_active })
      .eq('id', person.id)

    if (error) return toast.error(errorMessage(error))
    setPeople((prev) =>
      prev.map((p) => (p.id === person.id ? { ...p, is_active: !p.is_active } : p)),
    )
    setModal(null)
    toast.success(person.is_active ? 'Nalog je deaktiviran.' : 'Nalog je aktiviran.')
  }

  /**
   * Umanjena dnevnica za jedan dan — isto što i na samom izveštaju, samo se
   * odavde vidi ceo period odjednom. `override = null` vraća punu dnevnicu.
   */
  async function saveDayWage(reportId, override) {
    setWorking(true)
    const { error } = await supabase
      .from('shift_report_staff')
      .update({ wage_override: override })
      .eq('report_id', reportId)
      .eq('profile_id', modal.person.id)
    setWorking(false)

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setWageRow(null)
    toast.success(override === null ? 'Vraćena puna dnevnica.' : 'Dnevnica je umanjena.')
    // Prozor ostaje otvoren — obračun se preračuna ispod njega.
    await load()
  }

  async function savePayout(e) {
    e.preventDefault()
    const person = modal.person
    const isBonus = modal.entry === 'bonus'
    const amount = parseNumber(form.payout)
    if (amount <= 0) return toast.error(isBonus ? 'Unesi iznos bonusa.' : 'Unesi iznos isplate.')

    setWorking(true)
    const { error } = await supabase.from('payouts').insert({
      profile_id: person.id,
      kind: isBonus ? 'bonus' : 'isplata',
      amount,
      paid_on: form.paid_on || todayISO(),
      // Vezuje se za period koji je otvoren u obračunu, a ne za datum isplate —
      // isplata se i dešava posle perioda (16. odnosno 1.).
      period_key: period.key,
      note: (form.payout_note ?? '').trim(),
      created_by: profile.id,
    })
    setWorking(false)

    if (error) return toast.error(errorMessage(error))
    setModal(null)
    toast.success(
      isBonus
        ? `Bonus ${formatMoney(amount)} je dodat na platu.`
        : `Isplata ${formatMoney(amount)} je upisana.`,
    )
    load()
  }

  /**
   * Brisanje pogrešno upisane isplate ili bonusa.
   * Prozor ostaje otvoren, a obračun se odmah preračuna bez te stavke — da
   * se odmah vidi koliko radnik sada ima da primi.
   */
  async function deletePayout(payout) {
    setWorking(true)
    const { error } = await supabase.from('payouts').delete().eq('id', payout.id)
    setWorking(false)
    setPayoutToRemove(null)

    if (error) return toast.error(errorMessage(error))

    const old = modal?.calc
    if (old) {
      const payouts = old.payouts.filter((p) => p.id !== payout.id)
      const sumOf = (kind) =>
        payouts
          .filter((p) => (kind === 'bonus' ? p.kind === 'bonus' : p.kind !== 'bonus'))
          .reduce((sum, p) => sum + Number(p.amount ?? 0), 0)

      const bonus = sumOf('bonus')
      const paid = sumOf('isplata')
      const balance = old.earned + bonus - paid

      setModal((m) =>
        m?.calc
          ? {
              ...m,
              calc: {
                ...m.calc,
                payouts,
                bonus,
                paid,
                balance,
                bonuses: payouts.filter((p) => p.kind === 'bonus'),
                payments: payouts.filter((p) => p.kind !== 'bonus'),
              },
            }
          : m,
      )

      // Predlog iznosa za isplatu prati novo stanje duga.
      if (modal?.entry === 'isplata') {
        setForm((f) => ({ ...f, payout: balance > 0 ? String(balance) : '' }))
      }
    }

    toast.success(payout.kind === 'bonus' ? 'Bonus je obrisan.' : 'Isplata je obrisana.')
    load()
  }

  if (loading) return <FullPageLoader />

  /**
   * Jedan radnik na spisku — isti red i za aktivne i za neaktivne.
   * `index` dolazi iz `map` i služi strelicama za redosled (samo kod aktivnih).
   */
  const workerRow = ({ person, calc }, index = 0) => (
    <div
      key={person.id}
      className={cx('px-4 py-3 lg:py-2.5', !person.is_active && 'opacity-60')}
    >
      <div className="flex items-start gap-3">
        {/* Redosled zadaje admin — najvažniji radnici na vrh. */}
        {person.is_active && activeRows.length > 1 && (
          <div className="flex shrink-0 flex-col gap-0.5 pt-0.5">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => moveWorker(index, -1)}
              aria-label={`Pomeri ${person.full_name} gore`}
              className="rounded-md px-1.5 text-[11px] leading-5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ▲
            </button>
            <button
              type="button"
              disabled={index === activeRows.length - 1}
              onClick={() => moveWorker(index, 1)}
              aria-label={`Pomeri ${person.full_name} dole`}
              className="rounded-md px-1.5 text-[11px] leading-5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ▼
            </button>
          </div>
        )}

        <Avatar
          name={person.full_name}
          path={person.avatar_path}
          zoomable
          className={cx(
            'h-10 w-10 text-sm',
            person.role === 'admin' ? 'bg-ink text-white' : 'bg-stone-200 text-stone-700',
          )}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-stone-900">{person.full_name || '—'}</p>
            <Badge
              className={
                person.role === 'admin'
                  ? 'bg-brand-100 text-brand-800 ring-brand-600/20'
                  : 'bg-stone-100 text-stone-700 ring-stone-600/20'
              }
            >
              {person.role === 'admin' ? 'Admin' : 'Radnik'}
            </Badge>
            {!person.is_active && (
              <Badge className="bg-rose-100 text-rose-700 ring-rose-600/20">neaktivan</Badge>
            )}
            {person.id === profile.id && (
              <Badge className="bg-sky-100 text-sky-700 ring-sky-600/20">ti</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-stone-500">
            {calc.model === 'plata'
              ? `plata ${formatMoney(calc.salary)} mesečno`
              : `dnevnica ${formatMoney(calc.wage)}`}
            {calc.percent > 0 ? ` · ${formatQty(calc.percent)}% od pazara` : ''}
            {person.phone ? ` · ${person.phone}` : ''}
          </p>
        </div>
      </div>

      {/* Obračun i dugmad. Na telefonu jedno ispod drugog, a na širem ekranu
          u istom redu — tako spisak od 13 radnika stane bez skrolovanja. */}
      <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
      <div className="rounded-2xl border border-stone-200/70 bg-white px-3 py-2.5 lg:flex-1">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          {[
            // Dana, a ne smena — ko radi međusmenu ima dve smene, a jednu dnevnicu.
            [plural(calc.days, 'dan'), String(calc.days), ''],
            ['zarađeno', formatMoney(calc.earned, false), ''],
            calc.fromPercent > 0
              ? ['procenat', `+${formatMoney(calc.fromPercent, false)}`, '']
              : null,
            calc.bonus > 0
              ? ['bonus', `+${formatMoney(calc.bonus, false)}`, 'text-emerald-700']
              : null,
            ['isplaćeno', formatMoney(calc.paid, false), ''],
          ]
            .filter(Boolean)
            .map(([label, value, tone]) => (
              <span key={label} className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                  {label}
                </span>
                <b className={cx('block text-sm tabular-nums text-stone-900', tone)}>{value}</b>
              </span>
            ))}

          {/* Minus se ne piše — pretplata se kaže rečju, da se ne čita kao greška. */}
          <span
            className={cx(
              'ml-auto rounded-full px-3 py-1.5 text-sm font-bold tabular-nums',
              calc.balance > 0
                ? 'bg-brand-600 text-white'
                : calc.balance < 0
                  ? 'bg-rose-600 text-white'
                  : 'bg-stone-100 text-stone-500',
            )}
          >
            {formatMoney(Math.abs(calc.balance), false)}
            <span className="ml-1 text-[11px] font-semibold opacity-80">
              {calc.balance < 0 ? 'pretplaćeno' : 'za isplatu'}
            </span>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 lg:shrink-0">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setForm({
              payout: calc.balance > 0 ? String(calc.balance) : '',
              paid_on: todayISO(),
              payout_note: `Dnevnice ${periodLabel(period)}`,
            })
            setPayoutToRemove(null)
            setModal({ kind: 'payout', entry: 'isplata', person, calc })
          }}
        >
          Isplati
        </Button>
        {/* Dnevnice po danima — odatle se pojedinom danu umanjuje iznos. */}
        {calc.model === 'dnevnica' && calc.days > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setWageRow(null)
              setModal({ kind: 'dani', person, calc })
            }}
          >
            Dnevnice
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setForm({ payout: '', paid_on: todayISO(), payout_note: '' })
            setPayoutToRemove(null)
            setModal({ kind: 'payout', entry: 'bonus', person, calc })
          }}
        >
          Bonus
        </Button>
        <Button variant="ghost" size="sm" onClick={() => openEdit(person)}>
          Izmeni
        </Button>
        {/* Neaktivan radnik se briše direktno sa spiska, bez ulaska u Izmeni. */}
        {!person.is_active && person.id !== profile.id && (
          <Button
            variant="ghost"
            size="sm"
            className="text-rose-600"
            onClick={() => setModal({ kind: 'delete', person, calc })}
          >
            Obriši
          </Button>
        )}
      </div>
      </div>

      {calc.returned > 0 && (
        <p className="mt-1.5 text-xs text-amber-700">
          {calc.returned}{' '}
          {plural(calc.returned, ['smena je vraćena', 'smene su vraćene', 'smena je vraćeno'])} na
          ispravku i ne ulazi u obračun.
        </p>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      {/* ---------- Obračun za mesec ---------- */}
      <Card>
        <CardHeader
          title="Obračun dnevnica"
          action={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                Preuzmi
              </Button>
              <PeriodPicker period={period} onChange={setPeriod} />
            </div>
          }
          // Na uskom telefonu meni prelazi ispod naslova umesto da ga skrati.
          className="flex-wrap"
        />
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
          <Stat label="Dana" value={totals.days} />
          <Stat label="Zarađeno" value={formatMoney(totals.earned, false)} />
          <Stat label="Bonusi" value={formatMoney(totals.bonus, false)} />
          <Stat label="Isplaćeno" value={formatMoney(totals.paid, false)} />
          {/* Ako je isplaćeno više nego što je zarađeno, ne piše se minus nego
              „Pretplaćeno“ — minus ispod naslova „za isplatu“ se čita kao greška. */}
          <Stat
            label={totals.balance < 0 ? 'Pretplaćeno' : 'Za isplatu'}
            value={formatMoney(Math.abs(totals.balance), false)}
            tone={totals.balance < 0 ? 'expense' : 'total'}
          />
        </div>
      </Card>

      {/* ---------- Radnici ---------- */}
      <Card>
        <CardHeader
          title="Radnici"
          subtitle={`${countLabel(people.filter((p) => p.is_active).length, [
            'aktivan',
            'aktivna',
            'aktivnih',
          ])} od ${people.length}`}
          action={
            <Button size="sm" className="shrink-0" onClick={openNew}>
              + Novi nalog
            </Button>
          }
        />

        <div className="divide-y divide-stone-100">{activeRows.map(workerRow)}</div>

        {/* Neaktivni stoje sklonjeni na dno — otvaraju se klikom. */}
        {inactiveRows.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowInactive((v) => !v)}
              aria-expanded={showInactive}
              className="flex w-full items-center gap-2.5 border-t border-stone-200 px-4 py-3 text-left transition hover:bg-stone-50"
            >
              <svg
                className={cx(
                  'h-4 w-4 shrink-0 text-stone-400 transition-transform',
                  showInactive && 'rotate-90',
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
              <span className="text-sm font-semibold text-stone-700">Neaktivni</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-stone-500">
                {inactiveRows.length}
              </span>
              <span className="ml-auto text-xs text-stone-400">
                {showInactive ? 'sakrij' : 'prikaži'}
              </span>
            </button>

            {showInactive && (
              <div className="divide-y divide-stone-100 border-t border-stone-100 bg-stone-50/40">
                {inactiveRows.map(workerRow)}
              </div>
            )}
          </>
        )}
      </Card>

      {/* Šta ulazi u preuzet obračun */}
      <ReportPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={`Preuzmi obračun — ${periodLabel(period)}`}
        options={[
          { key: 'zbir', label: 'Zbirni pregled' },
          { key: 'radnici', label: 'Po radnicima' },
          { key: 'isplate', label: 'Isplate i bonusi' },
        ]}
        onConfirm={printSettlement}
      />

      {/* ---------- Pravila i obaveze — radnici ih čitaju na ekranu Profil ---------- */}
      <RuleDocs editable />

      {/* ================================================================ */}
      {/*  Modal: novi nalog                                               */}
      {/* ================================================================ */}
      <Modal
        open={modal?.kind === 'new'}
        onClose={() => !working && setModal(null)}
        title="Novi nalog za radnika"
      >
        {created ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-200">
              <p className="text-sm font-bold text-emerald-900">Nalog je otvoren ✅</p>
              <p className="mt-1 text-sm text-emerald-800">Pošalji radniku ove podatke:</p>
              <div className="mt-3 space-y-1 rounded-lg bg-white p-3 font-mono text-sm">
                <p>
                  <span className="text-stone-500">Korisničko ime:</span> {created.username}
                </p>
                <p>
                  <span className="text-stone-500">Lozinka:</span> {created.password}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(
                      `Prijava u aplikaciju\nKorisničko ime: ${created.username}\nLozinka: ${created.password}`,
                    )
                    .then(() => toast.success('Kopirano.'))
                    .catch(() => toast.error('Kopiranje nije uspelo.'))
                }
              >
                Kopiraj
              </Button>
              <Button className="flex-1" onClick={() => setModal(null)}>
                Gotovo
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={createWorker} className="space-y-4">
            <Field
              label="Ime i prezime"
              required
              hint="Ovo je ujedno i korisničko ime za prijavu."
            >
              <Input
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                placeholder="Marko Marković"
                autoFocus
                required
              />
            </Field>

            <Field label="Telefon">
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="064 123 4567"
              />
            </Field>

            <PayFields form={form} setForm={setForm} />

            <Field label="Lozinka" required hint="Zapiši je — radnik je dobija od tebe.">
              <div className="flex gap-2">
                <Input
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="font-mono"
                  required
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setForm((f) => ({ ...f, password: generatePassword() }))}
                >
                  ↻
                </Button>
              </div>
            </Field>

            <Field label="Uloga">
              <Select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="radnik">Radnik (konobar / šanker)</option>
                <option value="admin">Admin (pun pristup)</option>
              </Select>
            </Field>

            {fnHelp && <FunctionHelp />}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setModal(null)}
              >
                Otkaži
              </Button>
              <Button type="submit" className="flex-1" loading={working}>
                Otvori nalog
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ================================================================ */}
      {/*  Modal: izmena radnika                                           */}
      {/* ================================================================ */}
      <Modal
        open={modal?.kind === 'edit'}
        onClose={() => !working && setModal(null)}
        title={modal?.person?.full_name || 'Izmeni radnika'}
      >
        {modal?.kind === 'edit' && (
          <div className="space-y-5">
            {/* Slika profila — čuva se odmah, nezavisno od „Sačuvaj izmene“. */}
            <AvatarEditor
              person={modal.person}
              className={cx(
                'h-[60px] w-[60px] text-lg',
                modal.person.role === 'admin' ? 'bg-ink text-white' : 'bg-stone-200 text-stone-700',
              )}
              onChange={(path) => avatarChanged(modal.person, path)}
            >
              <p className="text-sm font-bold text-stone-900">Slika profila</p>
              <p className="text-xs text-stone-500">Vidi se u smeni i na spisku radnika.</p>
            </AvatarEditor>

            <form onSubmit={saveEdit} className="space-y-4">
              <Field label="Ime i prezime" required hint="Ujedno i korisničko ime za prijavu.">
                <Input
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                  required
                />
              </Field>

              <Field label="Telefon">
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </Field>

              <PayFields form={form} setForm={setForm} />

              <Field label="Uloga">
                <Select
                  value={form.role}
                  disabled={modal.person.id === profile.id}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                >
                  <option value="radnik">Radnik</option>
                  <option value="admin">Admin</option>
                </Select>
              </Field>

              <Button type="submit" className="w-full" loading={working}>
                Sačuvaj izmene
              </Button>
            </form>

            {/* Lozinka */}
            <div className="rounded-xl border border-stone-200 p-3.5">
              <p className="text-sm font-bold text-stone-900">Nova lozinka</p>
              <p className="mt-0.5 text-xs text-stone-500">
                Radnik ne može sam da je promeni — ti mu zadaješ novu.
              </p>
              <div className="mt-2.5 flex gap-2">
                <Input
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="nova lozinka"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setForm((f) => ({ ...f, password: generatePassword() }))}
                >
                  ↻
                </Button>
                <Button type="button" onClick={setPassword} loading={working}>
                  Postavi
                </Button>
              </div>
            </div>

            {/* Opasna zona */}
            {modal.person.id !== profile.id && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5">
                <p className="text-sm font-bold text-rose-900">Opasna zona</p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => toggleActive(modal.person)}>
                    {modal.person.is_active ? 'Deaktiviraj nalog' : 'Aktiviraj nalog'}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setModal({ kind: 'delete', person: modal.person })}
                  >
                    Obriši radnika
                  </Button>
                </div>
                <p className="mt-2 text-xs text-rose-800">
                  Deaktivacija samo isključuje prijavu. Brisanje uklanja nalog trajno.
                </p>
              </div>
            )}

            {fnHelp && <FunctionHelp />}
          </div>
        )}
      </Modal>

      {/* ================================================================ */}
      {/*  Modal: nova lozinka postavljena                                 */}
      {/* ================================================================ */}
      <Modal
        open={modal?.kind === 'password-done'}
        onClose={() => setModal(null)}
        title="Lozinka je promenjena"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-stone-600">Pošalji radniku nove podatke za prijavu:</p>
          <div className="space-y-1 rounded-lg bg-stone-50 p-3 font-mono text-sm">
            <p>
              <span className="text-stone-500">Korisničko ime:</span> {modal?.person?.full_name}
            </p>
            <p>
              <span className="text-stone-500">Lozinka:</span> {modal?.password}
            </p>
          </div>
          <Button className="w-full" onClick={() => setModal(null)}>
            Gotovo
          </Button>
        </div>
      </Modal>

      {/* ================================================================ */}
      {/*  Modal: brisanje                                                 */}
      {/* ================================================================ */}
      <Modal
        open={modal?.kind === 'delete'}
        onClose={() => !working && setModal(null)}
        title="Obriši radnika"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={working}
              onClick={() =>
                // Otvoren sa spiska → samo zatvori; otvoren iz „Izmeni“ → vrati se tamo.
                setModal(modal?.calc ? null : { kind: 'edit', person: modal.person })
              }
            >
              Otkaži
            </Button>
            <Button variant="danger" className="flex-1" loading={working} onClick={deleteWorker}>
              Obriši trajno
            </Button>
          </div>
        }
      >
        <p className="text-sm text-stone-600">
          <strong>{modal?.person?.full_name}</strong> se briše i više neće moći da se prijavi.
        </p>
        {modal?.kind === 'delete' && owedOf(modal.person) > 0 && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
            <strong>Pažnja — još ima da primi {formatMoney(owedOf(modal.person))}.</strong> Posle
            brisanja isplata ne može da se upiše. Isplati ga pre brisanja.
          </p>
        )}
        <p className="mt-2 text-sm text-stone-600">
          Ako iza njega postoje popisi, oni <strong>ostaju u istoriji</strong> sa njegovim imenom —
          samo nestaje sa spiska radnika. Ova radnja se ne može poništiti.
        </p>
      </Modal>

      {/* ================================================================ */}
      {/*  Modal: dnevnice po danima — umanjenje za pojedini dan           */}
      {/* ================================================================ */}
      <Modal
        open={modal?.kind === 'dani'}
        onClose={() => {
          if (working) return
          setWageRow(null)
          setModal(null)
        }}
        title={`Dnevnice — ${modal?.person?.full_name ?? ''}`}
      >
        {modal?.kind === 'dani' && (() => {
          /* Posle upisa se obračun ponovo učita, pa se uzima svež red —
             `modal.calc` bi ostao onakav kakav je bio pri otvaranju. */
          const fresh = rows.find((r) => r.person.id === modal.person.id)?.calc ?? modal.calc
          const byDay = new Map()
          for (const s of fresh.shiftList) {
            if (!byDay.has(s.report_date)) byDay.set(s.report_date, [])
            byDay.get(s.report_date).push(s)
          }
          const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))

          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-stone-100 px-4 py-2.5">
                <p className="eyebrow">Redovna dnevnica</p>
                <p className="text-sm font-bold tabular-nums text-stone-900">
                  {formatMoney(fresh.wage, false)}
                </p>
              </div>

              <ul className="divide-y divide-stone-100">
                {days.map(([date, list]) => {
                  const sorted = [...list].sort((a, b) => shiftRank(a.shift) - shiftRank(b.shift))
                  /* Dan nosi jednu dnevnicu — ako je na nekoj smeni upisan
                     manji iznos, važi najmanji. */
                  const overrides = sorted
                    .map((s) => s.wage_override)
                    .filter((v) => v !== null && v !== undefined)
                    .map(Number)
                  const amount = overrides.length > 0 ? Math.min(...overrides) : fresh.wage
                  const cut = overrides.length > 0
                  // Iznos se upisuje na prvu smenu tog dana.
                  const target = sorted[0]
                  const editing = wageRow?.reportId === target.id

                  return (
                    <li key={date} className="py-2">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-stone-900">
                            {formatDate(date)}
                          </span>
                          <span className="block text-[11px] text-stone-400">
                            {sorted.map((s) => SHIFT_SHORT[s.shift] ?? s.shift).join(' · ')}
                          </span>
                        </span>

                        {!editing && (
                          <>
                            <span className="shrink-0 text-[13px] tabular-nums">
                              {cut ? (
                                <b className="text-rose-600">{formatMoney(amount, false)}</b>
                              ) : (
                                <span className="text-stone-500">
                                  {formatMoney(amount, false)}
                                </span>
                              )}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0"
                              onClick={() =>
                                setWageRow({
                                  reportId: target.id,
                                  value: cut ? String(amount) : '',
                                })
                              }
                            >
                              {cut ? 'Izmeni' : 'Umanji'}
                            </Button>
                          </>
                        )}
                      </div>

                      {editing && (
                        <div className="mt-2 space-y-2">
                          <MoneyInput
                            value={wageRow.value}
                            onChange={(v) => setWageRow((w) => ({ ...w, value: v }))}
                          />
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              className="flex-1"
                              disabled={working}
                              onClick={() => setWageRow(null)}
                            >
                              Otkaži
                            </Button>
                            {cut && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="flex-1"
                                disabled={working}
                                onClick={() => saveDayWage(target.id, null)}
                              >
                                Puna
                              </Button>
                            )}
                            <Button
                              size="sm"
                              className="flex-1"
                              loading={working}
                              disabled={wageRow.value === ''}
                              onClick={() => saveDayWage(target.id, parseNumber(wageRow.value))}
                            >
                              Sačuvaj
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>

              <div className="flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-white">
                <p className="eyebrow text-stone-400">Ukupno dnevnice</p>
                <p className="text-lg font-extrabold tabular-nums">
                  {formatMoney(fresh.base, false)}
                </p>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ================================================================ */}
      {/*  Modal: isplata                                                  */}
      {/* ================================================================ */}
      <Modal
        open={modal?.kind === 'payout'}
        onClose={() => {
          if (working) return
          setPayoutToRemove(null)
          setModal(null)
        }}
        title={`${modal?.entry === 'bonus' ? 'Bonus' : 'Isplata'} — ${modal?.person?.full_name ?? ''}`}
      >
        {modal?.kind === 'payout' && (
          <form onSubmit={savePayout} className="space-y-4">
            <div className="rounded-xl bg-stone-50 px-4 py-3 text-sm">
              <div className="flex justify-between py-0.5">
                <span className="text-stone-600">
                  {modal.calc.model === 'plata'
                    ? `plata ${formatMoney(modal.calc.salary, false)} ÷ 2`
                    : modal.calc.reduced > 0
                      ? `${countLabel(modal.calc.days, 'dan')} · ${modal.calc.reduced} umanjeno`
                      : `${countLabel(modal.calc.days, 'dan')} × ${formatMoney(modal.calc.wage, false)}`}
                </span>
                <span className="font-bold tabular-nums">{formatMoney(modal.calc.base)}</span>
              </div>
              {modal.calc.fromPercent > 0 && (
                <div className="flex justify-between py-0.5">
                  <span className="text-stone-600">
                    {formatQty(modal.calc.percent)}% od {formatMoney(modal.calc.pazar, false)}
                  </span>
                  <span className="font-bold tabular-nums">+{formatMoney(modal.calc.fromPercent)}</span>
                </div>
              )}
              {modal.calc.bonus > 0 && (
                <div className="flex justify-between py-0.5">
                  <span className="text-stone-600">bonusi</span>
                  <span className="font-bold tabular-nums text-emerald-700">
                    +{formatMoney(modal.calc.bonus)}
                  </span>
                </div>
              )}
              <div className="flex justify-between py-0.5">
                <span className="text-stone-600">već isplaćeno</span>
                <span className="font-bold tabular-nums text-stone-500">
                  −{formatMoney(modal.calc.paid)}
                </span>
              </div>
              <div className="mt-1 flex justify-between border-t border-stone-200 pt-1.5">
                <span className="font-semibold text-stone-700">
                  {modal.calc.balance < 0 ? 'Pretplaćeno' : 'Za isplatu'}
                </span>
                <span
                  className={cx(
                    'font-extrabold tabular-nums',
                    modal.calc.balance < 0 ? 'text-rose-600' : 'text-brand-700',
                  )}
                >
                  {formatMoney(Math.abs(modal.calc.balance), false)}
                </span>
              </div>
            </div>

            {modal.entry === 'bonus' && (
              <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900 ring-1 ring-inset ring-emerald-200">
                Bonus se <strong>dodaje na platu</strong> — uvećava iznos koji radnik ima da
                primi. Radnik ga vidi na svom ekranu Profil.
              </p>
            )}

            <Field label={modal.entry === 'bonus' ? 'Iznos bonusa' : 'Iznos isplate'} required>
              <MoneyInput
                value={form.payout ?? ''}
                onChange={(v) => setForm((f) => ({ ...f, payout: v }))}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Datum">
                <Input
                  type="date"
                  value={form.paid_on ?? todayISO()}
                  max={todayISO()}
                  onChange={(e) => setForm((f) => ({ ...f, paid_on: e.target.value }))}
                />
              </Field>
              <Field label="Napomena">
                <Input
                  value={form.payout_note ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, payout_note: e.target.value }))}
                  placeholder={modal.entry === 'bonus' ? 'npr. za doček Nove godine' : 'npr. akontacija'}
                />
              </Field>
            </div>

            {modal.calc.payouts.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="eyebrow">
                    Stavke za {periodLabel(period)}
                  </p>
                  <p className="text-[11px] text-stone-400">× briše pogrešan unos</p>
                </div>
                <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200">
                  {modal.calc.payouts.map((p) => (
                    <li key={p.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 text-xs text-stone-600">
                          {p.kind === 'bonus' ? '🎁 ' : '💵 '}
                          {formatDate(p.paid_on)}
                          {p.note ? ` · ${p.note}` : ''}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span
                            className={cx(
                              'text-sm font-bold tabular-nums',
                              p.kind === 'bonus' ? 'text-emerald-700' : 'text-stone-900',
                            )}
                          >
                            {p.kind === 'bonus' ? '+' : '−'}
                            {formatMoney(p.amount, false)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setPayoutToRemove((id) => (id === p.id ? null : p.id))
                            }
                            aria-label={p.kind === 'bonus' ? 'Obriši bonus' : 'Obriši isplatu'}
                            className="rounded-md px-1.5 text-base leading-none text-stone-400 transition hover:bg-rose-50 hover:text-rose-600"
                          >
                            ×
                          </button>
                        </span>
                      </div>

                      {/* Potvrda stoji u samom redu — bez još jednog prozora preko ovog. */}
                      {payoutToRemove === p.id && (
                        <div className="mt-2 rounded-lg bg-rose-50 p-2.5 ring-1 ring-inset ring-rose-200">
                          <p className="text-xs font-bold text-rose-900">Da li si siguran?</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-rose-800">
                            Brišeš {p.kind === 'bonus' ? 'bonus' : 'isplatu'} od{' '}
                            <strong>{formatMoney(p.amount)}</strong> od {formatDate(p.paid_on)}.
                            Obračun se odmah preračunava, a ovo ne može da se poništi.
                          </p>
                          <div className="mt-2 flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setPayoutToRemove(null)}
                            >
                              Ne, vrati me
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              loading={working}
                              onClick={() => deletePayout(p)}
                            >
                              Da, obriši
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setModal(null)}
              >
                Otkaži
              </Button>
              <Button type="submit" variant="success" className="flex-1" loading={working}>
                {modal.entry === 'bonus' ? 'Dodaj bonus' : 'Upiši isplatu'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Pomoć kad Edge Function nije objavljena                            */
/* ------------------------------------------------------------------ */
function FunctionHelp() {
  return (
    <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
      <p className="font-bold">Edge Function nije objavljena</p>
      <p className="mt-1">
        Otvaranje naloga, promena lozinke i brisanje rade preko funkcije na serveru. Objavi je sa:
      </p>
      <code className="mt-1.5 block rounded bg-amber-100 px-2 py-1">
        supabase functions deploy manage-worker
      </code>
      <p className="mt-1.5">
        Dok to ne uradiš, naloge otvaraš ručno: Supabase → Authentication → Users → „Add user“, uz
        ✅ Auto Confirm User.
      </p>
    </div>
  )
}
