import { supabase } from './supabaseClient'

/**
 * Radna mesta — konobar, šanker, menadžer…
 *
 * Spisak pravi admin i sam ga dopunjuje. Jedan radnik može da ima više
 * radnih mesta; kod njega se čuvaju u jednoj koloni, odvojena zarezom.
 */

/** Spisak radnih mesta, redom kojim stoje. */
export async function loadPositions() {
  const { data, error } = await supabase
    .from('positions')
    .select('id, name, sort_order, is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  // Baza bez skripte za radna mesta — ekran radi i bez spiska.
  if (error) {
    console.error(error)
    return []
  }
  return data ?? []
}

/** Novo radno mesto na kraj spiska. Vraća upisani naziv. */
export async function addPosition(name, count = 0) {
  const value = name.trim()
  if (!value) throw new Error('Unesi naziv radnog mesta.')

  const { error } = await supabase
    .from('positions')
    .insert({ name: value, sort_order: (count + 1) * 10 })

  // Već postoji — to nije greška, samo ga izaberi.
  if (error && error.code !== '23505') throw error
  return value
}

/** „Konobar, Šanker“ → ['Konobar', 'Šanker'] */
export function parsePositions(text) {
  return String(text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** ['Konobar', 'Šanker'] → „Konobar, Šanker“ */
export function joinPositions(list) {
  return (list ?? []).map((s) => String(s).trim()).filter(Boolean).join(', ')
}
