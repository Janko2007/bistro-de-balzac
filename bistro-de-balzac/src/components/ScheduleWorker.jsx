import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import {
  DAY_NAMES,
  SHIFT_INFO,
  timeOf,
  addSignup,
  deadlineLabel,
  loadPeople,
  loadSignups,
  loadSlots,
  loadWeek,
  removeSignup,
  saveSignupNote,
  shiftsOf,
  shortDate,
  signupsOpen,
  weekDays,
} from '../lib/schedule'
import { cx, errorMessage } from '../lib/utils'
import { Card, CardHeader } from './ui'
import ScheduleImage from './ScheduleImage'
import { downloadScheduleImage } from '../lib/scheduleImage'

/**
 * Raspored — radnik: prijavljuje se za smene do roka, ostavlja napomenu i
 * (kad admin objavi) vidi raspored.
 */
export default function ScheduleWorker({ weekStart }) {
  const { profile } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [week, setWeek] = useState(null)
  const [signups, setSignups] = useState([])
  const [slots, setSlots] = useState([])
  const [names, setNames] = useState(new Map())
  const [notes, setNotes] = useState({}) // id prijave -> tekst koji se kuca
  const [busy, setBusy] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const w = await loadWeek(weekStart)
      setWeek(w)
      if (w) {
        const [mine, placed, people] = await Promise.all([
          loadSignups(w.id),
          w.published ? loadSlots(w.id) : Promise.resolve([]),
          loadPeople().catch(() => []),
        ])
        setSignups(mine)
        setSlots(placed)
        setNames(new Map(people.map((p) => [p.id, p.full_name])))
        setNotes(Object.fromEntries(mine.map((s) => [s.id, s.note ?? ''])))
      } else {
        setSignups([])
        setSlots([])
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

  const open = signupsOpen(week)
  // Kratki nazivi na dugmadima: Prva, Među, Druga.
  const shiftName = (shift) => (shift === 'medjusmena' ? 'Među' : SHIFT_INFO[shift].short)
  const days = useMemo(() => weekDays(weekStart), [weekStart])
  const mineAt = (day, shift) => signups.find((s) => s.day === day && s.shift === shift)

  async function toggle(day, shift) {
    if (!week || !open) return
    const key = `${day}|${shift}`
    setBusy(key)
    try {
      const existing = mineAt(day, shift)
      if (existing) {
        await removeSignup(existing.id)
        setSignups((prev) => prev.filter((s) => s.id !== existing.id))
      } else {
        const row = await addSignup(week.id, profile.id, day, shift)
        setSignups((prev) => [...prev, row])
        setNotes((prev) => ({ ...prev, [row.id]: '' }))
      }
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Nije sačuvano — rok za prijavu je možda istekao.'))
      load()
    }
    setBusy(null)
  }

  /** Klik na dan: označi sve smene tog dana, a ako su već sve označene — skini ih. */
  async function toggleDay(day) {
    if (!week || !open) return
    const list = shiftsOf(week)
    const rows = list.map((sh) => mineAt(day, sh))
    setBusy(`${day}|*`)
    try {
      if (rows.every(Boolean)) {
        await Promise.all(rows.map((r) => removeSignup(r.id)))
        const gone = new Set(rows.map((r) => r.id))
        setSignups((prev) => prev.filter((s) => !gone.has(s.id)))
      } else {
        const missing = list.filter((sh) => !mineAt(day, sh))
        const added = await Promise.all(missing.map((sh) => addSignup(week.id, profile.id, day, sh)))
        setSignups((prev) => [...prev, ...added])
        setNotes((prev) => ({ ...prev, ...Object.fromEntries(added.map((r) => [r.id, ''])) }))
      }
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Nije sačuvano — rok za prijavu je možda istekao.'))
      load()
    }
    setBusy(null)
  }

  async function commitNote(row) {
    const text = notes[row.id] ?? ''
    if (text.trim() === (row.note ?? '')) return
    try {
      await saveSignupNote(row.id, text)
      setSignups((prev) => prev.map((s) => (s.id === row.id ? { ...s, note: text.trim() || null } : s)))
    } catch (err) {
      toast.error(errorMessage(err, 'Napomena nije sačuvana.'))
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-stone-400">Učitavam…</p>

  if (!week) {
    return (
      <Card>
        <div className="p-6 text-center">
          <p className="text-base font-bold text-stone-900">Raspored za ovu nedelju još nije otvoren</p>
          <p className="mt-1 text-[13px] text-stone-400">Prijave će se pojaviti čim ih admin otvori.</p>
        </div>
      </Card>
    )
  }

  const shifts = shiftsOf(week)

  return (
    <div className="space-y-4">
      {/* Objavljen raspored: samo slika. */}
      {week.published && (
        <Card>
          <CardHeader title="Raspored" subtitle="Tvoje smene su označene" />
          <div className="p-3">
            <ScheduleImage
              week={week}
              slots={slots}
              names={names}
              meId={profile?.id}
              downloading={saving}
              onDownload={async () => {
                setSaving(true)
                try {
                  await downloadScheduleImage({ week, slots, names, meId: profile?.id })
                } catch (err) {
                  toast.error(errorMessage(err, 'Slika nije napravljena.'))
                }
                setSaving(false)
              }}
            />          </div>
        </Card>
      )}

      {/* Dok raspored nije objavljen: rok i prijave. */}
      {!week.published && (
      <>
      <div
        className={cx(
          'flex items-center justify-between gap-3 rounded-2xl px-4 py-3',
          open ? 'bg-brand-50 ring-1 ring-inset ring-brand-600/20' : 'bg-stone-200/60',
        )}
      >
        <div>
          <p className="eyebrow">{open ? 'Prijava je otvorena' : 'Prijava je zatvorena'}</p>
          <p className="text-sm font-bold text-stone-900">Rok: {deadlineLabel(week.signup_deadline)}</p>
        </div>
        <span className="text-xl" aria-hidden="true">
          {open ? '📝' : '🔒'}
        </span>
      </div>
      {/* Moje prijave */}
      <Card>
        <CardHeader title="Prijave" />
        <ul className="divide-y divide-stone-100">
          {days.map((day, i) => (
            <li key={day} className="px-4 py-3">
              {/* Klik na dan označava sve smene tog dana (ili ih sve skida). */}
              <button
                type="button"
                onClick={() => toggleDay(day)}
                disabled={!open || busy === `${day}|*`}
                aria-label={`${DAY_NAMES[i]}: označi sve smene`}
                className="flex w-full items-center justify-between gap-2 rounded-lg text-left disabled:cursor-default"
              >
                <span className="text-sm font-extrabold capitalize text-stone-900">
                  {DAY_NAMES[i]} <span className="font-medium text-stone-400">{shortDate(day)}</span>
                </span>
                {open && (
                  <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold text-stone-500">
                    {shiftsOf(week).every((sh) => mineAt(day, sh)) ? 'Poništi sve' : 'Sve smene'}
                  </span>
                )}
              </button>

              {/* Svaka smena je svoja kolona: dugme, a ispod njega njena napomena. */}
              <div className="mt-2 grid items-start gap-1.5" style={{ gridTemplateColumns: `repeat(${shifts.length}, minmax(0, 1fr))` }}>
                {shifts.map((shift) => {
                  const row = mineAt(day, shift)
                  return (
                    <div key={shift} className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggle(day, shift)}
                        disabled={!open || busy === `${day}|${shift}`}
                        aria-pressed={!!row}
                        className={cx(
                          'flex min-h-[62px] flex-col items-center justify-center rounded-2xl px-2 py-2 text-center transition',
                          row
                            ? 'bg-brand-600 text-white'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70 disabled:hover:bg-stone-100',
                          !open && !row && 'opacity-50',
                        )}
                      >
                        <span className="block text-[15px] font-bold leading-tight">
                          {row ? '✓ ' : ''}
                          {shiftName(shift)}
                        </span>
                        <span className={cx('mt-0.5 block text-[11px] leading-tight', row ? 'text-white/80' : 'text-stone-400')}>
                          {timeOf(week, shift, day)}
                        </span>
                      </button>

                      {row && (
                        <input
                          value={notes[row.id] ?? ''}
                          onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                          onBlur={() => commitNote(row)}
                          disabled={!open}
                          maxLength={160}
                          placeholder="Napomena"
                          aria-label={`Napomena: ${DAY_NAMES[i]}, ${shiftName(shift)}`}
                          className="field w-full px-2.5 py-2 text-[13px]"
                        />
                      )}
                    </div>
                  )
                })}
              </div>            </li>
          ))}
        </ul>
      </Card>
      </>
      )}
    </div>
  )
}
