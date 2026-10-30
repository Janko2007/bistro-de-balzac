import { supabase } from './supabaseClient'

/**
 * Popisi (admin) — izbrojano stanje artikala.
 *
 * Izbrojano stanje postaje početno stanje sledeće smene, a pri sledećem
 * popisu se vidi koliko čega fali od poslednjeg popisa. Sve računa baza
 * (skripta -21); ovde su samo pozivi.
 */

/** Stanje svakog aktivnog artikla: očekivano, prošli popis, prodato, dodato. */
export async function loadStatus() {
  const { data, error } = await supabase.rpc('inventory_status')
  if (error) throw error
  const map = new Map()
  for (const row of data ?? []) {
    map.set(row.item_id, {
      expected: row.expected_qty === null ? null : Number(row.expected_qty),
      source: row.base_source,
      baseAt: row.base_at,
      prevQty: row.prev_counted_qty === null ? null : Number(row.prev_counted_qty),
      prevAt: row.prev_counted_at,
      sold: Number(row.sold_since ?? 0),
      added: Number(row.added_since ?? 0),
    })
  }
  return map
}

/** Upisuje popis. items: [{ item_id, qty }], categories: nazivi popisanih u celini. */
export async function saveCount({ items, categories, note }) {
  const { data, error } = await supabase.rpc('save_inventory_count', {
    p_items: items,
    p_categories: categories,
    p_note: note || null,
  })
  if (error) throw error
  return data
}

/** Spisak popisa, najnoviji prvo. */
export async function loadCounts(limit = 30) {
  const { data, error } = await supabase
    .from('inventory_counts')
    .select('id, counted_at, counted_on, note, creator:profiles!inventory_counts_created_by_fkey ( full_name )')
    .order('counted_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

/** Stavke jednog popisa. */
export async function loadCountItems(countId) {
  const { data, error } = await supabase
    .from('inventory_count_items')
    .select(
      'id, item_id, item_name, category, unit, counted_qty, expected_qty, prev_counted_qty, prev_counted_at, sold_since, added_since',
    )
    .eq('count_id', countId)
  if (error) throw error
  return data ?? []
}

/** Briše popis — stanje se vraća na ono pre njega. */
export async function removeCount(countId) {
  const { error } = await supabase.from('inventory_counts').delete().eq('id', countId)
  if (error) throw error
}
