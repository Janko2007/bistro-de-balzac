import { useCallback, useEffect, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { SHIFT_LABELS, errorMessage, formatDate, formatMoney } from '../lib/utils'
import { Button, Card, CardHeader } from './ui'

/** Koliko dugo obrisan popis može da se vrati. */
const KEEP_MS = 12 * 60 * 60 * 1000

/** „još 11 h 20 min“ do trajnog brisanja. */
function timeLeft(deletedAt) {
  const ms = new Date(deletedAt).getTime() + KEEP_MS - Date.now()
  if (ms <= 0) return 'briše se'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `još ${h} h ${m} min` : `još ${m} min`
}

/**
 * Obrisani popisi — korpa (samo vlasnik).
 *
 * Obrisan popis se ovde čuva 12 sati i može da se vrati. Pri svakom
 * otvaranju ekrana korpa se prazni od onoga što je starije od 12 sati:
 * baza trajno briše zapise i vraća putanje slika, koje se brišu iz storage-a.
 * Kartica se ne prikazuje dok je korpa prazna.
 */
export default function ReportTrash({ onRestored }) {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [names, setNames] = useState({})
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    const since = new Date(Date.now() - KEEP_MS).toISOString()
    const { data, error } = await supabase
      .from('report_trash')
      .select('id, report_date, shift, deleted_at, data')
      .gt('deleted_at', since)
      .order('deleted_at', { ascending: false })

    if (error) {
      console.error(error)
      return
    }
    setRows(data ?? [])

    const ids = [...new Set((data ?? []).map((r) => r.data?.report?.created_by).filter(Boolean))]
    if (ids.length) {
      const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name])))
    }
  }, [])

  useEffect(() => {
    let active = true

    async function purgeThenLoad() {
      // Trajno brisanje isteklih popisa + njihovih slika.
      const { data: paths, error } = await supabase.rpc('purge_report_trash')
      if (!error && paths?.length) {
        const list = paths.map((p) => (typeof p === 'string' ? p : Object.values(p)[0]))
        await supabase.storage.from('izvestaji').remove(list.filter(Boolean))
      }
      if (active) load()
    }

    purgeThenLoad()
    return () => {
      active = false
    }
  }, [load])

  async function restore(row) {
    setBusy(row.id)
    const { error } = await supabase.rpc('restore_report', { p_id: row.id })
    setBusy(null)

    if (error) return toast.error(errorMessage(error))
    toast.success('Popis je vraćen.')
    load()
    onRestored?.()
  }

  if (rows.length === 0) return null

  return (
    <Card>
      <CardHeader title="Obrisani popisi" subtitle="Mogu da se vrate 12 sati od brisanja" />
      <ul className="divide-y divide-stone-100">
        {rows.map((row) => {
          const r = row.data?.report ?? {}
          return (
            <li key={row.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] text-stone-400">
                  <span className="font-semibold text-stone-900">
                    {formatDate(row.report_date)} · {SHIFT_LABELS[row.shift] ?? row.shift}
                  </span>
                  {names[r.created_by] ? ` · ${names[r.created_by]}` : ''}
                </p>
                <p className="mt-0.5 text-xs tabular-nums text-stone-400">
                  pazar {formatMoney(r.total_amount, false)} · {timeLeft(row.deleted_at)}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={busy === row.id}
                disabled={!!busy}
                onClick={() => restore(row)}
              >
                Vrati
              </Button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
