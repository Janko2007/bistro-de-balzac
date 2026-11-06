import { supabase } from './supabaseClient'
import { LOCALE, todayISO } from './utils'

/**
 * Obračunski periodi.
 *
 * Podrazumevano se plata isplaćuje dva puta mesečno:
 *
 *   1. – 15.        →  isplata 16. istog meseca
 *   16. – kraj      →  isplata 1. sledećeg meseca
 *
 * Odatle prirodno sledi pravilo iz lokala: ako se radi NA DAN ISPLATE, ta
 * dnevnica ulazi u sledeću platu. Smena odrađena 16. pada u period
 * 16.–kraj, koji se isplaćuje tek 1. sledećeg meseca; smena odrađena 1.
 * pada u period 1.–15., koji se isplaćuje 16.
 *
 * Admin to menja u Podešavanjima, tri načina:
 *   • „pola“  — dva puta mesečno, a drugi period počinje onog dana koji izabere
 *   • „mesec“ — jednom mesečno, ceo mesec
 *   • „dani“  — period traje tačno onoliko dana koliko admin upiše, računato
 *               od datuma koji izabere (7, 10, 14, 20… dana)
 */
export const DEFAULT_PAY_PERIOD = { mode: 'pola', split: 16, days: 10, anchor: '' }

let config = { ...DEFAULT_PAY_PERIOD }

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const lastDayOf = (y, m) => new Date(y, m, 0).getDate()

/* ---- datumi kao dani (UTC, bez problema sa letnjim vremenom) ---- */
const DAY_MS = 86400000
const dayNumber = (isoDate) => {
  const [y, m, d] = String(isoDate).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}
const fromDayNumber = (n) => {
  const date = new Date(n * DAY_MS)
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}
const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))
const firstOfThisMonth = () => `${todayISO().slice(0, 7)}-01`

/** Ispravna postavka iz bilo čega što je došlo iz baze. */
export function normalizePayPeriod(raw) {
  const mode = raw?.mode === 'mesec' ? 'mesec' : raw?.mode === 'dani' ? 'dani' : 'pola'
  const split = Math.min(28, Math.max(2, Math.trunc(Number(raw?.split)) || 16))
  const days = Math.min(62, Math.max(1, Math.trunc(Number(raw?.days)) || 10))
  const anchor = isIsoDate(raw?.anchor) ? raw.anchor : firstOfThisMonth()
  return { mode, split, days, anchor }
}

export function getPayPeriod() {
  return config
}

export function setPayPeriod(raw) {
  config = normalizePayPeriod(raw)
}

export const PAY_PERIOD_KEY = 'pay_period'

/** Učitava postavku iz baze; dok je nema važi podrazumevana. */
export async function loadPayPeriod() {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', PAY_PERIOD_KEY)
      .maybeSingle()
    setPayPeriod(error ? null : data?.value)
  } catch {
    setPayPeriod(null)
  }
  return config
}

export async function savePayPeriod(raw) {
  const value = normalizePayPeriod(raw)
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: PAY_PERIOD_KEY, value }, { onConflict: 'key' })
  if (error) throw error
  config = value
  // Izabrani period iz prethodnog podešavanja više ne postoji — kreće se od tekućeg.
  try {
    window.sessionStorage.removeItem('bdb.ui.workers.period')
    window.sessionStorage.removeItem('bdb.ui.myearn.period')
  } catch {
    /* bez skladišta — nema šta da se briše */
  }
  return value
}

/** Period od `start` (YYYY-MM-DD) koji traje `config.days` dana. */
function makeDaysPeriod(start) {
  const first = dayNumber(start)
  const to = fromDayNumber(first + config.days - 1)
  const [y, m] = start.split('-').map(Number)
  return {
    key: `d${start}`,
    year: y,
    month: m,
    half: 1,
    from: start,
    to,
    payDate: fromDayNumber(first + config.days),
  }
}

