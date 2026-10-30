import { useEffect, useState } from 'react'

/**
 * Stanje ekrana koje se pamti dok je aplikacija otvorena.
 *
 * Isto kao `useState`, ali vrednost (filter, pretraga, otvorene sekcije,
 * izabran mesec…) preživi odlazak na drugi ekran. Zato povratak iz pregleda
 * popisa vraća tačno onako kako je bilo, bez ponovnog biranja filtera.
 *
 * Čuva se u `sessionStorage` — nestaje kad se aplikacija zatvori ili kad se
 * radnik odjavi, a ne meša se između naloga.
 */
const PREFIX = 'bdb.ui.'

function read(key) {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

function write(key, value) {
  try {
    const plain = value instanceof Set || value instanceof Map ? [...value] : value
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(plain))
  } catch {
    /* pun ili zabranjen prostor — stanje samo ne preživi odlazak */
  }
}

export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    const fallback = typeof initial === 'function' ? initial() : initial
    const saved = read(key)
    if (saved === undefined) return fallback
    if (fallback instanceof Set) return Array.isArray(saved) ? new Set(saved) : fallback
    if (fallback instanceof Map) return Array.isArray(saved) ? new Map(saved) : fallback
    // Sačuvana vrsta mora da liči na početnu (string, broj, objekat…).
    if (fallback !== null && typeof fallback !== typeof saved) return fallback
    return saved
  })

  useEffect(() => {
    write(key, value)
  }, [key, value])

  return [value, setValue]
}

/** Zaboravlja sve zapamćeno — poziva se pri odjavi. */
export function clearPersistedState() {
  try {
    const store = window.sessionStorage
    for (let i = store.length - 1; i >= 0; i -= 1) {
      const name = store.key(i)
      if (name && name.startsWith(PREFIX)) store.removeItem(name)
    }
  } catch {
    /* nema šta da se briše */
  }
}
