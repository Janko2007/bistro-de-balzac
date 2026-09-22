import { LOCALE, todayISO } from './utils'

/**
 * Obračunski periodi — plate su svakog 1. i 16. u mesecu.
 *
 *   1. – 15.        →  isplata 16. istog meseca
 *   16. – kraj      →  isplata 1. sledećeg meseca
 *
 * Odatle prirodno sledi pravilo iz lokala: ako se radi NA DAN ISPLATE, ta
 * dnevnica ulazi u sledeću platu. Smena odrađena 16. pada u period
 * 16.–kraj, koji se isplaćuje tek 1. sledećeg meseca; smena odrađena 1.
 * pada u period 1.–15., koji se isplaćuje 16.
 */

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const lastDayOf = (y, m) => new Date(y, m, 0).getDate()

function makePeriod(year, month, half) {
  if (half === 1) {
    return {
      key: `${year}-${pad(month)}-A`,
      year,
      month,
      half: 1,
      from: iso(year, month, 1),
      to: iso(year, month, 15),
      payDate: iso(year, month, 16),
    }
  }

  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1

  return {
    key: `${year}-${pad(month)}-B`,
    year,
    month,
    half: 2,
    from: iso(year, month, 16),
    to: iso(year, month, lastDayOf(year, month)),
    payDate: iso(nextYear, nextMonth, 1),
  }
}

/** Kom periodu pripada dati datum (YYYY-MM-DD). */
export function periodOf(dateISO) {
  const [y, m, d] = String(dateISO).split('-').map(Number)
  return makePeriod(y, m, d <= 15 ? 1 : 2)
}

/** Period u kome se trenutno nalazimo. */
export function currentPeriod() {
  return periodOf(todayISO())
}

/** Period pomeren za `delta` polovina unapred (+) ili unazad (−). */
export function shiftPeriod(period, delta) {
  const index = period.year * 24 + (period.month - 1) * 2 + (period.half - 1) + delta
  const year = Math.floor(index / 24)
  const rest = index - year * 24
  return makePeriod(year, Math.floor(rest / 2) + 1, (rest % 2) + 1)
}

/** Period rekonstruisan iz ključa "2026-09-A". */
export function periodFromKey(key) {
  const match = String(key).match(/^(\d{4})-(\d{2})-([AB])$/)
  if (!match) return currentPeriod()
  return makePeriod(+match[1], +match[2], match[3] === 'A' ? 1 : 2)
}

/** "1–15. septembar 2026." */
export function periodLabel(period) {
  const monthName = new Intl.DateTimeFormat(LOCALE, { month: 'long' }).format(
    new Date(period.year, period.month - 1, 1),
  )
  const lastDay = period.half === 1 ? 15 : lastDayOf(period.year, period.month)
  const firstDay = period.half === 1 ? 1 : 16
  return `${firstDay}–${lastDay}. ${monthName} ${period.year}.`
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
