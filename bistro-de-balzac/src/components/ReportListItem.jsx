import { Link } from 'react-router-dom'
import { Badge } from './ui'
import {
  SHIFT_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
  formatDate,
  formatMoney,
} from '../lib/utils'

/**
 * Jedan red u spisku izveštaja.
 *
 * `compact` — samo datum, smena i stanje, bez iznosa (radnikov spisak);
 * iznosi se vide tek kad se izveštaj otvori.
 */
export default function ReportListItem({ report, showAuthor = false, compact = false }) {
  // Radnikov spisak: jedan red, iste kolone u svakom — datum | smena | stanje.
  // Svi redovi su iste visine i sve stoji poravnato, pa 8 izveštaja stane na
  // ekran telefona bez pomeranja.
  if (compact) {
    return (
      <Link
        to={`/izvestaj/${report.id}`}
        className="grid grid-cols-[80px_minmax(0,1fr)_auto_14px] items-center gap-x-2 px-3.5 py-[11px] transition hover:bg-slate-50 active:bg-slate-100"
      >
        <span className="whitespace-nowrap text-[13px] font-bold text-slate-900">
          {formatDate(report.report_date)}
        </span>
        <span className="truncate text-xs text-slate-500">
          {SHIFT_LABELS[report.shift] ?? report.shift}
        </span>
        {/* Manja oznaka nego inače, da i „Vraćen na ispravku“ stane u isti red. */}
        <Badge
          className={`${STATUS_STYLES[report.status]} justify-self-end whitespace-nowrap !px-2 !py-0.5 !text-[11px]`}
        >
          {STATUS_LABELS[report.status]}
        </Badge>
        <svg
          className="h-3.5 w-3.5 text-slate-300"
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
      </Link>
    )
  }

  // Vlasnikov spisak (Pregled je grupisan po danima — datum je već u traci
  // dana iznad): svaki red ista dva reda.
  //   gore:  smena · radnik              pazar
  //   dole:  kartice · predato           stanje
  // Svaki od dva reda se deli za sebe — gornji ima mesta koliko je širok
  // pazar, donji koliko je široka oznaka stanja.
  return (
    <Link
      to={`/izvestaj/${report.id}`}
      className="flex items-center gap-2.5 px-4 py-3 transition hover:bg-slate-50 active:bg-slate-100"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center justify-between gap-2.5">
          <span className="min-w-0 truncate text-[13.5px] text-slate-400">
            <span className="font-semibold text-slate-900">
              {SHIFT_LABELS[report.shift] ?? report.shift}
            </span>
            {showAuthor && report.created_by_name ? ` · ${report.created_by_name}` : ''}
          </span>
          {/* Pazar */}
          <span className="shrink-0 text-[15px] font-bold tabular-nums text-slate-900">
            {formatMoney(report.total_amount, false)}
          </span>
        </span>

        <span className="flex min-w-0 items-center justify-between gap-2.5">
          <span className="min-w-0 truncate text-[11px] tabular-nums text-slate-400">
            kartice {formatMoney(report.card_amount, false)} · predato{' '}
            {formatMoney(report.cash_amount, false)}
          </span>
          <Badge
            className={`${STATUS_STYLES[report.status]} shrink-0 whitespace-nowrap !px-2 !py-0.5 !text-[11px]`}
          >
            {STATUS_LABELS[report.status]}
          </Badge>
        </span>
      </span>

      <svg
        className="h-3.5 w-3.5 shrink-0 text-slate-300"
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
    </Link>
  )
}
