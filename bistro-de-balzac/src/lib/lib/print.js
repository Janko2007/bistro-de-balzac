/**
 * Štampa i PDF — zajednički izgled za sve izveštaje.
 *
 * Svi izveštaji (smene, uplate, prodaja, popis, dnevnice) idu kroz ovu
 * datoteku, pa izgledaju isto: isto zaglavlje sa logom, iste tabele, isti
 * potpis na dnu. Pravi se obična HTML stranica i otvara se prozor za štampu —
 * odatle se bira štampač ili „Sačuvaj kao PDF“ (na telefonu: Podeli → Štampaj).
 *
 * Zašto ne gotova PDF biblioteka? Ona bi aplikaciji dodala nekoliko stotina
 * kilobajta, a pregledač i sam pravi PDF — i to sa ispravnim našim slovima,
 * prelomom strana i ponovljenim zaglavljem tabele na svakoj strani.
 */

import { APP_NAME } from './supabaseClient'
import { formatDateTime } from './utils'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Tekst u HTML — da naziv artikla sa „&“ ili „<“ ne pokvari stranicu. */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c])

/* ------------------------------------------------------------------ */
/*  Delovi izveštaja                                                   */
/* ------------------------------------------------------------------ */

/** Red sa zbirovima na vrhu izveštaja: [{ label, value, sub }] */
export function statGrid(items = []) {
  const list = items.filter(Boolean)
  if (list.length === 0) return ''
  return `<div class="stats">${list
    .map(
      (s) => `<div class="stat">
        <span class="stat-l">${esc(s.label)}</span>
        <span class="stat-v">${esc(s.value)}</span>
        ${s.sub ? `<span class="stat-s">${esc(s.sub)}</span>` : ''}
      </div>`,
    )
    .join('')}</div>`
}

/** Naslov iznad tabele ili bloka. */
export function heading(text, note = '') {
  return `<h2 class="h2">${esc(text)}${note ? `<span>${esc(note)}</span>` : ''}</h2>`
}

/** Blok sa tekstom (napomena radnika, poruka admina…). */
export function textBlock(title, body) {
  if (!body) return ''
  return `<div class="note"><p class="note-t">${esc(title)}</p><p class="note-b">${esc(body)}</p></div>`
}

/**
 * Tabela.
 *   columns: [{ label, align, width }]
 *   rows:    red je niz ćelija, ili { kind: 'group' | 'total', ... }
 *   ćelija:  vrednost, ili { value, align, strong, muted }
 */
