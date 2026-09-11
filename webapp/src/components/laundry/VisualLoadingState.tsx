import { Loader2, type LucideIcon } from 'lucide-react'

type VisualLoadingStateProps = {
  title: string
  detail: string
  icon?: LucideIcon
}

/**
 * A deliberate loading surface for operator pages. It keeps the workspace
 * visually grounded while a server-backed query is in flight and gives
 * automated visual review a stable, discoverable loading state.
 */
export default function VisualLoadingState({ title, detail, icon: Icon = Loader2 }: VisualLoadingStateProps) {
  return <section data-testid="page-loading" aria-live="polite" className="grid min-h-[18rem] place-items-center rounded-[24px] border border-[#263f44]/10 bg-white px-6 py-12 shadow-[0_8px_28px_rgba(37,48,43,.04)]">
    <div className="max-w-sm text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eeeaff] text-[#664cf0]">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 font-display text-lg font-bold tracking-[-.02em] text-[#17353c]">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-[#718087]">{detail}</p>
      <div className="mx-auto mt-5 flex items-center justify-center gap-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[#39786f]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Reading local records
      </div>
    </div>
  </section>
}
