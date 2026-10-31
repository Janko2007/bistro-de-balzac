import { DAY_NAMES, SHIFT_INFO, SLOT_LABELS, hasCustomTime, timeOf, shiftsOf, shortDate, slotsOf, toCyrillic, weekDays, weekLabel } from './schedule'

/**
 * Raspored kao slika (PNG): čist, svetao izgled — bela podloga, tanke linije,
 * dani gore, smene levo. Crta se na canvas-u u pregledaču; ništa se ne šalje
 * na server.
 */
const PAD = 18
const LABEL_W = 118
const DAY_W = 156
const HEAD_H = 92
const SCALE = 2 // dvostruka oštrina, da slika bude jasna i kad se uveća
const FONT = "'Inter', 'Segoe UI', Arial, sans-serif"

const INK = '#1c1917'
const MUTED = '#a8a29e'
const LINE = '#ebe7e0'
const LINE_STRONG = '#d8d3ca'
const BRAND = '#ef5f07'
const MINE = '#fff0e0'

/**
 * Samo ime. Ako u kolektivu ima više istih imena, uz ime ide i početno slovo
 * prezimena („Marina P.“). `names` je Map(id → puno ime) svih radnika.
 */
export function displayNames(names) {
  const first = (full) => String(full ?? '').trim().split(/\s+/)[0] ?? ''
  const count = new Map()
  for (const full of names.values()) {
    const key = first(full).toLowerCase()
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  const out = new Map()
  for (const [id, full] of names) {
    const parts = String(full ?? '').trim().split(/\s+/)
    const name = parts[0] ?? ''
    const twin = (count.get(name.toLowerCase()) ?? 0) > 1
    const surname = parts.length > 1 ? parts[parts.length - 1] : ''
    out.set(id, twin && surname ? `${name} ${surname[0].toUpperCase()}.` : name)
  }
  return out
}

function loadLogo() {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = '/icons/icon-192.png'
  })
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function rowHeight(week, shift) {
  const n = slotsOf(week, shift).length
  return n > 1 ? 112 : shift === 'medjusmena' ? 104 : 92
}

/**
 * Crta raspored i vraća canvas.
 *   cyr   — ćirilica
 *   blank — prazan obrazac (bez imena)
 *   meId  — istakni smene tog radnika
 *   logo  — false: bez loga (kad pregledač zabrani izvoz slike sa logom)
 */