export function table({ columns = [], rows = [], empty = 'Nema podataka.' }) {
  if (rows.length === 0) return `<p class="empty">${esc(empty)}</p>`

  const head = columns
    .map(
      (c) =>
        `<th class="${c.align === 'right' ? 'r' : c.align === 'center' ? 'c' : ''}"${
          c.width ? ` style="width:${c.width}"` : ''
        }>${esc(c.label)}</th>`,
    )
    .join('')

  const body = rows.map((row) => rowHtml(row, columns)).join('')

  return `<table class="t">
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

function cellHtml(cell, column, extra = '') {
  const c = cell && typeof cell === 'object' ? cell : { value: cell }
  const align = c.align ?? column?.align ?? 'left'
  const cls = [
    align === 'right' ? 'r' : align === 'center' ? 'c' : '',
    c.strong ? 'b' : '',
    c.muted ? 'm' : '',
    extra,
  ]
    .filter(Boolean)
    .join(' ')
  return `<td${cls ? ` class="${cls}"` : ''}>${esc(c.value)}</td>`
}

function rowHtml(row, columns) {
  if (Array.isArray(row)) {
    return `<tr>${columns.map((col, i) => cellHtml(row[i], col)).join('')}</tr>`
  }

  // Red sa nazivom grupe (kategorija, datum…) preko cele širine.
  if (row.kind === 'group') {
    return `<tr class="g">
      <td colspan="${Math.max(1, columns.length - 1)}">${esc(row.label)}</td>
      <td class="r">${esc(row.right ?? '')}</td>
    </tr>`
  }

  if (row.kind === 'total') {
    return `<tr class="tot">${columns
      .map((col, i) => cellHtml(row.cells?.[i], col))
      .join('')}</tr>`
  }

  return `<tr${row.muted ? ' class="dim"' : ''}>${columns
    .map((col, i) => cellHtml(row.cells?.[i], col))
    .join('')}</tr>`
}

/**
 * Polja koja se popunjavaju rukom (datum, smena, potpis…) — kao kućice u
 * zaglavlju odštampanog popisa.
 */
export function blankFields(labels = []) {
  if (labels.length === 0) return ''
  return `<div class="stats">${labels
    .map(
      (l) => `<div class="stat blank">
        <span class="stat-l">${esc(l)}</span>
        <span class="stat-v">&nbsp;</span>
      </div>`,
    )
    .join('')}</div>`
}

/* ------------------------------------------------------------------ */
/*  Stranica                                                           */
/* ------------------------------------------------------------------ */

const STYLE = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 18px 20px 28px;
    background: #f1efeb;
    color: #1c1917;
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    max-width: 800px;
    margin: 0 auto;
    background: #fff;
    padding: 26px 26px 22px;
    border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,.08);
  }

  /* Traka sa dugmadima — vidi se samo na ekranu, ne i na papiru. */
  .tools {
    max-width: 800px;
    margin: 0 auto 14px;
    display: flex; gap: 8px; align-items: center;
  }
  .tools button {
    font: inherit; font-weight: 700; font-size: 13px;
    padding: 9px 15px; border-radius: 10px; border: 0; cursor: pointer;
    background: #ef5f07; color: #fff;
  }
  .tools button.sec { background: #fff; color: #44403c; border: 1px solid #d6d3d1; }
  .tools p { margin: 0 0 0 auto; font-size: 11.5px; color: #78716c; }

  header.top {
    display: flex; align-items: flex-start; gap: 12px;
    padding-bottom: 12px; border-bottom: 2px solid #1c1917;
  }
  header.top img { width: 38px; height: 38px; border-radius: 9px; }
  .brand { font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #78716c; }
  h1 { margin: 2px 0 0; font-size: 20px; font-weight: 800; letter-spacing: -.02em; }
  .sub { margin: 3px 0 0; font-size: 12px; color: #57534e; }
  .meta { margin-left: auto; text-align: right; font-size: 11px; color: #57534e; line-height: 1.6; }
  .meta b { color: #1c1917; }

  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; }
  .stat {
    flex: 1 1 0; min-width: 104px;
    border: 1px solid #e7e5e4; border-radius: 10px; padding: 8px 10px;
    background: #faf9f7;
  }
  .stat-l { display: block; font-size: 9.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #78716c; }
  .stat-v { display: block; margin-top: 2px; font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .stat-s { display: block; font-size: 10px; color: #a8a29e; }
  .stat.blank { border-style: dashed; background: #fff; }

  .h2 {
    display: flex; align-items: baseline; gap: 8px;
    margin: 18px 0 7px; font-size: 13px; font-weight: 800;
    letter-spacing: .04em; text-transform: uppercase;
  }
  .h2 span { font-size: 11px; font-weight: 600; letter-spacing: 0; text-transform: none; color: #78716c; }

  table.t { width: 100%; border-collapse: collapse; }
  table.t th {
    text-align: left; padding: 6px 7px;
    font-size: 9.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase;
    color: #57534e; border-bottom: 1.5px solid #1c1917;
  }
  table.t td {
    padding: 5px 7px; font-size: 11.5px; border-bottom: 1px solid #ededea;
    vertical-align: top;
  }
  table.t .r { text-align: right; font-variant-numeric: tabular-nums; }
  table.t .c { text-align: center; }
  table.t .b { font-weight: 700; }
  table.t .m { color: #a8a29e; }
  table.t tr.dim td { color: #a8a29e; }
  table.t tr.g td {
    background: #f3efe9; font-size: 10.5px; font-weight: 800;
    letter-spacing: .05em; text-transform: uppercase; color: #44403c;
    border-bottom: 1px solid #e0dbd2; padding: 5px 7px;
  }
  /* Zbir grupe stoji u jednom redu, ma koliko kolona bilo. */
  table.t tr.g td:last-child { white-space: nowrap; text-align: right; }
  table.t tr.tot td {
    font-weight: 800; font-size: 12px;
    border-top: 1.5px solid #1c1917; border-bottom: 0; padding-top: 7px;
  }

  .note { margin-top: 12px; border-left: 3px solid #e7e5e4; padding: 2px 0 2px 10px; }
  .note-t { margin: 0; font-size: 9.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #78716c; }
  .note-b { margin: 3px 0 0; font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; }
  .empty { margin: 8px 0; font-size: 11.5px; color: #a8a29e; }

  footer.bot {
    margin-top: 20px; padding-top: 8px; border-top: 1px solid #e7e5e4;
    display: flex; gap: 10px; align-items: center;
    font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; color: #a8a29e;
  }
  footer.bot span:last-child { margin-left: auto; }

  @media print {
    body { background: #fff; padding: 0; }
    .page { max-width: none; box-shadow: none; border-radius: 0; padding: 0; }
    .tools { display: none; }
    table.t { page-break-inside: auto; }
    table.t thead { display: table-header-group; }
    table.t tr { page-break-inside: avoid; }
    .stats, .note { page-break-inside: avoid; }
    .h2 { page-break-after: avoid; }
  }
`

/**
 * Otvara izveštaj u novom prozoru i poziva štampu.
 *
 *   title    — naslov izveštaja
 *   subtitle — šta tačno obuhvata (period, filteri…)
 *   meta     — [{ label, value }] gore desno
 *   content  — HTML (statGrid, heading, table, textBlock…)
 *   landscape— true za široke tabele
 *   extraCss — dodatni stil samo za taj izveštaj (npr. viši redovi za ručno popunjavanje)
 */
export function printDocument({
  title,
  subtitle = '',
  meta = [],
  content = '',
  landscape = false,
  extraCss = '',
}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  // `auto` = stranica sama otvori štampu. U skrivenom okviru to radi
  // aplikacija, pa se tamo ovaj deo izostavlja — inače bi se dijalog za
  // štampu otvorio dvaput.
  const buildHtml = (auto) => `<!doctype html>
<html lang="sr-Latn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(APP_NAME)}</title>
<style>@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 13mm 11mm; }${STYLE}${extraCss}</style>
</head>
<body>
  <div class="tools">
    <button type="button" onclick="window.print()">Štampaj / Sačuvaj kao PDF</button>
    <button type="button" class="sec" onclick="window.close()">Zatvori</button>
    <p>Na telefonu: Podeli → Štampaj → Sačuvaj kao PDF</p>
  </div>

  <div class="page">
    <header class="top">
      <img src="${origin}/icons/icon-192.png" alt="">
      <div>
        <p class="brand">${esc(APP_NAME)}</p>
        <h1>${esc(title)}</h1>
        ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}
      </div>
      <div class="meta">
        ${meta
          .filter(Boolean)
          .map((m) => `<div>${esc(m.label)}: <b>${esc(m.value)}</b></div>`)
          .join('')}
      </div>
    </header>

    ${content}

    <footer class="bot">
      <span>${esc(APP_NAME)}</span>
      <span>Odštampano ${esc(formatDateTime(new Date().toISOString()))}</span>
    </footer>
  </div>

  ${
    auto
      ? `<script>
    window.addEventListener('load', function () {
      setTimeout(function () { try { window.print() } catch (e) {} }, 350)
    })
  </script>`
      : ''
  }
</body>
</html>`

  const win = window.open('', '_blank')
  if (win) {
    win.document.open()
    win.document.write(buildHtml(true))
    win.document.close()
    return true
  }

  // Pregledač je blokirao novi prozor (često u aplikaciji sa početnog ekrana)
  // — onda se štampa iz skrivenog okvira u samoj stranici.
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0'
  document.body.appendChild(frame)

  const doc = frame.contentWindow?.document
  if (!doc) {
    frame.remove()
    return false
  }
  doc.open()
  doc.write(buildHtml(false))
  doc.close()

  setTimeout(() => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } catch {
      /* ništa — korisnik dobija poruku iz ekrana koji je zvao štampu */
    }
    setTimeout(() => frame.remove(), 60_000)
  }, 400)

  return true
}
