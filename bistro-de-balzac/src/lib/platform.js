/**
 * Na kom telefonu se aplikacija otvara: 'ios' (iPhone, iPad), 'android' ili
 * 'other' (računar i sve ostalo). Služi samo da donja traka izgleda kao na
 * tom telefonu.
 *
 * Za isprobavanje na računaru: dodaj ?platform=ios ili ?platform=android na
 * adresu (npr. …/?platform=ios).
 */
export function detectPlatform() {
  if (typeof navigator === 'undefined') return 'other'

  try {
    const forced = new URLSearchParams(window.location.search).get('platform')
    if (forced === 'ios' || forced === 'android' || forced === 'other') return forced
  } catch {
    /* bez adrese — nastavlja se običnim prepoznavanjem */
  }

  const ua = navigator.userAgent || ''
  // Noviji iPad se predstavlja kao Mac, ali ima ekran na dodir.
  const iPadAsMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  if (/iPhone|iPad|iPod/.test(ua) || iPadAsMac) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}
