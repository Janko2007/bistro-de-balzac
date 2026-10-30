import { useCallback, useEffect, useMemo, useState } from 'react'

import { usePersistentState } from '../lib/persist'
import { useToast } from '../context/ToastContext'
import {
  DAY_NAMES,
  LAYOUTS,
  SHIFT_INFO,
  SLOT_LABELS,
  addDays,
  createWeek,
  deadlineLabel,
  deleteWeek,
  hasMid,
  fromLocalInput,
  loadPeople,
  loadSignups,
  loadSlots,
  loadWeek,
  mondayOf,
  setSlot,
  shiftsOf,
  shortDate,
  signupsOpen,
  slotsOf,
  toLocalInput,
  updateWeek,
  weekDays,
} from '../lib/schedule'
import { parsePositions } from '../lib/positions'
import { cx, errorMessage, formatMoney, plural, todayISO } from '../lib/utils'
import { Button, Card, CardHeader, Input, Select } from './ui'
import ScheduleImage from './ScheduleImage'
import { downloadScheduleImage } from '../lib/scheduleImage'

/** Podrazumevani rok: četvrtak pre nedelje u 20:00. */
const defaultDeadline = (weekStart) => `${addDays(weekStart, -4)}T20:00`

/** Da li radno mesto odgovara polju (šanker / konobar). */
function fitsSlot(person, slot) {
  const list = parsePositions(person.position).join(' ').toLowerCase()
  if (slot === 'sanker') return list.includes('šanker') || list.includes('sanker')
  if (slot === 'konobar') return list.includes('konobar')
  return false
}

/** Kartica koja se otvara i zatvara: naslov, podnaslov i desno kratak podatak. */
function Fold({ title, subtitle, right, open, onToggle, children }) {
  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
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
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-tight text-stone-900">{title}</span>
          {subtitle && <span className="mt-0.5 block text-[13px] text-stone-500">{subtitle}</span>}
        </span>
        {right && <span className="shrink-0 text-[15px] font-extrabold tabular-nums text-stone-900">{right}</span>}
      </button>
      {open && <div className="border-t border-stone-100">{children}</div>}
    </Card>
  )
}
/**
 * Raspored — admin: otvara nedelju, postavlja rok za prijavu, vidi ko se
 * prijavio (sa napomenama), slaže raspored i objavljuje ga.
 */
