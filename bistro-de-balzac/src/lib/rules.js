import { weekdayName } from './deposits'

/** Dokument „Dnevne obaveze“ iz spiska pravila (po naslovu). */
export function findDailyDoc(docs) {
  return (docs ?? []).find((d) => /dnevne\s+obaveze/i.test(d.title)) ?? null
}

/**
 * Deo teksta ispod naslova „# <naslov>“, do sledećeg naslova.
 * sectionUnder(body, 'Utorak') → obaveze za utorak.
 */
export function sectionUnder(body, heading) {
  const want = String(heading ?? '').trim().toLowerCase()
  const out = []
  let inside = false

  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#')) {
      if (inside) break
      inside = line.replace(/^#+\s*/, '').trim().toLowerCase() === want
      continue
    }
    if (inside) out.push(raw)
  }

  return out.join('\n').trim()
}

/** Dnevne obaveze za dan u kome je smena (npr. „Utorak“ + tekst ispod). */
export function dailyTaskFor(docs, dateISO) {
  const day = weekdayName(dateISO)
  const text = sectionUnder(findDailyDoc(docs)?.body, day)
  return { day: day.charAt(0).toUpperCase() + day.slice(1), text }
}
