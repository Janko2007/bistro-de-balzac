import { useCallback, useEffect, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { Button, Card, CardHeader, Modal, Select } from './ui'
import { countLabel, errorMessage, formatDate } from '../lib/utils'

/** Procena veličine jedne slike posle kompresije (KB). */
const KB_PER_IMAGE = 140
const FREE_TIER_MB = 1024

const PERIODS = [
  { months: 6, label: 'starije od 6 meseci' },
  { months: 12, label: 'starije od godinu dana' },
  { months: 24, label: 'starije od 2 godine' },
]

/** Datum pre N meseci, YYYY-MM-DD. */
function monthsAgo(months) {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString().slice(0, 10)
}

/**
 * Održavanje prostora (samo vlasnik).
 * Slike izveštaja su jedino što s vremenom raste — brojevi iz popisa
 * zauzimaju zanemarljivo malo i nikad se ne brišu.
 */
export default function StorageCleanup() {
  const toast = useToast()

  const [total, setTotal] = useState(null)
  const [months, setMonths] = useState(12)
  const [oldCount, setOldCount] = useState(0)
  const [oldest, setOldest] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [working, setWorking] = useState(false)

  const cutoff = monthsAgo(months)

  const load = useCallback(async () => {
    const [allRes, oldRes, oldestRes] = await Promise.all([
      supabase.from('report_images').select('id', { count: 'exact', head: true }),
      supabase
        .from('report_images')
        .select('id, report:shift_reports!inner(report_date)', { count: 'exact', head: true })
        .lt('report.report_date', cutoff),
      supabase
        .from('shift_reports')
        .select('report_date')
        .order('report_date', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ])

    if (allRes.error) {
      console.error(allRes.error)
      return
    }
    setTotal(allRes.count ?? 0)
    setOldCount(oldRes.count ?? 0)
    setOldest(oldestRes.data?.report_date ?? null)
  }, [cutoff])

  useEffect(() => {
    load()
  }, [load])

  async function cleanup() {
    setWorking(true)

    // Uzimamo putanje slika koje pripadaju izveštajima starijim od praga.
    const { data, error } = await supabase
      .from('report_images')
      .select('id, storage_path, report:shift_reports!inner(report_date)')
      .lt('report.report_date', cutoff)
      .limit(1000)

    if (error) {
      setWorking(false)
      toast.error(errorMessage(error))
      return
    }

    const rows = data ?? []
    if (rows.length === 0) {
      setWorking(false)
      setConfirmOpen(false)
      toast.info('Nema slika za brisanje.')
      return
    }

    // Prvo fajlovi iz storage-a, pa redovi iz baze — da ne ostane zapis
    // koji pokazuje na nepostojeću sliku.
    const { error: storageError } = await supabase.storage
      .from('izvestaji')
      .remove(rows.map((r) => r.storage_path))

    if (storageError) {
      setWorking(false)
      toast.error(errorMessage(storageError))
      return
    }

    const { error: rowError } = await supabase
      .from('report_images')
      .delete()
      .in('id', rows.map((r) => r.id))

    setWorking(false)
    setConfirmOpen(false)

    if (rowError) return toast.error(errorMessage(rowError))

    toast.success(
      `Obrisano ${countLabel(rows.length, 'slika')} — oslobođeno ~${Math.round(
        (rows.length * KB_PER_IMAGE) / 1024,
      )} MB.`,
    )
    load()
  }

  if (total === null) return null

  const usedMb = (total * KB_PER_IMAGE) / 1024
  const percent = Math.min(100, Math.round((usedMb / FREE_TIER_MB) * 100))

  return (
    <>
      <Card>
        <CardHeader
          title="Prostor za slike"
          subtitle={`${countLabel(total, 'slika')} · ~${usedMb.toFixed(0)} MB od 1 GB besplatno`}
        />
        <div className="space-y-3 p-4">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className={percent > 80 ? 'h-full bg-rose-500' : 'h-full bg-emerald-500'}
              style={{ width: `${Math.max(percent, 2)}%` }}
            />
          </div>

          <p className="text-sm text-slate-600">
            Slike izveštaja su jedino što s vremenom raste. Brojevi iz popisa — pazar, stanja,
            dnevnice — zauzimaju zanemarljivo malo i <strong>nikad se ne brišu</strong>.
            {oldest && ` Najstariji izveštaj je od ${formatDate(oldest)}.`}
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label className="label" htmlFor="cleanup-period">
                Obriši slike
              </label>
              <Select
                id="cleanup-period"
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
              >
                {PERIODS.map((p) => (
                  <option key={p.months} value={p.months}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              variant={oldCount > 0 ? 'secondary' : 'ghost'}
              disabled={oldCount === 0}
              onClick={() => setConfirmOpen(true)}
            >
              {oldCount > 0 ? `Obriši ${oldCount}` : 'Nema takvih'}
            </Button>
          </div>
        </div>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => !working && setConfirmOpen(false)}
        title="Obriši stare slike"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={working}
              onClick={() => setConfirmOpen(false)}
            >
              Otkaži
            </Button>
            <Button variant="danger" className="flex-1" loading={working} onClick={cleanup}>
              Obriši {oldCount}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Briše se <strong>{oldCount}</strong> slika iz izveštaja pre{' '}
          <strong>{formatDate(cutoff)}</strong>. Oslobađa se oko{' '}
          <strong>{Math.round((oldCount * KB_PER_IMAGE) / 1024)} MB</strong>.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Sami izveštaji — pazar, popis po artiklima i dnevnice — <strong>ostaju netaknuti</strong>.
          Nestaju samo fotografije.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Ovo briše kopiju koja stoji u aplikaciji. Originalni fiskalni podaci ostaju tamo gde ih
          inače čuvaš.
        </p>
      </Modal>
    </>
  )
}
