/**
 * Priprema slike izveštaja pre slanja na Supabase Storage.
 *
 * Cilj je da besplatnih 1 GB nikad ne popuniš. Zato se slika:
 *   1) smanji na 1280 px po dužoj strani,
 *   2) prebaci u sivu skalu sa blagim pojačanjem kontrasta,
 *   3) sačuva kao JPEG kvaliteta 0.68.
 *
 * Traka sa kase je crn tekst na beloj podlozi — boja ne nosi nikakvu
 * informaciju, a njeno uklanjanje smanjuje fajl za dodatnih ~25%.
 * Rezultat: fotografija od 5 MB postaje ~130 KB, tekst i dalje čitak.
 *
 * Ako ti se učini da je tekst premutan, podigni QUALITY na 0.8 ili
 * MAX_SIZE na 1600 — slika će biti oko duplo veća.
 */
const MAX_SIZE = 1280
const QUALITY = 0.68
const GRAYSCALE = true

export async function compressImage(file, options = {}) {
  if (!file || !file.type?.startsWith('image/')) return file

  const maxSize = options.maxSize ?? MAX_SIZE
  const quality = options.quality ?? QUALITY
  const grayscale = options.grayscale ?? GRAYSCALE

  try {
    const bitmap = await loadBitmap(file)
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)

    // Siva skala + blagi kontrast: manji fajl, a štampa sa trake čitljivija.
    // Stariji pretraživači nemaju ctx.filter — tada se slika crta u boji.
    if (grayscale && 'filter' in ctx) {
      ctx.filter = 'grayscale(1) contrast(1.15) brightness(1.03)'
    }

    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file

    const name = file.name.replace(/\.[^.]+$/, '') || 'izvestaj'
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } catch (err) {
    console.warn('Kompresija slike nije uspela, šaljem original.', err)
    return file
  }
}

/**
 * Slika profila: kvadrat iz sredine fotografije, 640×640, JPEG 0.82.
 * Dovoljno oštro i kad se klikne i uveća, a ma koliko velika fotografija
 * bila, rezultat je ~50–80 KB.
 */
export async function squareAvatar(file, size = 640) {
  const bitmap = await loadBitmap(file)
  const w = bitmap.width
  const h = bitmap.height
  const side = Math.min(w, h)
  const out = Math.min(size, side)

  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out, out)
  ctx.drawImage(bitmap, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out)
  bitmap.close?.()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  if (!blob) throw new Error('Ne mogu da obradim sliku.')
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() })
}

function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    // `from-image` poštuje EXIF rotaciju — bez toga su slike sa telefona
    // ponekad okrenute na stranu.
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
      createImageBitmap(file),
    )
  }

  // Fallback za starije Safari verzije
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}

/** Nasumično, bezbedno ime fajla u storage-u. */
export function buildStoragePath(reportId, file, index) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const rand = Math.random().toString(36).slice(2, 8)
  return `${reportId}/${Date.now()}-${index}-${rand}.${ext || 'jpg'}`
}
