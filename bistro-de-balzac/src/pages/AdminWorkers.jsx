import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { EMPTY_STATS, loadWorkStats, settle } from '../lib/earnings'
import { currentPeriod, periodLabel } from '../lib/payperiod'
import Avatar, { AvatarEditor } from '../components/Avatar'
import PeriodPicker from '../components/PeriodPicker'
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
  countLabel,
  cx,
  errorMessage,
  formatDate,
  formatMoney,
  loginEmail,
  parseNumber,
  plural,
  todayISO,
} from '../lib/utils'

const emptyNew = { full_name: '', phone: '', password: '', role: 'radnik', daily_wage: '' }

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

  const range = useMemo(
    () => ({ from: period.from, to: period.to, periodKey: period.key }),
    [period],
  )

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_deleted', false)
      .order('role')
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

  /** Koliko radnik još ima da primi u izabranom periodu. */
  function owedOf(person) {
    return settle(person, stats.get(person.id) ?? EMPTY_STATS).balance
  }

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          shifts: acc.shifts + r.calc.shifts,
          earned: acc.earned + r.calc.earned,
          bonus: acc.bonus + r.calc.bonus,
          paid: acc.paid + r.calc.paid,
          balance: acc.balance + r.calc.balance,
        }),
        { shifts: 0, earned: 0, bonus: 0, paid: 0, balance: 0 },
      ),
    [rows],
  )

  /* ---------------------------------------------------------------- */
  /*  Edge Function                                                    */
  /* ---------------------------------------------------------------- */
  async function callFunction(body) {
    const { data, error } = await supabase.functions.invoke('manage-worker', { body })
    if (data?.error) return { error: data.error }
    if (error) {
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
      daily_wage: String(person.daily_wage ?? ''),
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
      daily_wage: parseNumber(form.daily_wage),
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
      daily_wage: parseNumber(form.daily_wage),
    }
    // Ime je korisničko ime — ako se menja, menja se i adresa za prijavu.
    if (name !== person.full_name) payload.email = loginEmail(name)
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

  if (loading) return <FullPageLoader />

  return (
    <div className="space-y-4">
      {/* ---------- Obračun za mesec ---------- */}
      <Card>
        <CardHeader
          title="Obračun dnevnica"
          subtitle="Plate se isplaćuju 1. i 16. u mesecu"
          action={<PeriodPicker period={period} onChange={setPeriod} />}
          // Na uskom telefonu meni prelazi ispod naslova umesto da ga skrati.
          className="flex-wrap"
        />
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
          <Stat label="Odrađeno smena" value={totals.shifts} sub="ukupno" />
          <Stat label="Zarađeno" value={formatMoney(totals.earned, false)} sub="RSD" />
          <Stat label="Bonusi" value={formatMoney(totals.bonus, false)} sub="RSD" tone="cash" />
          <Stat label="Isplaćeno" value={formatMoney(totals.paid, false)} sub="RSD" />
          <Stat label="Za isplatu" value={formatMoney(totals.balance, false)} sub="RSD" tone="total" />
        </div>
        <p className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
          Smena odrađena <strong>na dan isplate</strong> ulazi u sledeću platu — zato period
          1.–15. počinje baš 1., a period 16.–kraj baš 16.
        </p>
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

        <div className="divide-y divide-slate-100">
          {rows.map(({ person, calc }) => (
            <div key={person.id} className={cx('p-4', !person.is_active && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <Avatar
                  name={person.full_name}
                  path={person.avatar_path}
                  zoomable
                  className={cx(
                    'h-11 w-11 text-sm',
                    person.role === 'admin' ? 'bg-ink text-white' : 'bg-slate-200 text-slate-700',
                  )}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-slate-900">{person.full_name || '—'}</p>
                    <Badge
                      className={
                        person.role === 'admin'
                          ? 'bg-brand-100 text-brand-800 ring-brand-600/20'
                          : 'bg-slate-100 text-slate-700 ring-slate-600/20'
                      }
                    >
                      {person.role === 'admin' ? 'Vlasnik' : 'Radnik'}
                    </Badge>
                    {!person.is_active && (
                      <Badge className="bg-rose-100 text-rose-700 ring-rose-600/20">
                        neaktivan
                      </Badge>
                    )}
                    {person.id === profile.id && (
                      <Badge className="bg-sky-100 text-sky-700 ring-sky-600/20">ti</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    dnevnica {formatMoney(calc.wage)}
                    {person.phone ? ` · ${person.phone}` : ''}
                  </p>
                </div>
              </div>

              {/* Obračun */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs">
                <span className="text-slate-600">
                  <b className="text-sm text-slate-900">{calc.shifts}</b>{' '}
                  {plural(calc.shifts, 'smena')}
                </span>
                <span className="text-slate-600">
                  zarađeno <b className="tabular-nums text-slate-900">{formatMoney(calc.earned, false)}</b>
                </span>
                {calc.bonus > 0 && (
                  <span className="text-slate-600">
                    bonus <b className="tabular-nums text-emerald-700">+{formatMoney(calc.bonus, false)}</b>
                  </span>
                )}
                <span className="text-slate-600">
                  isplaćeno <b className="tabular-nums text-slate-900">{formatMoney(calc.paid, false)}</b>
                </span>
                <span
                  className={cx(
                    'ml-auto rounded-lg px-2.5 py-1 font-bold tabular-nums',
                    calc.balance > 0
                      ? 'bg-brand-600 text-white'
                      : calc.balance < 0
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-200 text-slate-600',
                  )}
                >
                  za isplatu {formatMoney(calc.balance, false)}
                </span>
              </div>

              {calc.returned > 0 && (
                <p className="mt-1.5 text-xs text-amber-700">
                  {calc.returned}{' '}
                  {plural(calc.returned, [
                    'smena je vraćena',
                    'smene su vraćene',
                    'smena je vraćeno',
                  ])}{' '}
                  na ispravku i ne ulazi u obračun.
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setForm({
                      payout: calc.balance > 0 ? String(calc.balance) : '',
                      paid_on: todayISO(),
                      payout_note: `Dnevnice ${periodLabel(period)}`,
                    })
                    setModal({ kind: 'payout', entry: 'isplata', person, calc })
                  }}
                >
                  Isplati
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setForm({ payout: '', paid_on: todayISO(), payout_note: '' })
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
          ))}
        </div>
      </Card>

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
                  <span className="text-slate-500">Korisničko ime:</span> {created.username}
                </p>
                <p>
                  <span className="text-slate-500">Lozinka:</span> {created.password}
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

            <Field label="Dnevnica" hint="Koliko dobija po odrađenoj smeni.">
              <MoneyInput
                value={form.daily_wage}
                onChange={(v) => setForm((f) => ({ ...f, daily_wage: v }))}
              />
            </Field>

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
                <option value="admin">Vlasnik (pun pristup)</option>
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
                modal.person.role === 'admin' ? 'bg-ink text-white' : 'bg-slate-200 text-slate-700',
              )}
              onChange={(path) => avatarChanged(modal.person, path)}
            >
              <p className="text-sm font-bold text-slate-900">Slika profila</p>
              <p className="text-xs text-slate-500">Vidi se u smeni i na spisku radnika.</p>
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

              <Field label="Dnevnica">
                <MoneyInput
                  value={form.daily_wage}
                  onChange={(v) => setForm((f) => ({ ...f, daily_wage: v }))}
                />
              </Field>

              <Field label="Uloga">
                <Select
                  value={form.role}
                  disabled={modal.person.id === profile.id}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                >
                  <option value="radnik">Radnik</option>
                  <option value="admin">Vlasnik</option>
                </Select>
              </Field>

              <Button type="submit" className="w-full" loading={working}>
                Sačuvaj izmene
              </Button>
            </form>

            {/* Lozinka */}
            <div className="rounded-xl border border-slate-200 p-3.5">
              <p className="text-sm font-bold text-slate-900">Nova lozinka</p>
              <p className="mt-0.5 text-xs text-slate-500">
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
          <p className="text-sm text-slate-600">Pošalji radniku nove podatke za prijavu:</p>
          <div className="space-y-1 rounded-lg bg-slate-50 p-3 font-mono text-sm">
            <p>
              <span className="text-slate-500">Korisničko ime:</span> {modal?.person?.full_name}
            </p>
            <p>
              <span className="text-slate-500">Lozinka:</span> {modal?.password}
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
        <p className="text-sm text-slate-600">
          <strong>{modal?.person?.full_name}</strong> se briše i više neće moći da se prijavi.
        </p>
        {modal?.kind === 'delete' && owedOf(modal.person) > 0 && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
            <strong>Pažnja — još ima da primi {formatMoney(owedOf(modal.person))}.</strong> Posle
            brisanja isplata ne može da se upiše. Isplati ga pre brisanja.
          </p>
        )}
        <p className="mt-2 text-sm text-slate-600">
          Ako iza njega postoje popisi, oni <strong>ostaju u istoriji</strong> sa njegovim imenom —
          samo nestaje sa spiska radnika. Ova radnja se ne može poništiti.
        </p>
      </Modal>

      {/* ================================================================ */}
      {/*  Modal: isplata                                                  */}
      {/* ================================================================ */}
      <Modal
        open={modal?.kind === 'payout'}
        onClose={() => !working && setModal(null)}
        title={`${modal?.entry === 'bonus' ? 'Bonus' : 'Isplata'} — ${modal?.person?.full_name ?? ''}`}
      >
        {modal?.kind === 'payout' && (
          <form onSubmit={savePayout} className="space-y-4">
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between py-0.5">
                <span className="text-slate-600">
                  {countLabel(modal.calc.shifts, 'smena')} × {formatMoney(modal.calc.wage, false)}
                </span>
                <span className="font-bold tabular-nums">{formatMoney(modal.calc.earned)}</span>
              </div>
              {modal.calc.bonus > 0 && (
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-600">bonusi</span>
                  <span className="font-bold tabular-nums text-emerald-700">
                    +{formatMoney(modal.calc.bonus)}
                  </span>
                </div>
              )}
              <div className="flex justify-between py-0.5">
                <span className="text-slate-600">već isplaćeno</span>
                <span className="font-bold tabular-nums text-slate-500">
                  −{formatMoney(modal.calc.paid)}
                </span>
              </div>
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1.5">
                <span className="font-semibold text-slate-700">Za isplatu</span>
                <span className="font-extrabold tabular-nums text-brand-700">
                  {formatMoney(modal.calc.balance)}
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
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Stavke za {periodLabel(period)}
                </p>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {modal.calc.payouts.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 text-xs text-slate-600">
                        {p.kind === 'bonus' ? '🎁 ' : '💵 '}
                        {formatDate(p.paid_on)}
                        {p.note ? ` · ${p.note}` : ''}
                      </span>
                      <span
                        className={cx(
                          'shrink-0 text-sm font-bold tabular-nums',
                          p.kind === 'bonus' ? 'text-emerald-700' : 'text-slate-900',
                        )}
                      >
                        {p.kind === 'bonus' ? '+' : '−'}
                        {formatMoney(p.amount, false)}
                      </span>
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
