/** Narandžasta oznaka „MEĐU“ pored imena onoga ko je radio međusmenu. */
export default function MidMark({ className = '' }) {
  return (
    <span
      title="Međusmena"
      className={`inline-block shrink-0 whitespace-nowrap rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-brand-800 ${className}`}
    >
      Među
    </span>
  )
}
