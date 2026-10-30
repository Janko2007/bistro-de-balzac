import Celebration from './Celebration'

/**
 * Prozor obaveštenja — onako kako ga radnik vidi.
 *
 * Koristi ga i AnnouncementGate (radnici) i „Pregled“ kod admina, da pregled
 * izgleda tačno isto kao stvarno obaveštenje.
 *
 * photo: gotova adresa slike (ili null dok se učitava)
 * hasImage: da li obaveštenje uopšte ima sliku
 */
export default function AnnouncementPopup({
  item,
  photo = null,
  hasImage = false,
  heading = null,
  counter = null,
  buttonLabel,
  onDismiss,
}) {
  return (
    <>
      {/* key: efekat kreće iznova za svako novo obaveštenje */}
      <Celebration key={item.id} effect={item.effect} />

      <div
        className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label={item.title || 'Obaveštenje'}
      >
        <div className="relative flex max-h-[94dvh] w-full max-w-sm animate-zoom-in flex-col overflow-hidden rounded-[2rem] bg-white text-center shadow-2xl">
          {/* Narandžasta traka — da prozor ne bude samo crno-beli. */}
          <div className="h-1.5 shrink-0 bg-gradient-to-r from-brand-500 via-brand-600 to-amber-400" aria-hidden="true" />

          {counter && (
            <p className="absolute right-3 top-4 z-10 rounded-full bg-ink/60 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur">
              {counter}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Slika ide preko cele širine, cela, bez sečenja. */}
            {hasImage && (
              <div className="bg-gradient-to-b from-brand-50 to-stone-100">
                {photo ? (
                  <img src={photo} alt="" className="mx-auto block max-h-[62dvh] w-full object-contain" />
                ) : (
                  <div className="h-56 animate-pulse bg-stone-200" />
                )}
              </div>
            )}

            <div className={hasImage ? 'px-6 pb-2 pt-5' : 'px-6 pb-2 pt-8'}>
              {/* Znak: velik kad nema slike, a uz sliku samo u malom krugu. */}
              {!hasImage ? (
                <div
                  className="mx-auto flex h-24 w-24 items-center justify-center rounded-[1.75rem] bg-brand-50 text-6xl leading-none ring-1 ring-inset ring-brand-600/15"
                  aria-hidden="true"
                >
                  {item.icon || '📣'}
                </div>
              ) : (
                (item.title || item.body) && (
                  <div className="text-3xl leading-none" aria-hidden="true">
                    {item.icon || '📣'}
                  </div>
                )
              )}

              {heading && (
                <p className="mt-4 text-sm font-bold uppercase tracking-wider text-brand-600">{heading}</p>
              )}

              {item.title && (
                <h2 className="mt-3 text-xl font-extrabold leading-tight tracking-tight text-stone-900">
                  {item.title}
                </h2>
              )}

              {item.body && (
                <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-stone-600">{item.body}</p>
              )}
            </div>
          </div>

          <div className="shrink-0 px-6 pb-6 pt-4">
            <button
              type="button"
              onClick={onDismiss}
              className="w-full rounded-2xl bg-brand-600 px-5 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-brand-700 active:scale-[.99]"
            >
              {buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
