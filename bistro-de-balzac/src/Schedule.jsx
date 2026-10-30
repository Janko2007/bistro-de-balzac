import { useAuth } from '../context/AuthContext'
import ScheduleAdmin from '../components/ScheduleAdmin'
import ScheduleWorker from '../components/ScheduleWorker'
import { Button } from '../components/ui'
import { usePersistentState } from '../lib/persist'
import { addDays, mondayOf, weekLabel } from '../lib/schedule'
import { todayISO } from '../lib/utils'

/**
 * Raspored smena. Radnik se prijavljuje do roka i vidi objavljen raspored,
 * a admin otvara nedelju, slaže raspored i objavljuje ga.
 */
export default function Schedule() {
  const { isAdmin } = useAuth()
  const [weekStart, setWeekStart] = usePersistentState('schedule.week', () => mondayOf(todayISO()))

  const thisWeek = mondayOf(todayISO())
  const nextWeek = addDays(thisWeek, 7)

  const tabs = [
    { start: thisWeek, title: 'Ova nedelja' },
    { start: nextWeek, title: 'Sledeća nedelja' },
  ]

  return (
    <div className="space-y-4">
      {/* Izbor nedelje: dva velika dugmeta, bez strelica */}
      <div className="grid grid-cols-2 gap-2">
        {tabs.map((t) => {
          const active = weekStart === t.start
          return (
            <button
              key={t.start}
              type="button"
              onClick={() => setWeekStart(t.start)}
              aria-pressed={active}
              className={
                'rounded-2xl px-3 py-3 text-center transition ' +
                (active ? 'bg-stone-900 text-white shadow-sm' : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70')
              }
            >
              <span className="block text-[15px] font-extrabold leading-tight">{t.title}</span>
              <span className={'mt-0.5 block text-[11px] ' + (active ? 'text-white/70' : 'text-stone-400')}>
                {weekLabel(t.start)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Admin može i na ostale nedelje */}
      {isAdmin && (
        <div className="flex items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="Prethodna nedelja">
            ◀
          </Button>
          <p className="min-w-0 truncate text-center text-[13px] font-bold text-stone-700">
            {tabs.some((t) => t.start === weekStart) ? 'Druge nedelje' : weekLabel(weekStart)}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="Sledeća nedelja">
            ▶
          </Button>
        </div>
      )}

      {isAdmin ? <ScheduleAdmin weekStart={weekStart} /> : <ScheduleWorker weekStart={weekStart} />}
    </div>
  )
}