export async function renderScheduleCanvas({ week, slots, names, cyr = false, blank = false, meId = null, logo = true }) {
  const t = (s) => (cyr ? toCyrillic(s) : s)
  const shown = displayNames(names)
  const days = weekDays(week.week_start)
  const shifts = shiftsOf(week)
  const heights = shifts.map((s) => rowHeight(week, s))
  const innerW = LABEL_W + DAY_W * 7
  const innerH = HEAD_H + heights.reduce((a, b) => a + b, 0)
  const W = innerW + PAD * 2
  const H = innerH + PAD * 2

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  // bela podloga
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  const X0 = PAD
  const Y0 = PAD
  const logoImg = logo ? await loadLogo() : null

  // kartica blago zaobljenih ivica; sve unutra se seče po njoj
  ctx.save()
  roundRect(ctx, X0, Y0, innerW, innerH, 18)
  ctx.clip()

  // zaglavlje — vrlo blaga podloga
  ctx.fillStyle = '#faf8f5'
  ctx.fillRect(X0, Y0, innerW, HEAD_H)

  // istaknute smene radnika
  if (meId && !blank) {
    let y = Y0 + HEAD_H
    shifts.forEach((shift, si) => {
      days.forEach((day, di) => {
        const mine = slots.some((s) => s.day === day && s.shift === shift && s.profile_id === meId)
        if (mine) {
          ctx.fillStyle = MINE
          ctx.fillRect(X0 + LABEL_W + di * DAY_W + 1, y + 1, DAY_W - 2, heights[si] - 2)
        }
      })
      y += heights[si]
    })
  }

  // linije
  ctx.lineWidth = 1.5
  ctx.strokeStyle = LINE_STRONG
  ctx.beginPath()
  ctx.moveTo(X0, Y0 + HEAD_H)
  ctx.lineTo(X0 + innerW, Y0 + HEAD_H)
  ctx.stroke()

  ctx.strokeStyle = LINE
  ctx.beginPath()
  let yy = Y0 + HEAD_H
  heights.forEach((h, i) => {
    yy += h
    if (i < heights.length - 1) {
      ctx.moveTo(X0, yy)
      ctx.lineTo(X0 + innerW, yy)
    }
  })
  for (let i = 0; i < 7; i += 1) {
    const x = X0 + LABEL_W + i * DAY_W
    ctx.moveTo(x, Y0)
    ctx.lineTo(x, Y0 + innerH)
  }
  ctx.stroke()
  ctx.restore()

  // okvir kartice
  ctx.strokeStyle = LINE_STRONG
  ctx.lineWidth = 1.5
  roundRect(ctx, X0, Y0, innerW, innerH, 18)
  ctx.stroke()

  // logo gore levo
  if (logoImg) {
    const size = 76
    ctx.save()
    roundRect(ctx, X0 + (LABEL_W - size) / 2, Y0 + (HEAD_H - size) / 2, size, size, 16)
    ctx.clip()
    ctx.drawImage(logoImg, X0 + (LABEL_W - size) / 2, Y0 + (HEAD_H - size) / 2, size, size)
    ctx.restore()
  }

  // dani
  days.forEach((day, i) => {
    const cx = X0 + LABEL_W + i * DAY_W + DAY_W / 2
    ctx.fillStyle = INK
    ctx.font = `700 19px ${FONT}`
    ctx.fillText(t(DAY_NAMES[i]), cx, Y0 + HEAD_H / 2 - 8)
    ctx.fillStyle = MUTED
    ctx.font = `500 13px ${FONT}`
    ctx.fillText(shortDate(day), cx, Y0 + HEAD_H / 2 + 14)
  })

  // smene
  let top = Y0 + HEAD_H
  shifts.forEach((shift, si) => {
    const h = heights[si]
    const mid = top + h / 2
    const info = SHIFT_INFO[shift]
    const keys = slotsOf(week, shift)
    const lx = X0 + LABEL_W / 2

    if (shift === 'medjusmena') {
      ctx.fillStyle = INK
      ctx.font = `700 16px ${FONT}`
      ctx.fillText(t('Međusmena'), lx, mid - 14)
      ctx.fillStyle = MUTED
      ctx.font = `500 11px ${FONT}`
      ctx.fillText(`${t('radni dani')} 9:00–17:00`, lx, mid + 6)
      ctx.fillText(`${t('vikend')} 12:00–20:00`, lx, mid + 22)
    } else {
      ctx.fillStyle = BRAND
      ctx.font = `800 28px ${FONT}`
      ctx.fillText(info.roman, lx, mid - 17)
      ctx.fillStyle = INK
      ctx.font = `700 14px ${FONT}`
      ctx.fillText(t('smena'), lx, mid + 6)
      ctx.fillStyle = MUTED
      ctx.font = `500 12px ${FONT}`
      ctx.fillText(info.time(), lx, mid + 24)
    }

    // imena u poljima — samo ime (ili ime i slovo prezimena ako ih ima više istih)
    if (!blank) {
      days.forEach((day, di) => {
        const cx = X0 + LABEL_W + di * DAY_W + DAY_W / 2
        keys.forEach((slot, ki) => {
          const hit = slots.find((s) => s.day === day && s.shift === shift && s.slot === slot)
          if (!hit) return
          const name = t(shown.get(hit.profile_id) ?? '—')
          const cy = keys.length > 1 ? top + (h / keys.length) * (ki + 0.5) : mid
          const role = keys.length > 1 && SLOT_LABELS[slot] ? t(SLOT_LABELS[slot]) : null
          if (role) {
            ctx.fillStyle = MUTED
            ctx.font = `700 10px ${FONT}`
            ctx.fillText(role.toUpperCase(), cx, cy - 12)
          }
          ctx.fillStyle = INK
          ctx.font = `600 19px ${FONT}`
          ctx.fillText(name, cx, role ? cy + 7 : cy)
        })
        // Vreme se piše u polju samo kad je za taj dan drugačije od uobičajenog.
        if (hasCustomTime(week, shift, day)) {
          ctx.fillStyle = BRAND
          ctx.font = `700 12px ${FONT}`
          ctx.fillText(timeOf(week, shift, day), cx, top + h - 11)
        }
      })
    }
    top += h
  })

  return canvas
}

export function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Slika nije napravljena.'))), 'image/png')
    } catch (err) {
      reject(err)
    }
  })
}

/** Skida raspored kao PNG. Ako pregledač ne dozvoli sa logom, pokuša bez njega. */
export async function downloadScheduleImage(opts) {
  let canvas = await renderScheduleCanvas(opts)
  let blob
  try {
    blob = await canvasBlob(canvas)
  } catch {
    canvas = await renderScheduleCanvas({ ...opts, logo: false })
    blob = await canvasBlob(canvas)
  }
  const label = weekLabel(opts.week.week_start).replace(/[^\d]+/g, '-').replace(/^-|-$/g, '')
  const fileName = `raspored-${label}${opts.blank ? '-prazan' : ''}.png`

  // Na telefonu se slika šalje kroz sistemski meni za deljenje, gde stoji
  // „Sačuvaj sliku“ — tako završi u galeriji, a ne u fascikli sa preuzimanjima.
  try {
    const file = new File([blob], fileName, { type: 'image/png' })
    const touch = typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0
    if (touch && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] })
      return
    }
  } catch (err) {
    if (err?.name === 'AbortError') return // zatvorio je meni — nije greška
    // inače se preuzima običnim putem
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
