/** Nazivi smena za prikaz. */
export const SHIFTS = [
  { value: 'prva', label: 'Prva smena', hint: 'jutarnja' },
  { value: 'druga', label: 'Druga smena', hint: 'večernja' },
  { value: 'medjusmena', label: 'Međusmena', hint: 'između' },
]

export const SHIFT_LABELS = {
  prva: 'Prva smena',
  druga: 'Druga smena',
  medjusmena: 'Međusmena',
}

export const STATUS_LABELS = {
  otvoren: 'Smena u toku',
  poslat: 'Čeka potvrdu',
  potvrdjen: 'Potvrđen',
  vracen: 'Vraćen na ispravku',
}

export const STATUS_STYLES = {
  otvoren: 'bg-sky-100 text-sky-800 ring-sky-600/20',
  poslat: 'bg-amber-100 text-amber-800 ring-amber-600/20',
  potvrdjen: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20',
  vracen: 'bg-rose-100 text-rose-800 ring-rose-600/20',
}

const MONEY_WHOLE = new Intl.NumberFormat('sr-RS', { maximumFractionDigits: 0 })
const MONEY_CENTS = new Intl.NumberFormat('sr-RS', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * 1000 -> "1.000 RSD", bez „,00“ — tako se piše svuda u aplikaciji.
 * Pare se NE gube: ako ih ima, ostaju — 12345.5 -> "12.345,50 RSD".
 */
export function formatMoney(value, withCurrency = true) {
  const raw = Number(value ?? 0)
  const num = Number.isFinite(raw) ? Math.round(raw * 100) / 100 : 0
  const formatted = Number.isInteger(num) ? MONEY_WHOLE.format(num) : MONEY_CENTS.format(num)
  return withCurrency ? `${formatted} RSD` : formatted
}

/** Isto što i formatMoney bez „RSD“ (ostavljeno zbog postojećih poziva). */
export function formatMoneyShort(value) {
  return formatMoney(value, false)
}

/**
 * 3 -> "3", 3.5 -> "3,5" (bez nepotrebnih nula).
 * Prazna vrednost je "—", a ne nula — nepopisan artikal se ne sme prikazati
 * kao da mu je stanje nula.
 */
export function formatQty(value) {
  if (value === null || value === undefined || value === '') return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return new Intl.NumberFormat('sr-RS', { maximumFractionDigits: 2 }).format(num)
}

/* ------------------------------------------------------------------ */
/*  Množina uz broj                                                    */
/* ------------------------------------------------------------------ */
/**
 * Srpski ima tri oblika uz broj, a koji se koristi zavisi od POSLEDNJE cifre:
 *
 *   1, 21, 101…        →  1 smena
 *   2–4, 22–24, 102…   →  2 smene
 *   0, 5–20, 25–30…    →  5 smena
 *
 * Izuzetak su 11–14 — oni uvek idu u treći oblik (11 smena, ne 11 smene).
 */
const PLURALS = {
  smena: ['smena', 'smene', 'smena'],
  dan: ['dan', 'dana', 'dana'],
  uplata: ['uplata', 'uplate', 'uplata'],
  slika: ['slika', 'slike', 'slika'],
  artikal: ['artikal', 'artikla', 'artikala'],
  // Posle predloga koji traže genitiv („kod 2 artikla“, „od 2 artikla“)
  artikla: ['artikla', 'artikla', 'artikala'],
  izvestaj: ['izveštaj', 'izveštaja', 'izveštaja'],
  radnik: ['radnik', 'radnika', 'radnika'],
  stavka: ['stavka', 'stavke', 'stavki'],
}

/**
 * Oblik reči uz dati broj.
 * `forms` je ključ iz PLURALS ili niz [za 1, za 2–4, za 5+].
 */
export function plural(n, forms) {
  const list = Array.isArray(forms) ? forms : PLURALS[forms]
  if (!list) return ''

  const num = Math.abs(Math.trunc(Number(n) || 0))
  const last = num % 10
  const lastTwo = num % 100

  if (lastTwo >= 11 && lastTwo <= 14) return list[2]
  if (last === 1) return list[0]
  if (last >= 2 && last <= 4) return list[1]
  return list[2]
}

/** Broj i reč u ispravnom obliku: countLabel(3, 'smena') -> "3 smene" */
export function countLabel(n, forms) {
  return `${Math.trunc(Number(n) || 0)} ${plural(n, forms)}`
}

/** "2026-09-20" -> "20.09.2026." */
export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dateStr
  return new Intl.DateTimeFormat('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

/** ISO timestamp -> "20.09.2026. 23:41" */
export function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

/** Današnji datum u formatu YYYY-MM-DD po lokalnoj zoni (ne UTC!). */
export function todayISO() {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60 * 1000).toISOString().slice(0, 10)
}

/** Datum pre N dana, YYYY-MM-DD. */
export function daysAgoISO(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60 * 1000).toISOString().slice(0, 10)
}

