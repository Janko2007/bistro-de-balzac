import { LOCALE, todayISO } from './utils'

/**
 * Raspored uplate pazara u banku:
 *
 *   ponedeljkom  →  uplaćuje se petak, subota i nedelja
 *   petkom       →  uplaćuje se ponedeljak, utorak, sreda i četvrtak
 *
 * Oba pravila su zapravo jedno te isto: pazar nekog dana se uplaćuje
 * PRVOG SLEDEĆEG ponedeljka ili petka. Odatle se sve izvodi samo — nema
 * potrebe nabrajati dane.
 *
 * Raspored je samo podsetnik. Šta je stvarno uplaćeno zna baza: tamo stoji
 * spisak uplaćenih dana, pa vlasnik može da uplati i mimo rasporeda i da
 * označi baš one dane koje je pokrio.
 */

const MONDAY = 1
const FRIDAY = 5

const pad = (n) => String(n).padStart(2, '0')

/** "2026-09-21" -> Date u lokalnoj zoni (bez UTC pomeranja). */
function toDate(dateISO) {
  const [y, m, d] = String(dateISO).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Kog dana se po rasporedu uplaćuje pazar od datog dana. */
export function depositDueDate(businessDate) {
  const d = toDate(businessDate)
  do {
    d.setDate(d.getDate() + 1)
  } while (d.getDay() !== MONDAY && d.getDay() !== FRIDAY)
  return toISO(d)
}

/** Da li je dan uplate stigao (danas ili ranije)? */
export function isDue(dueDate) {
  return dueDate <= todayISO()
}

/** "ponedeljak" */
export function weekdayName(dateISO) {
  return new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(toDate(dateISO))
}

/** "pon 22.09." — za uske prikaze i čipove */
export function shortDay(dateISO) {
  const d = toDate(dateISO)
  const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' })
    .format(d)
    .replace(/\.$/, '')
  return `${weekday} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`
}

/** "ponedeljak, 22.09.2026." */
export function longDay(dateISO) {
  const d = toDate(dateISO)
  return `${weekdayName(dateISO)}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}.`
}

/**
 * Razvrstava neuplaćene dane u grupe po danu uplate.
 * Ulaz: [{ date, cash, ... }]  →  izlaz: [{ due, overdue, total, days: [...] }]
 * Sortirano tako da najstariji dug stoji prvi.
 */
export function groupByDueDate(days) {
  const groups = new Map()

  for (const day of days) {
    const due = depositDueDate(day.date)
    if (!groups.has(due)) groups.set(due, { due, total: 0, days: [] })
    const group = groups.get(due)
    group.days.push(day)
    group.total += day.cash
  }

  return [...groups.values()]
    .sort((a, b) => (a.due < b.due ? -1 : 1))
    .map((group) => ({
      ...group,
      overdue: isDue(group.due),
      days: group.days.sort((a, b) => (a.date < b.date ? -1 : 1)),
    }))
}
