import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { useToast, useToastOffset } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { categoryComparator, loadCategories } from '../lib/categories'
import { heading, printDocument, statGrid, table, textBlock } from '../lib/print'
import ReportPicker from '../components/ReportPicker'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CategoryToggle,
  EmptyState,
  Field,
  FullPageLoader,
  Modal,
  MoneyInput,
  Stat,
  Textarea,
} from '../components/ui'
import {
  SHIFT_LABELS,
  SHIFT_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  countLabel,
  cx,
  errorMessage,
  formatDate,
  formatDateTime,
  formatMoney,
  formatQty,
  parseNumber,
} from '../lib/utils'

export default function ReportDetail() {
  const { id } = useParams()
  const { isAdmin, profile } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  // Admin ima traku sa dugmadima iznad donje navigacije — obaveštenja idu iznad nje.
  useToastOffset(130, isAdmin)

  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState(null)
  const [imageUrls, setImageUrls] = useState([])
  const [lightbox, setLightbox] = useState(null)
  const [working, setWorking] = useState(false)
  const [openCats, setOpenCats] = useState(() => new Set())
  const [returnOpen, setReturnOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [adminNote, setAdminNote] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [staffOpen, setStaffOpen] = useState(false)
  const [allWorkers, setAllWorkers] = useState([])
  const [staffDraft, setStaffDraft] = useState([])
  const [categories, setCategories] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  // { profileId, name, full, value } — otvoren prozor za umanjenje dnevnice
  const [wageEdit, setWageEdit] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('shift_reports')
      .select(
        `
        *,
        creator:profiles!shift_reports_created_by_fkey ( id, full_name, email ),
        verifier:profiles!shift_reports_verified_by_fkey ( id, full_name ),
        noteAuthor:profiles!shift_reports_admin_note_by_fkey ( id, full_name ),
        staff:shift_report_staff ( wage_override, profile:profiles ( id, full_name, pay_model, daily_wage ) ),
        items:shift_report_items (
          id, item_id, item_name, unit, category,
          qty_start, qty_added, qty_new, qty_sold, qty_end, is_counter, note
        ),
        images:report_images ( id, storage_path, created_at )
      `,
      )
      .eq('id', id)
      .maybeSingle()

    if (error) {
      toast.error(errorMessage(error))
      setLoading(false)
      return
    }
    if (!data) {
      setReport(null)
      setLoading(false)
      return
    }

    setReport(data)
    setAdminNote(data.admin_note ?? '')

    // Bucket je privatan -> potreban je potpisani URL (traje 2 sata).
    if (data.images?.length) {
      const paths = data.images.map((img) => img.storage_path)
      const { data: signed, error: signError } = await supabase.storage
        .from('izvestaji')
        .createSignedUrls(paths, 60 * 60 * 2)

      if (signError) {
        console.error(signError)
        setImageUrls([])
      } else {
        setImageUrls(
          (signed ?? []).map((s, i) => ({
            id: data.images[i].id,
            url: s.signedUrl,
            path: data.images[i].storage_path,
          })),
        )
      }
    } else {
      setImageUrls([])
    }

    setLoading(false)
  }, [id, toast])

  /* Ceo spisak artikala — da se vidi i ono što radnik nije popisao. */
  const [catalog, setCatalog] = useState([])

  useEffect(() => {
    setLoading(true)
    load()
    loadCategories()
      .then(setCategories)
      .catch(() => setCategories([]))
    supabase
      .from('items')
      .select('id, name, category, unit, sort_order, is_active, is_counter, created_at')
      .order('sort_order', { ascending: true })
      .then(({ data }) => setCatalog(data ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  /**
   * Svi artikli u jednom spisku:
   *   - redovi iz izveštaja (popisani), i
   *   - aktivni artikli bez reda u izveštaju → „nije popisano“.
   * Artikal dodat u meni POSLE ove smene se ne vodi kao preskočen.
   */
  const allRows = useMemo(() => {
    if (!report) return []
    const order = new Map(catalog.map((c) => [c.id, c.sort_order]))

    const rows = (report.items ?? []).map((i) => ({
      ...i,
      key: i.id,
      missing: i.qty_end === null || i.qty_end === undefined,
      sort: order.get(i.item_id) ?? 99999,
    }))

    const counted = new Set((report.items ?? []).map((i) => i.item_id))
    for (const c of catalog) {
      if (counted.has(c.id) || !c.is_active) continue
      if (report.created_at && c.created_at && c.created_at > report.created_at) continue
      rows.push({
        key: `missing-${c.id}`,
        item_id: c.id,
        item_name: c.name,
        unit: c.unit,
        category: c.category,
        qty_start: null,
        qty_added: null,
        qty_new: null,
        qty_sold: null,
        qty_end: null,
        is_counter: !!c.is_counter,
        missing: true,
        sort: c.sort_order,
      })
    }
    return rows
  }, [report, catalog])

  const groupedItems = useMemo(() => {
    const map = new Map()
    for (const item of allRows) {
      const key = item.category || 'Ostalo'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(item)
    }
    // Isti redosled kao u popisu: kategorije po Adminovom redu, artikli po sort_order.
    for (const list of map.values()) {
      list.sort((a, b) => a.sort - b.sort || a.item_name.localeCompare(b.item_name, 'sr'))
    }
    const compare = categoryComparator(categories)
    return Array.from(map.entries()).sort((a, b) => compare(a[0], b[0]))
  }, [allRows, categories])

  function toggleCat(category) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const soldTotal = useMemo(
    () => (report?.items ?? []).reduce((sum, i) => sum + Number(i.qty_sold ?? 0), 0),
    [report],
  )

  /* Filter popisa: sve / nije popisano / popisano, a nije prodato. */
  const [itemFilter, setItemFilter] = useState('sve') // 'sve' | 'nepopisano' | 'nije'

  // Nije prodat = popisan (ima krajnje stanje), a prodato je tačno 0.
  const isUnsold = (i) => !i.missing && Number(i.qty_sold) === 0

  const itemCounts = useMemo(
    () => ({
      sve: allRows.length,
      nepopisano: allRows.filter((i) => i.missing).length,
      nije: allRows.filter(isUnsold).length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows],
  )

  const visibleGroups = useMemo(() => {
    if (itemFilter === 'sve') return groupedItems
    const keep = itemFilter === 'nepopisano' ? (i) => i.missing : isUnsold
    return groupedItems
      .map(([cat, list]) => [cat, list.filter(keep)])
      .filter(([, list]) => list.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedItems, itemFilter])

  /* ---------------------------------------------------------------- */
  /*  Ko je radio u smeni — menja samo admin (od toga zavise dnevnice) */
  /* ---------------------------------------------------------------- */
  async function openStaffEditor() {
    setStaffDraft((report.staff ?? []).map((s) => s.profile?.id).filter(Boolean))
    setStaffOpen(true)

    if (allWorkers.length === 0) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, daily_wage')
        .eq('is_deleted', false)
        .order('full_name')

      if (error) toast.error(errorMessage(error))
      else setAllWorkers(data ?? [])
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Umanjena dnevnica za ovaj dan                                    */
  /*  Npr. radnik je došao kasnije — dobija manje SAMO za ovu smenu.    */
  /* ---------------------------------------------------------------- */
  function openWageEditor(entry) {
    setWageEdit({
      profileId: entry.profile.id,
      name: entry.profile.full_name,
      full: Number(entry.profile.daily_wage ?? 0),
      value: entry.wage_override === null || entry.wage_override === undefined
        ? ''
        : String(entry.wage_override),
    })
  }

  async function saveWage(override) {
    setWorking(true)
    const { error } = await supabase
      .from('shift_report_staff')
      .update({ wage_override: override })
      .eq('report_id', id)
      .eq('profile_id', wageEdit.profileId)
    setWorking(false)

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setWageEdit(null)
    toast.success(override === null ? 'Vraćena puna dnevnica.' : 'Dnevnica je umanjena za ovaj dan.')
    load()
  }

  async function saveStaff() {
    setWorking(true)
    const current = (report.staff ?? []).map((s) => s.profile?.id).filter(Boolean)
    const toAdd = staffDraft.filter((id) => !current.includes(id))
    const toRemove = current.filter((id) => !staffDraft.includes(id))

    let error = null
    if (toRemove.length > 0) {
      const res = await supabase
        .from('shift_report_staff')
        .delete()
        .eq('report_id', id)
        .in('profile_id', toRemove)
      error = res.error
    }
    if (!error && toAdd.length > 0) {
      const res = await supabase
        .from('shift_report_staff')
        .insert(toAdd.map((profileId) => ({ report_id: id, profile_id: profileId })))
      error = res.error
    }
    setWorking(false)

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setStaffOpen(false)
    toast.success('Smena je izmenjena — dnevnice su preračunate.')
    load()
  }

  async function changeStatus(status, note = null) {
    setWorking(true)
    const payload = { status }
    if (note !== null) payload.admin_note = note

    const { error } = await supabase.from('shift_reports').update(payload).eq('id', id)
    setWorking(false)

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(
      status === 'potvrdjen' ? 'Popis je potvrđen. ✅' : 'Popis je vraćen radniku na ispravku.',
    )
    setReturnOpen(false)
    load()
  }

  /** Poruka radniku — Admin je piše kad god hoće, ne samo pri vraćanju. */
  async function saveAdminNote() {
    setWorking(true)
    const { error } = await supabase
      .from('shift_reports')
      .update({ admin_note: adminNote.trim() })
      .eq('id', id)
    setWorking(false)

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setNoteOpen(false)
    toast.success(adminNote.trim() ? 'Poruka je sačuvana.' : 'Poruka je obrisana.')
    load()
  }

  async function handleDelete() {
    setWorking(true)
    // Ne briše se odmah: popis ide u korpu i 12 sati može da se vrati
    // (Pregled → Obrisani popisi). Slike ostaju dok se korpa ne isprazni.
    const { error } = await supabase.rpc('trash_report', { p_id: id })
    setWorking(false)

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success('Popis je obrisan — 12 sati možeš da ga vratiš iz Pregleda.')
    navigate('/', { replace: true })
  }

  /**
   * Potvrđen popis je za radnika zaključan: ostaju mu samo datum i smena,
   * poruka da iznose vidi admin, ko je radio i dnevna obaveza. Pazar,
   * popis artikala, slike i napomene se sakrivaju.
   *
   * Dok popis nije potvrđen radnik vidi sve — sam ga je i popunio.
   */
  const lockedForWorker = !isAdmin && report?.status === 'potvrdjen'

  /** Popis ove smene na papiru — `parts` bira šta ulazi. */
  function printReport(parts) {
    const has = (key) => parts.includes(key)

    const columns = [
      { label: 'Artikal' },
      { label: 'Jed.', width: '9%' },
      { label: 'Početno', align: 'right', width: '11%' },
      { label: 'Dodato', align: 'right', width: '11%' },
      { label: 'Novo', align: 'right', width: '11%' },
      { label: 'Prodato', align: 'right', width: '11%' },
      { label: 'Krajnje', align: 'right', width: '11%' },
    ]

    const rows = []
    for (const [category, catItems] of groupedItems) {
      const catSold = catItems.reduce((s, i) => s + Number(i.qty_sold ?? 0), 0)
      rows.push({ kind: 'group', label: category, right: `prodato ${formatQty(catSold)}` })
      for (const item of catItems) {
        rows.push({
          muted: item.missing,
          cells: [
            item.missing ? `${item.item_name} — nije popisano` : item.item_name,
            item.unit,
            formatQty(item.qty_start),
            // Brojač se ne dopunjava — te dve kolone kod njega nemaju smisla.
            item.is_counter ? '—' : formatQty(item.qty_added),
            item.is_counter ? '—' : formatQty(item.qty_new),
            { value: formatQty(item.qty_sold), strong: !item.missing },
            formatQty(item.qty_end),
          ],
        })
      }
    }
    rows.push({
      kind: 'total',
      cells: [
        'Ukupno prodato',
        '',
        '',
        '',
        '',
        formatQty(soldTotal),
        '',
      ],
    })

    /* Uz ime ide i umanjena dnevnica, ako je za taj dan upisana — da se na
       papiru vidi zašto je nekome manje. */
    const staffLine =
      staffList.length > 0
        ? staffList
            .map((s) =>
              isAdmin && s.wage_override !== null && s.wage_override !== undefined
                ? `${s.profile.full_name} (${formatMoney(s.wage_override, false)})`
                : s.profile.full_name,
            )
            .join(', ')
        : '—'

    printDocument({
      title: `Popis smene — ${formatDate(report.report_date)}`,
      subtitle: `${SHIFT_LABELS[report.shift]} · ${STATUS_LABELS[report.status] ?? report.status}`,
      meta: [
        { label: 'U smeni', value: staffLine },
        { label: 'Poslao', value: report.creator?.full_name || '—' },
        report.status === 'potvrdjen' && report.verified_at
          ? { label: 'Potvrdio', value: `${report.verifier?.full_name || 'Admin'}, ${formatDateTime(report.verified_at)}` }
          : null,
      ],
      content: [
        has('obracun')
          ? statGrid([
              lockedForWorker
                ? null
                : { label: 'Pazar', value: formatMoney(report.total_amount, false), sub: 'RSD' },
              lockedForWorker
                ? null
                : { label: 'Kartice', value: formatMoney(report.card_amount, false), sub: 'RSD' },
              lockedForWorker
                ? null
                : {
                    label: 'Predato',
                    value: formatMoney(report.cash_amount, false),
                    sub: 'pazar − kartice',
                  },
              {
                label: 'Popisano',
                value: `${itemCounts.sve - itemCounts.nepopisano}/${itemCounts.sve}`,
                sub: 'artikala',
              },
              {
                label: 'Dnevna obaveza',
                value: report.daily_task_done ? 'urađena' : 'nije',
                sub: countLabel(imageUrls.length, 'slika'),
              },
            ])
          : '',
        has('napomene') ? textBlock('Napomena radnika', report.note) : '',
        has('napomene')
          ? textBlock(
              `Poruka admina${report.noteAuthor?.full_name ? ` · ${report.noteAuthor.full_name}` : ''}`,
              report.admin_note,
            )
          : '',
        has('popis') ? heading('Popis artikala', `ukupno prodato ${formatQty(soldTotal)}`) : '',
        has('popis') ? table({ columns, rows, empty: 'Popis je prazan.' }) : '',
      ].join(''),
    })
  }

  if (loading) return <FullPageLoader />

  if (!report) {
    return (
      <Card>
        <EmptyState
          icon="🔍"
          title="Izveštaj nije pronađen"
          description="Možda je obrisan ili nemaš pristup ovom izveštaju."
          action={<Button onClick={() => navigate('/')}>Nazad na početnu</Button>}
        />
      </Card>
    )
  }

  const isOwner = report.created_by === profile?.id
  const staffList = (report.staff ?? [])
    .filter((s) => s.profile?.id)
    .sort((a, b) => String(a.profile.full_name).localeCompare(String(b.profile.full_name)))
  const staffNames = staffList.map((s) => s.profile.full_name)

  return (
    <div className="space-y-4 pb-28">
      {/* ---------- Zaglavlje ---------- */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-extrabold text-stone-900">
                {formatDate(report.report_date)}
              </h1>
              <Badge className={SHIFT_STYLES[report.shift] ?? SHIFT_STYLES.prva}>
                {SHIFT_LABELS[report.shift]}
              </Badge>
              <Badge className={STATUS_STYLES[report.status]}>{STATUS_LABELS[report.status]}</Badge>
            </div>
            <p className="mt-1 text-[12px] text-stone-400">
              {report.creator?.full_name || '—'} · {formatDateTime(report.created_at)}
            </p>
            {report.status === 'potvrdjen' && report.verified_at && (
              <p className="mt-1 text-[12px] font-medium text-emerald-700">
                Potvrdio {report.verifier?.full_name || 'admin'} ·{' '}
                {formatDateTime(report.verified_at)}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* Potvrđen popis radnik ne preuzima — nema šta da se odštampa. */}
            {!lockedForWorker && (
              <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                Preuzmi
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => navigate(-1)}>
              ← Nazad
            </Button>
          </div>
        </div>

        {lockedForWorker ? (
          /* Potvrđen popis — radnik više ne vidi iznose. */
          <div className="border-t border-stone-200 p-4">
            <p className="eyebrow">
              Obračun smene
            </p>
            <p className="mt-1.5 text-sm text-stone-500">
              Popis je potvrđen — iznose od sada vidi samo admin.
            </p>
          </div>
        ) : (
          <div className="space-y-3 border-t border-stone-200 p-4">
            <p className="eyebrow">
              Obračun smene
            </p>

            {/* Pazar, kartice, pa predato — predato = pazar − kartice. */}
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Pazar" value={formatMoney(report.total_amount, false)} tone="total" />
              <Stat label="Kartice" value={formatMoney(report.card_amount, false)} />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3.5 text-white">
              <p className="eyebrow text-stone-400">Predato</p>
              <p className="text-2xl font-extrabold tabular-nums">
                {formatMoney(report.cash_amount, false)}
              </p>
            </div>
          </div>
        )}

        <div className="border-t border-stone-200 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">
              U smeni radili
            </p>
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={openStaffEditor}>
                Izmeni
              </Button>
            )}
          </div>
          {/* Radnik vidi samo imena. Admin vidi i dnevnicu za taj dan, sa
              dugmetom kojim je umanjuje baš za ovu smenu. */}
          {isAdmin ? (
            staffList.length > 0 ? (
              <ul className="mt-1.5 divide-y divide-stone-100">
                {staffList.map((entry) => {
                  const cut = entry.wage_override !== null && entry.wage_override !== undefined
                  const plata = entry.profile?.pay_model === 'plata'
                  return (
                    <li
                      key={entry.profile.id}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-800">
                        {entry.profile.full_name}
                      </span>
                      {!plata && (
                        <span className="shrink-0 text-[13px] tabular-nums">
                          {cut ? (
                            <>
                              <span className="text-stone-400 line-through">
                                {formatMoney(entry.profile.daily_wage, false)}
                              </span>{' '}
                              <b className="text-rose-600">
                                {formatMoney(entry.wage_override, false)}
                              </b>
                            </>
                          ) : (
                            <span className="text-stone-500">
                              {formatMoney(entry.profile.daily_wage, false)}
                            </span>
                          )}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() => openWageEditor(entry)}
                      >
                        {cut ? 'Izmeni' : 'Umanji'}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <span className="text-sm text-stone-400">—</span>
            )
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {staffNames.length > 0 ? (
                staffNames.map((name) => (
                  <Badge key={name} className="bg-stone-100 text-stone-700 ring-stone-300">
                    {name}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-stone-400">—</span>
              )}
            </div>
          )}
        </div>

        {/* Da li je radnik štiklirao dnevnu obavezu za ovu smenu */}
        <div className="flex items-center justify-between gap-3 border-t border-stone-200 px-4 py-3">
          <p className="eyebrow">
            Dnevna obaveza
          </p>
          {report.daily_task_done ? (
            <Badge className="bg-emerald-100 text-emerald-800 ring-emerald-600/20">urađena</Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-800 ring-amber-600/20">
              nije štiklirana
            </Badge>
          )}
        </div>

        {report.note && !lockedForWorker && (
          <div className="border-t border-stone-200 px-4 py-3">
            <p className="eyebrow">
              Napomena za admina
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{report.note}</p>
          </div>
        )}

        {(report.admin_note || isAdmin) && !lockedForWorker && (
          <div
            className={cx(
              'border-t border-stone-200 px-4 py-3',
              report.admin_note && 'bg-amber-50',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p
                className={cx(
                  'text-xs font-semibold uppercase tracking-wide',
                  report.admin_note ? 'text-amber-700' : 'text-stone-500',
                )}
              >
                {report.admin_note
                  ? `Poruka · ${report.noteAuthor?.full_name || 'Admin'}`
                  : 'Poruka radniku'}
              </p>
              {isAdmin && (
                <Button variant="ghost" size="sm" onClick={() => setNoteOpen(true)}>
                  {report.admin_note ? 'Izmeni' : 'Napiši'}
                </Button>
              )}
            </div>

            {report.admin_note ? (
              <>
                <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">
                  {report.admin_note}
                </p>
                {report.admin_note_at && (
                  <p className="mt-1 text-[11px] text-amber-700/70">
                    {formatDateTime(report.admin_note_at)}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-stone-400">
                Radnik će je videti uz ovaj izveštaj.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Potvrđen popis radnik više ne pregleda — ostaju mu samo datum,
          poruka o iznosima, ko je radio i dnevna obaveza. */}
      {!lockedForWorker && (
        <>
      {/* ---------- Slike ---------- */}
      <Card>
        <CardHeader
          title="Slike izveštaja"
          subtitle={imageUrls.length > 0 ? String(imageUrls.length) : undefined}
        />
        {imageUrls.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-stone-400">Nema slika.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
            {imageUrls.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setLightbox(img.url)}
                className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-stone-200 bg-stone-50"
              >
                <img
                  src={img.url}
                  alt="Slika izveštaja sa kase i aparata za kartice"
                  loading="lazy"
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
                <span className="absolute inset-x-0 bottom-0 bg-stone-900/60 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
                  Uvećaj
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* ---------- Popis ---------- */}
      <Card>
        <CardHeader
          title="Popis artikala"
          subtitle={`${itemCounts.sve - itemCounts.nepopisano}/${
            itemCounts.sve
          } · prodato ${formatQty(soldTotal)}`}
          action={
            itemFilter === 'sve' ? (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() =>
                  setOpenCats(
                    openCats.size > 0 ? new Set() : new Set(groupedItems.map(([cat]) => cat)),
                  )
                }
              >
                {openCats.size > 0 ? 'Zatvori sve' : 'Otvori sve'}
              </Button>
            ) : null
          }
        />

        {/* Filter: svi artikli / nije popisano / popisano, a nije prodato */}
        {groupedItems.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-stone-100 px-4 py-2.5">
            {[
              ['sve', 'Svi artikli'],
              ['nepopisano', 'Nije popisano'],
              ['nije', 'Nije prodato'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setItemFilter(key)}
                aria-pressed={itemFilter === key}
                className={cx(
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                  itemFilter === key
                    ? 'bg-brand-600 text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200',
                )}
              >
                {label} <span className="tabular-nums opacity-75">{itemCounts[key]}</span>
              </button>
            ))}
          </div>
        )}

        {groupedItems.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-stone-500">Popis je prazan.</p>
        ) : visibleGroups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-stone-500">
            {itemFilter === 'nepopisano'
              ? 'Popisani su svi artikli.'
              : 'Svaki popisan artikal je prodat bar jednom.'}
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {visibleGroups.map(([category, catItems]) => {
              // U filtriranom prikazu kategorije su odmah otvorene — da se vidi šta je izdvojeno.
              const open = itemFilter !== 'sve' || openCats.has(category)
              const catSold = catItems.reduce((s, i) => s + Number(i.qty_sold ?? 0), 0)
              const catMissing = catItems.filter((i) => i.missing).length

              return (
                <div key={category}>
                  <CategoryToggle
                    title={category}
                    open={open}
                    onToggle={() => toggleCat(category)}
                    right={
                      itemFilter === 'sve' ? (
                        <span className="flex shrink-0 items-center gap-2">
                          {catMissing > 0 && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                              {catMissing} nepopisano
                            </span>
                          )}
                          <span className="text-xs font-semibold tabular-nums text-stone-500">
                            prodato {formatQty(catSold)}
                          </span>
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-stone-500">
                          {countLabel(catItems.length, 'artikal')}
                        </span>
                      )
                    }
                  />

                  {open && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[500px] border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-stone-100 text-[10px] font-bold uppercase tracking-wide text-stone-400">
                            <th className="px-4 py-2 text-left">Artikal</th>
                            <th className="px-2 py-2 text-right">Početno</th>
                            <th className="px-2 py-2 text-right">Dodato</th>
                            <th className="px-2 py-2 text-right">Novo</th>
                            <th className="px-2 py-2 text-right">Prodato</th>
                            <th className="px-4 py-2 text-right">Krajnje</th>
                          </tr>
                        </thead>
                        <tbody>
                          {catItems.map((item) => (
                            <tr
                              key={item.key}
                              className={cx(
                                'border-t border-stone-100',
                                item.missing && 'bg-amber-50/60',
                              )}
                            >
                              <td className="px-4 py-2">
                                <span
                                  className={cx(
                                    'font-medium',
                                    item.missing ? 'text-stone-500' : 'text-stone-800',
                                  )}
                                >
                                  {item.item_name}
                                </span>
                                <span className="ml-1.5 text-xs text-stone-400">{item.unit}</span>
                                {item.missing && (
                                  <span className="ml-2 text-[11px] font-semibold text-amber-700">
                                    nije popisano
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-stone-500">
                                {formatQty(item.qty_start)}
                              </td>
                              {/* Brojač se ne dopunjava — „dodato“ i „novo
                                  stanje“ kod njega nemaju smisla. */}
                              <td className="px-2 py-2 text-right tabular-nums text-stone-500">
                                {item.is_counter ? '—' : formatQty(item.qty_added)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-stone-500">
                                {item.is_counter ? '—' : formatQty(item.qty_new)}
                              </td>
                              <td
                                className={cx(
                                  'px-2 py-2 text-right font-extrabold tabular-nums',
                                  Number(item.qty_sold) < 0
                                    ? 'text-rose-600'
                                    : isUnsold(item)
                                      ? 'text-stone-300' // popisano, a nije prodato
                                      : 'text-stone-900',
                                )}
                              >
                                {formatQty(item.qty_sold)}
                              </td>
                              <td className="px-4 py-2 text-right font-semibold tabular-nums text-stone-700">
                                {formatQty(item.qty_end)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
        </>
      )}

      {/* ---------- Radnje admina ---------- */}
      {isAdmin && (
        {/* Traka stoji tačno iznad donje navigacije. Na iPhone-u je navigacija
            viša za prostor iznad crte za gašenje aplikacije — bez
            `safe-area-inset-bottom` traka bi upala pod nju. Na računaru nema
            navigacije, pa ide na dno, sa malo vazduha ispod dugmadi. */}
        <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom,0px))] z-20 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:py-4 lg:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
            {report.status !== 'potvrdjen' ? (
              <Button
                variant="success"
                size="lg"
                loading={working}
                onClick={() => changeStatus('potvrdjen')}
                className="flex-1 sm:flex-none"
              >
                ✅ Potvrdi popis
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="lg"
                loading={working}
                onClick={() => changeStatus('poslat')}
                className="flex-1 sm:flex-none"
              >
                Poništi potvrdu
              </Button>
            )}

            <Button
              variant="secondary"
              size="lg"
              onClick={() => setReturnOpen(true)}
              disabled={working}
            >
              ↩︎ Vrati na ispravku
            </Button>

            <Button
              variant="ghost"
              size="lg"
              className="ml-auto text-rose-600"
              onClick={() => setDeleteOpen(true)}
              disabled={working}
            >
              Obriši
            </Button>
          </div>
        </div>
      )}

      {!isAdmin && isOwner && report.status === 'vracen' && (
        <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-inset ring-rose-200">
          Admin je vratio ovaj popis na ispravku. Pošalji novi, ispravan popis za ovu smenu.
        </div>
      )}

      {/* ---------- Modali ---------- */}
      <ReportPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={`Preuzmi popis — ${formatDate(report.report_date)}`}
        options={[
          { key: 'obracun', label: lockedForWorker ? 'Podaci o smeni' : 'Obračun smene' },
          { key: 'popis', label: 'Popis artikala' },
          { key: 'napomene', label: 'Napomene' },
        ]}
        onConfirm={printReport}
      />

      <Modal
        open={staffOpen}
        onClose={() => !working && setStaffOpen(false)}
        title="Ko je radio u ovoj smeni"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setStaffOpen(false)}>
              Otkaži
            </Button>
            <Button className="flex-1" loading={working} onClick={saveStaff}>
              Sačuvaj
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-stone-600">
          Svako označen dobija punu dnevnicu za ovu smenu.
        </p>
        <div className="space-y-1">
          {allWorkers.map((w) => {
            const on = staffDraft.includes(w.id)
            return (
              <button
                key={w.id}
                type="button"
                onClick={() =>
                  setStaffDraft((prev) =>
                    on ? prev.filter((x) => x !== w.id) : [...prev, w.id],
                  )
                }
                className={cx(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                  on
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-stone-200 bg-white hover:bg-stone-50',
                )}
              >
                <span
                  className={cx(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                    on ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-400',
                  )}
                >
                  {on ? '✓' : ''}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-800">
                  {w.full_name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-stone-500">
                  {formatMoney(w.daily_wage, false)}
                </span>
              </button>
            )
          })}
          {allWorkers.length === 0 && (
            <p className="py-6 text-center text-sm text-stone-500">Učitavanje…</p>
          )}
        </div>
      </Modal>

      {/* ================================================================ */}
      {/*  Modal: umanjena dnevnica za ovaj dan                            */}
      {/* ================================================================ */}
      <Modal
        open={!!wageEdit}
        onClose={() => !working && setWageEdit(null)}
        title={`Dnevnica — ${wageEdit?.name ?? ''}`}
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={working}
              onClick={() => saveWage(null)}
            >
              Puna dnevnica
            </Button>
            <Button
              className="flex-1"
              loading={working}
              disabled={wageEdit?.value === ''}
              onClick={() => saveWage(parseNumber(wageEdit.value))}
            >
              Sačuvaj
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-stone-100 px-4 py-2.5">
            <p className="eyebrow">Redovna dnevnica</p>
            <p className="text-sm font-bold tabular-nums text-stone-900">
              {formatMoney(wageEdit?.full ?? 0, false)}
            </p>
          </div>

          <Field label="Za ovaj dan">
            <MoneyInput
              value={wageEdit?.value ?? ''}
              onChange={(v) => setWageEdit((w) => ({ ...w, value: v }))}
            />
          </Field>

          <p className="hint">Važi samo za {formatDate(report.report_date)}.</p>
        </div>
      </Modal>

      {/* Poruka radniku — nezavisno od vraćanja na ispravku */}
      <Modal
        open={noteOpen}
        onClose={() => !working && setNoteOpen(false)}
        title={report.admin_note ? 'Izmeni poruku' : 'Poruka radniku'}
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={working}
              onClick={() => {
                setAdminNote(report.admin_note ?? '')
                setNoteOpen(false)
              }}
            >
              Otkaži
            </Button>
            <Button className="flex-1" loading={working} onClick={saveAdminNote}>
              Sačuvaj
            </Button>
          </div>
        }
      >
        <Field
          label="Šta želiš da mu poručiš?"
          hint={`Potpisuje se tvojim imenom (${profile?.full_name || '—'}). Prazno polje briše poruku.`}
        >
          <Textarea
            rows={4}
            placeholder="npr. Odlično odrađeno. Sledeći put upiši i stanje za vino."
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
          />
        </Field>
      </Modal>

      <Modal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="Vrati popis na ispravku"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setReturnOpen(false)}>
              Otkaži
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={working}
              onClick={() => changeStatus('vracen', adminNote.trim())}
            >
              Vrati radniku
            </Button>
          </div>
        }
      >
        <Field label="Šta treba ispraviti?" hint="Radnik će videti ovu poruku uz izveštaj.">
          <Textarea
            rows={4}
            placeholder="npr. Fali stanje za točeno pivo i slika izveštaja je mutna."
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
          />
        </Field>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Obriši izveštaj"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteOpen(false)}>
              Otkaži
            </Button>
            <Button variant="danger" className="flex-1" loading={working} onClick={handleDelete}>
              Obriši
            </Button>
          </div>
        }
      >
        <p className="text-sm text-stone-600">
          Sa njim nestaje i njegov <strong>pazar</strong> — iz Pregleda, iz Uplata i iz dnevnica.
        </p>
        <p className="mt-2 text-[13px] text-stone-400">
          Čuva se još <strong>12 sati</strong> — do tada ga vraćaš u{' '}
          <strong>Pregled → Obrisani popisi</strong>. Posle toga se briše trajno, zajedno sa
          slikama.
        </p>
      </Modal>

      {/* ---------- Uvećana slika ---------- */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/90 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Slika izveštaja sa kase i aparata za kartice"
            className="max-h-full max-w-full rounded-lg object-contain"
          />
          <button
            type="button"
            className={cx(
              'absolute right-4 top-4 flex h-10 w-10 items-center justify-center',
              'rounded-full bg-white/15 text-2xl text-white backdrop-blur',
            )}
            aria-label="Zatvori"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
