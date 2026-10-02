import { supabase } from './supabaseClient'

/**
 * Kategorije određuju redosled kojim se artikli prikazuju u popisu.
 * Admin ih menja kroz Artikli -> Kategorije.
 */
export async function loadCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, sort_order, is_active')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw error
  // Starije baze nemaju kolonu `is_active` — tamo je sve vidljivo.
  return (data ?? []).map((c) => ({ ...c, is_active: c.is_active !== false }))
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
