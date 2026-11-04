import { CARD, H2 } from "@/app/ui/kit";

/** A card in the product page's action grid: title, state on the right, then its body. */
export function ActionCard({ id, title, state, stateClass = "text-muted", wide = false, children }) {
  return (
    <section id={id} aria-label={title} className={`${CARD} flex scroll-mt-4 flex-col gap-2 px-[18px] py-4 ${wide ? "md:col-span-2" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={H2}>{title}</h2>
        {state && <span className={`text-xs font-semibold ${stateClass}`}>{state}</span>}
      </div>
      {children}
    </section>
  );
}
