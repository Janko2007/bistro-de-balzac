import { useRef, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import PastSchedules from '../components/PastSchedules'
import ScheduleAdmin from '../components/ScheduleAdmin'
import ScheduleWorker from '../components/ScheduleWorker'
import { usePersistentState } from '../lib/persist'
import { addDays, mondayOf, weekLabel } from '../lib/schedule'
import { todayISO } from '../lib/utils'

/** „Ova nedelja“, „Sledeća nedelja“… prema tome koliko je nedelja od današnje. */
function weekTitle(start, thisWeek) {
  const diff = Math.round((new Date(`${start}T12:00:00`) - new Date(`${thisWeek}T12:00:00`)) / (7 * 86400000))
  if (diff === 0) return 'Ova nedelja'
  if (diff === 1) return 'Sledeća nedelja'
  if (diff === -1) return 'Prošla nedelja'
  return diff > 0 ? `Za ${diff} ned.` : `Pre ${-diff} ned.`
}

/**
 * Raspored smena. Radnik se prijavljuje do roka i vidi objavljen raspored,
 * a admin otvara nedelju, slaže raspored i objavljuje ga.
 *
 * Nedelja se bira dodirom na jedno od dva dugmeta ili PREVLAČENJEM preko njih:
 * ulevo → sledeća, udesno → prethodna. Radnik može samo ovu i sledeću,
 * admin bilo koju.
 */
export default function Schedule() {
  const { isAdmin } = useAuth()
  const [weekStart, setWeekStart] = usePersistentState('schedule.week', () => mondayOf(todayISO()))

  const thisWeek = mondayOf(todayISO())
  const nextWeek = addDays(thisWeek, 7)

  // Dva dugmeta: ova + sledeća; kad admin ode dalje, dugmad idu s njim.
  const base = !isAdmin || weekStart === thisWeek || weekStart === nextWeek ? thisWeek : weekStart
  const tabs = [base, addDays(base, 7)]

  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(null)
  const moved = useRef(false)

  function go(delta) {
    setWeekStart((w) => {
      const next = addDays(w, delta * 7)
      if (isAdmin) return next
      return next < thisWeek ? thisWeek : next > nextWeek ? nextWeek : next
    })
  }

  function down(e) {
    startX.current = e.clientX
    moved.current = false
    setDragging(true)
  }
  function move(e) {
    if (startX.current === null) return
    const d = e.clientX - startX.current
    if (Math.abs(d) > 6) moved.current = true
    setDx(Math.max(-80, Math.min(80, d)))
  }
  function end(e) {
    if (startX.current === null) return
    const d = e.clientX - startX.current
    startX.current = null
    setDragging(false)
    setDx(0)
    if (d <= -50) go(1)
    else if (d >= 50) go(-1)
  }

  return (
    <div className="space-y-4">
      {/* Izbor nedelje: dodir ili prevlačenje ulevo/desno */}
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ touchAction: 'pan-y' }}
        className="select-none"
        role="group"
        aria-label="Izbor nedelje — prevuci levo ili desno"
      >
        <div
          className={'grid grid-cols-2 gap-2 ' + (dragging ? '' : 'transition-transform duration-200')}
          style={{ transform: `translateX(${dx}px)` }}
        >
          {tabs.map((start) => {
            const active = weekStart === start
            return (
              <button
                key={start}
                type="button"
                onClick={() => {
                  // Posle prevlačenja se klik ne računa.
                  if (!moved.current) setWeekStart(start)
                }}
                aria-pressed={active}
                className={
                  'rounded-2xl px-3 py-3 text-center transition ' +
                  (active ? 'bg-stone-900 text-white shadow-sm' : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70')
                }
              >
                <span className="block text-[15px] font-extrabold leading-tight">{weekTitle(start, thisWeek)}</span>
                <span className={'mt-0.5 block text-[11px] ' + (active ? 'text-white/70' : 'text-stone-400')}>
                  {weekLabel(start)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {isAdmin ? <ScheduleAdmin weekStart={weekStart} /> : <ScheduleWorker weekStart={weekStart} />}

      {isAdmin && <PastSchedules beforeWeek={thisWeek} onOpen={setWeekStart} />}
    </div>
  )
}
