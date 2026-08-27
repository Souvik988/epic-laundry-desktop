import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Banknote, CalendarClock, CheckCircle2, CircleAlert, ClipboardList, Loader2, PackageCheck, Plus, Truck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiGet } from '@/lib/api'
import type { LaundryDashboard as DashboardData, LaundryState } from '@/lib/laundry'
import { stateTone } from '@/lib/laundry'
import { cn, formatINR } from '@/lib/utils'

const stateLabels: Array<{ key: keyof DashboardData['kpis']; label: string; detail: string; icon: typeof ClipboardList; tone: string }> = [
  { key: 'booking', label: 'Booking', detail: 'New orders', icon: ClipboardList, tone: 'text-sky-700 bg-sky-100' },
  { key: 'delivery', label: 'Delivery', detail: 'Out with rider', icon: Truck, tone: 'text-orange-700 bg-orange-100' },
  { key: 'delivered', label: 'Delivered', detail: 'Completed', icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-100' },
]

export default function LaundryDashboard() {
  const query = useQuery({ queryKey: ['laundry-dashboard'], queryFn: () => apiGet<DashboardData>('/laundry/dashboard') })
  const data = query.data

  if (query.isError) return <Failure />
  if (!data) return <div className="grid h-80 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#3a7d78]" /></div>

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-7 duration-500">
      <section className="overflow-hidden rounded-[26px] bg-[#123039] p-6 text-[#edf3ec] shadow-[0_20px_45px_rgba(18,48,57,.18)] md:p-8">
        <div className="relative z-10 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-[#b8d3c8]">Daily control · {prettyDate(data.asOf)}</p>
            <h1 className="mt-3 max-w-xl font-serif text-3xl leading-tight md:text-4xl">A calm counter starts with a clear queue.</h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-[#c4d7d0]">Track what was collected, what needs attention, and what leaves the store next.</p>
          </div>
          <Link to="/laundry/new-order" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#e6bc65] px-4 py-3 text-sm font-bold text-[#17363e] transition hover:bg-[#f0cd7d]">
            <Plus className="h-4 w-4" /> Book an order
          </Link>
        </div>
        <div className="pointer-events-none absolute" />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Banknote} label="Collection amount" value={formatINR(data.kpis.collection)} note="Collected today" accent="#e6bc65" />
        <Kpi icon={ClipboardList} label="Order requests" value={String(data.kpis.orderRequests)} note="Waiting for a response" accent="#7db7d0" />
        <Kpi icon={PackageCheck} label="Pending orders" value={String(data.kpis.pendingOrders)} note="Across the store" accent="#85b59d" />
        <Kpi icon={CalendarClock} label="Upcoming delivery" value={String(data.kpis.upcomingDeliveries)} note="Due today or earlier" accent="#e5a76a" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.55fr_.9fr]">
        <div className="rounded-[22px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.05)] md:p-6">
          <SectionHeading eyebrow="Live queue" title="Order pipeline" action={<Link to="/laundry/orders" className="text-sm font-semibold text-[#2e716d] hover:text-[#174945]">View orders <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></Link>} />
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {stateLabels.map(({ key, label, detail, icon: Icon, tone }, index) => (
              <div key={label} className="relative rounded-2xl border border-[#263f44]/10 bg-[#fcfcfa] p-4">
                {index < 2 && <div className="absolute -right-4 top-1/2 z-10 hidden h-px w-5 bg-[#bed1c9] md:block" />}
                <span className={cn('mb-5 grid h-9 w-9 place-items-center rounded-xl', tone)}><Icon className="h-4 w-4" /></span>
                <p className="font-serif text-3xl tabular-nums text-[#15333a]">{data.kpis[key]}</p>
                <p className="mt-1 text-sm font-semibold">{label}</p>
                <p className="text-xs text-[#718087]">{detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-7 border-t border-[#263f44]/10 pt-5">
            <div className="flex items-center justify-between"><p className="text-sm font-semibold">Recent orders</p><p className="text-xs text-[#718087]">Live records from this device</p></div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="text-[11px] font-bold uppercase tracking-[.12em] text-[#75858a]"><tr><th className="pb-3">Order</th><th className="pb-3">Customer</th><th className="pb-3">Delivery</th><th className="pb-3">Amount</th><th className="pb-3">Status</th></tr></thead>
                <tbody>{data.recent.length ? data.recent.map((order) => <tr key={order.id} className="border-t border-[#263f44]/8"><td className="py-3 font-semibold text-[#205660]">{order.orderNumber}</td><td className="py-3"><span className="block font-medium">{order.customer.name}</span><span className="text-xs text-[#718087]">{order.itemCount} item{order.itemCount === 1 ? '' : 's'}</span></td><td className="py-3 text-[#617278]">{prettyDate(order.expectedDeliveryDate)}</td><td className="py-3 font-semibold tabular-nums">{formatINR(order.grandTotal)}</td><td className="py-3"><StatePill state={order.state} /></td></tr>) : <tr><td colSpan={5} className="py-10 text-center text-[#718087]">Your booked orders will appear here.</td></tr>}</tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="rounded-[22px] border border-[#263f44]/10 bg-[#fffdf8] p-5 shadow-[0_8px_28px_rgba(37,48,43,.05)] md:p-6">
          <SectionHeading eyebrow="Action list" title="Needs attention" />
          <div className="mt-5 space-y-2">
            {data.attention.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-[#263f44]/8 bg-white px-3 py-3.5"><span className={cn('h-2.5 w-2.5 rounded-full', item.tone === 'amber' ? 'bg-amber-400' : item.tone === 'rose' ? 'bg-rose-400' : item.tone === 'blue' ? 'bg-sky-400' : 'bg-slate-400')} /><span className="flex-1 text-sm font-medium">{item.label}</span><span className="grid h-7 min-w-7 place-items-center rounded-lg bg-[#eff2ee] px-1.5 text-sm font-bold tabular-nums">{item.count}</span></div>)}
          </div>
          <div className="mt-6 rounded-2xl bg-[#eaf3ef] p-4 text-sm text-[#315d57]"><CircleAlert className="mr-2 inline h-4 w-4" /><span className="font-semibold">Tip:</span> Move ready orders to delivery before the next rider dispatch.</div>
        </div>
      </section>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, note, accent }: { icon: typeof Banknote; label: string; value: string; note: string; accent: string }) {
  return <div className="rounded-[20px] border border-[#263f44]/10 bg-white p-5 shadow-[0_8px_28px_rgba(37,48,43,.04)]"><span className="grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: `${accent}33`, color: accent }}><Icon className="h-5 w-5" /></span><p className="mt-5 text-xs font-bold uppercase tracking-[.13em] text-[#718087]">{label}</p><p className="mt-1 font-serif text-3xl tabular-nums text-[#17353c]">{value}</p><p className="mt-1 text-xs text-[#74848a]">{note}</p></div>
}

function SectionHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) { return <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#4d8982]">{eyebrow}</p><h2 className="mt-1 font-serif text-2xl text-[#17353c]">{title}</h2></div>{action}</div> }
function StatePill({ state }: { state: LaundryState }) { return <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset', stateTone[state])}>{state}</span> }
function prettyDate(value: string) { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)) }
function Failure() { return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">The laundry dashboard could not be loaded. Confirm the local server is running, then refresh.</div> }
