import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { useToast, useToastOffset } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { buildStoragePath, compressImage } from '../lib/image'
import { categoryComparator, loadCategories } from '../lib/categories'
import { dailyTaskFor } from '../lib/rules'
import Avatar from '../components/Avatar'
import RuleText from '../components/RuleText'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CategoryToggle,
  Field,
  FullPageLoader,
  Input,
  Modal,
  MoneyInput,
  Select,
  Textarea,
} from '../components/ui'
import {
  SHIFTS,
  SHIFT_LABELS,
  countLabel,
  cx,
  errorMessage,
  formatDate,
  formatMoney,
  formatMoneyShort,
  formatQty,
  parseNumber,
  plural,
  todayISO,
} from '../lib/utils'

/** Koliko se čeka posle poslednjeg kucanja pre upisa u bazu. */
const SAVE_DEBOUNCE_MS = 600

/**
 * Prazan red popisa: početno stanje, dodato, prodato.
 *
 * Radnik upisuje PRODATO, a KRAJNJE STANJE se računa:
 *   krajnje = (početno + dodato) − prodato
 * U bazi se i dalje čuva krajnje stanje (qty_end), a prodato (qty_sold) baza
 * izračuna sama — tako svi izveštaji i zbirovi rade kao i ranije.
 */
const EMPTY_ROW = { s: '', d: '', p: '' }

const COLUMNS = [
  { key: 's', short: 'Poč.', label: 'Početno stanje' },
  { key: 'd', short: 'Dod.', label: 'Dodato' },
  { key: 'p', short: 'Prod.', label: 'Prodato' },
]

const round2 = (n) => Math.round(n * 100) / 100

/** Broj iz baze u tekst za polje. NULL znači „nije upisano“ → prazno polje. */
function toField(value) {
  if (value === null || value === undefined) return ''
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : ''
}

/** Tekst iz polja u broj za bazu. Prazno polje → NULL, a ne nula. */
function toDb(value) {
  if (value === '' || value === null || value === undefined) return null
  const num = parseFloat(String(value).replace(',', '.'))
  return Number.isFinite(num) && num >= 0 ? num : null
}

/** Krajnje stanje = (početno + dodato) − prodato. */
function endOf(row) {
  return round2(parseNumber(row.s) + parseNumber(row.d) - parseNumber(row.p))
}

/** Red iz baze (početno, dodato, krajnje) u polja popisa (početno, dodato, prodato). */
function rowFromDb(dbRow) {
  const hasEnd = dbRow.qty_end !== null && dbRow.qty_end !== undefined
  const sold = hasEnd
    ? round2((Number(dbRow.qty_start) || 0) + (Number(dbRow.qty_added) || 0) - Number(dbRow.qty_end))
    : null
  return {
    s: toField(dbRow.qty_start),
    d: toField(dbRow.qty_added),
    p: toField(sold),
  }
}

/**
 * Radnik upisuje PAZAR i KARTICE (oba stoje na traci sa kase), a PREDATO se
 * računa: pazar − kartice. U bazi se i dalje čuvaju gotovina (= predato) i
 * kartice, pa se pri učitavanju pazar vraća kao njihov zbir.
 */
function moneyFields(rep) {
  const cash = Number(rep.cash_amount) || 0
  const card = Number(rep.card_amount) || 0
  return {
    pazar: cash + card ? String(Math.round((cash + card) * 100) / 100) : '',
    card: card ? String(card) : '',
  }
}

/** Popisan artikal = upisano mu je prodato (i 0 se računa). */
const isDone = (row) => (row?.p ?? '') !== ''

/** Započet artikal = uneto mu je početno stanje ili dodato. */
const isStarted = (row) => (row?.s ?? '') !== '' || (row?.d ?? '') !== ''

