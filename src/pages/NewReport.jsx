import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { useToast, useToastOffset } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { buildStoragePath, compressImage } from '../lib/image'
import {
  carriedCategoryNames,
  categoryComparator,
  hiddenCategoryNames,
  isCountDue,
  loadCategories,
  nextCountOn,
} from '../lib/categories'
import { dailyTaskFor } from '../lib/rules'
import Avatar from '../components/Avatar'
import MidShiftView from '../components/MidShiftView'
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
  Textarea,
} from '../components/ui'
import {
  SHIFTS,
  SHIFT_LABELS,
  SHIFT_SHORT,
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
 * U bazi se čuvaju i prodato (qty_sold) i krajnje stanje (qty_end) — krajnje
 * se računa iz prodatog, a formula zavisi od toga da li je artikal brojač.
 */
const EMPTY_ROW = { s: '', d: '', p: '', e: '' }

/**
 * Način popisa artikla.
 *
 *   zalihe   upisuje se PRODATO    krajnje = (početno + dodato) − prodato
 *   brojac   upisuje se PRODATO    krajnje = početno + prodato      (espresso)
 *   krajnje  upisuje se KRAJNJE    prodato = (početno + dodato) − krajnje (voće)
 *
 * `is_counter` je stariji način zapisa — poštuje se zbog baza u kojima još
 * nije pokrenuta skripta sa `count_mode`.
 */
function modeOf(item) {
  if (item?.count_mode === 'brojac' || item?.count_mode === 'krajnje') return item.count_mode
  if (item?.count_mode === 'zalihe') return 'zalihe'
  return item?.is_counter ? 'brojac' : 'zalihe'
}

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

/** Prodato — kod „krajnje“ se računa, inače ga radnik upisuje. */
function soldOf(row, mode) {
  if (mode !== 'krajnje') return parseNumber(row.p)
  return round2(parseNumber(row.s) + parseNumber(row.d) - parseNumber(row.e))
}

/** Krajnje stanje — kod „krajnje“ ga radnik upisuje, inače se računa. */
function endOf(row, mode) {
  if (mode === 'krajnje') return parseNumber(row.e)
  const start = parseNumber(row.s)
  const sold = parseNumber(row.p)
  return mode === 'brojac' ? round2(start + sold) : round2(start + parseNumber(row.d) - sold)
}

/** Red iz baze u polja popisa. */
function rowFromDb(dbRow, mode) {
  return {
    s: toField(dbRow.qty_start),
    d: toField(dbRow.qty_added),
    p: mode === 'krajnje' ? '' : toField(dbRow.qty_sold),
    e: mode === 'krajnje' ? toField(dbRow.qty_end) : '',
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

/**
 * Šta se sa aparata za kartice slika na kraju smene.
 *
 *   prva smena i međusmena  →  ukupan izveštaj
 *   druga smena             →  kraj dana (zaključenje)
 *
 * Taj izveštaj ide na ISTU sliku sa izveštajem prodaje po operateru — tako
 * se odmah vidi da se kartice sa kase i sa aparata poklapaju.
 */
function terminalReportOf(shift) {
  return shift === 'druga'
    ? 'kraj dana sa aparata za kartice'
    : 'ukupan izveštaj sa aparata za kartice'
}

/**
 * Dirnut artikal = upisano mu je BILO ŠTA.
 *
 * Ništa nije obavezno: početno se upisuje na početku smene, prodato na kraju
 * i samo ako je artikal prodavan. Prazno „prodato“ znači NULA prodatih, pa
 * krajnje ostaje jednako novom. Artikal koji niko nije dirao se ne upisuje —
 * u izveštaju ostaje crtica, a ne nula.
 */
const isDone = (row) =>
  (row?.s ?? '') !== '' ||
  (row?.d ?? '') !== '' ||
  (row?.p ?? '') !== '' ||
  (row?.e ?? '') !== ''

/**
 * Ništa nije obavezno. Artikal koji radnik nije dirao ostaje prazan — i u
 * popisu i u izveštaju stoji crtica, a ne nula, da se vidi da nije ni brojan.
 * Prazno „prodato“ znači nula prodatih, pa krajnje ostaje jednako novom.
 */

export default function NewReport() {
  const { profile, isAdmin } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // „Ispravi popis“ sa izveštaja vodi ovde sa ?izvestaj=<id> — otvara baš taj popis.
  const requestedId = searchParams.get('izvestaj')
  const fileInputRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [people, setPeople] = useState([])
  const [ruleDocs, setRuleDocs] = useState([]) // odatle se čita dnevna obaveza za dan smene
  // Krajnje stanje iz prošle smene — odatle se prepisuje početno kod grupa
  // koje se popisuju ređe (žestine na 7 dana).
  const [lastEnds, setLastEnds] = useState(() => new Map())

  /* Izbor smene — zaključava se čim se uđe u nju. */
  const [reportDate, setReportDate] = useState(todayISO())
  const [shift, setShift] = useState('prva')

  /* Otvorena smena */
  const [myOpen, setMyOpen] = useState([]) // sve smene u kojima je radnik trenutno
  const [reportId, setReportId] = useState(null)
  const [status, setStatus] = useState(null)
  const [staff, setStaff] = useState([])
  // Za koji je izveštaj učitano ko radi u njemu — dok to ne stigne, ne zna se
  // da li je admin u smeni ili je samo uređuje.
  const [staffFor, setStaffFor] = useState(null)
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
  // Za koji je izveštaj već učitano ono što je upisano — dok to ne stoji,
  // početno stanje se ne prepisuje, da se zatečeni unos ne pregazi.
  const rowsLoadedFor = useRef(null)
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

  const submitted = status === 'poslat' || status === 'potvrdjen'

  /* Admin uređuje tuđ popis — i dok traje, i posle predaje. Ne ulazi u smenu,
     pa mu se ne računa dnevnica, a radnik ništa ne primeti osim promene.
     Isto važi i kad otvori već predat popis u kome je sam radio. */
  const adminEdit =
    isAdmin &&
    !!reportId &&
    staffFor === reportId &&
    (submitted || !staff.includes(profile?.id))

  const editable = status === 'otvoren' || status === 'vracen' || (isAdmin && submitted)
  const closed = submitted && !isAdmin

  // Dok stoji traka „Zatvori smenu“ (iznad donje navigacije), obaveštenja idu iznad nje.
  useToastOffset(134, !!reportId && editable)

  /* ------------------------------------------------------------ */
  /*  Učitavanje artikala, kategorija i imena                      */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    let active = true

    async function load() {
      const [itemsRes, cats, peopleRes, rulesRes, endsRes] = await Promise.all([
        supabase
          .from('items')
          .select('id, name, category, unit, sort_order, is_counter, count_mode')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        loadCategories().catch(() => []),
        supabase.from('profiles').select('id, full_name, avatar_path'),
        supabase.from('rule_docs').select('title, body'),
        // Pogled ne postoji u bazama bez skripte za retko popisivanje.
        supabase.from('last_item_end').select('item_id, qty_end'),
      ])

      if (!active) return
      // Artikli iz sakrivenih grupa se ne popisuju — admin ih je sklonio.
      const hidden = hiddenCategoryNames(cats)
      if (itemsRes.error) toast.error(errorMessage(itemsRes.error))
      else setItems((itemsRes.data ?? []).filter((i) => !hidden.has(i.category)))
      setCategories(cats)
      setPeople(peopleRes.data ?? [])
      setRuleDocs(rulesRes.data ?? [])
      setLastEnds(
        new Map((endsRes.data ?? []).map((r) => [r.item_id, Number(r.qty_end)])),
      )
      setLoading(false)
    }

    load()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------------------------------------ */
  /*  Smene koje radnik trenutno ima otvorene                      */
  /*                                                               */
  /*  Može ih biti i više odjednom — ko radi međusmenu ulazi i u    */
  /*  prvu i u drugu. Zato se pamte SVE, pa se između njih prelazi  */
  /*  dugmadima, a aplikacija te po ulasku vrati u poslednju.       */
  /* ------------------------------------------------------------ */
  const loadMyOpen = useCallback(async () => {
    if (!profile?.id) return []
    const { data } = await supabase
      .from('shift_reports')
      .select('id, report_date, shift, shift_report_staff!inner(profile_id)')
      .eq('shift_report_staff.profile_id', profile.id)
      .in('status', ['otvoren', 'vracen'])
      .order('report_date', { ascending: false })
      .limit(10)

    const list = (data ?? []).map((r) => ({ id: r.id, date: r.report_date, shift: r.shift }))
    setMyOpen(list)
    return list
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    let active = true

    loadMyOpen().then((list) => {
      if (!active) return
      if (requestedId) {
        setReportId(requestedId)
        return
      }
      if (!list.length) return
      setReportDate(list[0].date)
      setShift(list[0].shift)
      setReportId(list[0].id)
    })

    return () => {
      active = false
    }
  }, [profile?.id, requestedId, loadMyOpen])

  // U međusmeni se prva i druga pojavljuju kao „moje“ čim ih neko otvori —
  // pa se spisak povremeno osveži, da se ✓ pojavi bez ručnog osvežavanja.
  useEffect(() => {
    if (shift !== 'medjusmena' || !reportId) return undefined
    const timer = setInterval(loadMyOpen, 15000)
    return () => clearInterval(timer)
  }, [shift, reportId, loadMyOpen])

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
    setStaffFor(id)
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
          .select('item_id, qty_start, qty_added, qty_end, qty_sold')
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
        next[row.item_id] = rowFromDb(
          row,
          modeOf(itemsRef.current.find((i) => i.id === row.item_id)),
        )
      }
      setRows(next)
      rowsLoadedFor.current = id

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
            else
              next[itemId] = rowFromDb(
                payload.new,
                modeOf(itemsRef.current.find((i) => i.id === itemId)),
              )
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
      const blank = !isDone(row)

      const mode = modeOf(item)

      // Prodato veće od novog stanja (ili krajnje veće od njega) — red se ne
      // upisuje dok se ne ispravi, pa ga kolega ne pregazi. Brojač nema to
      // ograničenje: kod njega krajnje samo raste.
      if (isDone(row) && mode !== 'brojac' && soldOf(row, mode) < 0) return

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
            // Prazno polje je nula — artikal koji nije prodavan radnik
            // ostavlja prazan. Šta se upisuje a šta računa zavisi od načina
            // popisa (zalihe, brojač ili krajnje stanje).
            qty_sold: soldOf(row, mode),
            qty_end: endOf(row, mode),
            is_counter: mode === 'brojac',
            count_mode: mode,
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

  /* Međusmenu radi jedan čovek — ako je neko drugi već unutra, ulaz je
     zatvoren i piše ko je to, da radnik ne gubi vreme. */
  const midTaken =
    shift === 'medjusmena' &&
    joinsExisting &&
    (peek.names ?? []).some((n) => n !== profile?.full_name)

  /** Koje smene tog dana radnik već ima otvorene. */
  const myShiftsToday = useMemo(
    () => new Set(myOpen.filter((r) => r.date === reportDate).map((r) => r.shift)),
    [myOpen, reportDate],
  )

  /**
   * Prelazak na drugu smenu istog dana.
   *
   * Ako je radnik već u njoj — otvara se njen popis. Ako nije — prikazuje se
   * dugme za ulazak. Sve što čeka na upis se prvo upiše, da ne bi završilo u
   * pogrešnom popisu.
   */
  async function switchShift(value) {
    if (value === shift) return
    if (reportId) await flushPending()

    let mine = myOpen.find((r) => r.date === reportDate && r.shift === value)
    // Ko radi međusmenu, u prvu i drugu ulazi sam kad se one otvore — spisak
    // se zato proveri ponovo pre nego što se kaže da u njoj nije.
    if (!mine) {
      const fresh = await loadMyOpen()
      mine = fresh.find((r) => r.date === reportDate && r.shift === value)
    }
    setShift(value)
    setStatus(null)
    setStaff([])
    setRows({})
    setImages([])
    setPazar('')
    setCard('')
    setNote('')
    setTaskDone(false)
    setReportId(mine ? mine.id : null)
  }

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
    await loadMyOpen()
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
    await loadMyOpen()
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
    // Redosled kategorija je onaj koji je admin podesio u Artikli -> Kategorije.
    const compare = categoryComparator(categories)
    return Array.from(map.entries()).sort((a, b) => compare(a[0], b[0]))
  }, [items, search, categories])

  /* ------------------------------------------------------------ */
  /*  Grupe koje se popisuju ređe (žestine na 7 dana)              */
  /*                                                               */
  /*  Dok ne dođe red za popis, radniku se početno stanje PREPISUJE */
  /*  iz prošle smene — on upisuje samo prodato, a krajnje ide      */
  /*  sledećoj smeni kao početno.                                   */
  /* ------------------------------------------------------------ */
  const carriedCats = useMemo(
    () => carriedCategoryNames(categories, reportDate),
    [categories, reportDate],
  )

  /** Grupe koje se baš danas popisuju — po zatvaranju smene se upisuje datum. */
  const dueCatNames = useMemo(
    () =>
      categories
        .filter((c) => c.is_active && Number(c.count_every_days) > 0 && isCountDue(c, reportDate))
        .map((c) => c.name),
    [categories, reportDate],
  )

  /* Krajnje stanje PRETHODNE smene, ponovo pročitano iz baze — ne ono što je
     bilo kad je ekran otvoren. Prva smena često upiše prodato tek pri predaji,
     pa se broj menja i posle ulaska druge smene. `endsFor` kaže za koju je smenu
     ovaj spisak tačan (bez toga se radi sa starijim snimkom, samo jednom). */
  const [endsFor, setEndsFor] = useState(null)

  const refreshEnds = useCallback(async () => {
    const id = reportIdRef.current
    if (!id) return
    const { data, error } = await supabase.rpc('previous_item_end', { p_report_id: id })
    // Funkcije nema dok skripta za bazu nije puštena — ostaje stariji snimak.
    if (error || !Array.isArray(data) || reportIdRef.current !== id) return
    setLastEnds(new Map(data.map((r) => [r.item_id, Number(r.qty_end)])))
    setEndsFor(id)
  }, [])

  useEffect(() => {
    if (!reportId || status !== 'otvoren' || adminEdit || carriedCats.size === 0) return undefined

    refreshEnds()
    const timer = setInterval(refreshEnds, 15000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshEnds()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reportId, status, adminEdit, carriedCats, refreshEnds])

  /* Početno kod ređe popisivanih grupa UVEK prati krajnje stanje prethodne
     smene dok ova traje. Radnik ga ne kuca, pa nema šta da se pregazi; unos
     „prodato“ i „dodato“ ostaje, a krajnje se računa iznova. */
  useEffect(() => {
    // Admin koji samo uređuje tuđ popis ne prepisuje ništa. Čeka se i da se
    // zna ko je u smeni, i da se učita ono što je već upisano.
    if (!reportId || status !== 'otvoren' || adminEdit || staffFor !== reportId) return
    if (carriedCats.size === 0 || items.length === 0) return
    if (rowsLoadedFor.current !== reportId) return

    const exact = endsFor === reportId

    for (const item of items) {
      if (!carriedCats.has(item.category) || !lastEnds.has(item.id)) continue
      if (dirtyItems.current.has(item.id)) continue

      const want = lastEnds.get(item.id)
      const have = rows[item.id]?.s ?? ''

      // Tačan spisak: početno se uvek izjednači. Stariji snimak: samo se popuni
      // prazno polje, da se ne pregazi nešto što je već upisano.
      const needs = have === '' || (exact && round2(parseNumber(have)) !== round2(want))
      if (!needs) continue

      setCell(item.id, 's', String(want))
      // Kod „krajnje“ (voće) se i krajnje prepisuje, da prodato ispadne nula.
      if (modeOf(item) === 'krajnje' && (rows[item.id]?.e ?? '') === '') {
        setCell(item.id, 'e', String(want))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, status, adminEdit, staffFor, carriedCats, items, lastEnds, endsFor, rows])

  const doneCount = useMemo(() => items.filter((i) => isDone(rows[i.id])).length, [items, rows])

  /** Artikli kod kojih je prodato veće od novog stanja — greška u unosu. */
  const errorCount = useMemo(
    () =>
      items.filter(
        (i) =>
          isDone(rows[i.id]) && modeOf(i) !== 'brojac' && soldOf(rows[i.id] ?? EMPTY_ROW, modeOf(i)) < 0,
      ).length,
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
    // Ništa nije obavezno po artiklu — samo da popis ne ostane sasvim prazan.
    if (doneCount === 0) return 'Popiši bar jedan artikal.'
    if (errorCount > 0) {
      return `Kod ${countLabel(errorCount, 'artikla')} je prodato veće od novog stanja. Ispravi pa zatvori smenu.`
    }
    if (pazar === '') return 'Unesi pazar.'
    if (cardTooBig) return 'Kartice ne mogu biti veće od pazara.'
    if (images.length === 0) {
      return `Slikaj izveštaj prodaje po operateru i ${terminalReportOf(shift)} — oboje na jednoj slici.`
    }
    return null
  }

  /** Dugme „Zatvori smenu“ ne šalje odmah — prvo pokaže obračun na potvrdu. */
  function openConfirm(e) {
    e.preventDefault()
    // Enter u polju ne sme da „zatvori“ tuđu smenu dok je admin samo uređuje.
    if (adminEdit) return
    const problem = validate()
    if (problem) {
      toast.error(problem)
      // Ono što fali se odmah otvori, da radnik vidi gde da upiše.
      if (pazar === '' || cardTooBig) setPazarOpen(true)
      return
    }
    setConfirmOpen(true)
  }

  async function closeShift() {
    setSubmitting(true)
    try {
      await flushPending()

      /* Artikal koji radnik nije dirao se NE upisuje — u izveštaju ostaje
         crtica, pa se vidi da nije ni brojan. Nula bi značila da je brojan i
         da ga nema. */

      const { error } = await supabase
        .from('shift_reports')
        .update({ status: 'poslat' })
        .eq('id', reportId)
      if (error) throw error

      /* Grupe koje su se danas stvarno popisivale (žestine) dobijaju novi
         datum popisa — od njega se broji sledećih 7 dana. Ako upis ne prođe,
         smena je ipak zatvorena, pa se greška samo beleži. */
      if (dueCatNames.length > 0) {
        const { error: markError } = await supabase.rpc('mark_categories_counted', {
          p_names: dueCatNames,
          p_date: reportDate,
        })
        if (markError) console.error(markError)
      }

      setConfirmOpen(false)
      toast.success('Smena je zatvorena i poslata adminu.')
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
        subtitle={joinsExisting && !reportId ? 'U toku' : undefined}
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
        <Field label="Datum">
          <Input
            type="date"
            value={reportDate}
            max={todayISO()}
            disabled={!!reportId}
            onChange={(e) => setReportDate(e.target.value)}
          />
        </Field>

        {/* Tri dugmeta umesto padajućeg menija — odmah se vidi u kojim si
            smenama tog dana. Ko radi međusmenu ulazi i u prvu i u drugu, pa
            ih može biti i više označenih. */}
        <div>
          <span className="label">Smena</span>
          <div className="grid grid-cols-3 gap-1.5">
            {SHIFTS.map((s) => {
              const mine = myShiftsToday.has(s.value)
              const active = s.value === shift
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => switchShift(s.value)}
                  // Admin koji uređuje tuđ popis ne prelazi u druge smene —
                  // time bi ušao u njih i dobio dnevnicu.
                  disabled={adminEdit && !active}
                  aria-pressed={active}
                  className={cx(
                    'relative rounded-2xl px-2 py-2.5 text-[13px] font-semibold transition',
                    adminEdit && !active && 'opacity-40',
                    active
                      ? 'bg-ink text-white'
                      : mine
                        ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20'
                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70',
                  )}
                >
                  {SHIFT_SHORT[s.value]}
                  {mine && !active && (
                    <span className="ml-1 text-brand-600" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {myShiftsToday.size > 1 && <p className="hint">Jedna dnevnica za ceo dan.</p>}
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

            {editable && !adminEdit && (
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
              <div className="mb-3 rounded-2xl bg-brand-50 px-3.5 py-2.5">
                <p className="eyebrow text-brand-600">Već u smeni</p>
                <p className="mt-0.5 text-sm font-semibold text-stone-800">
                  {peek.names.join(', ')}
                </p>
              </div>
            )}

            <Button
              type="button"
              size="lg"
              className="w-full"
              loading={joining}
              disabled={peek === null || shiftTaken || midTaken}
              onClick={joinShift}
            >
              {peek === null ? 'Proveravam…' : joinsExisting ? 'Uđi u smenu' : 'Otvori smenu'}
            </Button>

            {(shiftTaken || midTaken) && (
              <p className="hint text-rose-600">
                {shiftTaken ? 'Smena je zatvorena — izaberi drugu.' : 'Međusmenu radi jedan radnik.'}
              </p>
            )}
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
            <p className="text-[13px] text-stone-400">Popis je poslat adminu.</p>
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
    // Dugme „Otvori / Uđi u smenu“ već kaže šta treba — bez dodatne kartice.
    return <div className="space-y-4">{shiftCard}</div>
  }

  return (
    <form onSubmit={openConfirm} className="space-y-4 pb-28">
      {/* Admin uređuje tuđ popis: ne ulazi u smenu, ne dobija dnevnicu. */}
      {adminEdit && (
        <div className="rounded-2xl bg-ink px-4 py-3 text-white">
          <p className="text-sm font-bold">Uređuješ kao admin</p>
          <p className="mt-0.5 text-xs text-stone-300">Ne računa ti se dnevnica. Izmene se čuvaju odmah.</p>
        </div>
      )}

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
                ? 'Nije uneto'
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

          <p className="text-[12px] text-amber-700">
            Tačno sa kase, bez zaokruživanja — 34.560, ne 34.500.
          </p>

          <div className="flex items-center justify-between gap-3 rounded-2xl bg-stone-100 px-4 py-3">
            <p className="eyebrow">Predato</p>
            <p className="text-lg font-extrabold tabular-nums text-stone-900">
              {formatMoney(Math.max(0, cashNum), false)}
            </p>
          </div>
        </div>
        )}
      </Card>

      {/* ---------- Popis ---------- */}
      <Card>
        <CardHeader
          title="Popis artikala"
          subtitle={`${doneCount}/${items.length}${
            errorCount > 0 ? ` · ${errorCount} sa greškom` : ''
          }`}
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
            /* Grupa koja se popisuje ređe: danas se ili broji (pa to jasno
               piše), ili se početno samo prepisuje iz prošle smene. */
            const cat = categories.find((c) => c.name === category)
            const every = Number(cat?.count_every_days ?? 0)
            const carried = carriedCats.has(category)

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
                        done === categoryItems.length
                          ? 'bg-emerald-100 text-emerald-800 ring-emerald-600/20'
                          : 'bg-white text-stone-500 ring-stone-300',
                      )}
                    >
                      {done}/{categoryItems.length}
                    </span>
                  }
                />

                {/* Grupa sa ređim popisom — jednom rečenicom šta se danas radi. */}
                {open && every > 0 && (
                  <div
                    className={cx(
                      'border-b px-4 py-2 text-xs font-medium',
                      carried
                        ? 'border-stone-100 bg-stone-50 text-stone-500'
                        : 'border-amber-200 bg-amber-50 text-amber-900',
                    )}
                  >
                    {carried ? (
                      <>
                        Početno prepisano — upiši samo prodato.
                        {nextCountOn(cat) && ` Popis ${formatDate(nextCountOn(cat))}`}
                      </>
                    ) : (
                      <>
                        <b>Danas se popisuje</b> — upiši početno.
                        {cat?.count_due && ' (traži admin)'}
                      </>
                    )}
                  </div>
                )}

                {/* Legenda kolona — vidi se samo kad je kategorija otvorena.
                    Polja su široka 78px da i petocifren broj stane ceo. */}
                {open && (
                  <div className="flex items-center justify-end gap-1.5 border-b border-stone-100 bg-white px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                    {COLUMNS.map((c) => (
                      <span key={c.key} className="w-[78px] text-center">
                        {c.short}
                      </span>
                    ))}
                    <span className="w-[70px] text-right">Kraj</span>
                  </div>
                )}

                {open &&
                  categoryItems.map((item) => {
                    const row = rows[item.id] ?? EMPTY_ROW
                    // Zeleno čim je nešto upisano; netaknut red ostaje beo.
                    const done = isDone(row)
                    /* Način popisa određuje šta se upisuje a šta računa:
                       brojač (espresso) nema „dodato“, a kod „krajnje“ (voće)
                       radnik upisuje krajnje, pa se prodato računa. */
                    const mode = modeOf(item)
                    const counter = mode === 'brojac'
                    const endInput = mode === 'krajnje'
                    const end = endOf(row, mode)
                    const sold = soldOf(row, mode)
                    const bad = done && mode !== 'brojac' && sold < 0

                    return (
                      <div
                        key={item.id}
                        className={cx(
                          'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition',
                          bad ? 'bg-rose-50' : done && 'bg-emerald-50/50',
                        )}
                      >
                        <div className="min-w-[130px] flex-1">
                          <p className="text-sm font-semibold leading-tight text-stone-800">
                            {item.name}
                          </p>
                          <p className="text-xs text-stone-400">
                            {item.unit}
                            {counter && ' · brojač'}
                            {endInput && ' · upisuje se krajnje'}
                          </p>
                        </div>

                        <div className="ml-auto flex items-center gap-1.5">
                          {COLUMNS.map((c) => {
                            /* Brojač nema „dodato“ — ništa se ne dopunjava.
                               Kod „krajnje“ se prodato ne kuca nego računa. */
                            const prazno = counter && c.key === 'd'
                            const racunato = endInput && c.key === 'p'
                            /* Grupa koja se danas ne popisuje: početno je
                               prepisano iz prošle smene i ne kuca se. */
                            const prepisano = carried && c.key === 's'

                            if (prepisano) {
                              return (
                                <span
                                  key={c.key}
                                  title="Prepisano iz prošle smene — popisuje se na određen broj dana"
                                  className="w-[78px] rounded-lg bg-stone-100 px-1.5 py-2.5 text-center text-base font-bold tabular-nums text-stone-500"
                                >
                                  {row.s === '' ? '—' : formatQty(parseNumber(row.s))}
                                </span>
                              )
                            }

                            if (prazno || racunato) {
                              return (
                                <span
                                  key={c.key}
                                  className={cx(
                                    'w-[78px] text-center text-base font-bold tabular-nums',
                                    racunato && done
                                      ? bad
                                        ? 'text-rose-600'
                                        : 'text-stone-500'
                                      : 'text-stone-300',
                                  )}
                                  title={racunato ? 'Prodato = (početno + dodato) − krajnje' : undefined}
                                >
                                  {racunato && done ? formatQty(sold) : '—'}
                                </span>
                              )
                            }

                            return (
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
                                  'w-[78px] rounded-lg border px-1.5 py-2.5 text-center text-base font-bold tabular-nums outline-none transition',
                                  c.key === 'p' && bad
                                    ? 'border-rose-400 bg-white text-rose-700 focus:ring-2 focus:ring-rose-500/30'
                                    : c.key === 'p' && row.p !== ''
                                      ? 'border-emerald-400 bg-white text-emerald-800 focus:ring-2 focus:ring-emerald-500/30'
                                      : 'border-stone-300 bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30',
                                )}
                              />
                            )
                          })}

                          {/* Kod „krajnje“ je ovo polje za unos, inače računat broj. */}
                          {endInput ? (
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              placeholder="0"
                              aria-label={`${item.name} — Krajnje stanje`}
                              value={row.e}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => setCell(item.id, 'e', e.target.value)}
                              className={cx(
                                'w-[70px] shrink-0 rounded-lg border px-1.5 py-2.5 text-center text-base font-bold tabular-nums outline-none transition',
                                bad
                                  ? 'border-rose-400 bg-white text-rose-700 focus:ring-2 focus:ring-rose-500/30'
                                  : row.e !== ''
                                    ? 'border-emerald-400 bg-white text-emerald-800 focus:ring-2 focus:ring-emerald-500/30'
                                    : 'border-stone-300 bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30',
                              )}
                            />
                          ) : (
                            <span
                              className={cx(
                                'w-[70px] shrink-0 text-right text-base font-extrabold tabular-nums',
                                bad ? 'text-rose-600' : done ? 'text-stone-900' : 'text-stone-300',
                              )}
                              title={
                                counter
                                  ? 'Brojač: krajnje stanje = početno + prodato'
                                  : 'Krajnje stanje = (početno + dodato) − prodato'
                              }
                            >
                              {done ? formatQty(end) : '—'}
                            </span>
                          )}
                        </div>

                        {bad && (
                          <p className="w-full text-xs font-medium text-rose-600">
                            {endInput
                              ? 'Krajnje je veće od novog stanja ('
                              : 'Prodato je veće od novog stanja ('}
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
                ? 'Admin još nije dodao artikle. Javi mu se.'
                : 'Nema artikla za traženi pojam.'}
            </p>
          )}
        </div>
      </Card>

      {/* ---------- Međusmena: šta rade prva i druga smena ---------- */}
      {shift === 'medjusmena' && reportId && (
        <MidShiftView date={reportDate} myName={profile?.full_name} />
      )}

      {/* ---------- Slika izveštaja (kasa + aparat za kartice) ---------- */}
      <Card className={cx(images.length === 0 && 'ring-1 ring-rose-300')}>
        <CardHeader
          title="Slika izveštaja"
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
            {images.length === 0 ? 'Slikaj izveštaje' : 'Dodaj još'}
          </Button>

          {/* Pravilo je kratko koliko može, ali mora da ostane: jedna slika,
              dva izveštaja, i koji od dva sa aparata zavisi od smene. */}
          <p className="hint">
            Na jednoj slici: <strong>prodaja po operateru</strong> i{' '}
            <strong>{terminalReportOf(shift)}</strong>.
          </p>

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
                      alt="Slika izveštaja sa kase i aparata za kartice"
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
            <p className="text-[13px] text-stone-400">Nema obaveze za ovaj dan.</p>
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
              Urađeno
            </span>
          </button>
        </div>
      </Card>

      {/* ---------- Napomena ---------- */}
      <Card>
        <CardHeader title="Napomena" subtitle="Opciono" />
        <div className="p-4">
          <Textarea
            rows={3}
            placeholder="npr. nestao Heineken oko 22h"
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              markField('note')
            }}
          />
        </div>
      </Card>

      {/* ---------- Fiksna traka sa dugmetom ----------
          Stoji tačno iznad donje navigacije (56 px + linija). Na iPhone-u je
          navigacija viša za prostor iznad crte za gašenje aplikacije — zato
          se dodaje i `safe-area-inset-bottom`, inače bi traka upala pod nju.
          Na računaru nema donje navigacije, pa je traka na samom dnu. */}
      <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom,0px))] z-20 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:py-4 lg:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Predato</p>
            <p className="truncate text-lg font-extrabold tabular-nums text-stone-900">
              {formatMoney(Math.max(0, cashNum), false)}
            </p>
          </div>
          {adminEdit ? (
            // Admin ne zatvara smenu — izmene su već sačuvane, samo se vraća na izveštaj.
            <Button
              type="button"
              size="lg"
              className="shrink-0"
              onClick={async () => {
                await flushPending()
                navigate(`/izvestaj/${reportId}`)
              }}
            >
              Gotovo
            </Button>
          ) : (
            <Button type="submit" size="lg" loading={submitting} className="shrink-0">
              Zatvori smenu
            </Button>
          )}
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
          Briše se ceo popis smene. Pazar i slike ostaju.
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
          Dnevnica za ovu smenu ti se neće računati. Popis ostaje.
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
          <div className="rounded-2xl bg-stone-100 px-4 py-3 text-sm">
            <p className="font-bold text-stone-900">
              {formatDate(reportDate)} · {SHIFT_LABELS[shift]}
            </p>
            <p className="mt-0.5 text-stone-600">{staffNames.map((p) => p.name).join(', ')}</p>
            <p className="mt-0.5 text-[12px] text-stone-400">
              Popis {doneCount}/{items.length} · {countLabel(images.length, 'slika')}
              {taskDone ? ' · obaveza urađena' : ''}
            </p>
          </div>

          <dl className="divide-y divide-stone-100 text-sm">
            <div className="flex justify-between py-2">
              <dt className="text-stone-500">Pazar</dt>
              <dd className="font-bold tabular-nums text-stone-900">
                {formatMoney(pazarNum, false)}
              </dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-stone-500">Kartice</dt>
              <dd className="font-bold tabular-nums text-stone-900">
                {formatMoney(cardNum, false)}
              </dd>
            </div>
          </dl>

          <div className="flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3.5 text-white">
            <p className="eyebrow text-stone-400">Predato</p>
            <p className="text-2xl font-extrabold tabular-nums">{formatMoney(cashNum, false)}</p>
          </div>

          <p className="text-[12px] text-stone-400">
            Posle zatvaranja popis se menja samo ako ga admin vrati.
          </p>
        </div>
      </Modal>
    </form>
  )
}
