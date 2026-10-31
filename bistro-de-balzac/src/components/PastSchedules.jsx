import { useCallback, useEffect, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { usePersistentState } from '../lib/persist'
import { deleteWeek, loadPastWeeks, weekLabel } from '../lib/schedule'
import { cx, errorMessage, plural } from '../lib/utils'
import { Button, Card } from './ui'

/**
 * Prethodni rasporedi (admin) — padajući meni sa svim nedeljama pre ove.
 * Svaka može da se otvori ili obriše, a sve odjednom jednim dugmetom.
 */
export default function PastSchedules({ beforeWeek, onOpen }) {
  const toast = useToast()
  const [open, setOpen] = usePersistentState('pastsched.open', false)
  const [weeks, setWeeks] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [confirm, setConfirm] = useState(null) // id nedelje ili 'sve'
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    try {
      setWeeks(await loadPastWeeks(beforeWeek))
    } catch (err) {
      console.error(err)
    }
    setLoaded(true)
  }, [beforeWeek])

  useEffect(() => {
    load()
  }, [load])

  async function remove(list) {
    setWorking(true)
    try {
      for (const w of list) await deleteWeek(w.id)
      toast.success(list.length > 1 ? 'Prethodni rasporedi su obrisani.' : 'Raspored je obrisan.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
    setWorking(false)
    setConfirm(null)
    load()
  }

  if (!loaded || weeks.length === 0) return null

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
        <span className="min-w-0 flex-1 text-[15px] font-semibold tracking-tight text-stone-900">
          Prethodni rasporedi
        </span>
        <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold tabular-nums text-stone-500">
          {weeks.length}
        </span>
      </button>

      {open && (
        <div className="border-t border-stone-100">
          <ul className="divide-y divide-stone-100">
            {weeks.map((w) => (
              <li key={w.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpen?.(w.week_start)}
                    className="min-w-0 flex-1 truncate text-left text-sm font-semibold tabular-nums text-stone-800 hover:text-brand-700"
                  >
                    {weekLabel(w.week_start)}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-rose-600"
                    disabled={working}
                    onClick={() => setConfirm(confirm === w.id ? null : w.id)}
                  >
                    Obriši
                  </Button>
                </div>
                {confirm === w.id && (
                  <div className="mt-2 rounded-lg bg-rose-50 p-2.5 ring-1 ring-inset ring-rose-200">
                    <p className="text-xs font-bold text-rose-900">Obrisati ovaj raspored?</p>
                    <p className="mt-0.5 text-[11px] text-rose-800">Nestaju i prijave i raspored te nedelje.</p>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
                        Ne
                      </Button>
                      <Button variant="danger" size="sm" loading={working} onClick={() => remove([w])}>
                        Da, obriši
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="border-t border-stone-100 px-4 py-3">
            {confirm === 'sve' ? (
              <div className="rounded-lg bg-rose-50 p-2.5 ring-1 ring-inset ring-rose-200">
                <p className="text-xs font-bold text-rose-900">
                  Obrisati {weeks.length} {plural(weeks.length, ['prethodni raspored', 'prethodna rasporeda', 'prethodnih rasporeda'])}?
                </p>
                <p className="mt-0.5 text-[11px] text-rose-800">Ovo se ne može poništiti.</p>
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
                    Ne
                  </Button>
                  <Button variant="danger" size="sm" loading={working} onClick={() => remove(weeks)}>
                    Da, obriši sve
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-rose-600"
                disabled={working}
                onClick={() => setConfirm('sve')}
              >
                Obriši sve prethodne
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