function makePeriod(year, month, half) {
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1

  // Mesečni obračun: jedan period, ceo mesec.
  if (config.mode === 'mesec') {
    return {
      key: `${year}-${pad(month)}-A`,
      year,
      month,
      half: 1,
      from: iso(year, month, 1),
      to: iso(year, month, lastDayOf(year, month)),
      payDate: iso(nextYear, nextMonth, 1),
    }
  }

  if (half === 1) {
    return {
      key: `${year}-${pad(month)}-A`,
      year,
      month,
      half: 1,
      from: iso(year, month, 1),
      to: iso(year, month, config.split - 1),
      payDate: iso(year, month, config.split),
    }
  }

  return {
    key: `${year}-${pad(month)}-B`,
    year,
    month,
    half: 2,
    from: iso(year, month, config.split),
    to: iso(year, month, lastDayOf(year, month)),
    payDate: iso(nextYear, nextMonth, 1),
  }
}

/** Da li je obračun jednom mesečno (jedan period po mesecu). */
export const isMonthly = () => config.mode === 'mesec'

/** Da li periodi traju zadati broj dana. */
export const isByDays = () => config.mode === 'dani'

/** Kom periodu pripada dati datum (YYYY-MM-DD). */
export function periodOf(dateISO) {
  if (config.mode === 'dani') {
    const offset = dayNumber(dateISO) - dayNumber(config.anchor)
    const index = Math.floor(offset / config.days)
    return makeDaysPeriod(fromDayNumber(dayNumber(config.anchor) + index * config.days))
  }
  const [y, m, d] = String(dateISO).split('-').map(Number)
  return makePeriod(y, m, config.mode === 'mesec' || d < config.split ? 1 : 2)
}

/** Period u kome se trenutno nalazimo. */
export function currentPeriod() {
  return periodOf(todayISO())
}

/** Period pomeren za `delta` perioda unapred (+) ili unazad (−). */
export function shiftPeriod(period, delta) {
  if (config.mode === 'dani') {
    return makeDaysPeriod(fromDayNumber(dayNumber(period.from) + delta * config.days))
  }
  if (config.mode === 'mesec') {
    const index = period.year * 12 + (period.month - 1) + delta
    const year = Math.floor(index / 12)
    return makePeriod(year, index - year * 12 + 1, 1)
  }
  const index = period.year * 24 + (period.month - 1) * 2 + (period.half - 1) + delta
  const year = Math.floor(index / 24)
  const rest = index - year * 24
  return makePeriod(year, Math.floor(rest / 2) + 1, (rest % 2) + 1)
}

/** Period rekonstruisan iz ključa "2026-09-A" (ili "d2026-09-07" kod perioda po danima). */
export function periodFromKey(key) {
  const text = String(key)
  if (config.mode === 'dani') {
    const m = text.match(/^d(\d{4}-\d{2}-\d{2})$/)
    return m ? periodOf(m[1]) : currentPeriod()
  }
  const match = text.match(/^(\d{4})-(\d{2})-([AB])$/)
  if (!match) return currentPeriod()
  return makePeriod(+match[1], +match[2], match[3] === 'A' ? 1 : 2)
}

/**
 * "1–15. septembar 2026." ili, preko granice meseca, "28. okt – 10. nov 2026."
 * `withYear = false` izostavlja godinu — za mala polja gde ne bi stala.
 */
export function periodLabel(period, withYear = true) {
  const fmt = (opts) => new Intl.DateTimeFormat(LOCALE, opts)
  const [fy, fm, fd] = period.from.split('-').map(Number)
  const [ty, tm, td] = period.to.split('-').map(Number)

  if (fy === ty && fm === tm) {
    const monthName = fmt({ month: 'long' }).format(new Date(fy, fm - 1, 1))
    return `${fd}–${td}. ${monthName}${withYear ? ` ${fy}.` : ''}`
  }
  const short = (y, m) => fmt({ month: 'short' }).format(new Date(y, m - 1, 1)).replace('.', '')
  const left = `${fd}. ${short(fy, fm)}${withYear && fy !== ty ? ` ${fy}.` : ''}`
  return `${left} – ${td}. ${short(ty, tm)}${withYear ? ` ${ty}.` : ''}`
}

/** Da li je period još uvek u toku? */
export function isOpenPeriod(period) {
  const today = todayISO()
  return today >= period.from && today <= period.to
}

/** Period koji počinje posle današnjeg dana — nema smisla ga prikazivati. */
export function isFuturePeriod(period) {
  return period.from > todayISO()
}
