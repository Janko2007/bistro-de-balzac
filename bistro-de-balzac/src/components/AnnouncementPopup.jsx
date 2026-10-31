import Celebration from './Celebration'
import RichText from './RichText'

/**
 * Prozor obaveštenja — onako kako ga radnik vidi.
 *
 * Koristi ga i AnnouncementGate (radnici) i „Pregled“ kod admina, da pregled
 * izgleda tačno isto kao stvarno obaveštenje.
 *
 * Prikazuje samo ono što je admin napisao: sliku (cela, u punoj oštrini i
 * boji), naslov i poruku. Nema dodatnih znakova ni natpisa.
 *
 * photo: gotova adresa slike (ili null dok se učitava)
 * hasImage: da li obaveštenje uopšte ima sliku
 */
export default function AnnouncementPopup({
  item,
  photo = null,
  hasImage = false,
  counter = null,
  buttonLabel,
  onDismiss,
}) {
  return (
    <>
      {/* key: efekat kreće iznova za svako novo obaveštenje */}
      <Celebration key={item.id} effect={item.effect} />

      <div
        className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label={item.title || 'Obaveštenje'}
      >
        <div className="relative flex max-h-[94dvh] w-full max-w-md animate-zoom-in flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
          {counter && (
            <p className="absolute right-3 top-3 z-10 rounded-full bg-ink/60 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur">
              {counter}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Slika cela i neizmenjena — bez sečenja, bez filtera. */}
            {hasImage &&
              (photo ? (
                <img src={photo} alt="" className="block max-h-[70dvh] w-full bg-stone-50 object-contain" />
              ) : (
                <div className="h-64 animate-pulse bg-stone-100" />
              ))}

            {(item.title || item.body) && (
              <div className="px-6 pb-3 pt-6">
                {item.title && (
                  <h2 className="text-[22px] font-extrabold leading-tight tracking-tight text-stone-900">
                    {item.title}
                  </h2>
                )}
                {item.body && (
                  <RichText
                    body={item.body}
                    className={
                      'space-y-1 text-[16px] leading-relaxed text-stone-700 ' + (item.title ? 'mt-2' : '')
                    }
                  />
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 px-6 pb-6 pt-3">
            <button
              type="button"
              onClick={onDismiss}
              className="w-full rounded-2xl bg-ink px-5 py-3.5 text-base font-bold text-white transition hover:bg-ink-800 active:scale-[.99]"
            >
              {buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
