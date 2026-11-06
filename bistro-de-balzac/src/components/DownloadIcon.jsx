/**
 * Ikonica „preuzmi“ — strelica nadole u korpi. Zamenjuje tekst „Preuzmi“ na
 * dugmadima; ime dugmeta se čita iz aria-label, a vidi se i kad se zadrži miš.
 */
export default function DownloadIcon({ className = 'h-[18px] w-[18px]' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v11.4M7.6 11l4.4 4.4 4.4-4.4M4.8 14.8V18.6a1.4 1.4 0 0 0 1.4 1.4h11.6a1.4 1.4 0 0 0 1.4-1.4V14.8" />
    </svg>
  )
}
