import { useEffect, useState } from 'react'

/**
 * Stanje ekrana koje se pamti.
 *
 * `usePersistentState` — isto kao `useState`, ali vrednost (filter, pretraga,
 * otvorene sekcije, izabran mesec…) preživi odlazak na drugi ekran. Čuva se u
 * `sessionStorage`: nestaje kad se aplikacija zatvori ili kad se radnik odjavi.
 *
 * `usePermanentState` — za podešavanja koja treba da ostanu i posle odjave i
 * ponovnog otvaranja aplikacije (npr. izabran period u Pregledu). Čuva se u
 * `localStorage` na tom telefonu, dok se ne promeni.
 */
const PREFIX = 'bdb.ui.'
const PERMANENT_PREFIX = 'bdb.pref.'

function read(storage, key) {
  try {
    const raw = storage().getItem(key)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

function write(storage, key, value) {
  try {
    const plain = value instanceof Set || value instanceof Map ? [...value] : value
    storage().setItem(key, JSON.stringify(plain))
  } catch {
    /* pun ili zabranjen prostor — stanje samo ne preživi odlazak */
  }
}

function useStoredState(storage, prefix, key, initial) {
  const [value, setValue] = useState(() => {
    const fallback = typeof initial === 'function' ? initial() : initial
    const saved = read(storage, prefix + key)
    if (saved === undefined) return fallback
    if (fallback instanceof Set) return Array.isArray(saved) ? new Set(saved) : fallback
    if (fallback instanceof Map) return Array.isArray(saved) ? new Map(saved) : fallback
    // Sačuvana vrsta mora da liči na početnu (string, broj, objekat…).
    if (fallback !== null && typeof fallback !== typeof saved) return fallback
    return saved
  })

  useEffect(() => {
    write(storage, prefix + key, value)
  }, [storage, prefix, key, value])

  return [value, setValue]
}

const session = () => window.sessionStorage
const local = () => window.localStorage

export function usePersistentState(key, initial) {
  return useStoredState(session, PREFIX, key, initial)
}

/** Ostaje i posle odjave i zatvaranja aplikacije. */
export function usePermanentState(key, initial) {
  return useStoredState(local, PERMANENT_PREFIX, key, initial)
}

/** Zaboravlja sve zapamćeno dok je aplikacija otvorena — poziva se pri odjavi. Trajna podešavanja ostaju. */
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