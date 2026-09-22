import { LOCALE } from '../lib/utils'

/**
 * Prikaz teksta pravila i obaveza.
 *
 * Vlasnik piše običan tekst, a znakovi na početku reda menjaju izgled:
 *   #  naslov     -  stavka sa tačkom     !  upozorenje (žuto)     !!  crveni tekst
 * Sve ostalo je običan red (i numerisani redovi „1. …“ ostaju kako su).
 * Red koji počinje sa „1. smena:“ dobija podebljanu oznaku smene.
 *
 * Naslov koji se zove kao današnji dan („# Utorak“) dobija oznaku DANAS —
 * tako radnik u Dnevnim obavezama odmah vidi šta je na redu.
 */
export default function RuleText({ body }) {
  const today = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' })
    .format(new Date())
    .toLowerCase()

  const blocks = parse(body)

  return (
    <div className="text-sm leading-relaxed text-stone-700">
      {blocks.map((block, i) => {
        if (block.type === 'h') {
          const isToday = block.text.trim().toLowerCase() === today
          return (
            <p
              key={i}
              className="mt-4 flex items-center gap-2 text-[13.5px] font-bold text-stone-900 first:mt-0"
            >
              {block.text}
              {isToday && (
                <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  danas
                </span>
              )}
            </p>
          )
        }

        if (block.type === 'ul') {
          return (
            <ul key={i} className="mt-1.5 list-disc space-y-1 pl-5 first:mt-0">
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )
        }

        if (block.type === 'red') {
          return (
            <p key={i} className="mt-1 font-medium text-rose-700 first:mt-0">
              {block.text}
            </p>
          )
        }

        if (block.type === 'warn') {
          return (
            <p
              key={i}
              className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-900 first:mt-0"
            >
              {block.text}
            </p>
          )
        }

        // „1. smena: …“ — oznaka smene podebljana, da se odmah vidi čija je obaveza.
        const shift = block.text.match(/^(\d+\.\s*smena:)\s*(.*)$/i)
        return (
          <p key={i} className="mt-1 first:mt-0">
            {shift ? (
              <>
                <strong className="font-semibold text-stone-900">{shift[1]}</strong> {shift[2]}
              </>
            ) : (
              block.text
            )}
          </p>
        )
      })}
    </div>
  )
}

/** Tekst → blokovi. Uzastopne stavke sa „-“ se spajaju u jednu listu. */
function parse(body) {
  const blocks = []
  let bullets = null

  const flush = () => {
    if (bullets) blocks.push({ type: 'ul', items: bullets })
    bullets = null
  }

  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.trim()

    if (!line) {
      flush()
      continue
    }
    if (/^[-•]\s+/.test(line)) {
      if (!bullets) bullets = []
      bullets.push(line.replace(/^[-•]\s+/, ''))
      continue
    }

    flush()
    if (line.startsWith('#')) blocks.push({ type: 'h', text: line.replace(/^#+\s*/, '') })
    // „!!“ se proverava pre „!“ — inače bi i crveni red postao žuto upozorenje.
    else if (line.startsWith('!!')) blocks.push({ type: 'red', text: line.replace(/^!!\s*/, '') })
    else if (line.startsWith('!')) blocks.push({ type: 'warn', text: line.replace(/^!\s*/, '') })
    else blocks.push({ type: 'p', text: line })
  }

  flush()
  return blocks
}
