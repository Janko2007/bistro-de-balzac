import { supabase } from './supabaseClient'

/**
 * Kategorije određuju redosled kojim se artikli prikazuju u popisu.
 * Admin ih menja kroz Artikli -> Kategorije.
 */
export async function loadCategories() {
  const columns = 'id, name, sort_order, is_active, count_every_days, last_count_on, count_due'

  let { data, error } = await supabase
    .from('categories')
    .select(columns)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  // Baza u kojoj skripta za retko popisivanje još nije puštena nema te kolone.
  if (error) {
    const fallback = await supabase
      .from('categories')
      .select('id, name, sort_order, is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (fallback.error) throw fallback.error
    data = fallback.data
  }

  // Starije baze nemaju kolonu `is_active` — tamo je sve vidljivo.
  return (data ?? []).map((c) => ({
    ...c,
    is_active: c.is_active !== false,
    count_every_days: Number(c.count_every_days ?? 0) || 0,
    last_count_on: c.last_count_on ?? null,
    count_due: c.count_due === true,
  }))
}

/** Razlika u danima između dva datuma zapisana kao „2026-10-02“. */
function daysBetween(fromISO, toISO) {
  const from = Date.parse(`${fromISO}T00:00:00`)
  const to = Date.parse(`${toISO}T00:00:00`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Infinity
  return Math.round((to - from) / 86400000)
}

/**
 * Da li se ova grupa popisuje baš danas.
 *
 * Grupe sa `count_every_days = 0` se popisuju svaku smenu — to je obično.
 * Žestine stoje na 7 dana: tada se popisuju samo kad prođe nedelja od
 * poslednjeg popisa, ili kad admin zatraži popis dugmetom.
 */
export function isCountDue(category, dateISO) {
  const every = Number(category?.count_every_days ?? 0)
  if (!(every > 0)) return true
  if (category.count_due) return true
  if (!category.last_count_on) return true
  return daysBetween(category.last_count_on, dateISO) >= every
}

/** Datum sledećeg popisa, ili null ako se grupa popisuje svaku smenu. */
export function nextCountOn(category) {
  const every = Number(category?.count_every_days ?? 0)
  if (!(every > 0) || !category.last_count_on) return null
  const d = new Date(`${category.last_count_on}T00:00:00`)
  d.setDate(d.getDate() + every)
  return d.toISOString().slice(0, 10)
}

/** Nazivi grupa koje se danas NE popisuju — njima se početno prepisuje. */
export function carriedCategoryNames(categories, dateISO) {
  return new Set(
    categories.filter((c) => c.is_active && !isCountDue(c, dateISO)).map((c) => c.name),
  )
}

/** Nazivi grupa koje su sakrivene — njihovi artikli ne idu u popis. */
export function hiddenCategoryNames(categories) {
  return new Set(categories.filter((c) => !c.is_active).map((c) => c.name))
}

/**
 * Pravi funkciju za sortiranje naziva kategorija po zadatom redosledu.
 * Kategorije kojih nema u spisku (npr. stari snapshot u izveštaju) idu na kraj.
 */
export function categoryComparator(categories) {
  const index = new Map(categories.map((c, i) => [c.name, i]))
  return (a, b) => {
    const ia = index.has(a) ? index.get(a) : Number.MAX_SAFE_INTEGER
    const ib = index.has(b) ? index.get(b) : Number.MAX_SAFE_INTEGER
    return ia - ib || a.localeCompare(b, 'sr')
  }
}
