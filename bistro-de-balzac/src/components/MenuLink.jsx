import { Card } from './ui'

/** Adresa sajta sa kartom pića. */
const MENU_URL = 'https://meni.bistrodebalzac.rs/'

/**
 * Karta pića — posebna kartica; klik otvara sajt sa menijem u novom prozoru.
 * Isti red je u Profilu radnika i u Podešavanjima admina (ispod Artikala).
 */
export default function MenuLink() {
  return (
    <Card>
      <a
        href={MENU_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition hover:bg-stone-50"
      >
        <svg
          className="h-4 w-4 shrink-0 text-stone-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="min-w-0 flex-1 text-base font-extrabold tracking-tight text-stone-900">Karta pića</span>
        <svg
          className="h-4 w-4 shrink-0 text-stone-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
        </svg>
      </a>
    </Card>
  )
}
