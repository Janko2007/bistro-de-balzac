import { supabase } from './supabaseClient'

/**
 * Kategorije određuju redosled kojim se artikli prikazuju u popisu.
 * Vlasnik ih menja kroz Artikli -> Kategorije.
 */
export async function loadCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw error
  return data ?? []
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