/** "2026-09" -> { from: "2026-09-01", to: "2026-09-30" } */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

/**
 * Srpska latinica. `sr-RS` ispisuje nazive meseci i dana ĆIRILICOM
 * („септембар“), a cela aplikacija je na latinici — zato svuda gde se
 * ispisuje REČ ide ovaj jezik. Brojevi i datumi u ciframa su isti u oba.
 */
export const LOCALE = 'sr-Latn-RS'

/** "2026-09" -> "septembar 2026." */
export function formatMonth(month) {
  const [y, m] = month.split('-').map(Number)
  const label = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(
    new Date(y, m - 1, 1),
  )
  return label
}

/**
 * Prepoznaje datum ukucan na više načina — isto svuda u aplikaciji.
 *
 *   15              -> 15. u tekućem mesecu
 *   15.9   15.09.   -> 15. septembar tekuće godine
 *   15.9.2026       -> tačan datum
 *   2026-09-15      -> tačan datum
 *   9.2026  2026-09 -> ceo mesec
 *
 * Vraća { from, to } ili null ako uneto nije datum.
 */
export function parseDateInput(input) {
  const q = String(input ?? '').trim()
  if (!q) return null

  const now = new Date()
  const curYear = now.getFullYear()
  const curMonth = now.getMonth() + 1

  const pad = (n) => String(n).padStart(2, '0')
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
  const lastDay = (y, m) => new Date(y, m, 0).getDate()

  const day = (y, m, d) =>
    m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m) ? { from: iso(y, m, d), to: iso(y, m, d) } : null
  const month = (y, m) =>
    m >= 1 && m <= 12 ? { from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) } : null

  let t = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (t) return day(+t[1], +t[2], +t[3])

  t = q.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\.?$/)
  if (t) return day(+t[3], +t[2], +t[1])

  t = q.match(/^(\d{1,2})[./-](\d{4})\.?$/)
  if (t) return month(+t[2], +t[1])

  t = q.match(/^(\d{4})-(\d{1,2})$/)
  if (t) return month(+t[1], +t[2])

  t = q.match(/^(\d{1,2})[./-](\d{1,2})\.?$/)
  if (t) return day(curYear, +t[2], +t[1])

  t = q.match(/^(\d{1,2})$/)
  if (t) return day(curYear, curMonth, +t[1])

  return null
}

/** Parsira uneti broj — prihvata i zarez kao decimalni separator. */
export function parseNumber(input) {
  if (input === '' || input === null || input === undefined) return 0
  const n = parseFloat(String(input).replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Spaja klase, ignoriše falsy vrednosti. */
export function cx(...classes) {
  return classes.filter(Boolean).join(' ')
}

/* ------------------------------------------------------------------ */
/*  Korisničko ime = puno ime radnika                                  */
/*  Supabase Auth traži email, pa ga generišemo iz imena. Radnik nikad */
/*  ne vidi tu adresu — on kuca svoje ime i prezime.                   */
/*  Mora biti identično funkciji u supabase/functions/manage-worker.   */
/* ------------------------------------------------------------------ */
export const LOGIN_DOMAIN = import.meta.env.VITE_LOGIN_DOMAIN || 'bistrodebalzac.rs'

const LATIN_MAP = { č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj' }

/** "Marko Marković" -> "marko.markovic" */
export function slugifyName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[čćžšđ]/g, (c) => LATIN_MAP[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

/** "Marko Marković" -> "marko.markovic@bistrodebalzac.rs" */
export function loginEmail(name) {
  return `${slugifyName(name)}@${LOGIN_DOMAIN}`
}

/**
 * Šta je korisnik ukucao u polje za prijavu?
 * Ako je upisao email — koristi se kao takav (vlasnikov nalog iz Supabase panela).
 * Inače se tretira kao puno ime i pretvara u adresu za prijavu.
 */
export function resolveLogin(input) {
  const value = String(input ?? '').trim()
  return value.includes('@') ? value.toLowerCase() : loginEmail(value)
}

/** Inicijali iz imena: "Marko Marković" -> "MM" */
export function initials(name) {
  if (!name) return '?'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** Čitljiva poruka iz Supabase greške. */
export function errorMessage(error, fallback = 'Došlo je do greške. Pokušaj ponovo.') {
  if (!error) return fallback
  const msg = error.message || error.error_description || ''
  const map = {
    'Invalid login credentials': 'Pogrešno ime ili lozinka.',
    'Email not confirmed': 'Nalog nije potvrđen. Javi se vlasniku.',
    'Failed to fetch': 'Nema internet konekcije ili je server nedostupan.',
    'User already registered': 'Korisnik sa ovim emailom već postoji.',
  }
  for (const [key, value] of Object.entries(map)) {
    if (msg.includes(key)) return value
  }
  return msg || fallback
}
