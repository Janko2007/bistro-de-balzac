import { supabase } from './supabaseClient'
import { squareAvatar } from './image'

/**
 * Slike profila — bucket 'avatari', putanja <id radnika>/<vreme>.jpg.
 *
 * Bucket je privatan, pa se slika prikazuje preko signed URL-a. Adrese se
 * pamte u memoriji dok ne isteknu, da se ista slika ne traži iznova na
 * svakom ekranu.
 */
export const AVATAR_BUCKET = 'avatari'

const TTL = 60 * 60 * 12 // 12 sati
const cache = new Map() // path → { url, exp } | Promise

export function avatarUrl(path) {
  if (!path) return Promise.resolve(null)

  const hit = cache.get(path)
  if (hit instanceof Promise) return hit
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.url)

  const request = supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, TTL)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) {
        cache.delete(path)
        return null
      }
      // Obnovi malo pre isteka.
      cache.set(path, { url: data.signedUrl, exp: Date.now() + (TTL - 600) * 1000 })
      return data.signedUrl
    })
    .catch(() => {
      cache.delete(path)
      return null
    })

  cache.set(path, request)
  return request
}

/**
 * Postavlja novu sliku: iseče je na kvadrat, pošalje u storage, upiše putanju
 * u profil i obriše staru. Vraća novu putanju.
 */
export async function uploadAvatar(person, file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Izaberi sliku (JPG ili PNG).')

  const image = await squareAvatar(file)
  const path = `${person.id}/${Date.now()}.jpg`

  const { error: upErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, image, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw upErr

  const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', person.id)
  if (error) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path])
    throw error
  }

  if (person.avatar_path) {
    cache.delete(person.avatar_path)
    await supabase.storage.from(AVATAR_BUCKET).remove([person.avatar_path])
  }
  return path
}

/** Uklanja sliku — posle toga se opet vide inicijali. */
export async function removeAvatar(person) {
  const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', person.id)
  if (error) throw error

  if (person.avatar_path) {
    cache.delete(person.avatar_path)
    await supabase.storage.from(AVATAR_BUCKET).remove([person.avatar_path])
  }
}