export default function NewReport() {
  const { profile } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const fileInputRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [people, setPeople] = useState([])
  const [ruleDocs, setRuleDocs] = useState([]) // odatle se čita dnevna obaveza za dan smene

  /* Izbor smene — zaključava se čim se uđe u nju. */
  const [reportDate, setReportDate] = useState(todayISO())
  const [shift, setShift] = useState('prva')

  /* Otvorena smena */
  const [reportId, setReportId] = useState(null)
  const [status, setStatus] = useState(null)
  const [staff, setStaff] = useState([])
  const [rows, setRows] = useState({}) // { itemId: { s, d, p } } — p = prodato
  const [pazar, setPazar] = useState('') // ukupan pazar sa kase
  const [card, setCard] = useState('')
  const [note, setNote] = useState('')
  const [taskDone, setTaskDone] = useState(false) // dnevna obaveza urađena u ovoj smeni
  const [images, setImages] = useState([])

  /* Šta već postoji za izabrani datum i smenu — od toga zavisi da li se
     smena OTVARA ili se u nju ULAZI. */
  const [peek, setPeek] = useState(null) // null = još se proverava
  const [joining, setJoining] = useState(false)
  const [saveState, setSaveState] = useState('saved') // saved | saving | error
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [search, setSearch] = useState('')
  const [openCats, setOpenCats] = useState(() => new Set())
  // Pazar se otvara klikom, kao kategorije — zbir se vidi i kad je zatvoren.
  const [pazarOpen, setPazarOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)

  /* Reference — potrebne unutar odloženih upisa i poruka sa servera, gde
     stanje iz React-a može da bude zastarelo. */
  const reportIdRef = useRef(null)
  const itemsRef = useRef([])
  const rowsRef = useRef({})
  const dirtyItems = useRef(new Set()) // stavke sa još neupisanim izmenama
  const dirtyFields = useRef(new Set()) // 'money' | 'note' | 'task'
  const itemTimers = useRef(new Map())
  const fieldTimer = useRef(null)

  useEffect(() => {
    reportIdRef.current = reportId
  }, [reportId])
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const editable = status === 'otvoren' || status === 'vracen'
  const closed = status === 'poslat' || status === 'potvrdjen'

  // Dok stoji traka „Zatvori smenu“ (iznad donje navigacije), obaveštenja idu iznad nje.
  useToastOffset(134, !!reportId && editable)

  /* ------------------------------------------------------------ */
  /*  Učitavanje artikala, kategorija i imena                      */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    let active = true

    async function load() {
      const [itemsRes, cats, peopleRes, rulesRes] = await Promise.all([
        supabase
          .from('items')
          .select('id, name, category, unit, sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        loadCategories().catch(() => []),
        supabase.from('profiles').select('id, full_name, avatar_path'),
        supabase.from('rule_docs').select('title, body'),
      ])

      if (!active) return
      if (itemsRes.error) toast.error(errorMessage(itemsRes.error))
      else setItems(itemsRes.data ?? [])
      setCategories(cats)
      setPeople(peopleRes.data ?? [])
      setRuleDocs(rulesRes.data ?? [])
      setLoading(false)
    }

    load()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------------------------------------ */
  /*  Nastavak smene koja je već otvorena                          */
  /*  Ako je radnik već ušao u smenu pa zatvorio aplikaciju, vraća  */
  /*  ga pravo u nju — ne pravi se nova.                           */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    if (!profile?.id) return
    let active = true

    supabase
      .from('shift_reports')
      .select('id, report_date, shift, shift_report_staff!inner(profile_id)')
      .eq('shift_report_staff.profile_id', profile.id)
      .in('status', ['otvoren', 'vracen'])
      .order('report_date', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!active || !data?.length) return
        setReportDate(data[0].report_date)
        setShift(data[0].shift)
        setReportId(data[0].id)
      })

    return () => {
      active = false
    }
  }, [profile?.id])

  /* ------------------------------------------------------------ */
  /*  Postoji li već smena za izabrani datum?                      */
  /*  Radnik po RLS pravilima ne vidi tuđu smenu, pa se pita        */
  /*  funkcija `peek_shift` koja vraća samo status i imena.         */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    if (reportId || !reportDate) return undefined
    let active = true
    setPeek(null)

    supabase
      .rpc('peek_shift', { p_date: reportDate, p_shift: shift })
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          console.error(error)
          setPeek({ exists: false })
          return
        }
        const row = data?.[0]
        setPeek(
          row
            ? { exists: true, status: row.report_status, names: row.staff_names ?? [] }
            : { exists: false },
        )
      })

    return () => {
      active = false
    }
  }, [reportDate, shift, reportId])

  /* ------------------------------------------------------------ */
  /*  Učitavanje otvorene smene                                    */
  /* ------------------------------------------------------------ */
  const loadImages = useCallback(async (id) => {
    const { data } = await supabase
      .from('report_images')
      .select('id, storage_path')
      .eq('report_id', id)
      .order('created_at', { ascending: true })

    const list = data ?? []
    if (list.length === 0) return setImages([])

    const { data: signed } = await supabase.storage
      .from('izvestaji')
      .createSignedUrls(
        list.map((r) => r.storage_path),
        60 * 60 * 2,
      )

    setImages(list.map((row, i) => ({ ...row, url: signed?.[i]?.signedUrl ?? null })))
  }, [])

  const loadStaff = useCallback(async (id) => {
    const { data } = await supabase
      .from('shift_report_staff')
      .select('profile_id')
      .eq('report_id', id)
    setStaff((data ?? []).map((r) => r.profile_id))
  }, [])

  const loadReport = useCallback(
    async (id) => {
      const [repRes, itemsRes] = await Promise.all([
        supabase
          .from('shift_reports')
          .select('id, report_date, shift, status, cash_amount, card_amount, note, daily_task_done')
          .eq('id', id)
          .single(),
        supabase
          .from('shift_report_items')
          .select('item_id, qty_start, qty_added, qty_end')
          .eq('report_id', id),
      ])

      if (repRes.error) {
        toast.error(errorMessage(repRes.error, 'Ne mogu da učitam smenu.'))
        return
      }

      const rep = repRes.data
      setStatus(rep.status)
      setReportDate(rep.report_date)
      setShift(rep.shift)
      const money = moneyFields(rep)
      setPazar(money.pazar)
      setCard(money.card)
      setNote(rep.note ?? '')
      setTaskDone(!!rep.daily_task_done)

      const next = {}
      for (const row of itemsRes.data ?? []) {
        next[row.item_id] = rowFromDb(row)
      }
      setRows(next)

      await Promise.all([loadStaff(id), loadImages(id)])
    },
    [loadStaff, loadImages, toast],
  )

  useEffect(() => {
    if (reportId) loadReport(reportId)
  }, [reportId, loadReport])

  /* ------------------------------------------------------------ */
  /*  Uživo — šta kolega upiše, vidi se odmah                      */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    if (!reportId) return undefined

    const channel = supabase
      .channel(`smena-${reportId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shift_report_items',
          filter: `report_id=eq.${reportId}`,
        },
        (payload) => {
          const itemId = payload.new?.item_id ?? payload.old?.item_id
          if (!itemId) return
          // Polje koje ovaj radnik upravo kuca se ne dira — inače bi mu se
          // unos vratio unazad dok piše.
          if (dirtyItems.current.has(itemId)) return

          setRows((prev) => {
            const next = { ...prev }
            if (payload.eventType === 'DELETE') delete next[itemId]
            else next[itemId] = rowFromDb(payload.new)
            return next
          })
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'shift_reports',
          filter: `id=eq.${reportId}`,
        },
        (payload) => {
          const rep = payload.new
          setStatus(rep.status)
          if (!dirtyFields.current.has('money')) {
            const money = moneyFields(rep)
            setPazar(money.pazar)
            setCard(money.card)
          }
          if (!dirtyFields.current.has('note')) setNote(rep.note ?? '')
          // Kad kolega štiklira dnevnu obavezu, vidi se i ovde.
          if (!dirtyFields.current.has('task')) setTaskDone(!!rep.daily_task_done)
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shift_report_staff',
          filter: `report_id=eq.${reportId}`,
        },
        () => loadStaff(reportId),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'report_images',
          filter: `report_id=eq.${reportId}`,
        },
        () => loadImages(reportId),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [reportId, loadStaff, loadImages])

  /* ------------------------------------------------------------ */
  /*  Upis u bazu                                                  */
  /* ------------------------------------------------------------ */
  const saveItem = useCallback(
    async (itemId) => {
      const id = reportIdRef.current
      if (!id) return

      const item = itemsRef.current.find((i) => i.id === itemId)
      const row = rowsRef.current[itemId] ?? EMPTY_ROW
      const blank = !isStarted(row) && !isDone(row)

      // Prodato veće od novog stanja → krajnje bi bilo negativno. Takav red se
      // ne upisuje dok se ne ispravi (ostaje „neupisan“, pa ga kolega ne pregazi).
      if (isDone(row) && endOf(row) < 0) return

      let error = null
      if (blank) {
        // Sve obrisano — briše se i red, da artikal ne ostane „popisan nulama“.
        ;({ error } = await supabase
          .from('shift_report_items')
          .delete()
          .eq('report_id', id)
          .eq('item_id', itemId))
      } else if (item) {
        ;({ error } = await supabase.from('shift_report_items').upsert(
          {
            report_id: id,
            item_id: itemId,
            item_name: item.name,
            unit: item.unit,
            category: item.category,
            qty_start: toDb(row.s),
            qty_added: toDb(row.d),
            // Krajnje stanje se računa iz upisanog prodatog.
            qty_end: isDone(row) ? endOf(row) : null,
          },
          { onConflict: 'report_id,item_id' },
        ))
      }

      dirtyItems.current.delete(itemId)
      if (error) {
        console.error(error)
        setSaveState('error')
      } else if (dirtyItems.current.size === 0 && dirtyFields.current.size === 0) {
        setSaveState('saved')
      }
    },
    [],
  )

  const saveFields = useCallback(async () => {
    const id = reportIdRef.current
    if (!id) return

    const payload = {}
    let moneyWaits = false
    if (dirtyFields.current.has('money')) {
      const p = parseNumber(pazarRef.current)
      const k = parseNumber(cardRef.current)
      // Predato = pazar − kartice. Dok su kartice veće od pazara (radnik još
      // kuca), iznosi se ne upisuju — upisaće se čim se isprave.
      if (k <= p) {
        payload.cash_amount = Math.round((p - k) * 100) / 100
        payload.card_amount = k
      } else {
        moneyWaits = true
      }
    }
    if (dirtyFields.current.has('note')) payload.note = noteRef.current.trim()
    if (dirtyFields.current.has('task')) payload.daily_task_done = taskRef.current

    dirtyFields.current.clear()
    if (moneyWaits) dirtyFields.current.add('money')
    if (Object.keys(payload).length === 0) return

    const { error } = await supabase.from('shift_reports').update(payload).eq('id', id)

    if (error) {
      console.error(error)
      setSaveState('error')
    } else if (dirtyItems.current.size === 0 && !moneyWaits) {
      setSaveState('saved')
    }
  }, [])

  /* Svež sadržaj polja za odloženi upis */
  const pazarRef = useRef('')
  const cardRef = useRef('')
  const noteRef = useRef('')
  const taskRef = useRef(false)
  useEffect(() => {
    taskRef.current = taskDone
  }, [taskDone])
  useEffect(() => {
    pazarRef.current = pazar
  }, [pazar])
  useEffect(() => {
    cardRef.current = card
  }, [card])
  useEffect(() => {
    noteRef.current = note
  }, [note])

  function setCell(itemId, key, value) {
    setRows((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? EMPTY_ROW), [key]: value },
    }))

    dirtyItems.current.add(itemId)
    setSaveState('saving')

    clearTimeout(itemTimers.current.get(itemId))
    itemTimers.current.set(
      itemId,
      setTimeout(() => saveItem(itemId), SAVE_DEBOUNCE_MS),
    )
  }

  function markField(field) {
    dirtyFields.current.add(field)
    setSaveState('saving')
    clearTimeout(fieldTimer.current)
    fieldTimer.current = setTimeout(saveFields, SAVE_DEBOUNCE_MS)
  }

  /** Upisuje sve što čeka — pre zatvaranja smene. */
  const flushPending = useCallback(async () => {
    for (const timer of itemTimers.current.values()) clearTimeout(timer)
    itemTimers.current.clear()
    clearTimeout(fieldTimer.current)

    const pending = [...dirtyItems.current]
    await Promise.all(pending.map((id) => saveItem(id)))
    if (dirtyFields.current.size > 0) await saveFields()
  }, [saveItem, saveFields])

  useEffect(
    () => () => {
      for (const timer of itemTimers.current.values()) clearTimeout(timer)
      clearTimeout(fieldTimer.current)
    },
    [],
  )

  /* ------------------------------------------------------------ */
  /*  Ulazak i izlazak iz smene                                    */
  /* ------------------------------------------------------------ */
  /* Smena već postoji i traje → ULAZI se u nju.
     Smene nema → OTVARA se nova.
     Smena postoji, ali je zatvorena → ne može ni jedno ni drugo. */
  const joinsExisting = peek?.exists === true && peek.status === 'otvoren'
  const shiftTaken = peek?.exists === true && peek.status !== 'otvoren'

  async function joinShift() {
    if (!reportDate) return toast.error('Izaberi datum smene.')

    setJoining(true)
    const { data, error } = await supabase.rpc('open_or_join_shift', {
      p_date: reportDate,
      p_shift: shift,
    })
    setJoining(false)

    if (error) return toast.error(errorMessage(error, 'Ne mogu da uđem u smenu.'))
    setReportId(data)
    toast.success(
      joinsExisting ? 'Ušao si u smenu — dnevnica ti se računa.' : 'Smena je otvorena.',
    )
  }

  async function leaveShift() {
    const { error } = await supabase
      .from('shift_report_staff')
      .delete()
      .eq('report_id', reportId)
      .eq('profile_id', profile.id)

    if (error) return toast.error(errorMessage(error))

    setLeaveOpen(false)
    setReportId(null)
    setStatus(null)
    setStaff([])
    setRows({})
    setImages([])
    setPazar('')
    setCard('')
    setNote('')
    setTaskDone(false)
    toast.info('Izašao si iz smene — dnevnica se više ne računa.')
  }

  /* ------------------------------------------------------------ */
  /*  Izvedene vrednosti                                           */
  /* ------------------------------------------------------------ */
  const searching = search.trim() !== ''
  const isCatOpen = (category) => searching || openCats.has(category)

  function toggleCat(category) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = term
      ? items.filter(
          (i) => i.name.toLowerCase().includes(term) || i.category.toLowerCase().includes(term),
        )
      : items

    const map = new Map()
    for (const item of filtered) {
      if (!map.has(item.category)) map.set(item.category, [])
      map.get(item.category).push(item)
    }
    // Redosled kategorija je onaj koji je vlasnik podesio u Artikli -> Kategorije.
    const compare = categoryComparator(categories)
    return Array.from(map.entries()).sort((a, b) => compare(a[0], b[0]))
  }, [items, search, categories])

  const doneCount = useMemo(() => items.filter((i) => isDone(rows[i.id])).length, [items, rows])

  /** Započeti, a nedovršeni — smena se sa njima ne može zatvoriti. */
  const missingSold = useMemo(
    () => items.filter((i) => isStarted(rows[i.id]) && !isDone(rows[i.id])),
    [items, rows],
  )

  /** Artikli kod kojih je prodato veće od novog stanja — greška u unosu. */
  const errorCount = useMemo(
    () => items.filter((i) => isDone(rows[i.id]) && endOf(rows[i.id]) < 0).length,
    [items, rows],
  )

  // Pazar i kartice upisuje radnik, predato = pazar − kartice.
  const pazarNum = parseNumber(pazar)
  const cardNum = parseNumber(card)
  const cashNum = Math.round((pazarNum - cardNum) * 100) / 100
  const cardTooBig = cardNum > pazarNum

  /** Šta je dnevna obaveza za dan u kome je smena (iz „Dnevnih obaveza“). */
  const dailyTask = useMemo(() => dailyTaskFor(ruleDocs, reportDate), [ruleDocs, reportDate])

  const staffNames = useMemo(
    () =>
      staff.map((id) => {
        const p = people.find((x) => x.id === id)
        return { id, name: p?.full_name ?? 'Radnik', avatar_path: p?.avatar_path ?? null }
      }),
    [staff, people],
  )

  /* ------------------------------------------------------------ */
  /*  Slike — šalju se odmah, da ih vidi i kolega                  */
  /* ------------------------------------------------------------ */
  async function handleFiles(e) {
    const selected = Array.from(e.target.files ?? [])
    e.target.value = '' // dozvoli ponovni izbor istog fajla
    if (selected.length === 0 || !reportId) return

    const room = 6 - images.length
    if (room <= 0) return toast.info('Možeš dodati najviše 6 slika po smeni.')
    if (selected.length > room) toast.info('Možeš dodati najviše 6 slika po smeni.')

    setUploading(true)
    for (let i = 0; i < Math.min(selected.length, room); i += 1) {
      try {
        const compressed = await compressImage(selected[i])
        const path = buildStoragePath(reportId, compressed, images.length + i)

        const { error: uploadError } = await supabase.storage
          .from('izvestaji')
          .upload(path, compressed, { contentType: compressed.type, upsert: false })
        if (uploadError) throw uploadError

        const { error: rowError } = await supabase.from('report_images').insert({
          report_id: reportId,
          storage_path: path,
          uploaded_by: profile.id,
        })
        if (rowError) throw rowError
      } catch (err) {
        console.error(err)
        toast.error(errorMessage(err, 'Slanje slike nije uspelo.'))
      }
    }
    setUploading(false)
    loadImages(reportId)
  }

  async function removeImage(image) {
    await supabase.storage.from('izvestaji').remove([image.storage_path])
    const { error } = await supabase.from('report_images').delete().eq('id', image.id)
    if (error) return toast.error(errorMessage(error))
    loadImages(reportId)
  }

  async function clearRows() {
    setClearOpen(false)
    for (const timer of itemTimers.current.values()) clearTimeout(timer)
    itemTimers.current.clear()
    dirtyItems.current.clear()

    setRows({})
    const { error } = await supabase.from('shift_report_items').delete().eq('report_id', reportId)
    if (error) return toast.error(errorMessage(error))
    toast.info('Popis je očišćen.')
  }

  /* ------------------------------------------------------------ */
  /*  Zatvaranje smene                                             */
  /* ------------------------------------------------------------ */
  function validate() {
    if (!reportId) return 'Prvo uđi u smenu.'
    if (doneCount === 0) return 'Unesi prodato bar za jedan artikal.'
    if (missingSold.length > 0) {
      return `Kod ${countLabel(missingSold.length, 'artikla')} je uneto početno stanje, a nije prodato. Popuni ih pa zatvori smenu.`
    }
    if (errorCount > 0) {
      return `Kod ${countLabel(errorCount, 'artikla')} je prodato veće od novog stanja. Ispravi pa zatvori smenu.`
    }
    if (pazar === '') return 'Unesi pazar.'
    if (cardTooBig) return 'Kartice ne mogu biti veće od pazara.'
    if (images.length === 0) {
      return 'Slikaj izveštaj prodaje po operateru — bez toga smena ne može da se zatvori.'
    }
    return null
  }

  /** Dugme „Zatvori smenu“ ne šalje odmah — prvo pokaže obračun na potvrdu. */
  function openConfirm(e) {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      toast.error(problem)
      // Ono što fali se odmah otvori, da radnik vidi gde da upiše.
      if (missingSold.length > 0) {
        setOpenCats(new Set(missingSold.map((i) => i.category)))
      }
      if (pazar === '' || cardTooBig) setPazarOpen(true)
      return
    }
    setConfirmOpen(true)
  }

  async function closeShift() {
    setSubmitting(true)
    try {
      await flushPending()

      const { error } = await supabase
        .from('shift_reports')
        .update({ status: 'poslat' })
        .eq('id', reportId)
      if (error) throw error

      setConfirmOpen(false)
      toast.success('Smena je zatvorena i poslata vlasniku.')
      navigate(`/izvestaj/${reportId}`, { replace: true })
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Zatvaranje nije uspelo. Proveri internet i pokušaj ponovo.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <FullPageLoader label="Učitavanje artikala…" />

  /* ============================================================== */
  /*  Prikaz                                                        */
  /* ============================================================== */
  const shiftCard = (
    <Card>
      <CardHeader
        title="Smena"
        subtitle={
          reportId
            ? 'Popis se deli sa svima u smeni'
            : joinsExisting
              ? 'Ova smena je u toku'
              : 'Izaberi datum i smenu'
        }
        action={
          reportId && editable ? (
            <span
              className={cx(
                'shrink-0 text-[11px] font-semibold',
                saveState === 'error' ? 'text-rose-600' : 'text-stone-400',
              )}
            >
              {saveState === 'saving' && 'Čuva se…'}
              {saveState === 'saved' && 'Sačuvano'}
              {saveState === 'error' && 'Nije sačuvano'}
            </span>
          ) : null
        }
      />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Datum">
            <Input
              type="date"
              value={reportDate}
              max={todayISO()}
              disabled={!!reportId}
              onChange={(e) => setReportDate(e.target.value)}
            />
          </Field>
          <Field label="Smena">
            <Select value={shift} disabled={!!reportId} onChange={(e) => setShift(e.target.value)}>
              {SHIFTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} ({s.hint})
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {reportId ? (
          <div>
            <span className="label">U smeni</span>
            <div className="flex flex-wrap gap-2">
              {staffNames.map((person) => (
                <div
                  key={person.id}
                  className={cx(
                    'flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-semibold',
                    person.id === profile?.id
                      ? 'bg-brand-600 text-white'
                      : 'bg-stone-200 text-stone-700',
                  )}
                >
                  <Avatar
                    name={person.name}
                    path={person.avatar_path}
                    zoomable
                    className={cx(
                      'h-7 w-7 text-[11px]',
                      person.id === profile?.id ? 'bg-white/20' : 'bg-white/70',
                    )}
                  />
                  {person.name}
                </div>
              ))}
            </div>
            <p className="hint">
              {staffNames.length > 1
                ? `Vas ${staffNames.length} radi ovu smenu i delite isti popis — sve što jedan upiše, drugi odmah vidi. Svako dobija punu dnevnicu.`
                : 'Ko još uđe u ovu smenu, radi na istom popisu i dobija punu dnevnicu za nju.'}
            </p>

            {editable && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 px-0 text-rose-600"
                onClick={() => setLeaveOpen(true)}
              >
                Izađi iz smene
              </Button>
            )}
          </div>
        ) : (
          <div>
            {joinsExisting && peek.names.length > 0 && (
              <div className="mb-3 rounded-xl bg-brand-50 px-3.5 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
                  Smena je već otvorena
                </p>
                <p className="mt-0.5 text-sm text-stone-700">
                  U njoj {plural(peek.names.length, ['je', 'su', 'je'])}{' '}
                  <strong>{peek.names.join(', ')}</strong>. Ulaskom radiš na istom popisu.
                </p>
              </div>
            )}

            <Button
              type="button"
              size="lg"
              className="w-full"
              loading={joining}
              disabled={peek === null || shiftTaken}
              onClick={joinShift}
            >
              {peek === null ? 'Proveravam…' : joinsExisting ? 'Uđi u smenu' : 'Otvori smenu'}
            </Button>

            <p className={cx('hint', shiftTaken && 'text-rose-600')}>
              {shiftTaken
                ? 'Ova smena je već zatvorena i u nju se više ne može ući. Izaberi drugu smenu ili se javi vlasniku.'
                : joinsExisting
                  ? 'Ko uđe u smenu, tome se računa dnevnica za nju.'
                  : 'Otvaranjem smene počinje popis. Ko posle uđe u nju, radi na istom popisu i takođe dobija punu dnevnicu.'}
            </p>
          </div>
        )}
      </div>
    </Card>
  )

  /* Smena je zatvorena — ništa se više ne unosi. */
  if (reportId && closed) {
    return (
      <div className="space-y-4">
        {shiftCard}
        <Card>
          <div className="space-y-3 p-6 text-center">
            <p className="text-base font-bold text-stone-900">Smena je zatvorena</p>
            <p className="text-sm text-stone-500">
              Popis je poslat vlasniku i više ne može da se menja. Ako nešto ne valja, vlasnik će
              ga vratiti na ispravku.
            </p>
            <Button type="button" onClick={() => navigate(`/izvestaj/${reportId}`)}>
              Otvori izveštaj
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  /* Još nije ušao u smenu — ne prikazuje se popis. */
  if (!reportId) {
    return (
      <div className="space-y-4">
        {shiftCard}
        <Card>
          <div className="space-y-2 p-6 text-center">
            <p className="text-base font-bold text-stone-900">
              {shiftTaken
                ? 'Smena je već zatvorena'
                : joinsExisting
                  ? 'Popis je već u toku'
                  : 'Popis počinje otvaranjem smene'}
            </p>
            <p className="text-sm text-stone-500">
              {shiftTaken
                ? 'Popis za ovu smenu je poslat vlasniku. Ako nešto treba da se ispravi, vlasnik je vraća na ispravku.'
                : joinsExisting
                  ? 'Čim uđeš, vidiš sve što je kolega do sad upisao i možeš da nastaviš na istom popisu.'
                  : 'Čim otvoriš smenu, popis se čuva u bazu dok kucaš. Ako vam se pridruži još neko, svi vidite i menjate isti popis, i svima se piše dnevnica.'}
            </p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <form onSubmit={openConfirm} className="space-y-4 pb-28">
      {shiftCard}

      {/* ---------- Pazar — otvara se klikom ---------- */}
      <Card>
        <button
          type="button"
          onClick={() => setPazarOpen((v) => !v)}
          aria-expanded={pazarOpen}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
        >
          <svg
            className={cx(
              'h-4 w-4 shrink-0 text-stone-400 transition-transform',
              pazarOpen && 'rotate-90',
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

          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold tracking-tight text-stone-900">
              Pazar
            </span>
            {/* Zbir se vidi i kad je zatvoren — ne mora da se otvara samo da se pogleda. */}
            <span className="mt-0.5 block truncate text-[13px] text-stone-500">
              {pazar === '' && card === ''
                ? 'Pazar i kartice — još nije uneto'
                : `Kartice ${formatMoneyShort(cardNum)} · Predato ${formatMoneyShort(
                    Math.max(0, cashNum),
                  )}`}
            </span>
          </span>

          {pazarNum > 0 && (
            <span className="shrink-0 text-[15px] font-extrabold tabular-nums text-brand-700">
              {formatMoney(pazarNum, false)}
            </span>
          )}
        </button>

        {pazarOpen && (
        <div className="space-y-4 border-t border-stone-100 p-4">
          {/* Redosled svuda isti: pazar, kartice, predato. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pazar" required>
              <MoneyInput
                value={pazar}
                onChange={(v) => {
                  setPazar(v)
                  markField('money')
                }}
              />
            </Field>
            <Field label="Kartice" required>
              <MoneyInput
                value={card}
                onChange={(v) => {
                  setCard(v)
                  markField('money')
                }}
              />
              {cardTooBig && (
                <p className="mt-1 text-xs font-medium text-rose-600">
                  Kartice ne mogu biti veće od pazara.
                </p>
              )}
            </Field>
          </div>

          <div className="flex gap-2.5 rounded-xl bg-amber-50/50 px-3.5 py-2.5 ring-1 ring-inset ring-amber-200/60">
            <span className="text-base leading-none opacity-60" aria-hidden="true">
              ⚠️
            </span>
            <p className="text-xs leading-relaxed text-amber-900/75">
              Upiši <strong className="font-semibold">tačne iznose sa kase, bez zaokruživanja</strong>
              . Na primer <strong className="font-semibold">34.560</strong>, a ne 34.500.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-stone-100 px-4 py-2.5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Predato
              </p>
              <p className="text-[11px] text-stone-400">pazar − kartice</p>
            </div>
            <p className="text-lg font-extrabold tabular-nums text-stone-900">
              {formatMoney(Math.max(0, cashNum))}
            </p>
          </div>
        </div>
        )}
      </Card>

      {/* ---------- Popis ---------- */}
      <Card>
        <CardHeader
          title="Popis artikala"
          subtitle={`Popisano ${doneCount} od ${items.length}${
            missingSold.length > 0 ? ` · ${missingSold.length} bez prodatog` : ''
          }${errorCount > 0 ? ` · ${errorCount} sa greškom` : ''}`}
          action={
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setOpenCats(openCats.size > 0 ? new Set() : new Set(grouped.map(([cat]) => cat)))
                }
              >
                {openCats.size > 0 ? 'Zatvori sve' : 'Otvori sve'}
              </Button>
              {doneCount > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setClearOpen(true)}>
                  Očisti
                </Button>
              )}
            </div>
          }
        />

        <div className="sticky top-[57px] z-10 border-b border-stone-200 bg-white px-4 py-3">
          <Input
            type="search"
            placeholder="Pretraži artikal…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="divide-y divide-stone-100">
          {grouped.map(([category, categoryItems]) => {
            const open = isCatOpen(category)
            const done = categoryItems.filter((i) => isDone(rows[i.id])).length
            const half = categoryItems.filter((i) => isStarted(rows[i.id]) && !isDone(rows[i.id]))
              .length

            return (
              <div key={category}>
                <CategoryToggle
                  title={category}
                  open={open}
                  onToggle={() => toggleCat(category)}
                  right={
                    <span
                      className={cx(
                        'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums ring-1 ring-inset',
                        half > 0
                          ? 'bg-amber-100 text-amber-800 ring-amber-600/20'
                          : done === categoryItems.length
                            ? 'bg-emerald-100 text-emerald-800 ring-emerald-600/20'
                            : done > 0
                              ? 'bg-amber-100 text-amber-800 ring-amber-600/20'
                              : 'bg-white text-stone-500 ring-stone-300',
                      )}
                    >
                      {done}/{categoryItems.length}
                    </span>
                  }
                />

                {/* Legenda kolona — vidi se samo kad je kategorija otvorena */}
                {open && (
                  <div className="flex items-center justify-end gap-2 border-b border-stone-100 bg-white px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                    {COLUMNS.map((c) => (
                      <span key={c.key} className="w-[58px] text-center">
                        {c.short}
                      </span>
                    ))}
                    <span className="w-[48px] text-right">Kraj</span>
                  </div>
                )}

                {open &&
                  categoryItems.map((item) => {
                    const row = rows[item.id] ?? EMPTY_ROW
                    const done = isDone(row)
                    const half = isStarted(row) && !done
                    const end = endOf(row) // krajnje stanje, računa se
                    const bad = done && end < 0

                    return (
                      <div
                        key={item.id}
                        className={cx(
                          'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition',
                          bad
                            ? 'bg-rose-50'
                            : half
                              ? 'bg-amber-50'
                              : done && 'bg-emerald-50/50',
                        )}
                      >
                        <div className="min-w-[130px] flex-1">
                          <p className="text-sm font-semibold leading-tight text-stone-800">
                            {item.name}
                          </p>
                          <p className="text-xs text-stone-400">{item.unit}</p>
                        </div>

                        <div className="ml-auto flex items-center gap-2">
                          {COLUMNS.map((c) => (
                            <input
                              key={c.key}
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              placeholder="0"
                              aria-label={`${item.name} — ${c.label}`}
                              value={row[c.key]}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => setCell(item.id, c.key, e.target.value)}
                              className={cx(
                                'w-[58px] rounded-lg border px-1.5 py-2 text-center text-base font-bold tabular-nums outline-none transition',
                                c.key === 'p' && half
                                  ? 'border-amber-400 bg-white focus:ring-2 focus:ring-amber-500/30'
                                  : c.key === 'p' && done && !bad
                                    ? 'border-emerald-400 bg-white text-emerald-800 focus:ring-2 focus:ring-emerald-500/30'
                                    : bad && c.key === 'p'
                                      ? 'border-rose-400 bg-white text-rose-700 focus:ring-2 focus:ring-rose-500/30'
                                      : 'border-stone-300 bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30',
                              )}
                            />
                          ))}

                          <span
                            className={cx(
                              'w-[48px] shrink-0 text-right text-sm font-extrabold tabular-nums',
                              bad ? 'text-rose-600' : done ? 'text-stone-900' : 'text-stone-300',
                            )}
                            title="Krajnje stanje = (početno + dodato) − prodato"
                          >
                            {done ? formatQty(end) : '—'}
                          </span>
                        </div>

                        {half && (
                          <p className="w-full text-xs font-medium text-amber-700">
                            Fali prodato (ako ništa nije prodato, upiši 0). Dok ga ne upišeš, smena
                            ne može da se zatvori.
                          </p>
                        )}

                        {bad && (
                          <p className="w-full text-xs font-medium text-rose-600">
                            Prodato je veće od novog stanja (
                            {formatQty(parseNumber(row.s) + parseNumber(row.d))}). Proveri unos.
                          </p>
                        )}
                      </div>
                    )
                  })}
              </div>
            )
          })}

          {grouped.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-stone-500">
              {items.length === 0
                ? 'Vlasnik još nije dodao artikle. Javi mu se.'
                : 'Nema artikla za traženi pojam.'}
            </p>
          )}
        </div>
      </Card>

      {/* ---------- Izveštaj prodaje po operateru ---------- */}
      <Card className={cx(images.length === 0 && 'ring-1 ring-rose-300')}>
        <CardHeader
          title="Izveštaj prodaje po operateru"
          subtitle="Obavezno — slikaj izveštaj sa kase"
          action={
            images.length === 0 ? (
              <Badge className="shrink-0 bg-rose-100 text-rose-700 ring-rose-600/20">
                obavezno
              </Badge>
            ) : (
              <Badge className="shrink-0 bg-emerald-100 text-emerald-800 ring-emerald-600/20">
                {images.length}/6
              </Badge>
            )
          }
        />
        <div className="space-y-3 p-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={handleFiles}
            className="hidden"
          />

          <Button
            type="button"
            variant={images.length === 0 ? 'primary' : 'secondary'}
            onClick={() => fileInputRef.current?.click()}
            disabled={images.length >= 6 || uploading}
            loading={uploading}
          >
            {images.length === 0 ? 'Slikaj izveštaj' : 'Dodaj još'}
          </Button>

          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((image) => (
                <div
                  key={image.id}
                  className="relative aspect-square overflow-hidden rounded-xl bg-stone-100"
                >
                  {image.url && (
                    <img
                      src={image.url}
                      alt="Izveštaj prodaje po operateru"
                      className="h-full w-full object-cover"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeImage(image)}
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-stone-900/70 text-sm font-bold text-white"
                    aria-label="Ukloni sliku"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* ---------- Dnevna obaveza za dan smene ---------- */}
      <Card>
        <CardHeader
          title={`Dnevna obaveza — ${dailyTask.day}`}
          subtitle="Štikliraj kad je urađena"
          action={
            taskDone ? (
              <Badge className="shrink-0 bg-emerald-100 text-emerald-800 ring-emerald-600/20">
                urađeno
              </Badge>
            ) : null
          }
        />
        <div className="space-y-3 p-4">
          {dailyTask.text ? (
            <RuleText body={dailyTask.text} />
          ) : (
            <p className="text-sm text-stone-500">
              Za ovaj dan nema upisane obaveze u „Dnevnim obavezama“.
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setTaskDone((v) => !v)
              markField('task')
            }}
            aria-pressed={taskDone}
            className={cx(
              'flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition',
              taskDone ? 'bg-emerald-50' : 'bg-stone-100 hover:bg-stone-200/70',
            )}
          >
            <span
              className={cx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition',
                taskDone
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-stone-300 bg-white',
              )}
            >
              {taskDone && (
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M4 10.5l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span
              className={cx(
                'text-sm font-semibold',
                taskDone ? 'text-emerald-800' : 'text-stone-800',
              )}
            >
              Dnevna obaveza za ovu smenu je urađena
            </span>
          </button>
        </div>
      </Card>

      {/* ---------- Napomena ---------- */}
      <Card>
        <CardHeader title="Napomena za admina" subtitle="Opciono — sve što treba da zna" />
        <div className="p-4">
          <Textarea
            rows={3}
            placeholder="npr. nestao je Heineken oko 22h, pokvarila se mašina za led"
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              markField('note')
            }}
          />
        </div>
      </Card>

      {/* ---------- Fiksna traka sa dugmetom ---------- */}
      <div className="fixed inset-x-0 bottom-[60px] z-20 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:safe-bottom">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-stone-500">Predato</p>
            <p className="truncate text-lg font-extrabold tabular-nums text-stone-900">
              {formatMoney(Math.max(0, cashNum))}
            </p>
          </div>
          <Button type="submit" size="lg" loading={submitting} className="shrink-0">
            Zatvori smenu
          </Button>
        </div>
      </div>

      {/* ---------- Potvrda brisanja unetog popisa ---------- */}
      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Očisti popis?"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setClearOpen(false)}
            >
              Ne, vrati me
            </Button>
            <Button type="button" variant="danger" className="flex-1" onClick={clearRows}>
              Da, očisti
            </Button>
          </div>
        }
      >
        <p className="text-sm text-stone-600">
          Ovim brišeš ceo popis ove smene — i ono što je upisao kolega. Pazar i slike ostaju.
        </p>
      </Modal>

      {/* ---------- Potvrda izlaska iz smene ---------- */}
      <Modal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title="Izađi iz smene?"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setLeaveOpen(false)}
            >
              Ostani
            </Button>
            <Button type="button" variant="danger" className="flex-1" onClick={leaveShift}>
              Izađi
            </Button>
          </div>
        }
      >
        <p className="text-sm text-stone-600">
          Skidaš se sa spiska onih koji rade ovu smenu, pa ti se <strong>dnevnica za nju neće
          računati</strong>. Popis ostaje — njega i dalje vide ostali u smeni.
        </p>
      </Modal>

      {/* ---------- Potvrda zatvaranja smene ---------- */}
      <Modal
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title="Zatvaranje smene"
        footer={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              disabled={submitting}
              onClick={() => setConfirmOpen(false)}
            >
              Nazad
            </Button>
            <Button
              type="button"
              variant="success"
              className="flex-1"
              loading={submitting}
              onClick={closeShift}
            >
              Zatvori smenu
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-stone-100 px-4 py-3 text-sm">
            <p className="font-bold text-stone-900">
              {formatDate(reportDate)} · {SHIFT_LABELS[shift]}
            </p>
            <p className="mt-0.5 text-stone-600">
              {staffNames.map((p) => p.name).join(', ')}
            </p>
            <p className="mt-0.5 text-stone-500">
              Popisano {doneCount} od {countLabel(items.length, 'artikla')} · {images.length}{' '}
              {plural(images.length, 'slika')} trake
            </p>
            <p className={cx('mt-0.5', taskDone ? 'text-emerald-700' : 'text-amber-700')}>
              Dnevna obaveza: {taskDone ? 'urađena' : 'nije štiklirana'}
            </p>
          </div>

          <dl className="divide-y divide-stone-100 text-sm">
            <div className="flex justify-between py-2">
              <dt className="text-stone-600">Pazar</dt>
              <dd className="font-bold tabular-nums text-brand-700">{formatMoney(pazarNum)}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-stone-600">Kartice</dt>
              <dd className="font-bold tabular-nums text-sky-700">{formatMoney(cardNum)}</dd>
            </div>
          </dl>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3.5 text-white">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                Predato
              </p>
              <p className="text-xs text-stone-400">gotovina koju predaješ (pazar − kartice)</p>
            </div>
            <p className="text-2xl font-extrabold tabular-nums">{formatMoney(cashNum)}</p>
          </div>

          <p className="text-xs text-stone-500">
            Dnevnicu za ovu smenu dobija{' '}
            {staffNames.length > 1 ? `svih ${staffNames.length}` : 'onaj'} ko je u njoj. Posle
            zatvaranja popis više ne možete da menjate dok ga vlasnik ne vrati na ispravku.
          </p>
        </div>
      </Modal>
    </form>
  )
}
