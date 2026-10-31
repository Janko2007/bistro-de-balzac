import { Fragment } from 'react'

/**
 * Tekst obaveštenja sa malo oblikovanja — bez dodatnih biblioteka.
 *
 *   ## Podnaslov     red koji počinje sa „## “ je podnaslov
 *   **podebljano**   tekst između dve zvezdice je podebljan
 *
 * Sve ostalo ostaje kako je napisano (novi redovi se čuvaju). Radi i za
 * stara obaveštenja koja su običan tekst.
 */
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i} className="font-extrabold text-stone-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

export default function RichText({ body, className = '', subtitleClassName = '' }) {
  if (!body) return null
  const lines = String(body).split('\n')

  return (
    <div className={className}>
      {lines.map((line, i) =>
        line.startsWith('## ') ? (
          <p
            key={i}
            className={
              subtitleClassName || 'text-[17px] font-bold leading-snug text-stone-500'
            }
          >
            {inline(line.slice(3))}
          </p>
        ) : line.trim() === '' ? (
          <div key={i} className="h-3" aria-hidden="true" />
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {inline(line)}
          </p>
        ),
      )}
    </div>
  )
}

/** Podnaslov se čuva kao prvi red poruke: „## Podnaslov“. */
export function composeBody(subtitle, body) {
  const s = (subtitle ?? '').trim()
  const b = (body ?? '').trim()
  return [s ? `## ${s}` : '', b].filter(Boolean).join('\n')
}
