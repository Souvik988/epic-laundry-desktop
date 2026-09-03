import { NavLink } from 'react-router-dom'
import { Banknote, BarChart3, ClipboardCheck, FileWarning, Landmark, Printer, ReceiptText, Settings2, WalletCards } from 'lucide-react'

type FinanceWorkstream = {
  to: string
  title: string
  description: string
  action: string
  icon: typeof Banknote
}

const workstreams: FinanceWorkstream[] = [
  { to: '/laundry/management', title: 'Management control', description: 'See financial readiness, quality risk and workforce capacity without fabricated EBITDA or statutory outcomes.', action: 'Open control room', icon: BarChart3 },
  { to: '/laundry/cash-closing', title: 'Cash closing', description: 'Close the counter shift against actual cash collection and recorded payments.', action: 'Close a cash shift', icon: Banknote },
  { to: '/laundry/expenses', title: 'Store expenses', description: 'Record operating expenses with accountable amounts and supporting context.', action: 'Review expenses', icon: WalletCards },
  { to: '/laundry/settlements', title: 'Rider settlements', description: 'Reconcile rider collections and handoffs against the orders they completed.', action: 'Open settlements', icon: Landmark },
  { to: '/laundry/print-centre', title: 'Invoices & receipts', description: 'Produce customer-facing invoices and receipts from the authoritative order data.', action: 'Open documents', icon: Printer },
  { to: '/laundry/reports', title: 'Financial reports', description: 'Review sales, collections and operating performance from local records.', action: 'Open reports', icon: ReceiptText },
  { to: '/laundry/settings', title: 'Tax & invoice readiness', description: 'Maintain store tax configuration, invoice identity and document settings.', action: 'Open store settings', icon: Settings2 },
  { to: '/laundry/corrections', title: 'Correction documents', description: 'Create controlled corrections for the underlying customer and order history.', action: 'Review corrections', icon: FileWarning },
]

export default function LaundryFinanceHub() {
  return <section className="animate-in fade-in slide-in-from-bottom-2 duration-500">
    <div className="max-w-3xl">
      <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#39786f]">Finance & compliance</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-.035em] text-[#17353c]">Money and documents that trace back to work done.</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[#617178]">Finance is part of the Laundry Desk: every cash movement, settlement and document originates from the same store and order lifecycle—not a disconnected accounting prototype.</p>
    </div>
    <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {workstreams.map((item) => <NavLink key={item.to} to={item.to} className="group rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-5 shadow-[0_1px_1px_rgba(12,42,48,.03)] transition hover:-translate-y-0.5 hover:border-[#39786f]/30 hover:shadow-[0_14px_30px_rgba(12,42,48,.09)]">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e7f3ef] text-[#277267]"><item.icon className="h-5 w-5" /></span>
        <h2 className="mt-5 font-display text-lg font-semibold tracking-[-.02em] text-[#17353c]">{item.title}</h2>
        <p className="mt-2 min-h-12 text-sm leading-6 text-[#617178]">{item.description}</p>
        <span className="mt-5 inline-flex text-xs font-extrabold text-[#277267] group-hover:text-[#17353c]">{item.action} <span className="ml-1 transition-transform group-hover:translate-x-0.5">→</span></span>
      </NavLink>)}
    </div>
    <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[#e2c482]/50 bg-[#fff7df] p-4 text-sm text-[#775919]">
      <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0" />
      <p><strong>Compliance boundary:</strong> the system will show configuration and evidence states. It does not claim GST, e-invoice or provider success without an actual configured and verified integration.</p>
    </div>
  </section>
}