export default function ScheduleAdmin({ weekStart }) {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [week, setWeek] = useState(null)
  const [signups, setSignups] = useState([])
  const [slots, setSlots] = useState([])
  const [people, setPeople] = useState([])
  const [working, setWorking] = useState(false)

  // Otvaranje nove nedelje
  const [newLayout, setNewLayout] = useState('jedan')
  const [newMid, setNewMid] = useState(true)
  const [newDeadline, setNewDeadline] = useState(() => defaultDeadline(weekStart))
  // Rok postojeće nedelje
  const [deadlineInput, setDeadlineInput] = useState('')

  const [cyr, setCyr] = usePersistentState('schedule.cyr', false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Raspored i svaki dan posebno se otvaraju i zatvaraju. null = po podrazumevanom (objavljen → zatvoren).
  const [builderOpen, setBuilderOpen] = usePersistentState('schedule.builderOpen', null)
  const [openDays, setOpenDays] = usePersistentState('schedule.openDays', () => new Set())
  const [imageBusy, setImageBusy] = useState(false)
  const [signupsOpenList, setSignupsOpenList] = usePersistentState('schedule.signupsOpen', false)
  const [loadOpen, setLoadOpen] = usePersistentState('schedule.loadOpen', false)
  const [budgetOpen, setBudgetOpen] = usePersistentState('schedule.budgetOpen', false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [w, ppl] = await Promise.all([loadWeek(weekStart), loadPeople()])
      setPeople(ppl)
      setWeek(w)
      if (w) {
        const [su, sl] = await Promise.all([loadSignups(w.id), loadSlots(w.id)])
        setSignups(su)
        setSlots(sl)
        setDeadlineInput(toLocalInput(w.signup_deadline))
      } else {
        setSignups([])
        setSlots([])
        setNewDeadline(defaultDeadline(weekStart))
      }
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Ne mogu da učitam raspored. Da li je puštena skripta -25?'))
      setWeek(null)
    }
    setLoading(false)
  }, [weekStart, toast])

  useEffect(() => {
    load()
  }, [load])

  const names = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people])
  const days = useMemo(() => weekDays(weekStart), [weekStart])

  async function open() {
    setWorking(true)
    try {
      const w = await createWeek({
        weekStart,
        layout: newLayout,
        withMid: newMid,
        deadline: fromLocalInput(newDeadline),
      })
      setWeek(w)
      setDeadlineInput(toLocalInput(w.signup_deadline))
      toast.success('Nedelja je otvorena — radnici se mogu prijaviti.')
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Nedelja nije otvorena. Da li je puštena skripta -25?'))
    }
    setWorking(false)
  }

  async function patchWeek(patch, okMessage) {
    setWorking(true)
    try {
      await updateWeek(week.id, patch)
      setWeek((w) => ({ ...w, ...patch }))
      if (okMessage) toast.success(okMessage)
    } catch (err) {
      toast.error(errorMessage(err))
    }
    setWorking(false)
  }

  async function removeWeek() {
    setWorking(true)
    try {
      await deleteWeek(week.id)
      setConfirmDelete(false)
      toast.success('Nedelja je obrisana.')
      await load()
    } catch (err) {
      toast.error(errorMessage(err))
    }
    setWorking(false)
  }

  async function saveImage(blank) {
    setImageBusy(true)
    try {
      await downloadScheduleImage({ week, slots, names, cyr, blank })
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Slika nije napravljena.'))
    }
    setImageBusy(false)
  }

  async function place(day, shift, slot, profileId) {
    const before = slots
    setSlots((prev) => {
      const rest = prev.filter((s) => !(s.day === day && s.shift === shift && s.slot === slot))
      return profileId ? [...rest, { id: `tmp-${day}-${shift}-${slot}`, day, shift, slot, profile_id: profileId }] : rest
    })
    try {
      await setSlot({ weekId: week.id, day, shift, slot, profileId: profileId || null })
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Nije sačuvano.'))
      setSlots(before)
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-stone-400">Učitavam…</p>

  /* ---------------- Nedelja još nije otvorena ---------------- */
  if (!week) {
    return (
      <Card>
        <CardHeader title="Otvori prijave za ovu nedelju" subtitle="Radnici se prijavljuju do roka koji postaviš" />
        <div className="space-y-4 p-4">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {Object.entries(LAYOUTS).map(([key, l]) => (
              <button
                key={key}
                type="button"
                onClick={() => setNewLayout(key)}
                aria-pressed={newLayout === key}
                className={cx(
                  'rounded-2xl px-3.5 py-3 text-left transition',
                  newLayout === key ? 'bg-ink text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200/70',
                )}
              >
                <span className="block text-sm font-bold">{l.label}</span>
                <span className={cx('block text-[11px]', newLayout === key ? 'text-stone-300' : 'text-stone-500')}>
                  {l.hint}
                </span>
              </button>
            ))}
          </div>

          {/* Međusmena je poseban izbor: uvek jedna osoba, uz bilo koji izgled. */}
          <button
            type="button"
            onClick={() => setNewMid((v) => !v)}
            aria-pressed={newMid}
            className="flex w-full items-center gap-3 rounded-2xl bg-stone-100 px-3.5 py-3 text-left"
          >
            <span
              className={cx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                newMid ? 'bg-brand-600 text-white' : 'bg-white text-transparent ring-1 ring-inset ring-stone-300',
              )}
              aria-hidden="true"
            >
              ✓
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-stone-800">Međusmena</span>
              <span className="block text-[11px] text-stone-500">Jedna osoba, radnim danom 9–17, vikendom 12–20.</span>
            </span>
          </button>

          <label className="block text-[12px] font-semibold text-stone-500">
            Rok za prijavu
            <Input
              type="datetime-local"
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
              className="mt-1"
            />
          </label>

          <Button className="w-full" loading={working} onClick={open}>
            Otvori prijave
          </Button>
        </div>
      </Card>
    )
  }

  /* ---------------- Nedelja je otvorena ---------------- */
  const shifts = shiftsOf(week)
  const midOn = hasMid(week)
  const isBuilderOpen = builderOpen ?? !week.published
  const midPlaced = slots.some((s) => s.shift === 'medjusmena')
  const isOpen = signupsOpen(week)
  const signedPeople = new Set(signups.map((s) => s.profile_id))

  const signupsAt = (day, shift) => signups.filter((s) => s.day === day && s.shift === shift)
  const slotAt = (day, shift, slot) => slots.find((s) => s.day === day && s.shift === shift && s.slot === slot)
  const dayCount = (day, profileId) => slots.filter((s) => s.day === day && s.profile_id === profileId).length

  const load_ = people
    .map((p) => ({ p, n: slots.filter((s) => s.profile_id === p.id).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)

  // Budžet nedelje: dnevnica po radniku za svaki dan u kome je u rasporedu
  // (više smena istog dana je jedna dnevnica). Radnici na plati ne ulaze u zbir.
  const budget = people
    .map((p) => {
      const worked = new Set(slots.filter((s) => s.profile_id === p.id).map((s) => s.day)).size
      const salaried = p.pay_model === 'plata'
      const wage = Number(p.daily_wage ?? 0)
      return { p, days: worked, wage, salaried, cost: salaried ? 0 : worked * wage }
    })
    .filter((x) => x.days > 0)
    .sort((a, b) => b.cost - a.cost || a.p.full_name.localeCompare(b.p.full_name, 'sr'))
  const budgetTotal = budget.reduce((sum, x) => sum + x.cost, 0)
  const thisWeek = week.week_start === mondayOf(todayISO())
  return (
    <div className="space-y-4">
      {/* ---------- Podešavanja nedelje ---------- */}
      <Card>
        <CardHeader
          title={week.published ? 'Raspored je objavljen' : 'Raspored nije objavljen'}
          subtitle={`${LAYOUTS[week.layout]?.label}${midOn ? ' + međusmena' : ''} · rok ${deadlineLabel(week.signup_deadline)} · ${
            isOpen ? 'prijava otvorena' : 'prijava zatvorena'
          }`}
        />
        <div className="space-y-3 p-4">
          {/* Izgled rasporeda: po jedna osoba ili po dvoje u smeni. */}
          <div>
            <span className="label">Izgled rasporeda</span>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {Object.entries(LAYOUTS).map(([key, l]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => patchWeek({ layout: key }, `Izgled: ${l.label.toLowerCase()}.`)}
                  disabled={working || slots.length > 0 || week.layout === key}
                  aria-pressed={week.layout === key}
                  className={cx(
                    'rounded-2xl px-3.5 py-2.5 text-left transition',
                    week.layout === key
                      ? 'bg-ink text-white'
                      : 'bg-stone-100 text-stone-700 hover:bg-stone-200/70 disabled:opacity-50',
                  )}
                >
                  <span className="block text-sm font-bold">{l.label}</span>
                  <span className={cx('block text-[11px]', week.layout === key ? 'text-stone-300' : 'text-stone-500')}>
                    {l.hint}
                  </span>
                </button>
              ))}
            </div>
            {slots.length > 0 && (
              <p className="hint">Izgled može da se menja dok je raspored prazan. Isprazni ga ili obriši nedelju.</p>
            )}

            {/* Međusmena: poseban izbor, uz bilo koji izgled. */}
            <button
              type="button"
              onClick={() =>
                patchWeek({ with_mid: !midOn }, midOn ? 'Međusmena je isključena.' : 'Međusmena je uključena.')
              }
              disabled={working || (midOn && midPlaced)}
              aria-pressed={midOn}
              className="mt-1.5 flex w-full items-center gap-3 rounded-2xl bg-stone-100 px-3.5 py-2.5 text-left disabled:opacity-60"
            >
              <span
                className={cx(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                  midOn ? 'bg-brand-600 text-white' : 'bg-white text-transparent ring-1 ring-inset ring-stone-300',
                )}
                aria-hidden="true"
              >
                ✓
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-stone-800">Međusmena</span>
                <span className="block text-[11px] text-stone-500">
                  {midOn && midPlaced ? 'Prvo ukloni radnike iz međusmene.' : 'Jedna osoba, radnim danom 9–17, vikendom 12–20.'}
                </span>
              </span>
            </button>
          </div>

          <label className="block text-[12px] font-semibold text-stone-500">
            Rok za prijavu
            <div className="mt-1 flex gap-2">
              <Input
                type="datetime-local"
                value={deadlineInput}
                onChange={(e) => setDeadlineInput(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Button
                variant="secondary"
                className="shrink-0"
                disabled={working || deadlineInput === toLocalInput(week.signup_deadline)}
                onClick={() => patchWeek({ signup_deadline: fromLocalInput(deadlineInput) }, 'Rok je sačuvan.')}
              >
                Sačuvaj rok
              </Button>
            </div>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={week.published ? 'secondary' : 'primary'}
              disabled={working}
              onClick={() =>
                patchWeek(
                  { published: !week.published },
                  week.published ? 'Raspored je sakriven od radnika.' : 'Raspored je objavljen — radnici ga vide.',
                )
              }
            >
              {week.published ? 'Sakrij od radnika' : 'Objavi raspored'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => patchWeek({ signup_deadline: new Date().toISOString() }, 'Prijave su zatvorene.')}
              disabled={working || !isOpen}
            >
              Zatvori prijave sada
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" disabled={imageBusy} onClick={() => saveImage(true)}>
              Prazan obrazac
            </Button>
            <button
              type="button"
              onClick={() => setCyr((v) => !v)}
              aria-pressed={cyr}
              className={cx(
                'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                cyr ? 'bg-ink text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200',
              )}
            >
              {cyr ? 'Ćirilica' : 'Latinica'}
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-rose-600"
              onClick={() => setConfirmDelete(true)}
              disabled={working}
            >
              Obriši nedelju
            </Button>
          </div>

          {confirmDelete && (
            <div className="rounded-lg bg-rose-50 p-2.5 ring-1 ring-inset ring-rose-200">
              <p className="text-xs font-bold text-rose-900">Obrisati ovu nedelju?</p>
              <p className="mt-0.5 text-[11px] text-rose-800">Nestaju i prijave i raspored.</p>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                  Ne
                </Button>
                <Button variant="danger" size="sm" loading={working} onClick={removeWeek}>
                  Da, obriši
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ---------- Raspored kao slika ---------- */}
      <Card>
        <CardHeader
          title="Raspored"
          subtitle={week.published ? 'Ovako ga vide radnici' : 'Pregled — radnici ga ne vide dok ga ne objaviš'}
        />
        <div className="p-3">
          <ScheduleImage
            week={week}
            slots={slots}
            names={names}
            cyr={cyr}
            onDownload={() => saveImage(false)}
            downloading={imageBusy}
          />
        </div>
      </Card>
      {/* ---------- Pravljenje rasporeda ---------- */}
      <Card>
        <div className={cx('flex items-center gap-2 pr-3 transition', isBuilderOpen ? 'bg-stone-100' : 'hover:bg-stone-50')}>
          <button
            type="button"
            onClick={() => setBuilderOpen(!isBuilderOpen)}
            aria-expanded={isBuilderOpen}
            className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3.5 text-left"
          >
            <svg
              className={cx('h-4 w-4 shrink-0 text-stone-400 transition-transform', isBuilderOpen && 'rotate-90')}
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
                Pravljenje rasporeda
              </span>
            </span>
          </button>
          {isBuilderOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => setOpenDays(openDays.size > 0 ? new Set() : new Set(days))}
            >
              {openDays.size > 0 ? 'Zatvori dane' : 'Otvori dane'}
            </Button>
          )}
        </div>
        {isBuilderOpen && (
        <ul className="divide-y divide-stone-100 border-t border-stone-100">
          {days.map((day, i) => {
            const dayOpen = openDays.has(day)
            const total = shifts.reduce((n, sh) => n + slotsOf(week, sh).length, 0)
            const filled = slots.filter((x) => x.day === day).length
            const toggleDay = () =>
              setOpenDays((prev) => {
                const next = new Set(prev)
                if (next.has(day)) next.delete(day)
                else next.add(day)
                return next
              })
            return (
            <li key={day} className="px-4 py-2.5">
              <button
                type="button"
                onClick={toggleDay}
                aria-expanded={dayOpen}
                className="flex w-full items-center gap-2.5 py-1 text-left"
              >
                <svg
                  className={cx('h-4 w-4 shrink-0 text-stone-400 transition-transform', dayOpen && 'rotate-90')}
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
                <span className="min-w-0 flex-1 text-sm font-extrabold capitalize text-stone-900">
                  {DAY_NAMES[i]} <span className="font-medium text-stone-400">{shortDate(day)}</span>
                </span>
                <span
                  className={cx(
                    'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums',
                    filled === total ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500',
                  )}
                >
                  {filled}/{total}
                </span>
              </button>

              {dayOpen && (
              <div className="mt-2 space-y-3">
                {shifts.map((shift) => {
                  const here = signupsAt(day, shift)
                  const hereIds = new Set(here.map((s) => s.profile_id))
                  return (
                    <div key={shift} className="rounded-2xl bg-stone-50 p-2.5 ring-1 ring-inset ring-stone-200">
                      <p className="text-[12px] font-bold text-stone-700">
                        {SHIFT_INFO[shift].label}{' '}
                        <span className="font-medium text-stone-400">{SHIFT_INFO[shift].time(day)}</span>
                        <span className="ml-2 font-medium text-stone-400">prijavljeno: {here.length}</span>
                      </p>

                      <div className={cx('mt-1.5 grid gap-1.5', slotsOf(week, shift).length > 1 && 'sm:grid-cols-2')}>
                        {slotsOf(week, shift).map((slot) => {
                          const current = slotAt(day, shift, slot)
                          const value = current?.profile_id ?? ''
                          const sorted = [...people].sort(
                            (a, b) => Number(fitsSlot(b, slot)) - Number(fitsSlot(a, slot)) || a.full_name.localeCompare(b.full_name, 'sr'),
                          )
                          const signed = sorted.filter((p) => hereIds.has(p.id))
                          const others = sorted.filter((p) => !hereIds.has(p.id))
                          const twice = value && dayCount(day, value) > 1
                          return (
                            <div key={slot}>
                              {SLOT_LABELS[slot] && (
                                <span className="block text-[10px] font-bold uppercase tracking-wide text-stone-400">
                                  {SLOT_LABELS[slot]}
                                </span>
                              )}
                              <Select value={value} onChange={(e) => place(day, shift, slot, e.target.value)}>
                                <option value="">— niko —</option>
                                {signed.length > 0 && (
                                  <optgroup label="Prijavljeni">
                                    {signed.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.full_name}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label={signed.length > 0 ? 'Ostali' : 'Svi'}>
                                  {others.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.full_name}
                                    </option>
                                  ))}
                                </optgroup>
                              </Select>
                              {value && !hereIds.has(value) && (
                                <p className="mt-0.5 text-[11px] text-stone-400">nije se prijavio/la za ovu smenu</p>
                              )}
                              {twice && <p className="mt-0.5 text-[11px] font-semibold text-amber-700">radi i drugu smenu tog dana</p>}
                            </div>
                          )
                        })}
                      </div>

                      {here.some((s) => s.note) && (
                        <ul className="mt-1.5 space-y-0.5">
                          {here
                            .filter((s) => s.note)
                            .map((s) => (
                              <li key={s.id} className="text-[11px] leading-snug text-stone-500">
                                <b className="text-stone-700">{names.get(s.profile_id) ?? 'Radnik'}:</b> {s.note}
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
              )}
            </li>
            )
          })}
        </ul>
        )}
      </Card>

      {/* ---------- Ko se prijavio (padajući meni) ---------- */}
      <Card>
        <button
          type="button"
          onClick={() => setSignupsOpenList((v) => !v)}
          aria-expanded={signupsOpenList}
          className={cx(
            'flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition',
            signupsOpenList ? 'bg-stone-100' : 'hover:bg-stone-50',
          )}
        >
          <svg
            className={cx('h-4 w-4 shrink-0 text-stone-400 transition-transform', signupsOpenList && 'rotate-90')}
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
            <span className="block text-[15px] font-semibold tracking-tight text-stone-900">Prijave</span>
            <span className="mt-0.5 block text-[13px] text-stone-500">
              {signedPeople.size} {signedPeople.size === 1 ? 'radnik se prijavio' : 'radnika se prijavilo'}
            </span>
          </span>
        </button>
        {signupsOpenList && (
          <div className="flex flex-wrap gap-1.5 border-t border-stone-100 p-4">
            {people
              .filter((p) => p.role !== 'admin' || signedPeople.has(p.id))
              .map((p) => {
                const n = signups.filter((s) => s.profile_id === p.id).length
                return (
                  <span
                    key={p.id}
                    className={cx(
                      'rounded-full px-3 py-1.5 text-xs font-semibold',
                      n > 0 ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-600/20' : 'bg-stone-100 text-stone-400',
                    )}
                  >
                    {p.full_name} · {n}
                  </span>
                )
              })}
          </div>
        )}
      </Card>
      {/* ---------- Smene u nedelji (padajući meni) ---------- */}
      {load_.length > 0 && (
        <Fold
          title="Smene u nedelji"
          subtitle={`${load_.length} ${plural(load_.length, 'radnik')} u rasporedu`}
          open={loadOpen}
          onToggle={() => setLoadOpen((v) => !v)}
        >
          <ul className="divide-y divide-stone-100">
            {load_.map(({ p, n }) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold text-stone-800">{p.full_name}</span>
                <span className="shrink-0 tabular-nums text-stone-500">
                  {n} {plural(n, 'smena')}
                </span>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {/* ---------- Budžet nedelje (padajući meni) ---------- */}
      <Fold
        title={thisWeek ? 'Budžet za ovu nedelju' : 'Budžet za nedelju'}
        subtitle={
          budget.length === 0
            ? 'Još niko nije u rasporedu'
            : `${budget.length} ${plural(budget.length, 'radnik')}, dnevnice za dane u rasporedu`
        }
        right={budget.length > 0 ? formatMoney(budgetTotal, false) : null}
        open={budgetOpen}
        onToggle={() => setBudgetOpen((v) => !v)}
      >
        {budget.length === 0 ? (
          <p className="px-4 py-4 text-sm text-stone-400">Kad rasporediš radnike, ovde se računa koliko košta nedelja.</p>
        ) : (
          <>
            <ul className="divide-y divide-stone-100">
              {budget.map(({ p, days, wage, salaried, cost }) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-stone-800">{p.full_name}</span>
                    <span className="block text-[11px] text-stone-400">
                      {salaried
                        ? `${days} ${plural(days, ['dan', 'dana', 'dana'])} · na plati, ne ulazi u zbir`
                        : `${days} ${plural(days, ['dan', 'dana', 'dana'])} × ${formatMoney(wage, false)}`}
                    </span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-stone-900">
                    {salaried ? '—' : formatMoney(cost, false)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-stone-200 bg-stone-50 px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wide text-stone-500">Ukupno</span>
              <span className="text-lg font-extrabold tabular-nums text-stone-900">{formatMoney(budgetTotal)}</span>
            </div>
          </>
        )}
      </Fold>    </div>
  )
}
